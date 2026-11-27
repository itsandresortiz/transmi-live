import type { RouteShape, Vehicle } from "@transmi/domain";
import { arrivalOrPassed, estimateTravelSeconds, hav } from "./eta";
import type { TransitState } from "./transit-state";

/** Buses que vienen «del otro sentido»: los que van terminando la ruta de regreso y, al llegar al final, dan la vuelta y salen otra vez
 *  por esta ruta.
 *
 *  Por qué: TransMilenio publica cada sentido de una troncal como una ruta distinta y con otra letra (la H72 va de Toberín a Usme; de
 *  vuelta se llama B72). Un bus que llega al Portal Usme como H72 sale de nuevo como B72 (en los lotes del 2026-11-24 se vieron cientos
 *  de esos cambios: H72→B72, B74→J74, A60→F60…). Antes solo contaban los buses que ya iban por esta ruta y estaban antes de la parada,
 *  así que en las primeras paradas de cada ruta (portales, cabeceras como San Mateo, Universidades, Calle 72 para la F60) no venía
 *  «ningún bus» aunque hubiera varios a pocos minutos, por el otro lado. Con lotes reales (71 lotes, 2026-11-24, 10:53–11:45) eran
 *  35 vagones vacíos en ≥30 % de los lotes; ver `packages/application/test/returning-buses.test.ts`.
 *
 *  Ruta de regreso: mismo sistema y mismo número (las letras cambian según el destino), cuyo final queda a ≤ `TURN_RADIUS_M` del comienzo
 *  de esta. También cuenta la misma ruta si es circular (termina donde empieza). */
const TURN_RADIUS_M = 400;
/** Lo que tarda un bus en dar la vuelta en la cabecera (bajar a todos, acomodarse en la plataforma de salida). Estimado, sin medir aún. */
export const TURNAROUND_S = 120;
/** Más allá de esto la vuelta es demasiado incierta (el bus puede guardarse en el patio): no se anuncia. */
const MAX_AHEAD_S = 40 * 60;

const digits = (s: string) => s.replace(/\D/g, "");
const cache = new WeakMap<object, Map<RouteShape, RouteShape[]>>();

/** Recorridos que, al terminar, se convierten en `shape` (se calcula una vez por red). */
export function feederShapes(state: TransitState, shape: RouteShape): RouteShape[] {
  let m = cache.get(state.network);
  if (!m) {
    m = new Map();
    const all: RouteShape[] = [];
    for (const shapes of state.network.shapes.values()) all.push(...shapes);
    const byKey = new Map<string, RouteShape[]>();
    const keyOf = (sh: RouteShape) => { const r = state.network.routes.get(sh.routeId); return r && digits(r.shortName) ? `${r.system}|${digits(r.shortName)}` : ""; };
    for (const sh of all) { const k = keyOf(sh); if (k) (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(sh); }
    for (const sh of all) {
      const first = state.stopById(sh.stopIds[0]);
      const out: RouteShape[] = [];
      if (first) for (const o of byKey.get(keyOf(sh)) ?? []) {
        const last = state.stopById(o.stopIds[o.stopIds.length - 1]);
        if (o.stopIds.length < 2 || !last || hav(last.position, first.position) > TURN_RADIUS_M) continue;
        // otro trazado de la misma ruta y el mismo sentido no es «de regreso» (solo cuenta el propio, si es circular)
        if (o !== sh && o.routeId === sh.routeId && o.direction === sh.direction) continue;
        out.push(o);
      }
      m.set(sh, out);
    }
    cache.set(state.network, m);
  }
  return m.get(shape) ?? [];
}

export interface ReturningBus { vehicle: Vehicle; etaAt: number; stopsAway: number; turnsAt: string }

/** Buses de las rutas de regreso que llegarán a la parada `j` de `shape` tras dar la vuelta. `byRoute`: buses por ruta (ya agrupados). */
export function returningBuses(state: TransitState, shape: RouteShape, j: number, nowSec: number, byRoute: ReadonlyMap<string, readonly Vehicle[]>, skip?: ReadonlySet<string>): ReturningBus[] {
  const out: ReturningBus[] = [];
  const stopId = shape.stopIds[j];
  if (!stopId) return out;
  for (const o of feederShapes(state, shape)) {
    const end = o.stopIds.length - 1;
    for (const v of byRoute.get(o.routeId) ?? []) {
      if (!v.lastStopId || skip?.has(v.id)) continue;
      const k = o.stopIds.indexOf(v.lastStopId);
      if (k < 0 || k >= end) continue;                        // ya llegó (o no va por ese recorrido)
      if (o === shape && k < j) continue;                     // circular y todavía antes de la parada: ya cuenta como bus de esta ruta
      const atEnd = arrivalOrPassed(state, v, o, k, end, nowSec * 1000);
      if (atEnd == null) continue;
      const raw = atEnd + TURNAROUND_S + travel(state, v, shape, j, nowSec);
      if (raw - nowSec > MAX_AHEAD_S) continue;
      out.push({ vehicle: v, etaAt: state.etaHold.smooth(v.id, stopId, raw, nowSec), stopsAway: end - k + j, turnsAt: o.stopIds[end]! });
    }
  }
  return out;
}

/** De la primera parada de `shape` hasta la `j`, con los tiempos aprendidos por tramo si los hay. */
function travel(state: TransitState, v: Vehicle, shape: RouteShape, j: number, nowSec: number): number {
  let s = 0;
  for (let i = 0; i < j; i++) s += state.hopProfile.seconds(shape, i, nowSec * 1000, estimateTravelSeconds(state, v, shape.stopIds, i, i + 1, nowSec * 1000));
  return s;
}
