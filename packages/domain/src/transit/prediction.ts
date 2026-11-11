import type { WorldPoint } from "../shared/geo";
import { METERS_PER_WORLD_UNIT } from "../shared/geo";
import type { Vehicle } from "./vehicle";

/** Cuánto adelantar a un bus entre reportes. Calibrado con 16 lotes reales (5.000 buses en movimiento): desde el primer
 *  segundo el bus avanza una fracción de lo que dice su velocidad medida, porque esa velocidad sobrestima (los buses frenan,
 *  esperan en semáforos y paradas). En promedio avanza 0,72 de lo calculado, pero el error mínimo se logra con 0,5
 *  (la mitad de las veces se detienen); con 0,5 el error de posición baja 10-25 % frente a dejar el bus quieto. */
export interface PredictionPolicy {
  /** Proporción de (velocidad × tiempo) que realmente avanza. */
  readonly gain: number;
  /** Cuánto baja la proporción por cada segundo de antigüedad. */
  readonly gainDecayPerSecond: number;
  readonly maxSeconds: number;
  readonly minSpeedMps: number;
}
/** Recalibrado el 2026-11-11 (36.036 comparaciones en hora pico). TransMilenio pasó a entregar cada posición con ~55–60 s de edad
 *  (antes ~4 s) y la de un mismo bus cambia cada ~60 s: con el tope de 90 s el bus se quedaba quieto buena parte del tiempo.
 *  Con 0,4 y tope de 150 s el error mediano baja de 172 m a 166 m (p90 de 436 a 423 m) y el bus sigue andando entre reportes.
 *  Antes: 0,5 y 90 s (calibrado con 16 lotes cuando el dato llegaba casi al instante). */
export const DEFAULT_PREDICTION: PredictionPolicy = { gain: 0.4, gainDecayPerSecond: 0, maxSeconds: 150, minSpeedMps: 0.3 };

/** Segundos «efectivos» de movimiento que se le atribuyen a un dato con esta antigüedad. */
export function motionSeconds(ageSeconds: number, p: PredictionPolicy = DEFAULT_PREDICTION): number {
  const a = Math.min(p.maxSeconds, Math.max(0, ageSeconds));
  return a * Math.max(0.3, p.gain - p.gainDecayPerSecond * a);
}

/** Posición estimada del bus en el instante `nowSec` (segundos desde 1970). */
export function predictPosition(v: Vehicle, nowSec: number, p: PredictionPolicy = DEFAULT_PREDICTION): WorldPoint {
  const vel = v.velocity;
  if (!vel || vel.speedMps < p.minSpeedMps) return v.world;
  const meters = vel.speedMps * motionSeconds(nowSec - v.reportedAt, p);
  const k = meters / METERS_PER_WORLD_UNIT;
  return { x: v.world.x + vel.ux * k, y: v.world.y + vel.uy * k };
}
