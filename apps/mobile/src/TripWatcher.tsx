import { useEffect } from "react";
import { AppState } from "react-native";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { advanceGuide, busForLeg, guideNow, legTimes, liveShift, pendingAlerts } from "@transmi/application";
import { transit } from "./composition-root";
import { nowMs } from "./clock";
import { cancelTrip, scheduleTrip } from "./notify";
import { placeText, useTrip } from "./trip";
import { endTripActivity, showTripActivity } from "../modules/tripactivity/src";
import { SYSTEM_COLOR } from "./ui/theme";

const EVERY_MS = 5000;

/** Vigila el viaje de «Cómo llegar» que se está siguiendo: con la app abierta usa tu ubicación y el bus en vivo para saber en qué paso vas
 *  y deja programados los avisos de lo que falta. Con la app en segundo plano los avisos salen a la hora estimada (no se usa la ubicación en segundo plano). */
export function TripWatcher() {
  const it = useTrip((s) => s.it);

  useEffect(() => {
    if (!it) { void cancelTrip(); void endTripActivity(); return; }
    let here: { lat: number; lon: number } | null = null, hereAt = 0, gone = false, lastKey = "", actKey = "", lateFor = -1;
    let late: { id: string; at: number; title: string; body: string } | null = null;
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
          // va en la misma lista que los demás avisos: si se programara aparte, la siguiente reprogramación lo borraría antes de sonar
          late = { id: `late-${st.guide.leg}`, at: Date.now() / 1000 + 6, title: `El ${leg.shortName} viene con retraso`, body: `Llega unos ${Math.round(live / 60)} min más tarde de lo previsto. Abre el viaje para ver otra opción.` };
          lastKey = "";
        }
      }
      const g = advanceGuide(it, st.guide, fresh, now, shift);
      if (g.phase === "done") { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); st.stop(); return; }
      if (g.leg !== st.guide.leg || g.phase !== st.guide.phase) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      const moved = g.leg !== st.guide.leg || g.phase !== st.guide.phase;
      if (moved || shift !== st.shift || busId !== st.busId) st.update(g, moved ? shift : shift, moved ? null : busId);
      const key = `${g.leg}${g.phase}${Math.round(shift / 20)}`;
      if (key !== lastKey) {
        lastKey = key;
        if (late && late.at < Date.now() / 1000) late = null;
        void scheduleTrip(late ? [...pendingAlerts(it, g, placeText, shift), late] : pendingAlerts(it, g, placeText, shift));
      }
      // el mismo paso, en la pantalla de bloqueo y la isla dinámica (si el teléfono lo permite y la app trae el widget).
      // Va con su propia marca: si no se pudo mostrar (p. ej. el permiso de avisos aún estaba en pantalla), se reintenta en la siguiente vuelta.
      if (key !== actKey) {
        actKey = key;
        const cur = it.legs[g.leg], nowDo = guideNow(it, g, placeText), times = legTimes(it)[g.leg];
        void showTripActivity(st.dest, {
          title: nowDo.title, detail: nowDo.body,
          badge: cur?.kind === "ride" ? cur.shortName : "", color: cur?.kind === "ride" ? SYSTEM_COLOR[cur.system] : "#e11d2e",
          until: (cur?.kind === "ride" ? (g.phase === "wait" ? cur.departAt : cur.arriveAt) : times?.end ?? 0) + shift,
          untilLabel: cur?.kind === "ride" ? (g.phase === "wait" ? "Llega en" : "Te bajas en") : g.leg === it.legs.length - 1 ? "Llegas en" : "Caminando",
          step: g.leg + 1, steps: it.legs.length, arrive: it.arriveAt + shift, link: "transmilive:///trip",
        }).then((ok) => { if (!ok && actKey === key) actKey = ""; });
      }
    };
    tick();
    const timer = setInterval(() => { if (AppState.currentState === "active") tick(); }, EVERY_MS);
    return () => { gone = true; clearInterval(timer); sub?.remove(); };
  }, [it]);

  return null;
}

