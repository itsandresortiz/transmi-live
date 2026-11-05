import { type GeoPoint, type WorldPoint, distanceMeters, toWorld, bearingDegrees } from "../shared/geo";
import type { SystemType } from "./system";

export type VehicleId = string;

/** Lo que informa la fuente en tiempo real sobre un bus en un instante. */
export interface VehicleReport {
  readonly id: VehicleId;
  readonly plate?: string;
  readonly label?: string;
  readonly routeId: string;
  readonly tripId?: string;
  /** Última parada a la que llegó el bus (el feed informa la parada donde ya estuvo, no la que sigue). */
  readonly lastStopId?: string;
  readonly position: GeoPoint;
  /** Hora del lote (segundos desde 1970). Es la misma para todos los buses de un lote. */
  readonly reportedAt: number;
}

export interface Velocity {
  readonly speedMps: number;
  /** Dirección unitaria en coordenadas de mundo. */
  readonly ux: number;
  readonly uy: number;
}

interface Sample { t: number; x: number; y: number }

/** Parámetros calibrados con 16 lotes reales (ver README, "Movimiento de los buses"). */
export const VELOCITY_BASELINE_SECONDS = 28;
export const HISTORY_SECONDS = 150;
export const MIN_MOVE_METERS = 8;
export const TELEPORT_METERS = 800;
export const MAX_SPEED_MPS = 20;

/** Entidad: un bus en circulación, con su historial reciente de posiciones. */
export class Vehicle {
  readonly id: VehicleId;
  plate?: string;
  label?: string;
  routeId: string;
  tripId?: string;
  /** Última parada a la que llegó (ver `VehicleReport.lastStopId`). */
  lastStopId?: string;
  position: GeoPoint;
  world: WorldPoint;
  reportedAt: number;
  /** Rumbo de la última marcha conocida (0 = norte). */
  bearing: number | null = null;
  velocity: Velocity | null = null;
  /** Sistema de transporte, resuelto por la aplicación a partir de la ruta o del propio reporte. */
  system: SystemType = "otro";
  lastSeenMs: number;
  private history: Sample[] = [];

  constructor(r: VehicleReport, nowMs: number) {
    this.id = r.id;
    this.plate = r.plate;
    this.label = r.label;
    this.routeId = r.routeId;
    this.tripId = r.tripId;
    this.lastStopId = r.lastStopId;
    this.position = r.position;
    this.world = toWorld(r.position);
    this.reportedAt = r.reportedAt;
    this.lastSeenMs = nowMs;
    this.history = [{ t: r.reportedAt, x: this.world.x, y: this.world.y }];
  }

  /** Aplica un reporte nuevo. Devuelve `true` si cambió algo (reporte más reciente que el anterior). */
  apply(r: VehicleReport, nowMs: number): boolean {
    this.lastSeenMs = nowMs;
    this.plate = r.plate ?? this.plate;
    this.label = r.label ?? this.label;
    this.routeId = r.routeId || this.routeId;
    this.tripId = r.tripId ?? this.tripId;
    this.lastStopId = r.lastStopId ?? this.lastStopId;
    if (r.reportedAt === this.reportedAt) return false;

    const next = toWorld(r.position);
    const moved = distanceMeters(this.world, next);
    if (moved >= TELEPORT_METERS) {
      // Salto demasiado grande para ser real: se reinicia el historial.
      this.history = [];
      this.velocity = null;
      this.bearing = null;
    } else if (moved > 3) {
      this.bearing = bearingDegrees(this.world, next);
    }
    this.position = r.position;
    this.world = next;
    this.reportedAt = r.reportedAt;
    this.history = this.history.filter((s) => r.reportedAt - s.t <= HISTORY_SECONDS);
    this.history.push({ t: r.reportedAt, x: next.x, y: next.y });
    this.velocity = this.measureVelocity();
    return true;
  }

  /** Velocidad medida con una base de al menos 28 s: con base corta el ruido del GPS la desbarata. */
  private measureVelocity(): Velocity | null {
    const h = this.history;
    const last = h[h.length - 1]!;
    for (let i = h.length - 2; i >= 0; i--) {
      const o = h[i]!;
      const dt = last.t - o.t;
      if (dt < VELOCITY_BASELINE_SECONDS) continue;
      const dx = last.x - o.x;
      const dy = last.y - o.y;
      const hh = Math.hypot(dx, dy);
      const meters = distanceMeters(o, last);
      if (meters > MIN_MOVE_METERS && dt > 0) {
        return { speedMps: Math.min(MAX_SPEED_MPS, meters / dt), ux: dx / hh, uy: dy / hh };
      }
      return { speedMps: 0, ux: 0, uy: 0 };
    }
    return this.velocity;
  }
}
