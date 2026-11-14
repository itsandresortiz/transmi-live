import { type GeoPoint, type RouteShape, type Vehicle, bearingDegrees, toGeo, toWorld } from "@transmi/domain";
import { arrivalAtIndex, shapeStops } from "./eta";
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

/** Hora de llegada a la parada `to` contada desde donde va la persona (no desde el reporte del bus, que llega ~1 min tarde):
 *  lo que le falta para la siguiente parada, a velocidad de crucero, más lo que el modelo del bus dice entre esa parada y `to`. */
export function rideArrival(state: TransitState, v: Vehicle, shape: RouteShape, lastIndex: number, snap: RideSnap, to: number, nowMs: number): number {
  const now = nowMs / 1000;
  if (to < snap.nextIndex) return now;
  const toNextSec = snap.toNext / RIDE_CRUISE_MPS;
  if (to === snap.nextIndex || lastIndex >= snap.nextIndex) return now + toNextSec;
  const between = arrivalAtIndex(state, v, shape, lastIndex, to, nowMs) - arrivalAtIndex(state, v, shape, lastIndex, snap.nextIndex, nowMs);
  return now + toNextSec + Math.max(0, between);
}
/** Velocidad típica de un bus en marcha entre paradas (m/s); la misma que usa el cálculo de llegadas. */
const RIDE_CRUISE_MPS = 8;
