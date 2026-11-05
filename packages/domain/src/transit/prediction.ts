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
export const DEFAULT_PREDICTION: PredictionPolicy = { gain: 0.5, gainDecayPerSecond: 0, maxSeconds: 90, minSpeedMps: 0.3 };

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
