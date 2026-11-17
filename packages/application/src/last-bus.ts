import type { TransitState } from "./transit-state";

/** El último bus de hoy de una ruta en una parada. `time` en segundos desde 1970. */
export interface LastBusSoon { shortName: string; routeId: string; time: number }

/**
 * Los últimos buses de hoy que están por pasar por la parada (en la próxima `windowSec`), según el horario programado: para mostrar
 * en la app «Último B11 a las 10:10 p. m.» solo cuando ya se acerca el final del servicio (no como notificación diaria).
 * Si guardaste rutas que paran ahí, solo cuentan esas; si no, todas. Ordenados del que se acaba primero.
 */
export function lastBusSoon(state: TransitState, stopId: string, favRoutes: readonly string[], nowMs: number, windowSec = 3600): LastBusSoon[] {
  if (!state.departures.size) return [];
  const day = state.serviceEnds.dayAt(nowMs), now = nowMs / 1000, midnight = now - day.secs;
  const fav = new Set(favRoutes.flatMap((id) => state.routeFamily(id)));
  let passes = state.departures.lastAt(stopId, day.type);
  const mine = passes.filter((p) => fav.has(p.routeId));
  if (mine.length) passes = mine;
  const byName = new Map<string, LastBusSoon>();
  for (const p of passes) {
    const r = state.routeById(p.routeId), t = midnight + p.time;
    if (!r) continue;
    const cur = byName.get(r.shortName);
    if (!cur || cur.time < t) byName.set(r.shortName, { shortName: r.shortName, routeId: r.id, time: t });
  }
  return [...byName.values()].filter((x) => x.time > now && x.time - now <= windowSec).sort((a, b) => a.time - b.time);
}
