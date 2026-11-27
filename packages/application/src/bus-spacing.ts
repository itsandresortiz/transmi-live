/**
 * Buses que no se montan uno encima del otro en el mapa.
 *
 * Dos buses que van por el mismo carril y en el mismo sentido a veces se dibujan uno dentro del otro: el GPS de cada uno tiene unos metros
 * de error, el dato llega con ~1 min de atraso y el movimiento entre reportes se estima. En la vida real no pueden ocupar el mismo sitio:
 * si se pisan, el de ATRÁS se dibuja justo detrás del de adelante (con un metro de aire), como en una fila. Solo cambia dónde se DIBUJA,
 * no los datos ni las llegadas. Buses en sentidos distintos o en carriles distintos (más de ~2,2 m de lado) no se tocan.
 */
export interface SpacedBus { id: string; lon: number; lat: number; /** rumbo en grados (0 = norte) o null */ angle?: number | null; /** articulado (18,3 m) */ long?: boolean }

const GAP_M = 1, LANE_M = 2.2, SAME_DIR_DEG = 35;
const lengthOf = (b: SpacedBus) => (b.long ? 18.3 : 12);

/** Devuelve, para los buses que hubo que correr hacia atrás, su nueva posición (lon, lat). Los demás no aparecen. */
export function separateBuses<T extends SpacedBus>(buses: readonly T[]): Map<string, { lon: number; lat: number }> {
  const out = new Map<string, { lon: number; lat: number }>();
  if (buses.length < 2) return out;
  const lat0 = buses[0]!.lat, kx = 111_320 * Math.cos((lat0 * Math.PI) / 180), ky = 110_540;
  const pts = buses.filter((b) => b.angle != null && Number.isFinite(b.angle)).map((b) => {
    const r = ((b.angle as number) * Math.PI) / 180;
    return { b, x: b.lon * kx, y: b.lat * ky, fx: Math.sin(r), fy: Math.cos(r), len: lengthOf(b), moved: false };
  });
  // rejilla de 25 m: solo se comparan los buses cercanos
  const cell = (x: number, y: number) => Math.floor(x / 25) * 1_000_003 + Math.floor(y / 25);
  for (let pass = 0; pass < 3; pass++) {
    const grid = new Map<number, typeof pts>();
    for (const p of pts) { const k = cell(p.x, p.y); (grid.get(k) ?? grid.set(k, []).get(k)!).push(p); }
    let changed = false;
    for (const a of pts) {
      const cx = Math.floor(a.x / 25), cy = Math.floor(a.y / 25);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const b of grid.get((cx + dx) * 1_000_003 + cy + dy) ?? []) {
        if (b === a || a.b.id >= b.b.id) continue;
        if (a.fx * b.fx + a.fy * b.fy < Math.cos((SAME_DIR_DEG * Math.PI) / 180)) continue;      // otro sentido
        // a lo largo y a lo ancho, con el rumbo medio de los dos
        const mx = a.fx + b.fx, my = a.fy + b.fy, ml = Math.hypot(mx, my) || 1, ux = mx / ml, uy = my / ml;
        const ex = b.x - a.x, ey = b.y - a.y, along = ex * ux + ey * uy, side = Math.abs(-ex * uy + ey * ux);
        if (side > LANE_M) continue;                                                              // otro carril
        const need = (a.len + b.len) / 2 + GAP_M, overlap = need - Math.abs(along);
        if (overlap <= 0.01) continue;
        // el de atrás (en el sentido de la marcha) retrocede lo que se pisan
        const back = along >= 0 ? a : b;
        back.x -= ux * overlap; back.y -= uy * overlap; back.moved = true; changed = true;
      }
    }
    if (!changed) break;
  }
  for (const p of pts) if (p.moved) out.set(p.b.id, { lon: p.x / kx, lat: p.y / ky });
  return out;
}
