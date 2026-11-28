import type { Feature, FeatureCollection, LineString, Point, Polygon } from "geojson";
import { type RoadPath, type RouteShape, METERS_PER_WORLD_UNIT, RoadPath as Path, toGeo, toWorld, trunkLetterOf } from "@transmi/domain";
import type { Station } from "./queries";
import type { TransitState } from "./transit-state";

/** Medidas típicas (m) con las que se dibuja una estación. El archivo solo da un punto por parada, no la forma real. */
const CAPSULE_LENGTH = 30, CAPSULE_WIDTH = 9;
/** La base abraza a los vagones sin pasarse hacia las calzadas de las avenidas (la estación va en el separador). */
const BASE_MARGIN_ALONG = 7, BASE_MARGIN_ACROSS = 1.6, BASE_RADIUS = 6;
/** Distancia mínima (m) del eje de un vagón a un carril de bus: medio vagón real (2,4) + medio bus (1,3) + un poco. */
export const WAGON_CLEAR_M = 3.8;
/** Una estación tiene plaza si los carriles de la troncal pasan a cada lado separados al menos esto (m), con los vagones entre ellos. */
export const PLAZA_MIN_LANES_M = 22;
/** Pasillo que une los vagones de una misma estación. */
const LINK_WIDTH = 4.5;
/** Una estación se centra sobre la línea de su corredor si esta queda a lo sumo a estos metros. */
const MEDIAN_SNAP_M = 35;
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
  /** Plaza peatonal de las estaciones grandes (vagones en dos filas con un espacio sin buses en medio, como Tv. 86): adoquín, materas y árboles en 3D. */
  plazas: FeatureCollection<Polygon>;
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

/** Cuando las paradas de una estación forman una fila larga y recta (≥ `STOPS_AXIS_MIN_M` de punta a punta, ≤ `STOPS_AXIS_MAX_SPREAD_M` de
 *  ancho), esa fila manda sobre el sentido de los recorridos si se apartan más de `STOPS_AXIS_MAX_DEG`. En las cabeceras (Universidades)
 *  los recorridos dan la vuelta junto a la estación y su sentido salía casi atravesado a la avenida: la base cruzaba las calzadas. */
export const STOPS_AXIS_MIN_M = 40, STOPS_AXIS_MAX_SPREAD_M = 12, STOPS_AXIS_MAX_DEG = 20;
export function stopsAxis(ws: readonly { x: number; y: number }[], fromShapes: Axis): Axis {
  if (ws.length < 2) return fromShapes;
  const mx = ws.reduce((a, w) => a + w.x, 0) / ws.length, my = ws.reduce((a, w) => a + w.y, 0) / ws.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const w of ws) { const dx = w.x - mx, dy = w.y - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const t = Math.atan2(2 * sxy, sxx - syy) / 2, ax = { ux: Math.cos(t), uy: Math.sin(t) };
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const w of ws) {
    const u = ((w.x - mx) * ax.ux + (w.y - my) * ax.uy) * METERS_PER_WORLD_UNIT, v = ((w.x - mx) * -ax.uy + (w.y - my) * ax.ux) * METERS_PER_WORLD_UNIT;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  if (u1 - u0 < STOPS_AXIS_MIN_M || v1 - v0 > STOPS_AXIS_MAX_SPREAD_M) return fromShapes;
  const deg = (Math.acos(Math.min(1, Math.abs(ax.ux * fromShapes.ux + ax.uy * fromShapes.uy))) * 180) / Math.PI;
  return deg > STOPS_AXIS_MAX_DEG ? ax : fromShapes;
}

/** Dibuja las estaciones de la troncal: la estación completa como una base, y sus vagones como cápsulas adentro. */
/** Puntos de las líneas dibujadas de la troncal (lat, lon) con su letra: la línea por la que realmente pasa una estación manda sobre cuántas rutas la usan. */
export interface CorridorLine { l: string; p: readonly [number, number][] }

export function buildStationGeometry(state: TransitState, stations: readonly Station[], corridors: readonly CorridorLine[] = []): StationGeometry {
  const index = new Map<string, RouteShape>();
  /** Todos los recorridos de troncal y dual que paran en cada parada (para centrar la estación entre sus dos sentidos). */
  const byStop = new Map<string, Set<RouteShape>>();
  for (const [rid, shapes] of state.network.shapes) {
    const sys = state.network.routes.get(rid)?.system;
    if (sys !== "troncal" && sys !== "dual") continue;
    for (const sh of shapes) for (const id of sh.stopIds) { if (!index.has(id)) index.set(id, sh); (byStop.get(id) ?? byStop.set(id, new Set()).get(id)!).add(sh); }
  }
  const cache = new Map<RouteShape, RoadPath>();
  // línea de cada parada: la letra que más se repite entre las rutas troncales que se detienen ahí
  const letters = new Map<string, Map<string, number>>();
  for (const [rid, shapes] of state.network.shapes) {
    const r = state.network.routes.get(rid), l = r ? trunkLetterOf(r.shortName) : null;
    if (!l) continue;
    for (const sh of shapes) for (const id of sh.stopIds) { const c = letters.get(id) ?? letters.set(id, new Map()).get(id)!; c.set(l, (c.get(l) ?? 0) + 1); }
  }
  // caja de cada corredor (lat, lon): los que quedan lejos de una parada o estación no se recorren tramo por tramo (al abrir, esto se
  // hacía para cada parada contra todos los tramos de todos los corredores). No cambia el resultado: solo se saltan los que no pueden estar cerca
  const cbox = corridors.map((c) => {
    let s = Infinity, n = -Infinity, w = Infinity, e = -Infinity;
    for (const [la, lo] of c.p) { if (la < s) s = la; if (la > n) n = la; if (lo < w) w = lo; if (lo > e) e = lo; }
    return { s, n, w, e };
  });
  const farFrom = (i: number, lat: number, lon: number, meters: number): boolean => {
    const b = cbox[i]!, dLat = (meters * 1.5) / 110_540, dLon = (meters * 1.5) / (111_320 * Math.cos((lat * Math.PI) / 180));      // con holgura
    return lat < b.s - dLat || lat > b.n + dLat || lon < b.w - dLon || lon > b.e + dLon;
  };
  // letras de las líneas dibujadas a menos de 45 m de la parada (cada corredor tiene su letra)
  const nearLetters = (id: string): Set<string> => {
    const out = new Set<string>(), st = state.network.stops.get(id);
    if (!st) return out;
    const { lat, lon } = st.position, kx = 111_320 * Math.cos((lat * Math.PI) / 180), ky = 110_540;
    for (let ci = 0; ci < corridors.length; ci++) {
      const c = corridors[ci]!;
      if (out.has(c.l.trim()) || farFrom(ci, lat, lon, 45)) continue;
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
  /** El punto de corredor más cercano. Solo se miran los corredores que pueden quedar a ≤ `MEDIAN_SNAP_M`: más lejos no se usa. */
  const nearestMedian = (w: { x: number; y: number }): { x: number; y: number; dist: number } | null => {
    let best: { x: number; y: number; dist: number } | null = null;
    const g = toGeo(w);
    for (let ci = 0; ci < medians.length; ci++) {
      if (farFrom(ci, g.lat, g.lon, MEDIAN_SNAP_M)) continue;
      const pts = medians[ci]!;
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i]!, b = pts[i + 1]!, dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1e-18;
        const t = Math.max(0, Math.min(1, ((w.x - a.x) * dx + (w.y - a.y) * dy) / len2));
        const px = a.x + t * dx, py = a.y + t * dy, d = Math.hypot(px - w.x, py - w.y) * METERS_PER_WORLD_UNIT;
        if (!best || d < best.dist) best = { x: px, y: py, dist: d };
      }
    }
    return best;
  };
  const m = 1 / METERS_PER_WORLD_UNIT;
  const empty = <G extends Polygon | LineString | Point>(): FeatureCollection<G> => ({ type: "FeatureCollection", features: [] });
  const out: StationGeometry = { bases: empty(), capsules: empty(), doors: empty(), labels: empty(), links: empty(), chips: empty(), plazas: empty() };

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
    const axis = stopsAxis(items.map((i) => i.w), known.length ? meanAxis(known) : { ux: 0, uy: -1 });
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

    // Primero, por donde pasan los buses: los recorridos de las rutas que paran ahí van por los carriles de la troncal, uno a cada lado de
    // la estación. El centro de la estación es el punto medio entre el más a la izquierda y el más a la derecha (si son uno solo, ese).
    // Antes se centraba sobre la línea dibujada del corredor, que en algunos tramos va corrida (Rionegro quedaba ~15 m hacia los carriles).
    let byShapes = false;
    let shapeVs: number[] = [];      // dónde pasan (a lo ancho) los recorridos de las rutas que paran ahí, para la plaza
    {
      const vMid0 = wagons.reduce((a, w) => a + w.v, 0) / wagons.length, uMid0 = wagons.reduce((a, w) => a + w.u, 0) / wagons.length;
      const cw = { x: (uMid0 * axis.ux + vMid0 * nx) * m, y: (uMid0 * axis.uy + vMid0 * ny) * m };
      const vs: number[] = [];
      const seen = new Set<RouteShape>();
      for (const stop of st.stops) for (const sh of byStop.get(stop.id) ?? []) {
        if (seen.has(sh) || sh.points.length < 2) continue;
        seen.add(sh);
        let path = cache.get(sh);
        if (!path) { path = new Path(sh.points); cache.set(sh, path); }
        const hit = path.project(cw, 0, 0, 45);
        if (hit) vs.push(uv(path.pointAt(hit.s)).v);
      }
      shapeVs = vs;
      if (vs.length) {
        const lo = Math.min(...vs), hi = Math.max(...vs), dv = (lo + hi) / 2 - vMid0;
        // carriles de un mismo corredor: separados como mucho ~30 m; más, es otra avenida que se cruza
        if (hi - lo <= 30 && Math.abs(dv) <= 28) { if (Math.abs(dv) >= 1) for (const w of wagons) w.v += dv; byShapes = true; }
      }
    }
    // Si no hay recorridos cerca: la estación se centra lateralmente sobre la línea de su corredor (la mediana de la avenida), si esa
    // línea está cerca y el ajuste es razonable.
    if (!byShapes) {
      const vMid0 = wagons.reduce((a, w) => a + w.v, 0) / wagons.length, uMid0 = wagons.reduce((a, w) => a + w.u, 0) / wagons.length;
      const cw = { x: (uMid0 * axis.ux + vMid0 * nx) * m, y: (uMid0 * axis.uy + vMid0 * ny) * m };
      const nm = nearestMedian(cw);
      if (nm && nm.dist <= MEDIAN_SNAP_M) {
        const dv = uv(nm).v - vMid0;
        if (Math.abs(dv) >= 1.5 && Math.abs(dv) <= 28) for (const w of wagons) w.v += dv;
      }
    }
    // Estaciones grandes con plaza (Tv. 86, Mandalay…): los carriles de la troncal pasan por fuera, separados ≥ `PLAZA_MIN_LANES_M`, y
    // todos los vagones quedan entre ellos. Ahí cada vagón se pega a su carril (las paradas del archivo caen a veces en medio) y el
    // espacio entre los dos carriles es la plaza peatonal. Solo si se sabe por dónde pasan los buses.
    let plaza = false;
    if (wagons.length >= 2 && shapeVs.length >= 2) {
      const lo = Math.min(...shapeVs), hi = Math.max(...shapeVs);
      const twoSides = shapeVs.every((v) => v - lo < 4 || hi - v < 4);
      if (hi - lo >= PLAZA_MIN_LANES_M && twoSides && wagons.every((w) => w.v > lo - 4 && w.v < hi + 4)) {
        plaza = true;
        // un vagón por letra Y por lado: las paradas que dan a cada carril forman su propio vagón junto a él (en Héroes cada letra tiene
        // puertas hacia los dos carriles: antes se juntaban en uno solo y faltaban vagones)
        const groups = new Map<string, { n: number; side: number; us: number[]; ids: string[] }>();
        for (const it of items) {
          const p = uv(it.w), side = p.v - lo <= hi - p.v ? 0 : 1, key = `${it.n}|${side}`;
          const g2 = groups.get(key) ?? groups.set(key, { n: it.n, side, us: [], ids: [] }).get(key)!;
          g2.us.push(p.u); g2.ids.push(it.stop.id);
        }
        wagons.length = 0;
        for (const g2 of groups.values()) wagons.push({ n: g2.n, u: g2.us.reduce((a, x) => a + x, 0) / g2.us.length, v: g2.side === 0 ? lo + CAPSULE_WIDTH / 2 + 0.6 : hi - CAPSULE_WIDTH / 2 - 0.6, ids: g2.ids, count: g2.ids.length });
        const us = wagons.map((w) => w.u), pu0 = Math.min(...us) - CAPSULE_LENGTH / 2, pu1 = Math.max(...us) + CAPSULE_LENGTH / 2;
        const ring = rounded((pu0 + pu1) / 2, (lo + hi) / 2, (pu1 - pu0) / 2, (hi - lo) / 2 - 1.5, 2, axis);
        out.plazas.features.push({ type: "Feature", properties: { title: st.title, all, l: line }, geometry: { type: "Polygon", coordinates: [ring] } });
      }
    }
    // Las estaciones son rectas: lo que cambia entre paradas es de qué lado del vagón abre la puerta (el archivo pone cada parada donde
    // se detiene el bus, a veces sobre el carril mismo, a un lado o al otro del vagón). Antes cada vagón se corría hacia su puerta y la
    // estación salía torcida o con vagones sobre los carriles (Calle 72, Calle 100, Granja). Ahora todos los vagones van en una sola fila,
    // centrada entre los dos carriles si se conocen; las paradas solo dicen dónde va cada vagón a lo largo. Si aun así la fila toca un
    // carril (a menos de `WAGON_CLEAR_M` de su eje), se corre entera lo mínimo (≤ 7 m). Las estaciones con plaza (dos filas) ya quedaron.
    if (!plaza) {
      const lo = shapeVs.length ? Math.min(...shapeVs) : NaN, hi = shapeVs.length ? Math.max(...shapeVs) : NaN;
      const twoSides = shapeVs.length >= 2 && hi - lo >= 2 * WAGON_CLEAR_M && hi - lo <= 30 && shapeVs.every((v) => v - lo < 4 || hi - v < 4);
      let vC = twoSides ? (lo + hi) / 2 : wagons.reduce((acc, w) => acc + w.v, 0) / wagons.length;
      // los carriles a lo largo de toda la estación (pueden ir en diagonal o abrirse): centro y puntas de cada vagón
      const paths: RoadPath[] = [];
      const seenP = new Set<RouteShape>();
      for (const stop of st.stops) for (const sh of byStop.get(stop.id) ?? []) {
        if (seenP.has(sh) || sh.points.length < 2) continue;
        seenP.add(sh);
        let path = cache.get(sh);
        if (!path) { path = new Path(sh.points); cache.set(sh, path); }
        paths.push(path);
      }
      const lanes: number[] = [], laneUV: [number, number][] = [];
      for (const w of wagons) {
        const cw = { x: (w.u * axis.ux + vC * nx) * m, y: (w.u * axis.uy + vC * ny) * m };
        for (const path of paths) {
          const hit = path.project(cw, 0, 0, 14);
          if (!hit) continue;
          for (const ds of [-12, 0, 12]) { const q = uv(path.pointAt(Math.max(0, Math.min(path.length, hit.s + ds)))); if (Math.abs(q.u - w.u) < CAPSULE_LENGTH / 2 + 2) { lanes.push(q.v); laneUV.push([q.u, q.v]); } }
        }
      }
      const ok = (v: number) => lanes.every((l) => Math.abs(l - v) >= WAGON_CLEAR_M);
      if (lanes.length && !ok(vC)) {
        const cands = lanes.flatMap((l) => [l + WAGON_CLEAR_M, l - WAGON_CLEAR_M]).filter((v) => Math.abs(v - vC) <= 7 && ok(v)).sort((x, y) => Math.abs(x - vC) - Math.abs(y - vC));
        if (cands.length) vC = cands[0]!;
      }
      // la avenida no siempre va paralela a la estación (en una estación de 200–400 m los carriles se corren 10–20 m de lado): con los
      // dos carriles a los lados, la fila sigue la línea que va justo entre ellos, con su inclinación
      const left = laneUV.filter(([, v]) => v < vC), right = laneUV.filter(([, v]) => v >= vC);
      if (twoSides && left.length >= 2 && right.length >= 2) {
        const mean = (xs: [number, number][], i: 0 | 1) => xs.reduce((acc, p) => acc + p[i], 0) / xs.length;
        const muL = mean(left, 0), mvL = mean(left, 1), muR = mean(right, 0), mvR = mean(right, 1);
        let sxy = 0, sxx = 0;
        for (const [u, v] of left) { sxy += (u - muL) * (v - mvL); sxx += (u - muL) ** 2; }
        for (const [u, v] of right) { sxy += (u - muR) * (v - mvR); sxx += (u - muR) ** 2; }
        const b = sxx > 1 ? Math.max(-0.15, Math.min(0.15, sxy / sxx)) : 0;
        const center = (u: number) => (mvL + b * (u - muL) + mvR + b * (u - muR)) / 2;
        for (const w of wagons) w.v = center(w.u);
      } else for (const w of wagons) w.v = vC;
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
    if (wagons.length > 1 && !plaza) {
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
