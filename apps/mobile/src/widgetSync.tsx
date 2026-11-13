import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import Constants from "expo-constants";
import { spreadArrivals, upcomingAtStop } from "@transmi/application";
import { stopLabelText } from "@transmi/domain";
import { transit } from "./composition-root";
import { nowSec } from "./clock";
import { useSaved } from "./favorites";
import { isDemo } from "./demo";
import { SYSTEM_COLOR } from "./ui/theme";
import { TmWidget } from "../modules/tmwidget/src";

/** Deja en el App Group lo que el widget necesita: tus paradas favoritas con la hora de llegada de los próximos buses. Solo existe en las compilaciones con el widget (WIDGET=1). */
const extra = (Constants.expoConfig?.extra ?? {}) as { widget?: boolean; widgetGroup?: string };
type Storage = { set(key: string, value: string): void };
let storage: Storage | null = null, reload: (() => void) | null = null;
if (Platform.OS === "ios" && extra.widget && extra.widgetGroup) {
  try {
    // se carga solo si el widget está incluido: en las demás compilaciones esto no se toca
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@bacons/apple-targets") as { ExtensionStorage: { new (g: string): Storage; reloadWidget(): void } };
    storage = new mod.ExtensionStorage(extra.widgetGroup);
    reload = () => mod.ExtensionStorage.reloadWidget();
  } catch { storage = null; }
}

if (Platform.OS === "android" && TmWidget) {
  // en Android el widget va siempre incluido: recibe la misma instantánea por su propio módulo y se repinta solo al guardarla
  const w = TmWidget;
  storage = { set: (_key, value) => w.setSnapshot(value) };
}

let last = "";
export function syncWidget(): void {
  if (!storage || !transit.network.stops.size) return;
  const demo = isDemo();      // los buses de ejemplo llegan al widget marcados: el widget lo rotula «Demostración», nunca como dato real
  const saved = useSaved.getState();
  const now = nowSec();
  const stops = saved.stops.slice(0, 3).flatMap((id) => {
    const stop = transit.stopById(id);
    if (!stop) return [];
    const arrivals = spreadArrivals(upcomingAtStop(transit, id, now, 6)
      .flatMap((u) => u.buses.map((b) => ({ r: u.route.shortName, h: u.headsign, t: Math.round(b.etaAt), c: SYSTEM_COLOR[u.route.system] })))
      .sort((a, b) => a.t - b.t));      // varios, para que el widget siga con buses en vivo un buen rato después de cerrar la app
    // respaldo para cuando el dato en vivo se venza y la app no esté abierta: las próximas pasadas según el horario (el widget las rotula «Programado»)
    const sched: typeof arrivals = [];
    if (transit.departures.size) {
      const day = transit.serviceEnds.dayAt(now * 1000), midnight = now - day.secs;
      for (const p of transit.departures.nextAt(id, day.type, day.secs, 24)) {
        const route = transit.routeById(p.routeId);
        if (route) for (const t of p.times) sched.push({ r: route.shortName, h: "", t: Math.round(midnight + t), c: SYSTEM_COLOR[route.system] });
      }
      // cuando ya quedan pocas pasadas hoy (o ninguna: terminó el servicio), se agregan las primeras del siguiente día de servicio,
      // para que de noche el widget diga a qué hora pasa el primer bus en vez de quedarse vacío
      if (sched.length < 6) {
        for (const p of transit.departures.nextAt(id, transit.serviceEnds.nextDayType(now * 1000), 0, 6)) {
          const route = transit.routeById(p.routeId);
          if (route) for (const t of p.times) sched.push({ r: route.shortName, h: "", t: Math.round(midnight + 86_400 + t), c: SYSTEM_COLOR[route.system] });
        }
      }
      // repartido en el tiempo y para varias horas: si el teléfono no deja refrescar el widget y la app no se abre, el horario sigue respondiendo
      sched.sort((a, b) => a.t - b.t);
      const spread = spreadArrivals(sched, 40, 6, 240); sched.length = 0; sched.push(...spread);
    }
    return [{ id, name: saved.nicknames[id] || stopLabelText(transit.labelOf(stop)), arrivals, sched }];
  });
  const body = JSON.stringify({ at: Math.round(now), stops, demo });
  const key = (demo ? "demo" : "") + JSON.stringify(stops.map((s) => [s.id, s.name, s.arrivals.map((a) => [a.r, Math.round(a.t / 30)])]));   // si casi no cambió, no se recarga el widget
  if (key === last) return;
  last = key;
  try { storage.set("snapshot", body); reload?.(); } catch { /* sin App Group: el widget no está activo */ }
}

/** Mantiene el widget al día mientras la app está abierta y deja un último dato al pasar a segundo plano. */
export function WidgetSync() {
  const stops = useSaved((s) => s.stops), names = useSaved((s) => s.nicknames);
  useEffect(() => {
    if (!storage) return;
    syncWidget();
    const id = setInterval(() => { if (AppState.currentState === "active") syncWidget(); }, 20_000);
    const sub = AppState.addEventListener("change", (st) => { if (st !== "active") { last = ""; syncWidget(); } });
    return () => { clearInterval(id); sub.remove(); };
  }, [stops, names]);
  return null;
}
