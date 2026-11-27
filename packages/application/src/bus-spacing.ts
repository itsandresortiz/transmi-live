/**
 * Buses que no se montan uno encima del otro en el mapa.
 *
 * Dos buses que van por el mismo carril y en el mismo sentido a veces se dibujan uno dentro del otro: el GPS de cada uno tiene unos metros
 * de error, el dato llega con ~1 min de atraso y el movimiento entre reportes se estima. En la calle no pueden ocupar el mismo sitio: el de
 * ATRÁS (el que viene alcanzando) **se cambia de carril y lo adelanta**, como pasa de verdad. En la troncal se pasa por la derecha (el carril
 * pegado a la estación, en el separador, es el de parar; el de sobrepaso queda del lado de afuera); en las demás calles, por la izquierda.
 * Si ese carril también está ocupado, usa el del otro lado (o uno más allá): nunca se le deja atrás, porque eso atrasaría su avance.
 * Solo cambia dónde se DIBUJA (de lado), no los datos, el avance ni las llegadas.
 */
export interface SpacedBus { id: string; lon: number; lat: number; /** rumbo en grados (0 = norte) o null */ angle?: number | null; /** articulado de la troncal (18,3 m) */ long?: boolean; /** va por la troncal (pasa por la derecha) */ trunk?: boolean }
/** Corrimiento de un bus, en su propio sentido de marcha: `side` metros a la derecha (negativo: a la izquierda) y `back` metros hacia atrás. */
export interface BusShift { side: number; back: number }

const GAP_M = 1, LANE_M = 2.2, SAME_DIR_DEG = 35;
/** Ancho de un carril: lo que se corre el bus para adelantar. */
export const PASSING_LANE_M = 3.4;
const lengthOf = (b: SpacedBus) => (b.long ? 18.3 : 12);

/** Para cada bus que hay que correr (para adelantar o quedarse en fila), cuánto. Los demás no aparecen. */
export function separateBuses<T extends SpacedBus>(buses: readonly T[]): Map<string, BusShift> {
  const out = new Map<string, BusShift>();
  if (buses.length < 2) return out;
  const lat0 = buses[0]!.lat, kx = 111_320 * Math.cos((lat0 * Math.PI) / 180), ky = 110_540;
  const pts = buses.filter((b) => b.angle != null && Number.isFinite(b.angle)).map((b) => {
    const r = ((b.angle as number) * Math.PI) / 180;
    return { b, x: b.lon * kx, y: b.lat * ky, fx: Math.sin(r), fy: Math.cos(r), len: lengthOf(b), side: 0, back: 0 };
  });
  const cell = (x: number, y: number) => Math.floor(x / 25) * 1_000_003 + Math.floor(y / 25);
  const grid = new Map<number, typeof pts>();
  for (const p of pts) { const k = cell(p.x, p.y); (grid.get(k) ?? grid.set(k, []).get(k)!).push(p); }
  const near = (p: (typeof pts)[number]) => {
    const cx = Math.floor(p.x / 25), cy = Math.floor(p.y / 25), list: typeof pts = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const q of grid.get((cx + dx) * 1_000_003 + cy + dy) ?? []) if (q !== p) list.push(q);
    return list;
  };
  /** Posición dibujada de `p` (con su corrimiento). */
  const at = (p: (typeof pts)[number]) => ({ x: p.x + p.fy * p.side - p.fx * p.back, y: p.y - p.fx * p.side - p.fy * p.back });
  /** ¿`p`, en su posición dibujada, se pisa con algún otro bus de su mismo sentido? */
  const clashes = (p: (typeof pts)[number]) => near(p).some((q) => {
    if (p.fx * q.fx + p.fy * q.fy < Math.cos((SAME_DIR_DEG * Math.PI) / 180)) return false;
    const a = at(p), b = at(q), ex = b.x - a.x, ey = b.y - a.y;
    return Math.abs(-ex * p.fy + ey * p.fx) <= LANE_M && Math.abs(ex * p.fx + ey * p.fy) < (p.len + q.len) / 2 + GAP_M;
  });
  for (const a of pts) for (const b of near(a)) {
    if (a.b.id >= b.b.id) continue;
    if (a.fx * b.fx + a.fy * b.fy < Math.cos((SAME_DIR_DEG * Math.PI) / 180)) continue;      // otro sentido
    const mx = a.fx + b.fx, my = a.fy + b.fy, ml = Math.hypot(mx, my) || 1, ux = mx / ml, uy = my / ml;
    const ea = at(a), eb = at(b), ex = eb.x - ea.x, ey = eb.y - ea.y, along = ex * ux + ey * uy, side = Math.abs(-ex * uy + ey * ux);
    if (side > LANE_M) continue;                                                              // otro carril
    const need = (a.len + b.len) / 2 + GAP_M, overlap = need - Math.abs(along);
    if (overlap <= 0.01) continue;
    const back = along >= 0 ? a : b;                                                          // el que viene alcanzando
    if (back.side !== 0 || back.back !== 0) continue;                                         // ya se corrió por otro
    // adelanta por el carril de sobrepaso; si ahí también hay alguien, por el del otro lado o uno más allá. Nunca se le hace quedar atrás:
    // eso atrasaría dónde se ve el bus y su avance (el dueño, 2026-11-27)
    const first = back.b.trunk ? PASSING_LANE_M : -PASSING_LANE_M;
    for (const sd of [first, -first, 2 * first]) { back.side = sd; if (!clashes(back)) break; }
  }
  for (const p of pts) if (p.side || p.back) out.set(p.b.id, { side: p.side, back: p.back });
  return out;
}

/** Aplica un corrimiento a (lon, lat) con el rumbo `angle` (grados). */
export function shiftBus(lon: number, lat: number, angle: number, side: number, back: number): { lon: number; lat: number } {
  const r = (angle * Math.PI) / 180, fx = Math.sin(r), fy = Math.cos(r);
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180), ky = 110_540;
  return { lon: lon + (fy * side - fx * back) / kx, lat: lat + (-fx * side - fy * back) / ky };
}
