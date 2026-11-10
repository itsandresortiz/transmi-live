import type { Feature, FeatureCollection, LineString, Point, Polygon } from "geojson";
import { type RoadPath, type RouteShape, METERS_PER_WORLD_UNIT, RoadPath as Path, toGeo, toWorld, trunkLetterOf } from "@transmi/domain";
import type { Station } from "./queries";
import type { TransitState } from "./transit-state";

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
/** Puntos de las líneas dibujadas de la troncal (lat, lon) con su letra: la línea por la que realmente pasa una estación manda sobre cuántas rutas la usan. */
export interface CorridorLine { l: string; p: readonly [number, number][] }

export function buildStationGeometry(state: TransitState, stations: readonly Station[], corridors: readonly CorridorLine[] = []): StationGeometry {
  const index = new Map<string, RouteShape>();
  for (const [rid, shapes] of state.network.shapes) {
    const sys = state.network.routes.get(rid)?.system;
    if (sys !== "troncal" && sys !== "dual") continue;
    for (const sh of shapes) for (const id of sh.stopIds) if (!index.has(id)) index.set(id, sh);
  }
  const cache = new Map<RouteShape, RoadPath>();
  // línea de cada parada: la letra que más se repite entre las rutas troncales que se detienen ahí
  const letters = new Map<string, Map<string, number>>();
  for (const [rid, shapes] of state.network.shapes) {
    const r = state.network.routes.get(rid), l = r ? trunkLetterOf(r.shortName) : null;
    if (!l) continue;
    for (const sh of shapes) for (const id of sh.stopIds) { const c = letters.get(id) ?? letters.set(id, new Map()).get(id)!; c.set(l, (c.get(l) ?? 0) + 1); }
  }
  // letras de las líneas dibujadas a menos de 45 m de la parada (cada corredor tiene su letra)
  const nearLetters = (id: string): Set<string> => {
    const out = new Set<string>(), st = state.network.stops.get(id);
    if (!st) return out;
    const { lat, lon } = st.position, kx = 111_320 * Math.cos((lat * Math.PI) / 180), ky = 110_540;
    for (const c of corridors) {
      if (out.has(c.l.trim())) continue;
      for (let i = 0; i + 1 < c.p.length; i++) {
        const a = c.p[i]!, b = c.p[i + 1]!;
        const ax = (a[1] - lon) * kx, ay = (a[0] - lat) * ky, bx = (b[1] - lon) * kx, by = (b[0] - lat) * ky;
        const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
        if (Math.hypot(ax + t * dx, ay + t * dy) <= 45) { out.add(c.l.trim()); break; }
      }
    }
    return out;
  };
  const lineOf = (ids: string[]): string => {
    const tot = new Map<string, number>();
    for (const id of ids) for (const [l, n] of letters.get(id) ?? []) tot.set(l, (tot.get(l) ?? 0) + n);
    // el corredor por el que pasa la estación desempata (y pesa más que una ruta que solo la atraviesa)
    for (const id of ids) for (const l of nearLetters(id)) tot.set(l, (tot.get(l) ?? 0) + 2);
    return [...tot.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "X";
  };
  // líneas de los corredores en coordenadas de mundo: se usan para centrar cada estación en la mediana de su avenida
  const medians = corridors.map((c) => c.p.map(([la, lo]) => toWorld({ lat: la, lon: lo })));
  const nearestMedian = (w: { x: number; y: number }): { x: number; y: number; dist: number } | null => {
    let best: { x: number; y: number; dist: number } | null = null;
    for (const pts of medians) for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!, b = pts[i + 1]!, dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1e-18;
      const t = Math.max(0, Math.min(1, ((w.x - a.x) * dx + (w.y - a.y) * dy) / len2));
      const px = a.x + t * dx, py = a.y + t * dy, d = Math.hypot(px - w.x, py - w.y) * METERS_PER_WORLD_UNIT;
      if (!best || d < best.dist) best = { x: px, y: py, dist: d };
    }
    return best;
  };
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
    const line = lineOf(st.stops.map((s) => s.id));
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

    // Las coordenadas de las paradas del GTFS suelen quedar pegadas a un carril: la estación se centra lateralmente sobre la línea de su corredor
    // (la mediana de la avenida), si esa línea está cerca y el ajuste es razonable.
    {
      const vMid0 = wagons.reduce((a, w) => a + w.v, 0) / wagons.length, uMid0 = wagons.reduce((a, w) => a + w.u, 0) / wagons.length;
      const cw = { x: (uMid0 * axis.ux + vMid0 * nx) * m, y: (uMid0 * axis.uy + vMid0 * ny) * m };
      const nm = nearestMedian(cw);
      if (nm && nm.dist <= 35) {
        const dv = uv(nm).v - vMid0;
        if (Math.abs(dv) >= 1.5 && Math.abs(dv) <= 28) for (const w of wagons) w.v += dv;
      }
    }
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const w of wagons) {
      u0 = Math.min(u0, w.u); u1 = Math.max(u1, w.u); v0 = Math.min(v0, w.v); v1 = Math.max(v1, w.v);
      const ring = rounded(w.u, w.v, CAPSULE_LENGTH / 2, CAPSULE_WIDTH / 2, CAPSULE_WIDTH / 2, axis);
      const props = { ids: w.ids.join(","), all, w: w.n, text: String(w.n), l: line };
      out.capsules.features.push({ type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: [ring] } } as Feature<Polygon>);
      const c = point(w.u, w.v, nx, ny, axis);
      out.labels.features.push({ type: "Feature", properties: props, geometry: { type: "Point", coordinates: c } });
      for (const k of [-0.3, -0.1, 0.1, 0.3]) {
        const du = k * CAPSULE_LENGTH, dv = CAPSULE_WIDTH / 2 - 1.2;
        out.doors.features.push({ type: "Feature", properties: { ids: w.ids.join(","), l: line }, geometry: { type: "LineString", coordinates: [point(w.u + du, w.v - dv, nx, ny, axis), point(w.u + du, w.v + dv, nx, ny, axis)] } });
      }
    }
    if (wagons.length > 1) {
      // pasillo continuo de un vagón al otro, por el centro de la estación
      const vMid = (v0 + v1) / 2;
      out.links.features.push({ type: "Feature", properties: { all, l: line }, geometry: { type: "Polygon", coordinates: [rounded((u0 + u1) / 2, vMid, (u1 - u0) / 2, LINK_WIDTH / 2, LINK_WIDTH / 2, axis)] } });
    }
    const hl = (u1 - u0) / 2 + CAPSULE_LENGTH / 2 + BASE_MARGIN_ALONG, hw = (v1 - v0) / 2 + CAPSULE_WIDTH / 2 + BASE_MARGIN_ACROSS;
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
    out.bases.features.push({ type: "Feature", properties: { title: st.title, all, l: line }, geometry: { type: "Polygon", coordinates: [rounded(cu, cv, hl, hw, BASE_RADIUS, axis)] } });
    // etiqueta con el nombre: sobre la estación (hacia arriba en la pantalla)
    const up = ny <= 0 ? 1 : -1;
    out.chips.features.push({ type: "Feature", properties: { title: st.title, all, l: line }, geometry: { type: "Point", coordinates: point(cu, cv + up * (hw + 2), nx, ny, axis) } });
  }
  return out;
}
