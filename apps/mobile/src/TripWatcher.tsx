import { useEffect } from "react";
import { AppState } from "react-native";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { advanceGuide, arrivalAtIndex, pendingAlerts } from "@transmi/application";
import { transit } from "./composition-root";
import { nowMs } from "./clock";
import { cancelTrip, scheduleTrip } from "./notify";
import { placeText, useTrip } from "./trip";

const EVERY_MS = 5000;

/** Vigila el viaje de «Cómo llegar» que se está siguiendo: con la app abierta usa tu ubicación y el bus en vivo para saber en qué paso vas
 *  y deja programados los avisos de lo que falta. Con la app en segundo plano los avisos salen a la hora estimada (no se usa la ubicación en segundo plano). */
export function TripWatcher() {
  const it = useTrip((s) => s.it);

  useEffect(() => {
    if (!it) { void cancelTrip(); return; }
    let here: { lat: number; lon: number } | null = null, hereAt = 0, gone = false, lastKey = "";
    let sub: Location.LocationSubscription | undefined;
    void (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted || gone) return;
        sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, distanceInterval: 20 }, (p) => { here = { lat: p.coords.latitude, lon: p.coords.longitude }; hereAt = Date.now(); });
        if (gone) sub.remove();
      } catch { /* sin ubicación: la guía avanza con la hora prevista */ }
    })();

    const tick = () => {
      const st = useTrip.getState();
      if (!st.it) return;
      const now = nowMs() / 1000, leg = it.legs[st.guide.leg];
      // si se conoce el bus de este tramo, su hora real corre todos los avisos que faltan
      let shift = st.shift;
      if (leg?.kind === "ride" && leg.busId) {
        const v = transit.fleet.get(leg.busId), seq = v ? transit.sequenceForDisplay(v) : undefined;
        if (v && seq) {
          const riding = st.guide.phase === "ride";
          const ti = seq.shape.stopIds.indexOf(riding ? leg.alight.id : leg.board.id, Math.max(0, seq.index));
          if (ti >= 0) { const eta = arrivalAtIndex(transit, v, seq.shape, seq.index, ti, nowMs()); if (eta > 0) shift = Math.round(eta - (riding ? leg.arriveAt : leg.departAt)); }
        }
      }
      const fresh = here && Date.now() - hereAt < 60_000 ? here : null;
      const g = advanceGuide(it, st.guide, fresh, now, shift);
      if (g.phase === "done") { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); st.stop(); return; }
      if (g.leg !== st.guide.leg || g.phase !== st.guide.phase) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      if (g.leg !== st.guide.leg || g.phase !== st.guide.phase || shift !== st.shift) st.update(g, shift);
      const key = `${g.leg}${g.phase}${Math.round(shift / 20)}`;
      if (key !== lastKey) { lastKey = key; void scheduleTrip(pendingAlerts(it, g, placeText, shift)); }
    };
    tick();
    const timer = setInterval(() => { if (AppState.currentState === "active") tick(); }, EVERY_MS);
    return () => { gone = true; clearInterval(timer); sub?.remove(); };
  }, [it]);

  return null;
}

