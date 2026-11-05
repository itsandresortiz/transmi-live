import type { Feature, FeatureCollection, Point, Polygon } from "geojson";
import { type RoadPath, type RouteShape, METERS_PER_WORLD_UNIT, RoadPath as Path, toGeo, toWorld } from "@transmi/domain";
import { type Station, type TransitState } from "@transmi/application";

/** Tamaño típico de un vagón dibujado (m). El archivo solo da un punto por vagón, no su forma. */
const WAGON_LENGTH = 24, WAGON_WIDTH = 8, PILL_MARGIN = 9;

export interface StationGeometry {
  pills: FeatureCollection<Polygon>;
  wagons: FeatureCollection<Polygon>;
  labels: FeatureCollection<Point>;
  /** Paradas dibujadas como vagón (no se repiten como puntico). */
  stopIds: Set<string>;
}

interface Axis { ux: number; uy: number }

/** Orientación de cada parada: la dirección de la ruta que se detiene en ella. */
function tangentOf(state: TransitState, stopId: string, cache: Map<RouteShape, RoadPath>, index: Map<string, RouteShape>): Axis | null {
  const shape = index.get(stopId), stop = state.stopById(stopId);
  if (!shape || !stop || shape.points.length < 2) return null;
  let path = cache.get(shape);
  if (!path) { path = new Path(shape.points); cache.set(shape, path); }
  const hit = path.project(toWorld(stop.position), 0, 0, 80);
  return hit ? path.tangentAt(hit.s) : null;
}

/** Eje medio de varios ejes (las direcciones opuestas cuentan igual: una troncal tiene dos sentidos). */
function meanAxis(axes: Axis[]): Axis {
  let c = 0, s = 0;
  for (const a of axes) { const t = 2 * Math.atan2(a.uy, a.ux); c += Math.cos(t); s += Math.sin(t); }
  const t = Math.atan2(s, c) / 2;
  return { ux: Math.cos(t), uy: Math.sin(t) };
}

/** Dibuja las estaciones de la troncal: una píldora por estación (vista media) y un rectángulo por vagón (vista cercana). */
export function buildStationGeometry(state: TransitState, stations: readonly Station[]): StationGeometry {
  const index = new Map<string, RouteShape>();
  for (const [rid, shapes] of state.network.shapes) {
    const sys = state.network.routes.get(rid)?.system;
    if (sys !== "troncal" && sys !== "dual") continue;
    for (const sh of shapes) for (const id of sh.stopIds) if (!index.has(id)) index.set(id, sh);
  }
  const cache = new Map<RouteShape, RoadPath>();
  const m = 1 / METERS_PER_WORLD_UNIT;
  const rect = (cx: number, cy: number, ax: Axis, len: number, wid: number): number[][] => {
    const nx = -ax.uy, ny = ax.ux, l = (len / 2) * m, w = (wid / 2) * m;
    return [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([a, b]) => {
      const g = toGeo({ x: cx + ax.ux * l * a! + nx * w * b!, y: cy + ax.uy * l * a! + ny * w * b! });
      return [g.lon, g.lat];
    });
  };
  const out: StationGeometry = { pills: { type: "FeatureCollection", features: [] }, wagons: { type: "FeatureCollection", features: [] }, labels: { type: "FeatureCollection", features: [] }, stopIds: new Set() };

  for (const st of stations) {
    const items = st.stops.map((stop) => ({ stop, w: toWorld(stop.position), axis: tangentOf(state, stop.id, cache, index) }));
    const known = items.map((i) => i.axis).filter((a): a is Axis => !!a);
    const axis = known.length ? meanAxis(known) : { ux: 0, uy: -1 };
    for (const it of items) {
      const ax = it.axis ?? axis;
      const n = state.labelOf(it.stop).wagon!;
      const f: Feature<Polygon> = { type: "Feature", properties: { id: it.stop.id, w: n, title: st.title }, geometry: { type: "Polygon", coordinates: [rect(it.w.x, it.w.y, ax, WAGON_LENGTH, WAGON_WIDTH)] } };
      out.wagons.features.push(f);
      out.labels.features.push({ type: "Feature", properties: { id: it.stop.id, w: String(n) }, geometry: { type: "Point", coordinates: [it.stop.position.lon, it.stop.position.lat] } });
      out.stopIds.add(it.stop.id);
    }
    // píldora: caja orientada que envuelve todos los vagones
    const nx = -axis.uy, ny = axis.ux;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const it of items) {
      const u = it.w.x * axis.ux + it.w.y * axis.uy, v = it.w.x * nx + it.w.y * ny;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const padU = (WAGON_LENGTH / 2 + PILL_MARGIN) * m, padV = (WAGON_WIDTH / 2 + PILL_MARGIN) * m;
    const corner = (u: number, v: number) => { const g = toGeo({ x: u * axis.ux + v * nx, y: u * axis.uy + v * ny }); return [g.lon, g.lat]; };
    const ring = [corner(u0 - padU, v0 - padV), corner(u1 + padU, v0 - padV), corner(u1 + padU, v1 + padV), corner(u0 - padU, v1 + padV), corner(u0 - padU, v0 - padV)];
    out.pills.features.push({ type: "Feature", properties: { title: st.title, ids: st.stops.map((s) => s.id).join(",") }, geometry: { type: "Polygon", coordinates: [ring] } });
  }
  return out;
}
