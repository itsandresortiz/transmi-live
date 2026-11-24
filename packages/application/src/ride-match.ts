import { type GeoPoint, type Route, type RouteShape, type Vehicle, bearingDegrees, toGeo, toWorld } from "@transmi/domain";
import { arrivalAtIndex, estimateTravelSeconds, hav, shapeStops } from "./eta";
import type { TransitState } from "./transit-state";

/** Una lectura del GPS del teléfono. `at` en ms; `accuracy` y `speed` como las da el sistema (metros, m/s), si las da. */
export interface PhoneFix { lat: number; lon: number; at: number; accuracy?: number | null; speed?: number | null }

/** Dónde va la persona sobre el recorrido del bus en el que dice ir. */
export interface RideSnap {
  /** Metros desde el inicio del recorrido. */
  s: number;
  pos: GeoPoint;
  /** Rumbo del recorrido en ese punto (grados, como el de los buses). */
  heading: number;
  /** Primera parada del recorrido que aún no pasa (índice en `shape.stopIds`). */
  nextIndex: number;
  /** Metros que faltan para esa parada. */
  toNext: number;
  /** Desde dónde se mide el ritmo de tu bus en este viaje (si ya se tiene). */
  pace?: RidePace;
}

/** Resultado de comparar el teléfono con el bus:
 *  - `on`: va en el bus; se puede dibujar el bus donde va la persona (el GPS del teléfono llega al instante; el de TransMilenio, ~1 min tarde).
 *  - `off-route`: el teléfono está lejos del recorrido (se bajó, o marcó un bus que no es).
 *  - `apart`: está sobre el recorrido, pero muy lejos de donde puede estar el bus (va en otro bus de la misma vía, o marcó el equivocado).
 *  - `unknown`: no hay cómo saberlo (sin GPS, GPS impreciso o viejo, la persona está quieta esperando, recorrido sin trazado). */
export type RideCheck =
  | { kind: "on"; snap: RideSnap; moving: boolean }
  | { kind: "off-route"; moving: boolean }
  | { kind: "apart"; meters: number; moving: boolean }
  | { kind: "unknown" };

/** Lejos del recorrido a partir de aquí (metros): una calle paralela o una estación queda más cerca. */
export const OFF_ROUTE_M = 150;
/** Lectura del GPS que ya no sirve (ms) o demasiado imprecisa (metros). */
const FIX_MAX_AGE_MS = 20_000, FIX_MAX_ACCURACY_M = 60;
/** En movimiento (m/s): por encima de esto la persona va en un vehículo, no caminando ni esperando. */
export const MOVING_MPS = 3;
/** Cuánto puede ir un bus por delante de su último reporte: hasta ~16 m/s mientras el reporte envejece, más un margen por el GPS. */
const AHEAD_MPS = 16, AHEAD_PAD_M = 400;
/** La persona no puede ir mucho DETRÁS del último reporte del bus (el bus ya pasó por ahí). */
const BEHIND_M = 250;

/** Compara la ubicación del teléfono con el bus `v` que va por `shape`. `lastIndex` es la última parada que informó el bus. */
export function checkRide(state: TransitState, v: Vehicle, shape: RouteShape, lastIndex: number, fix: PhoneFix | null, nowMs: number, prevFix?: PhoneFix | null): RideCheck {
  if (!fix || nowMs - fix.at > FIX_MAX_AGE_MS || (fix.accuracy != null && fix.accuracy > FIX_MAX_ACCURACY_M)) return { kind: "unknown" };
  const ss = shapeStops(state, shape);
  if (!ss) return { kind: "unknown" };
  const speed = fixSpeed(fix, prevFix);
  const moving = speed != null && speed >= MOVING_MPS;
  // dónde va el bus según su último reporte; en recorridos de ida y vuelta por la misma calle se busca la pasada que sigue a su última parada
  const fromS = Math.max(0, (ss.s[lastIndex] ?? 0) - 100);
  const bus = ss.path.projectAfter(toWorld(v.position), fromS, OFF_ROUTE_M);
  const busS = bus?.s ?? ss.s[lastIndex] ?? 0;
  const me = ss.path.projectAfter(toWorld(fix), Math.max(0, busS - BEHIND_M - 300), OFF_ROUTE_M);
  if (!me) return { kind: "off-route", moving };
  // quieta y por delante del bus: lo está esperando en la parada (o va en un trancón). No se compara ni se pega el bus a ella.
  const delta = me.s - busS, age = Math.max(0, nowMs / 1000 - v.reportedAt);
  if (!moving && delta > 120) return { kind: "unknown" };
  if (delta < -BEHIND_M || delta > age * AHEAD_MPS + AHEAD_PAD_M) return { kind: "apart", meters: Math.round(Math.abs(delta)), moving };
  let nextIndex = ss.s.findIndex((s) => s > me.s + 15);
  if (nextIndex < 0) nextIndex = ss.s.length - 1;
  const here = ss.path.pointAt(me.s), ahead = ss.path.pointAt(me.s + 15);
  return { kind: "on", moving, snap: { s: me.s, pos: toGeo(here), heading: bearingDegrees(here, ahead), nextIndex, toNext: Math.max(0, (ss.s[nextIndex] ?? me.s) - me.s) } };
}

/** Velocidad del teléfono: la que da el sistema o, si no, la que sale de dos lecturas seguidas. */
export function fixSpeed(fix: PhoneFix, prev?: PhoneFix | null): number | null {
  if (fix.speed != null && fix.speed >= 0) return fix.speed;
  if (!prev || fix.at <= prev.at) return null;
  const R = 6_371_000, toRad = Math.PI / 180;
  const dLat = (fix.lat - prev.lat) * toRad, dLon = (fix.lon - prev.lon) * toRad * Math.cos(((fix.lat + prev.lat) / 2) * toRad);
  return (R * Math.hypot(dLat, dLon)) / ((fix.at - prev.at) / 1000);
}

/** Desde dónde se mide tu ritmo en el viaje: un punto del recorrido (metros) y cuándo pasaste por ahí (ms). */
export interface RidePace { s: number; at: number }

/** Tramo entre paradas para un viaje seguido con el GPS: un tiempo fijo por parada (frenar, subir y bajar gente, arrancar) más la
 *  distancia REAL del tramo sobre el recorrido a la velocidad de marcha. Antes se usaba el modelo de las llegadas (casi solo «N paradas ×
 *  ~1 min», con la distancia en línea recta a 18 m/s), y entre paradas de 200 m y de 2 km salía casi el mismo tiempo: con tu ubicación
 *  real al lado, los tiempos se desfasaban. Los promedios dan lo mismo que antes (zonal ~72 s con su tramo medio de 390 m, troncal
 *  ~117 s con 1.060 m), pero cada tramo pesa según lo largo que es. Si se sabe lo que tardan de verdad los buses en ese tramo a esta
 *  hora (perfil de tramos), se mezcla con eso. El cable sigue con su modelo (cuadra con el horario oficial). */
const RIDE_HOP: Partial<Record<Vehicle["system"], { stop: number; mps: number }>> = {
  troncal: { stop: 29, mps: 12 }, dual: { stop: 29, mps: 12 }, zonal: { stop: 23, mps: 8 }, alimentador: { stop: 29, mps: 8 }, otro: { stop: 23, mps: 8 },
};
function rideHopSeconds(state: TransitState, v: Vehicle, shape: RouteShape, s: readonly number[], i: number, nowMs: number): number {
  const m = RIDE_HOP[v.system], len = Math.max(0, s[i + 1]! - s[i]!);
  const model = m ? m.stop + len / m.mps : estimateTravelSeconds(state, v, shape.stopIds, i, i + 1, nowMs);
  return state.hopProfile.seconds(shape, i, nowMs, model);
}
/** Segundos que da el modelo para ir del punto `a` al punto `b` del recorrido (metros): cada tramo cuenta en la parte que se recorre. */
function rideModelSeconds(state: TransitState, v: Vehicle, shape: RouteShape, s: readonly number[], a: number, b: number, nowMs: number): number {
  let t = 0;
  for (let i = 0; i + 1 < s.length; i++) {
    const lo = s[i]!, hi = s[i + 1]!;
    if (hi <= a) continue;
    if (lo >= b) break;
    if (hi - lo < 1) continue;
    t += ((Math.min(b, hi) - Math.max(a, lo)) / (hi - lo)) * rideHopSeconds(state, v, shape, s, i, nowMs);
  }
  return t;
}
/** Con cuánta prisa va TU bus frente al modelo (1 = como el modelo, 1,5 = tarda 50 % más), medido con tu ubicación: lo que llevas
 *  recorrido desde `pace` y cuánto te tomó (contando semáforos y trancones). Pesa más cuanto más tiempo se ha medido (todo a los 10 min);
 *  con menos de 1 min o 200 m no se usa. Limitado a 0,6–1,8 para que un trancón largo no dispare los tiempos. */
export function ridePaceFactor(state: TransitState, v: Vehicle, shape: RouteShape, snap: RideSnap, nowMs: number): number {
  const p = snap.pace, ss = shapeStops(state, shape);
  if (!p || !ss) return 1;
  const took = (nowMs - p.at) / 1000, went = snap.s - p.s;
  if (took < 60 || went < 200) return 1;
  const model = rideModelSeconds(state, v, shape, ss.s, p.s, snap.s, nowMs);
  if (model < 20) return 1;
  const raw = Math.min(1.8, Math.max(0.6, took / model)), w = Math.min(1, took / 600);
  return 1 + w * (raw - 1);
}

/** Hora de llegada a la parada `to` contada desde donde va la persona (su GPS), no desde el reporte del bus (que llega ~1 min tarde):
 *  la distancia que de verdad falta sobre el recorrido, tramo por tramo, ajustada al ritmo que lleva tu bus en este viaje.
 *  `lastIndex` (la última parada que reportó el bus) ya no cambia la cuenta: tu ubicación manda. */
export function rideArrival(state: TransitState, v: Vehicle, shape: RouteShape, _lastIndex: number, snap: RideSnap, to: number, nowMs: number): number {
  const now = nowMs / 1000;
  if (to < snap.nextIndex) return now;
  const ss = shapeStops(state, shape), target = ss?.s[to];
  if (!ss || target == null) return now + snap.toNext / RIDE_CRUISE_MPS + Math.max(0, arrivalAtIndex(state, v, shape, snap.nextIndex, to, nowMs) - arrivalAtIndex(state, v, shape, snap.nextIndex, snap.nextIndex, nowMs));
  return now + ridePaceFactor(state, v, shape, snap, nowMs) * rideModelSeconds(state, v, shape, ss.s, snap.s, Math.max(snap.s, target), nowMs);
}
/** Velocidad típica de un bus en marcha entre paradas (m/s), para cuando el recorrido no tiene trazado. */
const RIDE_CRUISE_MPS = 8;

/** Dónde va el teléfono sobre un recorrido, sin comparar con ningún bus: para seguir un viaje cuando el bus no aparece en los datos
 *  de TransMilenio (su GPS no está reportando). `fromIndex`: la parada desde la que se viene (no se busca antes de ella). */
export function checkOnShape(state: TransitState, shape: RouteShape, fromIndex: number, fix: PhoneFix | null, nowMs: number, prevFix?: PhoneFix | null): RideCheck {
  if (!fix || nowMs - fix.at > FIX_MAX_AGE_MS || (fix.accuracy != null && fix.accuracy > FIX_MAX_ACCURACY_M)) return { kind: "unknown" };
  const ss = shapeStops(state, shape);
  if (!ss) return { kind: "unknown" };
  const speed = fixSpeed(fix, prevFix), moving = speed != null && speed >= MOVING_MPS;
  const me = ss.path.projectAfter(toWorld(fix), Math.max(0, (ss.s[fromIndex] ?? 0) - 150), OFF_ROUTE_M);
  if (!me) return { kind: "off-route", moving };
  let nextIndex = ss.s.findIndex((x) => x > me.s + 15);
  if (nextIndex < 0) nextIndex = ss.s.length - 1;
  const here = ss.path.pointAt(me.s), ahead = ss.path.pointAt(me.s + 15);
  return { kind: "on", moving, snap: { s: me.s, pos: toGeo(here), heading: bearingDegrees(here, ahead), nextIndex, toNext: Math.max(0, (ss.s[nextIndex] ?? me.s) - me.s) } };
}

/** Vas con «¿En qué bus vas?» (tu bus no salía en los datos) y aparece en los datos un bus de tu misma ruta y sentido justo donde vas tú:
 *  lo más seguro es que sea el tuyo, que volvió a reportar. Devuelve el que mejor cuadra, o `null`. `s` es dónde vas sobre el recorrido
 *  (metros). Cuadra si su reporte es reciente (≤2,5 min), no queda muy por delante de ti y, contando lo que avanza un bus típico desde ese
 *  reporte (~7 m/s), quedaría a menos de 300 m de ti. La app solo lo enlaza si cuadra en dos reportes seguidos del bus (ver RideWatcher). */
export function busForGpsRide(state: TransitState, shape: RouteShape, s: number, nowMs: number): { vehicle: Vehicle; gap: number } | null {
  const ss = shapeStops(state, shape);
  if (!ss) return null;
  const now = nowMs / 1000;
  let best: { vehicle: Vehicle; gap: number } | null = null;
  for (const v of state.fleet.values()) {
    if (v.routeId !== shape.routeId || v.id.startsWith("gps:")) continue;
    const age = now - v.reportedAt;
    if (age > 150 || age < -60) continue;
    if (state.sequenceForDisplay(v)?.shape !== shape) continue;      // mismo sentido
    const bus = ss.path.projectAfter(toWorld(v.position), Math.max(0, s - 3000), OFF_ROUTE_M);
    if (!bus) continue;
    const ahead = bus.s - s;                                           // el reporte (viejo) del bus no puede ir muy por delante de ti
    if (ahead > 150) continue;
    const gap = Math.abs(s - (bus.s + Math.max(0, age) * 7));
    if (gap <= 300 && (!best || gap < best.gap)) best = { vehicle: v, gap: Math.round(gap) };
  }
  return best;
}

/** Un bus que podría ser en el que vas (va por tu misma vía, en tu sentido, y donde puede estar dado lo viejo de su reporte). */
export interface BusGuess { vehicle: Vehicle; route: Route | undefined; headsign: string; meters: number }
/** Una ruta que pasa por donde vas, en tu sentido: para seguirte con el GPS si tu bus no aparece en los datos. */
export interface RouteGuess { route: Route; shapeIndex: number; headsign: string; fromIndex: number; meters: number }

/** ¿En qué bus vas? Con tu ubicación (y la anterior, para saber hacia dónde te mueves) busca los buses de los datos que podrían ser el tuyo
 *  y las rutas que pasan por ahí en tu sentido. Los buses van de más a menos probable (el más cerca de donde debería ir según su reporte). */
export function guessMyBus(state: TransitState, fix: PhoneFix, prevFix: PhoneFix | null, nowMs: number): { buses: BusGuess[]; routes: RouteGuess[]; moving: boolean } {
  const now = nowMs / 1000, speed = fixSpeed(fix, prevFix), moving = speed != null && speed >= MOVING_MPS;
  const me = toWorld(fix), prev = prevFix ? toWorld(prevFix) : null;
  const len = prev ? Math.hypot(me.x - prev.x, me.y - prev.y) : 0;
  const ux = prev && len > 0 && moving ? (me.x - prev.x) / len : 0, uy = prev && len > 0 && moving ? (me.y - prev.y) / len : 0;

  const buses: (BusGuess & { score: number })[] = [];
  for (const v of state.fleet.values()) {
    const age = now - v.reportedAt;
    if (age > 300 || age < -60 || hav(v.position, fix) > 2500) continue;
    const seq = state.sequenceForDisplay(v), ss = seq ? shapeStops(state, seq.shape) : null;
    if (!seq || !ss) continue;
    const bus = ss.path.projectAfter(toWorld(v.position), Math.max(0, (ss.s[seq.index] ?? 0) - 100), OFF_ROUTE_M);
    const mine = bus ? ss.path.projectAfter(me, Math.max(0, bus.s - BEHIND_M - 300), 80) : null;
    if (!bus || !mine) continue;
    if (moving && (ux || uy)) { const t = ss.path.tangentAt(mine.s); if (t.ux * ux + t.uy * uy < 0.3) continue; }      // va en otro sentido
    const delta = mine.s - bus.s;
    if (delta < -BEHIND_M || delta > Math.max(0, age) * AHEAD_MPS + AHEAD_PAD_M) continue;
    // lo más probable: que esté adelante de su reporte lo que avanza un bus típico en ese tiempo
    buses.push({ vehicle: v, route: state.routeOf(v), headsign: seq.shape.headsign, meters: Math.round(hav(v.position, fix)), score: Math.abs(delta - Math.max(0, age) * 7) });
  }
  buses.sort((a, b) => a.score - b.score);

  const routes: RouteGuess[] = [], seen = new Set<string>();
  for (const [routeId, shapes] of state.network.shapes) {
    const route = state.routeById(routeId);
    if (!route) continue;
    shapes.forEach((shape, shapeIndex) => {
      const ss = shapeStops(state, shape);
      const hit = ss ? (ux || uy ? ss.path.projectAlong(me, ux, uy, 60) : ss.path.project(me, 0, 0, 60)) : null;
      if (!ss || !hit) return;
      let fromIndex = -1;
      for (let i = 0; i < ss.s.length; i++) if (ss.s[i]! <= hit.s + 10) fromIndex = i; else break;
      if (fromIndex < 0 || fromIndex >= shape.stopIds.length - 1) return;      // antes de la primera parada o ya en la última
      const key = `${route.shortName}|${shape.headsign}`;
      if (seen.has(key)) return;
      seen.add(key);
      routes.push({ route, shapeIndex, headsign: shape.headsign, fromIndex, meters: Math.round(hit.dist) });
    });
  }
  const order: Record<string, number> = { troncal: 0, dual: 1, alimentador: 2, zonal: 3, otro: 4 };
  routes.sort((a, b) => (order[a.route.system] ?? 5) - (order[b.route.system] ?? 5) || a.meters - b.meters);
  return { buses: buses.slice(0, 6).map(({ score: _s, ...b }) => b), routes: routes.slice(0, 12), moving };
}
