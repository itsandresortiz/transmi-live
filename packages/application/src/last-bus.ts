import type { TransitState } from "./transit-state";

/** Un aviso de «se acaba el servicio» para una parada guardada. `at` en segundos desde 1970. */
export interface LastBusAlert { id: string; at: number; title: string; body: string; stopId: string }

const clock = (secs: number) => { const h = Math.floor(secs / 3600) % 24, m = Math.floor((secs % 3600) / 60); return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "a. m." : "p. m."}`; };

/**
 * Avisos del último bus para las paradas guardadas, según el horario programado: `leadMin` minutos antes de que pase el último bus de
 * tus rutas por esa parada. Uno por parada y por día (si son varias rutas, dice las primeras tres en el orden en que se acaban).
 * Si guardaste rutas, solo cuentan esas; si no, todas las que paran ahí. Se arman para hoy y el día de servicio siguiente
 * (así suena aunque no abras la app mañana). Es el horario, no buses en vivo: el texto lo dice.
 */
export function lastBusAlerts(state: TransitState, stopIds: readonly string[], favRoutes: readonly string[], nowMs: number, leadMin = 20, name: (stopId: string) => string = (id) => state.stopById(id)?.name ?? "tu parada"): LastBusAlert[] {
  if (!state.departures.size) return [];
  const fav = new Set(favRoutes.flatMap((id) => state.routeFamily(id)));
  const out: LastBusAlert[] = [];
  const today = state.serviceEnds.dayAt(nowMs);
  const midnight = nowMs / 1000 - today.secs;
  const days = [{ type: today.type, base: midnight, key: "a" }, { type: state.serviceEnds.nextDayType(nowMs), base: midnight + 86_400, key: "b" }];
  for (const id of stopIds) {
    for (const d of days) {
      let passes = state.departures.lastAt(id, d.type);
      const mine = passes.filter((p) => fav.has(p.routeId));
      if (mine.length) passes = mine;
      // por nombre de ruta: el último de cada una (los dos sentidos de una ruta cuentan como una)
      const byName = new Map<string, number>();
      for (const p of passes) { const n = state.routeById(p.routeId)?.shortName; if (n && (byName.get(n) ?? -1) < p.time) byName.set(n, p.time); }
      const list = [...byName].sort((a, b) => a[1] - b[1]);
      if (!list.length) continue;
      const at = d.base + list[0]![1] - leadMin * 60;
      if (at * 1000 <= nowMs + 60_000) continue;
      const parts = list.slice(0, 3).map(([n, t]) => `el ${n} a las ${clock(t)}`);
      out.push({
        id: `${id}-${d.key}`, at, stopId: id,
        title: `Se acaba el servicio en ${name(id)}`,
        body: `Según el horario, el último ${list[0]![0]} pasa a las ${clock(list[0]![1])}${parts.length > 1 ? `; después, ${parts.slice(1).join(" y ")}` : ""}. La hora real puede variar.`,
      });
    }
  }
  return out;
}
