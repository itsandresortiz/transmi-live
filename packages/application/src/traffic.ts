import { type GeoPoint, type WorldPoint, METERS_PER_WORLD_UNIT, RoadPath, distanceMeters, toGeo } from "@transmi/domain";
import type { TransitState } from "./transit-state";

/** Un tramo de calle con la velocidad a la que lo recorrió un bus. */
export interface TrafficSegment { a: GeoPoint; b: GeoPoint; /** m/s */ speed: number; /** recorrido por la calle entre a y b (sigue las curvas de la ruta) */ line?: GeoPoint[] }

/** Banda de velocidad para pintar: 0 casi detenido, 1 lento, 2 normal, 3 fluido. */
export function trafficBand(speedMps: number): 0 | 1 | 2 | 3 {
  return speedMps < 1.5 ? 0 : speedMps < 4 ? 1 : speedMps < 7.5 ? 2 : 3;
}

const pathCache = new WeakMap<object, Map<string, RoadPath[]>>();
function pathsOf(state: TransitState, routeId: string): RoadPath[] {
  let m = pathCache.get(state.network); if (!m) { m = new Map(); pathCache.set(state.network, m); }
  let l = m.get(routeId);
  if (!l) { l = (state.network.shapes.get(routeId) ?? []).filter((sh) => sh.points.length > 1).map((sh) => new RoadPath(sh.points)); m.set(routeId, l); }
  return l;
}

const CELL = 0.0004;                           // ~44 m
const stopGrids = new WeakMap<object, Map<string, true>>();
const key = (x: number, y: number) => `${Math.round(x / CELL)},${Math.round(y / CELL)}`;
function nearStop(state: TransitState, g: GeoPoint): boolean {
  let grid = stopGrids.get(state.network);
  if (!grid) { grid = new Map(); for (const s of state.network.stops.values()) grid.set(key(s.position.lon, s.position.lat), true); stopGrids.set(state.network, grid); }
  const cx = Math.round(g.lon / CELL), cy = Math.round(g.lat / CELL);
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (grid.has(`${cx + dx},${cy + dy}`)) return true;
  return false;
}

/** Velocidad real de los buses en las calles, a partir del último tramo que recorrió cada uno.
 *  Solo buses que comparten calle con el tráfico (no los carriles exclusivos de la troncal) y fuera de las paradas,
 *  donde detenerse es normal. Entre un reporte y otro pasan 17–59 s, así que cada tramo es la velocidad *media* de ese lapso. */
export function trafficSegments(state: TransitState, nowSec: number): TrafficSegment[] {
  const out: TrafficSegment[] = [];
  for (const v of state.fleet.values()) {
    if (v.system === "troncal") continue;
    if (nowSec - v.reportedAt > 120) continue;                       // dato viejo
    const leg = v.lastLeg(); if (!leg) continue;
    const dt = leg.t1 - leg.t0; if (dt < 8 || dt > 120) continue;
    const p0: WorldPoint = { x: leg.x0, y: leg.y0 }, p1: WorldPoint = { x: leg.x1, y: leg.y1 };
    const meters = distanceMeters(p0, p1);
    const b = toGeo(p1);
    if (nearStop(state, b)) continue;
    const speed = Math.min(20, meters / dt);
    if (meters < 12) {
      // casi quieto: un trazo corto en el sentido en que iba, para que se vea el tramo detenido
      const ang = ((v.bearing ?? 90) * Math.PI) / 180, k = 6 / METERS_PER_WORLD_UNIT;
      out.push({ a: toGeo({ x: p1.x - Math.sin(ang) * k, y: p1.y + Math.cos(ang) * k }), b: toGeo({ x: p1.x + Math.sin(ang) * k, y: p1.y - Math.cos(ang) * k }), speed });
    } else {
      // si los dos puntos caen sobre el recorrido de su ruta, el tramo sigue la calle (con sus curvas) en vez de cortar en línea recta
      let line: GeoPoint[] | undefined;
      for (const path of pathsOf(state, v.routeId)) {
        const h0 = path.project(p0, 0, 0, 40), h1 = path.project(p1, 0, 0, 40);
        if (h0 && h1 && h1.s > h0.s && h1.s - h0.s < meters * 1.6 + 30) { line = path.slice(h0.s, h1.s); break; }
      }
      out.push({ a: toGeo(p0), b, speed, line: line && line.length > 1 ? line : undefined });
    }
  }
  return out;
}

/* ---------- rayitas que avanzan sobre el tráfico ---------- */

/** Sobre cada tramo de tráfico se dibujan rayitas blancas que avanzan en el sentido de la marcha: rápidas donde fluye, casi quietas en el trancón.
 *  Por banda (0 detenido … 3 fluido): cuántas veces por segundo recorre la raya su ciclo. Lo usan la web y la app. */
export const TRAFFIC_FLOW: readonly { cycles: number; fps: number }[] = [{ cycles: 0.12, fps: 5 }, { cycles: 0.4, fps: 8 }, { cycles: 0.8, fps: 12 }, { cycles: 1.3, fps: 15 }];
const FLOW_DASH = 1.5, FLOW_GAP = 4.5;
/** Patrón «raya + hueco» visto desde la fase `phase` (en anchos de línea): al bajar la fase, las rayas avanzan por la línea. */
export function flowDash(phase: number): number[] {
  const d = FLOW_DASH, g = FLOW_GAP, P = d + g, ph = ((phase % P) + P) % P;
  const r = (x: number) => Math.round(x * 100) / 100;
  return ph < d ? [r(d - ph), g, r(ph), 0] : [0, r(g - (ph - d)), d, r(ph - d)];
}
/** El patrón de la banda `band` en el instante `tMs`. */
export function flowDashAt(band: number, tMs: number): number[] {
  const P = FLOW_DASH + FLOW_GAP;
  return flowDash(P - (((tMs / 1000) * TRAFFIC_FLOW[band]!.cycles) % 1) * P);
}
