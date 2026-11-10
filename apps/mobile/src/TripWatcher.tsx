import { useEffect } from "react";
import { AppState } from "react-native";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { advanceGuide, busForLeg, liveShift, pendingAlerts } from "@transmi/application";
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
    let here: { lat: number; lon: number } | null = null, hereAt = 0, gone = false, lastKey = "", lateFor = -1;
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
      const fresh = here && Date.now() - hereAt < 60_000 ? here : null;
      // el bus real de este tramo (el que viene hacia tu parada o en el que vas): su hora corre todos los avisos que faltan
      let shift = st.shift, busId: string | null = null;
      if (leg?.kind === "ride") {
        busId = busForLeg(transit, leg, st.guide.phase, fresh, now, st.busId ?? undefined) ?? null;
        const live = liveShift(transit, leg, st.guide.phase, busId ?? undefined, nowMs());
        if (live != null) shift = live;
        // el bus que esperas viene bastante más tarde de lo previsto: se avisa una vez por tramo
        if (st.guide.phase === "wait" && live != null && live >= 300 && lateFor !== st.guide.leg) {
          lateFor = st.guide.leg;
          void scheduleTrip([...pendingAlerts(it, st.guide, placeText, shift), { id: `late-${st.guide.leg}`, at: Date.now() / 1000 + 3, title: `El ${leg.shortName} viene con retraso`, body: `Llega unos ${Math.round(live / 60)} min más tarde de lo previsto. Abre el viaje para ver otra opción.` }]);
        }
      }
      const g = advanceGuide(it, st.guide, fresh, now, shift);
      if (g.phase === "done") { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); st.stop(); return; }
      if (g.leg !== st.guide.leg || g.phase !== st.guide.phase) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      const moved = g.leg !== st.guide.leg || g.phase !== st.guide.phase;
      if (moved || shift !== st.shift || busId !== st.busId) st.update(g, moved ? shift : shift, moved ? null : busId);
      const key = `${g.leg}${g.phase}${Math.round(shift / 20)}`;
      if (key !== lastKey) { lastKey = key; void scheduleTrip(pendingAlerts(it, g, placeText, shift)); }
    };
    tick();
    const timer = setInterval(() => { if (AppState.currentState === "active") tick(); }, EVERY_MS);
    return () => { gone = true; clearInterval(timer); sub?.remove(); };
  }, [it]);

  return null;
}

