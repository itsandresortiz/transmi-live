import type { WorldPoint } from "../shared/geo";
import { METERS_PER_WORLD_UNIT } from "../shared/geo";
import type { Vehicle } from "./vehicle";

/** Cuándo y cuánto adelantar a un bus entre reportes. Calibrado con datos reales:
 *  con un dato de menos de 15 s de antigüedad es mejor no inventar nada; después, avanzar
 *  en línea recta con la velocidad medida reduce el error 5–17 % frente a dejar el bus quieto. */
export interface PredictionPolicy {
  readonly gateSeconds: number;
  readonly maxSeconds: number;
  readonly minSpeedMps: number;
}
export const DEFAULT_PREDICTION: PredictionPolicy = { gateSeconds: 15, maxSeconds: 75, minSpeedMps: 0.3 };

/** Segundos de movimiento que se le atribuyen a un dato con esta antigüedad. */
export function motionSeconds(ageSeconds: number, p: PredictionPolicy = DEFAULT_PREDICTION): number {
  return Math.min(p.maxSeconds, Math.max(0, ageSeconds - p.gateSeconds));
}

/** Posición estimada del bus en el instante `nowSec` (segundos desde 1970). */
export function predictPosition(v: Vehicle, nowSec: number, p: PredictionPolicy = DEFAULT_PREDICTION): WorldPoint {
  const vel = v.velocity;
  if (!vel || vel.speedMps < p.minSpeedMps) return v.world;
  const meters = vel.speedMps * motionSeconds(nowSec - v.reportedAt, p);
  const k = meters / METERS_PER_WORLD_UNIT;
  return { x: v.world.x + vel.ux * k, y: v.world.y + vel.uy * k };
}
