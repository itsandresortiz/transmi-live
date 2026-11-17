import { useEffect } from "react";
import { AppState } from "react-native";
import { router } from "expo-router";
import { lastBusAlerts } from "@transmi/application";
import { transit } from "./composition-root";
import { nowMs } from "./clock";
import { useSaved } from "./favorites";
import { useSettings } from "./settings";
import { onLastBusTap, scheduleLastBus } from "./notify";
import { stopText } from "./stopname";

/** Con «Avisarme del último bus» encendido, deja programados (según el horario) los avisos de hoy y mañana para las paradas guardadas.
 *  Se rehacen al abrir la app, al cambiar las paradas o rutas guardadas y cuando llegan los horarios. Apagado, se quitan. */
export function LastBusWatcher() {
  const on = useSettings((s) => s.lastBus);
  const stops = useSaved((s) => s.stops), routes = useSaved((s) => s.routes), names = useSaved((s) => s.nicknames);
  useEffect(() => onLastBusTap((stopId) => router.push({ pathname: "/stop/[id]", params: { id: stopId } })), []);
  useEffect(() => {
    let done = "";
    const run = () => {
      if (!on) { void scheduleLastBus([]); return; }
      if (!transit.departures.size || !transit.network.stops.size) return;
      const list = lastBusAlerts(transit, stops.slice(0, 5), routes, nowMs(), 20, (id) => names[id] || stopText(transit.stopById(id), "tu parada"));
      const key = JSON.stringify(list.map((a) => [a.id, a.at]));
      if (key === done) return;
      done = key;
      void scheduleLastBus(list);
    };
    run();
    const unsub = transit.subscribe(() => { if (!done) run(); });      // cuando terminan de llegar los horarios
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") { done = ""; run(); } });
    return () => { unsub(); sub.remove(); };
  }, [on, stops, routes, names]);
  return null;
}
