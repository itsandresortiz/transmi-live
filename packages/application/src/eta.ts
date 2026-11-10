import { RoadPath, type RouteShape, type Vehicle, toWorld } from "@transmi/domain";
import { DEFAULT_SECONDS_PER_STOP } from "./travel-times";
import type { TransitState } from "./transit-state";

/** Velocidad entre paradas (m/s): casi no pesa frente al tiempo que se pierde en cada parada. */
const CRUISE_MPS = 18;
const DETOUR_FACTOR = 1.15;   // la calle es más larga que la línea recta entre paradas
/** Tiempo medio por parada de cada sistema (valor de partida; la app lo aprende por ruta). */
export const SECONDS_PER_STOP = DEFAULT_SECONDS_PER_STOP;

export function hav(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Estima cuántos segundos tarda un bus en ir de la parada `from` a la parada `to` de su recorrido.
 *  Calibrado con lotes reales: el tiempo lo domina el número de paradas, no la distancia ni la velocidad del momento. */
export function estimateTravelSeconds(state: TransitState, v: Vehicle, stopIds: readonly string[], from: number, to: number, nowMs = Date.now()): number {
  let meters = 0;
  for (let i = from; i < to; i++) {
    const a = state.stopById(stopIds[i]), b = state.stopById(stopIds[i + 1]);
    if (a && b) meters += hav(a.position, b.position) * DETOUR_FACTOR;
  }
  return meters / CRUISE_MPS + (to - from) * state.travelTimes.secondsPerStop(v.routeId, v.system, nowMs);
}

/** El trazado de una ruta y a cuántos metros del inicio queda cada una de sus paradas (se calcula una vez por recorrido). */
interface ShapeStops { path: RoadPath; s: number[] }
const shapeCache = new WeakMap<RouteShape, ShapeStops | null>();
export function shapeStops(state: TransitState, shape: RouteShape): ShapeStops | null {
  let c = shapeCache.get(shape);
  if (c !== undefined) return c;
  c = null;
  if (shape.points.length >= 2) {
    const path = new RoadPath(shape.points), s: number[] = [];
    let last = 0, ok = true;
    for (const id of shape.stopIds) {
      const p = state.stopById(id)?.position;
      const hit = p ? path.projectAfter(toWorld(p), last, 120) : null;      // en orden: la primera pasada cercana después de la parada anterior
      if (!hit) { ok = false; break; }
      last = Math.max(last, hit.s);            // las paradas van en orden a lo largo del recorrido
      s.push(last);
    }
    if (ok) c = { path, s };
  }
  shapeCache.set(shape, c);
  return c;
}

/** Cuándo llegará el bus a la parada `to` de su recorrido (segundos desde 1970).
 *
 *  La parada que informa TransMilenio es la **última a la que llegó**. Con eso y la posición del bus se calcula:
 *  1. cuánto del tramo hacia la siguiente parada ya recorrió (por su posición sobre el trazado de la ruta),
 *  2. lo que falta de ese tramo, más el tiempo típico de cada tramo que queda hasta `to`,
 *  3. todo contado desde el momento del reporte de posición.
 *  Medido con lotes reales, usar la posición baja el error mediano de 44–57 s a 34–37 s frente a contar solo desde la hora de llegada
 *  a la última parada (que queda como respaldo cuando el bus no se puede ubicar sobre su trazado). */
export function arrivalAtIndex(state: TransitState, v: Vehicle, shape: RouteShape, lastIndex: number, to: number, nowMs = Date.now()): number {
  const stopIds = shape.stopIds, now = nowMs / 1000;
  const hop = (i: number) => estimateTravelSeconds(state, v, stopIds, i, i + 1, nowMs);
  let eta: number;
  let remaining = 0;
  for (let i = lastIndex; i < to; i++) remaining += hop(i);

  const info = shapeStops(state, shape);
  const bus = info ? info.path.project(v.world, 0, 0, 120) : null;
  const sa = info?.s[lastIndex], sb = info?.s[lastIndex + 1];
  if (info && bus && sa != null && sb != null && sb - sa > 15 && bus.s >= sa - 80 && bus.s <= sb + 80) {
    const f = Math.min(1, Math.max(0, (bus.s - sa) / (sb - sa)));        // fracción del tramo ya recorrida
    remaining -= hop(lastIndex) * f;
    eta = v.reportedAt + remaining;
  } else {
    // respaldo: desde la hora real a la que llegó a su última parada
    const tu = v.tripId ? state.tripUpdates.get(v.tripId) : undefined;
    const reached = tu?.nextStop && tu.nextStop.stopId === v.lastStopId ? tu.nextStop.arrivalAt : undefined;
    eta = (reached ?? v.reportedAt) + remaining;
  }
  // si el bus va más lento que lo esperado el cálculo ya quedó en el pasado: no se sabe cuándo llega, pero no es «ya»; se supone que le falta una parte del tramo
  return eta > now + 3 ? eta : now + Math.max(10, 0.3 * remaining);
}
