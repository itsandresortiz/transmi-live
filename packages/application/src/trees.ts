import type { Feature, FeatureCollection, LineString, MultiLineString, MultiPolygon, Polygon, Position } from "geojson";
import { mixHex, type BusVolumeProps } from "./map-volumes";

/** Árboles en 3D (vista 3D del mapa, de cerca), «tipo Mapas de Apple»: copa redondeada como una nube (varias esferas de tamaños distintos)
 *  y tronco café. Dos fuentes:
 *   - **árboles de verdad**: los publica `tools/arboles.ts` en la rama `arboles`, por celdas de 0,01° (~1,1 km): el teléfono baja solo las
 *     celdas de la pantalla, nunca la ciudad entera;
 *   - **sembrados**: dentro de las zonas verdes del propio mapa base (parques, jardines, bosques), en una cuadrícula fija del mundo con un
 *     corrimiento y una poda que dependen solo de la posición (semilla fija): el mismo parque sale siempre con los mismos árboles, sin
 *     ponerlos sobre senderos, canchas ni edificios. Es el respaldo cuando no hay datos de árboles (como hace Apple).
 *  La web los dibuja con modelos (three.js); la app, que no admite capas propias, con piezas `fill-extrusion` (`treeVolumes`). */

/** Desde este zoom se ven los árboles con volumen (más lejos son motas y cargan mucho). */
export const TREE_3D_MIN_ZOOM = 16;
/** Tamaño de las celdas en que se publican los árboles de verdad (grados). */
export const TREE_CELL_DEG = 0.01;

export interface TreePoint {
  lon: number;
  lat: number;
  /** Altura (m), si el dato la trae. */
  h?: number;
  /** Diámetro de la copa (m), si el dato lo trae. */
  crown?: number;
  /** Árbol de un censo u OpenStreetMap (no sembrado por nosotros). */
  real?: boolean;
}
export interface Bounds { west: number; south: number; east: number; north: number }

/* ---------- azar con semilla fija por posición ---------- */
/** Número en [0, 1) que depende solo de (a, b, s): mismo árbol en el mismo sitio, en la web, en la app y en cada visita. */
export function hash01(a: number, b: number, s = 0): number {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(s + 1, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
/** Metros por grado en Bogotá. La cuadrícula de siembra usa una latitud fija (4,65°) para que no cambie al mover el mapa. */
const M_LAT = 110_540, M_LON = 111_320 * Math.cos((4.65 * Math.PI) / 180);

/* ---------- celdas de árboles de verdad ---------- */
export function treeCellKey(lon: number, lat: number): string {
  return `${Math.floor(lon / TREE_CELL_DEG + 1e-9)}_${Math.floor(lat / TREE_CELL_DEG + 1e-9)}`;
}
/** Las celdas que tocan un recuadro (como mucho `max`, de la más cercana al centro a la más lejana). */
export function treeCellsIn(b: Bounds, max = 25): string[] {
  const x0 = Math.floor(b.west / TREE_CELL_DEG), x1 = Math.floor(b.east / TREE_CELL_DEG), y0 = Math.floor(b.south / TREE_CELL_DEG), y1 = Math.floor(b.north / TREE_CELL_DEG);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, out: [number, string][] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([(x - cx) ** 2 + (y - cy) ** 2, `${x}_${y}`]);
  return out.sort((a, b) => a[0] - b[0]).slice(0, max).map((x) => x[1]);
}
/** Formato de una celda: `{ v: 1, k: "x_y", t: [dx, dy, altura dm, copa dm, …] }`, con (dx, dy) en millonésimas de grado desde la esquina
 *  suroeste de la celda (0–10.000) y 0 cuando no se sabe la altura o la copa. ~15 bytes por árbol. */
export interface TreeCellFile { v: 1; k: string; t: number[] }
export function encodeTreeCell(key: string, trees: readonly TreePoint[]): TreeCellFile {
  const [x, y] = key.split("_").map(Number) as [number, number];
  const t: number[] = [];
  for (const p of trees) {
    t.push(Math.round((p.lon - x * TREE_CELL_DEG) * 1e6), Math.round((p.lat - y * TREE_CELL_DEG) * 1e6), Math.round((p.h ?? 0) * 10), Math.round((p.crown ?? 0) * 10));
  }
  return { v: 1, k: key, t };
}
export function decodeTreeCell(file: unknown): TreePoint[] {
  const f = file as Partial<TreeCellFile> | null;
  if (!f || f.v !== 1 || typeof f.k !== "string" || !Array.isArray(f.t)) return [];
  const [x, y] = f.k.split("_").map(Number) as [number, number];
  if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
  const out: TreePoint[] = [];
  for (let i = 0; i + 3 < f.t.length; i += 4) {
    const p: TreePoint = { lon: x * TREE_CELL_DEG + f.t[i]! / 1e6, lat: y * TREE_CELL_DEG + f.t[i + 1]! / 1e6, real: true };
    if (f.t[i + 2]! > 0) p.h = f.t[i + 2]! / 10;
    if (f.t[i + 3]! > 0) p.crown = f.t[i + 3]! / 10;
    out.push(p);
  }
  return out;
}

/** Baja (una vez) el índice de la rama `arboles` y las celdas de la pantalla, y las guarda en memoria. Sin índice (la rama aún no existe,
 *  sin señal) devuelve listas vacías y no vuelve a intentar hasta `retryMs`: la vista sigue con los árboles sembrados. */
export function treeCellLoader(base: string, fetchJson: (url: string) => Promise<unknown>, retryMs = 10 * 60_000) {
  let index: Record<string, number> | null = null, indexAt = -Infinity, indexing: Promise<void> | null = null;
  const cells = new Map<string, TreePoint[] | Promise<TreePoint[]>>();
  const loadIndex = async () => {
    try {
      const j = (await fetchJson(base + "arboles-indice.json")) as { v?: number; n?: Record<string, number> } | null;
      index = j && j.v === 1 && j.n ? j.n : {};
    } catch { index = null; }
    indexAt = Date.now();
  };
  return {
    /** Los árboles de verdad de las celdas que tocan `b` (las que aún no llegaron se piden; `onLoad` avisa cuando llega alguna). */
    async inView(b: Bounds, onLoad?: () => void): Promise<TreePoint[]> {
      if (!index && Date.now() - indexAt > retryMs) await (indexing ??= loadIndex().finally(() => { indexing = null; }));
      if (!index) return [];
      const out: TreePoint[] = [];
      for (const k of treeCellsIn(b, 16)) {
        if (!index[k]) continue;
        const c = cells.get(k);
        if (Array.isArray(c)) { out.push(...c); continue; }
        if (!c) {
          const p = fetchJson(`${base}arb_${k}.json`).then(decodeTreeCell).catch(() => [] as TreePoint[]);
          cells.set(k, p);
          void p.then((list) => { cells.set(k, list); onLoad?.(); });
        }
      }
      return out.filter((t) => t.lon >= b.west && t.lon <= b.east && t.lat >= b.south && t.lat <= b.north);
    },
  };
}

/* ---------- siembra dentro de las zonas verdes ---------- */
export interface GreenArea {
  geometry: Polygon | MultiPolygon;
  /** Qué parte de los puntos de la cuadrícula lleva árbol (0–1): bosque ~0,8, parque ~0,5, prado o separador ~0,3. */
  keep: number;
}
export interface PlantInput {
  areas: readonly GreenArea[];
  /** Donde no va un árbol: canchas, edificios, agua. */
  avoidAreas?: readonly (Polygon | MultiPolygon)[];
  /** Senderos y calles: ningún árbol a menos de `clear` m. */
  avoidLines?: readonly (LineString | MultiLineString)[];
  /** Calles (más anchas que un sendero): ningún árbol a menos de `roadClear` m de su eje. */
  roads?: readonly (LineString | MultiLineString)[];
  roadClear?: number;
  bounds: Bounds;
  /** Distancia entre puntos de la cuadrícula (m). Por defecto 10. */
  spacing?: number;
  clear?: number;
  /** Tope de árboles; se quedan los más cercanos a `center`. */
  max?: number;
  center?: { lon: number; lat: number };
}

/** Planta árboles dentro de las zonas verdes, en una cuadrícula fija del mundo (cada punto corrido al azar con semilla por posición). */
export function plantTrees(input: PlantInput): TreePoint[] {
  const sp = input.spacing ?? 10, clear = input.clear ?? 2.5, b = input.bounds;
  const chosen = new Map<string, TreePoint>();
  for (const area of input.areas) {
    const polys = area.geometry.type === "Polygon" ? [area.geometry.coordinates] : area.geometry.coordinates;
    for (const rings of polys) {
      const outer = rings[0];
      if (!outer || outer.length < 4) continue;
      let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
      for (const [x, y] of outer as [number, number][]) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
      w = Math.max(w, b.west); e = Math.min(e, b.east); s = Math.max(s, b.south); n = Math.min(n, b.north);
      if (w >= e || s >= n) continue;
      const i0 = Math.floor((w * M_LON) / sp) - 1, i1 = Math.ceil((e * M_LON) / sp) + 1, j0 = Math.floor((s * M_LAT) / sp) - 1, j1 = Math.ceil((n * M_LAT) / sp) + 1;
      if ((i1 - i0) * (j1 - j0) > 400_000) continue;            // una zona enorme a la vista (no pasa de cerca): no se siembra
      // parques grandes, menos árboles y en grupos (como en Mapas de Apple): un parque de 2 ha va con la densidad normal; uno de 100 ha
      // (Simón Bolívar ~360 ha) con ~1/7, en bosquecitos de ~50 m con prados entre ellos. Antes se llenaban de árboles por igual
      const f = sizeFactor(rings), groves = f < 1 ? Math.min(1, Math.max(0.18, f * 1.6)) : 1, keep = (area.keep * f) / groves;
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const key = `${i},${j}`;
        if (chosen.has(key) || hash01(i, j, 2) >= keep) continue;
        if (groves < 1 && hash01(Math.floor((i * sp) / GROVE_M), Math.floor((j * sp) / GROVE_M), 3) >= groves) continue;
        const lon = ((i + 0.5 + (hash01(i, j, 0) - 0.5) * 0.8) * sp) / M_LON, lat = ((j + 0.5 + (hash01(i, j, 1) - 0.5) * 0.8) * sp) / M_LAT;
        if (lon < b.west || lon > b.east || lat < b.south || lat > b.north) continue;
        if (!inRings(lon, lat, rings)) continue;
        chosen.set(key, { lon, lat });
      }
    }
  }
  let out = [...chosen.values()];
  if (out.length && input.avoidAreas?.length) out = out.filter(outside(input.avoidAreas, b));
  if (out.length && input.avoidLines?.length) out = out.filter(farFrom(input.avoidLines, clear));
  if (out.length && input.roads?.length) out = out.filter(farFrom(input.roads, input.roadClear ?? 6));
  return capNearest(out, input.max, input.center ?? { lon: (b.west + b.east) / 2, lat: (b.south + b.north) / 2 });
}

/** Tamaño de zona verde (m²) hasta el que se siembra con la densidad normal; más grande, menos (raíz del cociente). */
export const TREES_FULL_AREA_M2 = 20_000;
/** Lado (m) de los bosquecitos en que se agrupan los árboles de un parque grande. */
const GROVE_M = 50;
/** Factor de densidad de una zona verde según su tamaño (1 hasta `TREES_FULL_AREA_M2`; 0,07 en una de 400 ha). */
export function sizeFactor(rings: readonly (readonly number[][])[]): number {
  const outer = rings[0];
  if (!outer || outer.length < 4) return 1;
  let a = 0;
  for (let i = 0; i + 1 < outer.length; i++) a += outer[i]![0]! * M_LON * outer[i + 1]![1]! * M_LAT - outer[i + 1]![0]! * M_LON * outer[i]![1]! * M_LAT;
  const area = Math.abs(a) / 2;
  return area <= TREES_FULL_AREA_M2 ? 1 : Math.sqrt(TREES_FULL_AREA_M2 / area);
}
/** Árboles de verdad (OpenStreetMap, censo) sin dibujarlos todos: como mucho uno cada `cellM` m (el censo trae árboles a 2–3 m unos de
 *  otros; dibujarlos todos no se ve mejor y pesa mucho en el teléfono). Siempre los mismos (por posición). */
export function thinTrees(trees: readonly TreePoint[], cellM = 9): TreePoint[] {
  const seen = new Set<string>(), out: TreePoint[] = [];
  for (const t of trees) {
    const k = `${Math.floor((t.lon * M_LON) / cellM)},${Math.floor((t.lat * M_LAT) / cellM)}`;
    if (seen.has(k)) continue;
    seen.add(k); out.push(t);
  }
  return out;
}

/** Junta los árboles de verdad (aligerados con `thinTrees`) con los sembrados: un sembrado a menos de `minDist` m de uno de verdad sobra. */
export function mergeTrees(realAll: readonly TreePoint[], planted: readonly TreePoint[], minDist = 5): TreePoint[] {
  const real = thinTrees(realAll);
  if (!real.length) return [...planted];
  const cell = minDist, grid = new Set<string>();
  for (const p of real) grid.add(`${Math.floor((p.lon * M_LON) / cell)},${Math.floor((p.lat * M_LAT) / cell)}`);
  const near = (p: TreePoint) => {
    const x = Math.floor((p.lon * M_LON) / cell), y = Math.floor((p.lat * M_LAT) / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (grid.has(`${x + dx},${y + dy}`)) return true;
    return false;
  };
  return [...real, ...planted.filter((p) => !near(p))];
}

/** Recorta un recuadro a un radio alrededor del centro (con el mapa inclinado, el recuadro visible se alarga hasta el horizonte). */
export function clampBounds(b: Bounds, center: { lon: number; lat: number }, radiusM: number): Bounds {
  const dx = radiusM / (111_320 * Math.cos((center.lat * Math.PI) / 180)), dy = radiusM / M_LAT;
  return { west: Math.max(b.west, center.lon - dx), east: Math.min(b.east, center.lon + dx), south: Math.max(b.south, center.lat - dy), north: Math.min(b.north, center.lat + dy) };
}

export function capNearest<T extends { lon: number; lat: number }>(pts: T[], max: number | undefined, c: { lon: number; lat: number }): T[] {
  if (max == null || pts.length <= max) return pts;
  return nearestFirst(pts, c).slice(0, max);
}
/** Los puntos ordenados del más cercano a `c` al más lejano. */
export function nearestFirst<T extends { lon: number; lat: number }>(pts: readonly T[], c: { lon: number; lat: number }): T[] {
  const d = (p: T) => ((p.lon - c.lon) * M_LON) ** 2 + ((p.lat - c.lat) * M_LAT) ** 2;
  return pts.map((p) => [d(p), p] as const).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
}

/* ---------- forma de cada árbol (la misma en la web y en la app) ---------- */
export interface TreeBlob { /** este, norte, altura del centro (m) */ x: number; y: number; z: number; r: number }
export interface TreeShape { trunkH: number; trunkR: number; blobs: TreeBlob[]; /** 0–1: tono de la copa */ tone: number; rot: number }

/** Copa tipo nube: una esfera grande y 2–4 más pequeñas alrededor y encima, con tamaño, giro y tono que dependen solo de la posición. */
export function treeShape(t: TreePoint): TreeShape {
  const a = Math.round(t.lon * 1e6), b = Math.round(t.lat * 1e6);
  const scale = 0.8 + hash01(a, b, 11) * 0.45, rot = hash01(a, b, 12) * Math.PI * 2, tone = hash01(a, b, 13);
  const H = clamp(t.h ?? 8.6 * scale, 3, 22);
  const R = clamp((t.crown ?? 6.6 * scale) / 2, 1.2, 7);
  const zc = Math.max(H - R * 0.95, R * 0.9 + 0.9);
  const blobs: TreeBlob[] = [{ x: 0, y: 0, z: zc, r: R }];
  const n = 2 + Math.floor(hash01(a, b, 14) * 3);       // 2–4 esferas más
  for (let k = 0; k < n; k++) {
    const ang = rot + (k * Math.PI * 2) / n + (hash01(a, b, 20 + k) - 0.5) * 0.9;
    const rr = R * (0.5 + hash01(a, b, 30 + k) * 0.25), off = R * (0.5 + hash01(a, b, 40 + k) * 0.15);
    blobs.push({ x: Math.cos(ang) * off, y: Math.sin(ang) * off, z: zc + R * (hash01(a, b, 50 + k) * 0.5 - 0.15), r: rr });
  }
  blobs.push({ x: R * 0.12 * Math.cos(rot), y: R * 0.12 * Math.sin(rot), z: zc + R * 0.55, r: R * 0.6 });     // copete
  return { trunkH: zc - R * 0.35, trunkR: clamp(0.16 + R * 0.045, 0.16, 0.45), blobs, tone, rot };
}
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Colores: copa verde azulado (como Apple), tres tonos; tronco café. */
export const TREE_COLORS = {
  light: { crowns: ["#6fbb86", "#5daa78", "#7ec592"], trunk: "#8a6a4c" },
  dark: { crowns: ["#27594d", "#214f45", "#2d6455"], trunk: "#5e4632" },
} as const;
export function crownColor(tone: number, dark: boolean): string {
  const c = TREE_COLORS[dark ? "dark" : "light"].crowns;
  return c[Math.min(c.length - 1, Math.floor(tone * c.length))]!;
}

/* ---------- piezas `fill-extrusion` para la app ---------- */
/** Rebanadas de una esfera (fracciones del radio, de abajo arriba): una pieza de `fill-extrusion` solo tiene paredes verticales, así que la
 *  copa redonda se arma con discos a distintas alturas, cada uno del ancho de la esfera a esa altura. */
const SLICES_FULL: [number, number][] = [[-0.8, -0.4], [-0.4, 0.35], [0.35, 0.72], [0.72, 0.94]];
const SLICES_LITE: [number, number][] = [[-0.75, -0.2], [-0.2, 0.5], [0.5, 0.9]];

/** Árboles con volumen para la app (misma capa y propiedades que los buses: color `c`, base `b`, altura `h`). `detail` = copa de nube
 *  (varias esferas, ~14–20 piezas por árbol); sin él, una sola esfera (4 piezas) para cuando hay muchos. */
export function treeVolumes(trees: readonly TreePoint[], opts: { dark?: boolean; detail?: boolean } = {}): FeatureCollection<Polygon, BusVolumeProps> {
  const dark = !!opts.dark, detail = opts.detail !== false, trunk = TREE_COLORS[dark ? "dark" : "light"].trunk;
  const features: Feature<Polygon, BusVolumeProps>[] = [];
  for (const t of trees) {
    if (!Number.isFinite(t.lon) || !Number.isFinite(t.lat)) continue;
    const s = treeShape(t), kx = 1 / (111_320 * Math.cos((t.lat * Math.PI) / 180)), ky = 1 / M_LAT;
    const base = crownColor(s.tone, dark);
    const disc = (x: number, y: number, r: number, sides: number, c: string, b: number, h: number) => {
      const ring: Position[] = [];
      for (let i = 0; i < sides; i++) {
        const a = s.rot + (i * Math.PI * 2) / sides;
        ring.push([r6(t.lon + (x + Math.cos(a) * r) * kx), r6(t.lat + (y + Math.sin(a) * r) * ky)]);
      }
      ring.push(ring[0]!);
      features.push({ type: "Feature", properties: { id: "", c, b: r2(b), h: r2(h) }, geometry: { type: "Polygon", coordinates: [ring] } });
    };
    disc(0, 0, s.trunkR, 6, trunk, 0, s.trunkH + 0.3);
    const blobs = detail ? s.blobs : [{ ...s.blobs[0]!, r: s.blobs[0]!.r * 1.1 }];
    blobs.forEach((bl, k) => {
      const slices = detail && k === 0 ? SLICES_FULL : SLICES_LITE;
      slices.forEach(([f0, f1], i) => {
        // el ancho de la rebanada: el de la esfera en su punto más ancho dentro de la rebanada, un poco recortado (se ve más redonda)
        const f = f0 <= 0 && f1 >= 0 ? 0 : Math.min(Math.abs(f0), Math.abs(f1));
        const r = bl.r * Math.sqrt(1 - f * f) * (f === 0 ? 1 : 0.97);
        // la luz viene de arriba: las rebanadas altas, un poco más claras
        const c = mixHex(base, dark ? "#7fbfa8" : "#ffffff", Math.max(0, (f0 + f1) / 2) * (dark ? 0.16 : 0.3));
        disc(bl.x, bl.y, r, detail ? 8 : 7, c, bl.z + f0 * bl.r, bl.z + f1 * bl.r);
      });
    });
  }
  return { type: "FeatureCollection", features };
}
/** Seis decimales (~10 cm) bastan para un árbol y aligeran el texto que va al mapa nativo. */
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const r2 = (v: number) => Math.round(v * 100) / 100;

/* ---------- geometría ---------- */
function inRing(x: number, y: number, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0]!, yi = ring[i]![1]!, xj = ring[j]![0]!, yj = ring[j]![1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inRings(x: number, y: number, rings: Position[][]): boolean {
  if (!rings[0] || !inRing(x, y, rings[0])) return false;
  for (let k = 1; k < rings.length; k++) if (inRing(x, y, rings[k]!)) return false;      // huecos
  return true;
}
function inGeometry(x: number, y: number, g: Polygon | MultiPolygon): boolean {
  return g.type === "Polygon" ? inRings(x, y, g.coordinates) : g.coordinates.some((r) => inRings(x, y, r));
}
function bbox(g: Polygon | MultiPolygon): [number, number, number, number] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  for (const p of polys) for (const [x, y] of (p[0] ?? []) as [number, number][]) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  return [w, s, e, n];
}
/** Filtro «fuera de todas estas zonas» (canchas, edificios, agua): las zonas se reparten en casillas de 50 m por su recuadro, así cada
 *  árbol se compara solo con las de su casilla (de cerca hay miles de edificios en pantalla). */
function outside(areas: readonly (Polygon | MultiPolygon)[], view: Bounds): (p: TreePoint) => boolean {
  const C = 50, buckets = new Map<string, { g: Polygon | MultiPolygon; box: [number, number, number, number] }[]>();
  for (const g of areas) {
    const box = bbox(g);
    if (box[2] < view.west || box[0] > view.east || box[3] < view.south || box[1] > view.north) continue;
    const x0 = Math.floor((Math.max(box[0], view.west) * M_LON) / C), x1 = Math.floor((Math.min(box[2], view.east) * M_LON) / C);
    const y0 = Math.floor((Math.max(box[1], view.south) * M_LAT) / C), y1 = Math.floor((Math.min(box[3], view.north) * M_LAT) / C);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const k = `${x},${y}`;
      (buckets.get(k) ?? buckets.set(k, []).get(k)!).push({ g, box });
    }
  }
  return (p) => {
    const list = buckets.get(`${Math.floor((p.lon * M_LON) / C)},${Math.floor((p.lat * M_LAT) / C)}`);
    return !list?.some(({ g, box }) => p.lon >= box[0] && p.lon <= box[2] && p.lat >= box[1] && p.lat <= box[3] && inGeometry(p.lon, p.lat, g));
  };
}
/** Filtro «a más de `clear` m de toda línea»: los tramos se reparten en casillas de 25 m para no comparar cada árbol con todos. */
function farFrom(lines: readonly (LineString | MultiLineString)[], clear: number): (p: TreePoint) => boolean {
  const C = 25, buckets = new Map<string, [number, number, number, number][]>();
  for (const g of lines) for (const line of g.type === "LineString" ? [g.coordinates] : g.coordinates) {
    for (let i = 1; i < line.length; i++) {
      const ax = line[i - 1]![0]! * M_LON, ay = line[i - 1]![1]! * M_LAT, bx = line[i]![0]! * M_LON, by = line[i]![1]! * M_LAT;
      const x0 = Math.floor((Math.min(ax, bx) - clear) / C), x1 = Math.floor((Math.max(ax, bx) + clear) / C);
      const y0 = Math.floor((Math.min(ay, by) - clear) / C), y1 = Math.floor((Math.max(ay, by) + clear) / C);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) continue;
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const k = `${x},${y}`;
        (buckets.get(k) ?? buckets.set(k, []).get(k)!).push([ax, ay, bx, by]);
      }
    }
  }
  return (p) => {
    const px = p.lon * M_LON, py = p.lat * M_LAT, segs = buckets.get(`${Math.floor(px / C)},${Math.floor(py / C)}`);
    if (!segs) return true;
    for (const [ax, ay, bx, by] of segs) {
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      const u = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
      if ((ax + u * dx - px) ** 2 + (ay + u * dy - py) ** 2 < clear * clear) return false;
    }
    return true;
  };
}

/** Cuánto árbol lleva cada zona verde del mapa base (capa `landcover` de OpenMapTiles, o `park`): bosques tupidos, parques y jardines con
 *  claros, prados y separadores con pocos. `null`: esa zona no se siembra. */
export function greenKeep(props: Record<string, unknown> | null | undefined, sourceLayer?: string): number | null {
  const cls = String(props?.class ?? ""), sub = String(props?.subclass ?? "");
  if (sourceLayer === "park") return 0.35;
  if (cls === "wood") return 0.85;
  if (cls !== "grass") return null;
  if (sub === "park" || sub === "garden" || sub === "recreation_ground" || sub === "village_green") return 0.5;
  if (sub === "flowerbed") return null;
  return 0.28;           // prados, separadores, zonas verdes sin más
}
