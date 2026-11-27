import { type RouteShape, bearingDegrees, toGeo } from "@transmi/domain";
import { shapeStops } from "./eta";
import type { TransitState } from "./transit-state";

/**
 * Posiciones compartidas (opcional y anónimo): quien va en un bus con «Voy en este bus», con su GPS confirmando que va en él y con el
 * permiso encendido en Más, manda cada ~20 s por dónde va el bus sobre su recorrido. Sin nada de la persona ni del teléfono: solo ruta,
 * recorrido, metros, hora, velocidad y, si es un bus de los datos de TransMilenio, su número. Con eso las apps dibujan ese bus más exacto
 * para todos (el reporte de TransMilenio llega ~1 min tarde) y dibujan buses que TransMilenio no reporta. Vale como mucho 60 s.
 */
export interface SharedRide {
  routeId: string;
  /** Índice del recorrido dentro de `network.shapes.get(routeId)` (define el sentido). */
  shape: number;
  /** Metros desde el inicio del recorrido. */
  meters: number;
  /** Hora de la lectura (segundos desde 1970). */
  at: number;
  /** m/s, si se sabe. */
  speed?: number | null;
  /** Número del bus en los datos de TransMilenio (nunca el de un viaje con GPS). */
  busId?: string | null;
}

/** Una posición compartida vale como mucho esto (segundos). */
export const SHARED_MAX_AGE_S = 60;
/** Dos posiciones del mismo recorrido a menos de esto (tras adelantar la vieja a la hora de la nueva) son del mismo bus. */
const SAME_BUS_M = 250;
/** Entre lecturas se adelanta a la velocidad que llevaba, hasta este tiempo y esta velocidad. */
const AHEAD_MAX_S = 20, MAX_SPEED_MPS = 20;

/** Lee la lista que publica el servidor (`{ at, items: [{ r, k, m, t, v?, b? }] }`). Descarta lo que no tenga forma válida. */
export function parseSharedRides(json: unknown): SharedRide[] {
  const items = (json as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];
  const out: SharedRide[] = [];
  for (const it of items) {
    const o = it as Record<string, unknown>;
    if (typeof o?.r !== "string" || typeof o.k !== "number" || typeof o.m !== "number" || typeof o.t !== "number") continue;
    if (!Number.isFinite(o.m) || o.m < 0 || !Number.isInteger(o.k) || o.k < 0) continue;
    out.push({ routeId: o.r, shape: o.k, meters: o.m, at: o.t, speed: typeof o.v === "number" ? o.v : null, busId: typeof o.b === "string" && o.b && !o.b.startsWith("gps:") ? o.b : null });
  }
  return out;
}

const speedOf = (r: SharedRide) => Math.min(MAX_SPEED_MPS, Math.max(0, r.speed ?? 0));

/** Una sola posición por bus: la más reciente. Sin identificador de persona, dos posiciones son del mismo bus si comparten número de bus o
 *  si, adelantando la vieja a la hora de la nueva, quedan a menos de 250 m en el mismo recorrido. Quita lo de más de 60 s. */
export function dedupeSharedRides(list: readonly SharedRide[], nowSec: number): SharedRide[] {
  const fresh = list.filter((r) => nowSec - r.at <= SHARED_MAX_AGE_S && r.at - nowSec <= 30).sort((a, b) => b.at - a.at);
  const kept: SharedRide[] = [];
  for (const r of fresh) {
    const same = kept.some((k) => {
      if (k.routeId !== r.routeId || k.shape !== r.shape) return false;
      if (k.busId && r.busId) return k.busId === r.busId;
      return Math.abs(k.meters - (r.meters + speedOf(r) * (k.at - r.at))) <= SAME_BUS_M;
    });
    if (!same) kept.push(r);
  }
  return kept;
}

/** Las posiciones compartidas vigentes. Vive en `TransitState` (`state.sharedRides`) para que la web y la app las lean igual. */
export class SharedRides {
  private list: SharedRide[] = [];
  private byBus = new Map<string, SharedRide>();

  get size(): number { return this.list.length; }
  set(list: readonly SharedRide[], nowSec: number): void {
    this.list = dedupeSharedRides(list, nowSec);
    this.byBus = new Map(this.list.filter((r) => r.busId).map((r) => [r.busId!, r]));
  }

  /** Dónde dibujar el bus `busId` según quien va en él (si hay una posición compartida reciente y más nueva que el reporte del bus). */
  positionOf(state: TransitState, busId: string, nowSec: number): { lat: number; lon: number; heading: number } | null {
    const r = this.byBus.get(busId), v = state.fleet.get(busId);
    if (!r || nowSec - r.at > SHARED_MAX_AGE_S || (v && v.reportedAt >= r.at)) return null;
    return sharedPosition(state, r, nowSec);
  }

  /** Buses que solo conoce la gente que va en ellos (TransMilenio no los reporta, o su número no está en los datos ahora). */
  extras(state: TransitState, nowSec: number): { id: string; routeId: string; lat: number; lon: number; heading: number }[] {
    const out: { id: string; routeId: string; lat: number; lon: number; heading: number }[] = [];
    this.list.forEach((r, i) => {
      if (nowSec - r.at > SHARED_MAX_AGE_S || (r.busId && state.fleet.get(r.busId))) return;
      const p = sharedPosition(state, r, nowSec);
      if (p) out.push({ id: `comp:${r.routeId}:${r.shape}:${i}`, routeId: r.routeId, ...p });
    });
    return out;
  }
}

/** Punto del recorrido donde va el bus ahora: la lectura adelantada a su velocidad (como mucho 20 s). */
export function sharedPosition(state: TransitState, r: SharedRide, nowSec: number): { lat: number; lon: number; heading: number } | null {
  const shape: RouteShape | undefined = state.network.shapes.get(r.routeId)?.[r.shape];
  const ss = shape ? shapeStops(state, shape) : null;
  if (!ss) return null;
  const s = Math.min(ss.path.length, r.meters + speedOf(r) * Math.min(AHEAD_MAX_S, Math.max(0, nowSec - r.at)));
  const here = ss.path.pointAt(s), ahead = ss.path.pointAt(Math.min(ss.path.length, s + 15)), g = toGeo(here);
  return { lat: g.lat, lon: g.lon, heading: bearingDegrees(here, ahead) };
}
