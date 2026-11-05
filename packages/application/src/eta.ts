import type { Vehicle } from "@transmi/domain";
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

/** Cuándo llegará el bus a la parada de la posición `to` de su recorrido, partiendo de la hora real a la que llegó a su última parada
 *  (la que informa TransMilenio con su hora exacta) más el tiempo estimado de los tramos que faltan. Segundos desde 1970. */
export function arrivalAtIndex(state: TransitState, v: Vehicle, stopIds: readonly string[], lastIndex: number, to: number, nowMs = Date.now()): number {
  const tu = v.tripId ? state.tripUpdates.get(v.tripId) : undefined;
  const reached = tu?.nextStop && tu.nextStop.stopId === v.lastStopId ? tu.nextStop.arrivalAt : undefined;
  const base = reached ?? v.reportedAt;
  return Math.max(base + estimateTravelSeconds(state, v, stopIds, lastIndex, to, nowMs), nowMs / 1000 + 3);
}
