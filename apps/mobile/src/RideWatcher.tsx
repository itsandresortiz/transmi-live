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
import { useTrip } from "./trip";
import { endTripActivity, showTripActivity } from "../modules/tripactivity/src";
import { SYSTEM_COLOR } from "./ui/theme";
import { router, usePathname } from "expo-router";
import { useLaunch } from "./ui/Launch";

const TAG = "ride";
const EVERY_MS = 5000;
/** Si el bus deja de reportar este tiempo (con otros buses sí reportando), se da el viaje por terminado. */
const GONE_MS = 10 * 60_000;
let lastAlight: string | null = null;

/** Vigila el viaje en curso mientras la app esté abierta: mantiene la pantalla encendida, vibra y reprograma los avisos con la hora más reciente de llegada. */
export function RideWatcher() {
  const busId = useRide((s) => s.busId), alightId = useRide((s) => s.alightId);

  useEffect(() => {
    if (!busId || !alightId) { void cancelAlerts(); if (!useTrip.getState().it) void endTripActivity(); return; }
    let warned = 99, shown = "", seen = false, missingSince = 0;
    // si se cambió la parada de bajada, los avisos de la anterior ya no sirven
    if (lastAlight && lastAlight !== alightId) void cancelAlerts();
    lastAlight = alightId;
    void activateKeepAwakeAsync(TAG).catch(() => undefined);
    const finish = () => { void cancelAlerts(); if (!useTrip.getState().it) void endTripActivity(); useRide.getState().clear(); };

    const tick = () => {
      const v = transit.fleet.get(busId), target = transit.stopById(alightId);
      const seq = v ? transit.sequenceForDisplay(v) : undefined;
      // el bus dejó de reportar (y otros sí): tras un rato se da por terminado, para no dejar la pantalla encendida y el aviso fijo para siempre
      if (!v) { if (transit.fleet.size > 0) { missingSince ||= Date.now(); if (seen && Date.now() - missingSince > GONE_MS) finish(); } return; }
      missingSince = 0;
      if (!seq || !target) return;
      const ti = seq.shape.stopIds.indexOf(alightId, Math.max(0, seq.index));
      // ya pasó tu parada (p. ej. la app estaba cerrada cuando llegó): el viaje terminó
      if (ti < 0) { if (seen) finish(); return; }
      seen = true;
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
      // lo mismo en la pantalla de bloqueo y la isla dinámica (si no hay ya un viaje de «Cómo llegar» ocupándola)
      if (!useTrip.getState().it && left > 0) {
        const eta = at(ti), key = `${left}|${Math.round(eta / 20)}`, total = Math.max(useRide.getState().total, left, 1), route = transit.routeOf(v);
        if (key !== shown) {
          shown = key;
          void showTripActivity(name, {
            title: `Vas en el ${route?.shortName ?? "bus"}`, detail: left === 1 ? `La siguiente parada es la tuya: ${name}.` : `Te bajas en ${name}. Faltan ${left} paradas.`,
            badge: route?.shortName ?? "", color: SYSTEM_COLOR[v.system], until: eta, untilLabel: "Te bajas en",
            step: total - left, steps: total, arrive: eta, link: `transmilive:///ride/${busId}`,
          }).then((ok) => { if (!ok && shown === key) shown = ""; });   // si no se pudo mostrar (permiso aún en pantalla), se reintenta
        }
      }
      if (left <= 0) finish();
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
    const openTrip = () => { if (pathRef.current !== "/trip") setTimeout(() => router.push("/trip"), 150); };
    return onAlertTap((d) => {
      const ride = useRide.getState();
      if (!ride.busId) ride.set(d.busId, d.alightId, d.total);
      if (pathRef.current !== `/ride/${d.busId}`) setTimeout(() => router.push({ pathname: "/ride/[id]", params: { id: d.busId } }), 150);
    }, openTrip);
  }, [launched]);

  return null;
}
