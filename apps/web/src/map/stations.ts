import type { Feature, FeatureCollection, LineString, Point, Polygon } from "geojson";
import { type RoadPath, type RouteShape, METERS_PER_WORLD_UNIT, RoadPath as Path, toGeo, toWorld } from "@transmi/domain";
import { type Station, type TransitState } from "@transmi/application";

/** Medidas típicas (m) con las que se dibuja una estación. El archivo solo da un punto por parada, no la forma real. */
const CAPSULE_LENGTH = 30, CAPSULE_WIDTH = 9;
/** La base abraza a los vagones sin pasarse hacia las calzadas de las avenidas (la estación va en el separador). */
const BASE_MARGIN_ALONG = 7, BASE_MARGIN_ACROSS = 1.6, BASE_RADIUS = 6;
/** Pasillo que une los vagones de una misma estación. */
const LINK_WIDTH = 4.5;
/** Las paradas del mismo vagón (una por sentido) que están así de cerca (m) son el mismo vagón. */
const MERGE_METERS = 45;

export interface StationGeometry {
  /** La estación completa: una base alargada y redondeada bajo todos sus vagones. */
  bases: FeatureCollection<Polygon>;
  /** Cada vagón, como cápsula dentro de la base. */
  capsules: FeatureCollection<Polygon>;
  /** Marcas de las puertas dentro de cada vagón. */
  doors: FeatureCollection<LineString>;
  /** Centro de cada vagón, para su número. */
  labels: FeatureCollection<Point>;
  /** El pasillo que une los vagones de cada estación. */
  links: FeatureCollection<Polygon>;
  /** Una etiqueta con el nombre sobre cada estación. */
  chips: FeatureCollection<Point>;
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

/** Eje medio (las direcciones opuestas cuentan igual: una troncal tiene dos sentidos). */
function meanAxis(axes: Axis[]): Axis {
  let c = 0, s = 0;
  for (const a of axes) { const t = 2 * Math.atan2(a.uy, a.ux); c += Math.cos(t); s += Math.sin(t); }
  const t = Math.atan2(s, c) / 2;
  return { ux: Math.cos(t), uy: Math.sin(t) };
}

/** Dibuja las estaciones de la troncal: la estación completa como una base, y sus vagones como cápsulas adentro. */
export function buildStationGeometry(state: TransitState, stations: readonly Station[]): StationGeometry {
  const index = new Map<string, RouteShape>();
  for (const [rid, shapes] of state.network.shapes) {
    const sys = state.network.routes.get(rid)?.system;
    if (sys !== "troncal" && sys !== "dual") continue;
    for (const sh of shapes) for (const id of sh.stopIds) if (!index.has(id)) index.set(id, sh);
  }
  const cache = new Map<RouteShape, RoadPath>();
  const m = 1 / METERS_PER_WORLD_UNIT;
  const empty = <G extends Polygon | LineString | Point>(): FeatureCollection<G> => ({ type: "FeatureCollection", features: [] });
  const out: StationGeometry = { bases: empty(), capsules: empty(), doors: empty(), labels: empty(), links: empty(), chips: empty() };

  /** Rectángulo redondeado en coordenadas de la estación (u a lo largo, v a lo ancho), llevado a longitud/latitud. */
  const rounded = (cu: number, cv: number, hl: number, hw: number, r: number, ax: Axis): number[][] => {
    const nx = -ax.uy, ny = ax.ux, ring: number[][] = [];
    const rr = Math.min(r, hw, hl);
    // esquinas en orden: (+,+) → (−,+) → (−,−) → (+,−); cada una es un arco de 90°
    const corners: [number, number, number][] = [[1, 1, 0], [-1, 1, 90], [-1, -1, 180], [1, -1, 270]];
    for (const [su, sv, a0] of corners) {
      for (let k = 0; k <= 6; k++) {
        const a = ((a0 + k * 15) * Math.PI) / 180;
        ring.push(point(cu + su * (hl - rr) + Math.cos(a) * rr, cv + sv * (hw - rr) + Math.sin(a) * rr, nx, ny, ax));
      }
    }
    ring.push(ring[0]!);
    return ring;
  };
  const point = (u: number, v: number, nx: number, ny: number, ax: Axis): number[] => {
    const g = toGeo({ x: (u * ax.ux + v * nx) * m, y: (u * ax.uy + v * ny) * m });
    return [g.lon, g.lat];
  };

  for (const st of stations) {
    const items = st.stops.map((stop) => ({ stop, w: toWorld(stop.position), n: state.labelOf(stop).wagon!, axis: tangentOf(state, stop.id, cache, index) }));
    const known = items.map((i) => i.axis).filter((a): a is Axis => !!a);
    const axis = known.length ? meanAxis(known) : { ux: 0, uy: -1 };
    const nx = -axis.uy, ny = axis.ux;
    const all = st.stops.map((s) => s.id).join(",");
    // coordenadas de la estación en metros: u a lo largo de la troncal, v a lo ancho
    const uv = (w: { x: number; y: number }) => ({ u: (w.x * axis.ux + w.y * axis.uy) * METERS_PER_WORLD_UNIT, v: (w.x * nx + w.y * ny) * METERS_PER_WORLD_UNIT });

    // un vagón por número, unido a los que están a menos de 45 m (las dos caras de un mismo vagón)
    const wagons: { n: number; u: number; v: number; ids: string[]; count: number }[] = [];
    for (const it of items) {
      const p = uv(it.w);
      const w = wagons.find((x) => x.n === it.n && Math.hypot(x.u - p.u, x.v - p.v) <= MERGE_METERS);
      if (w) { w.u = (w.u * w.count + p.u) / (w.count + 1); w.v = (w.v * w.count + p.v) / (w.count + 1); w.count++; w.ids.push(it.stop.id); }
      else wagons.push({ n: it.n, u: p.u, v: p.v, ids: [it.stop.id], count: 1 });
    }

    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const w of wagons) {
      u0 = Math.min(u0, w.u); u1 = Math.max(u1, w.u); v0 = Math.min(v0, w.v); v1 = Math.max(v1, w.v);
      const ring = rounded(w.u, w.v, CAPSULE_LENGTH / 2, CAPSULE_WIDTH / 2, CAPSULE_WIDTH / 2, axis);
      const props = { ids: w.ids.join(","), all, w: w.n, text: String(w.n) };
      out.capsules.features.push({ type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: [ring] } } as Feature<Polygon>);
      const c = point(w.u, w.v, nx, ny, axis);
      out.labels.features.push({ type: "Feature", properties: props, geometry: { type: "Point", coordinates: c } });
      for (const k of [-0.3, -0.1, 0.1, 0.3]) {
        const du = k * CAPSULE_LENGTH, dv = CAPSULE_WIDTH / 2 - 1.2;
        out.doors.features.push({ type: "Feature", properties: { ids: w.ids.join(",") }, geometry: { type: "LineString", coordinates: [point(w.u + du, w.v - dv, nx, ny, axis), point(w.u + du, w.v + dv, nx, ny, axis)] } });
      }
    }
    if (wagons.length > 1) {
      // pasillo continuo de un vagón al otro, por el centro de la estación
      const vMid = (v0 + v1) / 2;
      out.links.features.push({ type: "Feature", properties: { all }, geometry: { type: "Polygon", coordinates: [rounded((u0 + u1) / 2, vMid, (u1 - u0) / 2, LINK_WIDTH / 2, LINK_WIDTH / 2, axis)] } });
    }
    const hl = (u1 - u0) / 2 + CAPSULE_LENGTH / 2 + BASE_MARGIN_ALONG, hw = (v1 - v0) / 2 + CAPSULE_WIDTH / 2 + BASE_MARGIN_ACROSS;
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
    out.bases.features.push({ type: "Feature", properties: { title: st.title, all }, geometry: { type: "Polygon", coordinates: [rounded(cu, cv, hl, hw, BASE_RADIUS, axis)] } });
    // etiqueta con el nombre: sobre la estación (hacia arriba en la pantalla)
    const up = ny <= 0 ? 1 : -1;
    out.chips.features.push({ type: "Feature", properties: { title: st.title, all }, geometry: { type: "Point", coordinates: point(cu, cv + up * (hw + 2), nx, ny, axis) } });
  }
  return out;
}
