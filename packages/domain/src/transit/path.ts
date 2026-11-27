import { type GeoPoint, METERS_PER_WORLD_UNIT, type WorldPoint, toGeo, toWorld } from "../shared/geo";

/** Tramos por grupo en la búsqueda del punto más cercano (ver `RoadPath.chunkBoxes`). */
const CHUNK = 8;

/** Trazado de una ruta en coordenadas de mundo, con distancias acumuladas, para avanzar «por la calle». */
export class RoadPath {
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  /** Metros acumulados desde el inicio hasta cada punto. */
  readonly cum: Float64Array;
  readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number;

  constructor(points: readonly GeoPoint[]) {
    const n = points.length;
    this.xs = new Float64Array(n); this.ys = new Float64Array(n); this.cum = new Float64Array(n);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const w = toWorld(points[i]!);
      this.xs[i] = w.x; this.ys[i] = w.y;
      if (w.x < minX) minX = w.x; if (w.x > maxX) maxX = w.x;
      if (w.y < minY) minY = w.y; if (w.y > maxY) maxY = w.y;
      if (i) this.cum[i] = this.cum[i - 1]! + Math.hypot(w.x - this.xs[i - 1]!, w.y - this.ys[i - 1]!) * METERS_PER_WORLD_UNIT;
    }
    this.minX = minX; this.maxX = maxX; this.minY = minY; this.maxY = maxY;
  }
  get length(): number { return this.cum.length ? this.cum[this.cum.length - 1]! : 0; }
  get size(): number { return this.xs.length; }

  /** Caja (minX, maxX, minY, maxY) de cada grupo de `CHUNK` tramos, para saltarse de una vez los grupos que quedan lejos del punto.
   *  Proyectar los ~5.000 buses en cada lote recorría todos los tramos de cada trazado (~400) y era lo que más pesaba al procesar un lote.
   *  Se arma la primera vez que hace falta. */
  private boxes: Float64Array | null = null;
  private chunkBoxes(): Float64Array {
    if (this.boxes) return this.boxes;
    const segs = this.size - 1, n = Math.ceil(segs / CHUNK), b = new Float64Array(n * 4);
    for (let c = 0; c < n; c++) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = c * CHUNK, end = Math.min(segs, i + CHUNK); i <= end; i++) {   // puntos i..end: los extremos de los tramos del grupo
        const x = this.xs[i]!, y = this.ys[i]!;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      b[c * 4] = x0; b[c * 4 + 1] = x1; b[c * 4 + 2] = y0; b[c * 4 + 3] = y1;
    }
    return (this.boxes = b);
  }
  /** Distancia² mínima posible de `p` a cualquier tramo del grupo `c` (rebajada un poco para que el redondeo nunca descarte un tramo válido). */
  private static boxD2(b: Float64Array, c: number, p: WorldPoint): number {
    const x0 = b[c * 4]!, x1 = b[c * 4 + 1]!, y0 = b[c * 4 + 2]!, y1 = b[c * 4 + 3]!;
    const dx = p.x < x0 ? x0 - p.x : p.x > x1 ? p.x - x1 : 0, dy = p.y < y0 ? y0 - p.y : p.y > y1 ? p.y - y1 : 0;
    return (dx * dx + dy * dy) * (1 - 1e-9);
  }

  /** Punto del trazado más cercano a `p`: metros desde el inicio, distancia al trazado y sentido (+1/-1) respecto a (ux,uy). */
  project(p: WorldPoint, ux: number, uy: number, maxMeters: number): { s: number; dist: number; forward: boolean } | null {
    const pad = maxMeters / METERS_PER_WORLD_UNIT;
    if (this.size < 2 || p.x < this.minX - pad || p.x > this.maxX + pad || p.y < this.minY - pad || p.y > this.maxY + pad) return null;
    // los grupos de tramos más lejos que `maxMeters` o que la mejor distancia hallada no pueden ganar (el resultado es idéntico a revisarlos todos)
    const boxes = this.chunkBoxes(), segs = this.size - 1, max2 = pad * pad * (1 + 1e-9);
    let best = Infinity, bs = 0, bdot = 0;
    for (let c = 0, i = 0; i < segs; c++) {
      const end = Math.min(segs, i + CHUNK), bd = RoadPath.boxD2(boxes, c, p);
      if (bd > max2 || bd >= best) { i = end; continue; }
      for (; i < end; i++) {
        const ax = this.xs[i]!, ay = this.ys[i]!, dx = this.xs[i + 1]! - ax, dy = this.ys[i + 1]! - ay;
        const l2 = dx * dx + dy * dy;
        let t = l2 ? ((p.x - ax) * dx + (p.y - ay) * dy) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d2 = (p.x - (ax + t * dx)) ** 2 + (p.y - (ay + t * dy)) ** 2;
        if (d2 < best) { best = d2; bs = this.cum[i]! + t * (this.cum[i + 1]! - this.cum[i]!); bdot = dx * ux + dy * uy; }
      }
    }
    const dist = Math.sqrt(best) * METERS_PER_WORLD_UNIT;
    return dist <= maxMeters ? { s: bs, dist, forward: bdot >= 0 } : null;
  }

  /** Como `project`, pero solo cuenta los tramos que van en el mismo sentido que (ux,uy). Hace falta en los recorridos de ida y vuelta por la misma calle
   *  (alimentadores y zonales): el punto más cercano puede ser el de la otra pasada, que va al revés. Sin rumbo (0,0) equivale a `project`. */
  projectAlong(p: WorldPoint, ux: number, uy: number, maxMeters: number): { s: number; dist: number; forward: boolean } | null {
    if (!ux && !uy) return this.project(p, ux, uy, maxMeters);
    const pad = maxMeters / METERS_PER_WORLD_UNIT;
    if (this.size < 2 || p.x < this.minX - pad || p.x > this.maxX + pad || p.y < this.minY - pad || p.y > this.maxY + pad) return null;
    const boxes = this.chunkBoxes(), segs = this.size - 1, max2 = pad * pad * (1 + 1e-9);
    let best = Infinity, bs = 0;
    for (let c = 0, i = 0; i < segs; c++) {
      const end = Math.min(segs, i + CHUNK), bd = RoadPath.boxD2(boxes, c, p);
      if (bd > max2 || bd >= best) { i = end; continue; }
      for (; i < end; i++) {
        const ax = this.xs[i]!, ay = this.ys[i]!, dx = this.xs[i + 1]! - ax, dy = this.ys[i + 1]! - ay;
        if (dx * ux + dy * uy < 0) continue;
        const l2 = dx * dx + dy * dy;
        let t = l2 ? ((p.x - ax) * dx + (p.y - ay) * dy) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d2 = (p.x - (ax + t * dx)) ** 2 + (p.y - (ay + t * dy)) ** 2;
        if (d2 < best) { best = d2; bs = this.cum[i]! + t * (this.cum[i + 1]! - this.cum[i]!); }
      }
    }
    const dist = Math.sqrt(best) * METERS_PER_WORLD_UNIT;
    return dist <= maxMeters ? { s: bs, dist, forward: true } : null;
  }

  /** Proyecta un punto que se sabe que viene DESPUÉS de `minS` metros (las paradas van en orden): elige la primera pasada del trazado que queda cerca (≤ `nearMeters`),
   *  no la más cercana de todas. En un recorrido de ida y vuelta por la misma calle, la más cercana puede ser la pasada de regreso. Si ninguna pasada posterior queda cerca,
   *  devuelve la más cercana después de `minS` y, si tampoco, la más cercana de todas. */
  projectAfter(p: WorldPoint, minS: number, maxMeters: number, nearMeters = 40): { s: number; dist: number } | null {
    const pad = maxMeters / METERS_PER_WORLD_UNIT;
    if (this.size < 2 || p.x < this.minX - pad || p.x > this.maxX + pad || p.y < this.minY - pad || p.y > this.maxY + pad) return null;
    const near2 = (nearMeters / METERS_PER_WORLD_UNIT) ** 2;
    let all = Infinity, allS = 0, after = Infinity, afterS = 0, run = Infinity, runS = 0, inRun = false;
    const boxes = this.chunkBoxes(), segs = this.size - 1, max2 = pad * pad * (1 + 1e-9);
    scan: for (let c = 0, i = 0; i < segs; c++) {
      const end = Math.min(segs, i + CHUNK), bd = RoadPath.boxD2(boxes, c, p);
      // Se salta un grupo de tramos que no puede cambiar la respuesta: el que queda todo a más de `maxMeters` (lo que está tan lejos nunca
      // se devuelve), o el que no mejora ninguna de las marcas ni queda cerca (si todo él queda antes de `minS`, solo cuenta la más cercana
      // de todas). Si ya se iba por la pasada cercana, esta terminó ahí: los metros `s` solo crecen a lo largo del trazado.
      // Da exactamente lo mismo que revisar todos los tramos (al abrir la app, esto era lo que más tardaba del primer lote).
      if ((bd > max2 && bd > near2) || (bd >= all && (this.cum[end]! < minS || (bd >= after && bd > near2)))) { if (inRun) break; i = end; continue; }
      for (; i < end; i++) {
        const ax = this.xs[i]!, ay = this.ys[i]!, dx = this.xs[i + 1]! - ax, dy = this.ys[i + 1]! - ay;
        const l2 = dx * dx + dy * dy;
        let t = l2 ? ((p.x - ax) * dx + (p.y - ay) * dy) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d2 = (p.x - (ax + t * dx)) ** 2 + (p.y - (ay + t * dy)) ** 2, s = this.cum[i]! + t * (this.cum[i + 1]! - this.cum[i]!);
        if (d2 < all) { all = d2; allS = s; }
        if (s < minS) continue;
        if (d2 < after) { after = d2; afterS = s; }
        if (d2 <= near2) { inRun = true; if (d2 < run) { run = d2; runS = s; } }
        else if (inRun) break scan;                  // terminó la primera pasada cercana: es esa
      }
    }
    const pick = run < Infinity ? { d2: run, s: runS } : after < Infinity ? { d2: after, s: afterS } : { d2: all, s: allS };
    let dist = Math.sqrt(pick.d2) * METERS_PER_WORLD_UNIT;
    if (dist > maxMeters && pick.d2 !== all) { pick.d2 = all; pick.s = allS; dist = Math.sqrt(all) * METERS_PER_WORLD_UNIT; }
    return dist <= maxMeters ? { s: pick.s, dist } : null;
  }

  /** Dirección (vector unitario en coordenadas de mundo) del trazado a `s` metros del inicio. */
  tangentAt(s: number): { ux: number; uy: number } {
    const n = this.size;
    if (n < 2) return { ux: 0, uy: -1 };
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (this.cum[mid]! <= s) lo = mid; else hi = mid; }
    const dx = this.xs[hi]! - this.xs[lo]!, dy = this.ys[hi]! - this.ys[lo]!, h = Math.hypot(dx, dy) || 1;
    return { ux: dx / h, uy: dy / h };
  }

  /** Tramo del trazado entre `s0` y `s1` metros desde el inicio. */
  slice(s0: number, s1: number): GeoPoint[] {
    const a = Math.max(0, Math.min(s0, s1)), b = Math.min(this.length, Math.max(s0, s1));
    const out: GeoPoint[] = [toGeo(this.pointAt(a))];
    for (let i = 0; i < this.size; i++) if (this.cum[i]! > a && this.cum[i]! < b) out.push(toGeo({ x: this.xs[i]!, y: this.ys[i]! }));
    out.push(toGeo(this.pointAt(b)));
    return out;
  }

  /** Punto a `s` metros desde el inicio (limitado a los extremos). */
  pointAt(s: number): WorldPoint {
    const n = this.size;
    if (s <= 0) return { x: this.xs[0]!, y: this.ys[0]! };
    if (s >= this.length) return { x: this.xs[n - 1]!, y: this.ys[n - 1]! };
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (this.cum[mid]! <= s) lo = mid; else hi = mid; }
    const seg = this.cum[hi]! - this.cum[lo]!;
    const t = seg ? (s - this.cum[lo]!) / seg : 0;
    return { x: this.xs[lo]! + t * (this.xs[hi]! - this.xs[lo]!), y: this.ys[lo]! + t * (this.ys[hi]! - this.ys[lo]!) };
  }
}

export interface RouteLock { path: RoadPath; s: number; sign: 1 | -1 }

/** Elige el trazado (y sentido) por el que realmente va el bus: el más cercano que concuerda con su rumbo. */
export function lockToRoute(paths: readonly RoadPath[], p: WorldPoint, vel: { ux: number; uy: number } | null, maxMeters = 45, prefer?: RoadPath): RouteLock | null {
  if (prefer && paths.includes(prefer)) {
    // si el bus sigue sobre el mismo trazado se conserva (evita saltar entre variantes paralelas de una ruta)
    const hit = prefer.project(p, vel?.ux ?? 0, vel?.uy ?? 0, maxMeters);
    if (hit && (!vel || hit.forward)) return { path: prefer, s: hit.s, sign: 1 };
  }
  let best: RouteLock | null = null, bestDist = Infinity;
  for (const path of paths) {
    const hit = path.project(p, vel?.ux ?? 0, vel?.uy ?? 0, maxMeters);
    if (!hit) continue;
    if (vel && !hit.forward) {
      // un trazado que va en sentido contrario no sirve, salvo que el bus esté recorriéndolo al revés (lo cubre su otro sentido)
      continue;
    }
    if (hit.dist < bestDist) { bestDist = hit.dist; best = { path, s: hit.s, sign: 1 }; }
  }
  return best;
}
