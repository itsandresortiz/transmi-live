import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import * as Haptics from "expo-haptics";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { arrivalAtIndex } from "@transmi/application";
import { transit } from "./composition-root";
import { nowMs } from "./clock";
import { cancelAlerts, onAlertTap, schedule } from "./notify";
import { stopText } from "./stopname";
import { useRide } from "./ride";
import { router, usePathname } from "expo-router";
import { useLaunch } from "./ui/Launch";

const TAG = "ride";
const EVERY_MS = 5000;

/** Vigila el viaje en curso mientras la app esté abierta: mantiene la pantalla encendida, vibra y reprograma los avisos con la hora más reciente de llegada. */
export function RideWatcher() {
  const busId = useRide((s) => s.busId), alightId = useRide((s) => s.alightId);

  useEffect(() => {
    if (!busId || !alightId) { void cancelAlerts(); return; }
    let warned = 99;
    void activateKeepAwakeAsync(TAG).catch(() => undefined);

    const tick = () => {
      const v = transit.fleet.get(busId), target = transit.stopById(alightId);
      const seq = v ? transit.sequenceForDisplay(v) : undefined;
      if (!v || !seq || !target) return;
      const ti = seq.shape.stopIds.indexOf(alightId, Math.max(0, seq.index));
      if (ti < 0) return;
      const left = ti - seq.index, now = nowMs();
      const name = stopText(target, "tu parada");
      const at = (j: number) => arrivalAtIndex(transit, v, seq.shape, seq.index, j, now);

      // vibración y avisos mientras la app está abierta
      if (left <= 0 && warned > 0) { warned = 0; void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }
      else if (left === 1 && warned > 1) { warned = 1; void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); }
      else if (left === 3 && warned > 3) { warned = 3; void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }

      // avisos del teléfono (también si la app queda en segundo plano): se programan con la última hora estimada
      const data = { busId, alightId, total: useRide.getState().total };
      if (left >= 3) void schedule("ride-3", at(ti - 3), "Faltan 3 paradas", `Te bajas en ${name}.`, data);
      if (left >= 2) void schedule("ride-1", at(ti - 1), "Prepárate para bajar", `La siguiente parada es ${name}.`, data);
      if (left >= 1) void schedule("ride-0", at(ti) - 20, "Bájate aquí", `Estás llegando a ${name}.`, data);
      if (left <= 0) { void cancelAlerts(); useRide.getState().clear(); }
    };
    tick();
    const timer = setInterval(() => { if (AppState.currentState === "active") tick(); }, EVERY_MS);
    return () => { clearInterval(timer); void deactivateKeepAwake(TAG).catch(() => undefined); };
  }, [busId, alightId]);

  // tocar un aviso abre ese viaje (para ver cuánto falta o quitar el aviso); si la app se había cerrado, se recupera dónde te bajas
  const path = usePathname(), pathRef = useRef(path);
  pathRef.current = path;
  const launched = useLaunch((s) => s.done);
  useEffect(() => {
    if (!launched) return;
    return onAlertTap((d) => {
      const ride = useRide.getState();
      if (!ride.busId) ride.set(d.busId, d.alightId, d.total);
      if (pathRef.current !== `/ride/${d.busId}`) setTimeout(() => router.push({ pathname: "/ride/[id]", params: { id: d.busId } }), 150);
    });
  }, [launched]);

  return null;
}
