import type { NetworkDto } from "./parse";

/**
 * Formato compacto de la red ya procesada (`network2.json.gz`, versión 2): igual que la versión 1, pero los puntos de cada recorrido van
 * como enteros (coordenada × 100 000, ~1 m) y cada uno como diferencia con el anterior. Los recorridos son el 90 % del archivo: así pesa
 * la mitad (1,9 → 1,0 MB comprimido) y el teléfono lo descomprime y lee unas 2–3 veces más rápido al abrir la app.
 * La versión 1 se sigue publicando para las apps que ya están en las tiendas.
 */
export interface CompactNetworkDto extends NetworkDto { v: 2 }

const SCALE = 1e5;

/** Versión 1 (puntos en grados) → versión 2 (enteros en diferencias). No cambia el original. */
export function compactNetwork(dto: NetworkDto): CompactNetworkDto {
  return {
    ...dto, v: 2,
    shapes: dto.shapes.map((s) => {
      const out: number[] = new Array(s.pts.length);
      let a = 0, b = 0;
      for (let i = 0; i + 1 < s.pts.length; i += 2) {
        const x = Math.round(s.pts[i]! * SCALE), y = Math.round(s.pts[i + 1]! * SCALE);
        out[i] = x - a; out[i + 1] = y - b; a = x; b = y;
      }
      return { ...s, pts: out };
    }),
  };
}

/** Versión 2 → versión 1, en el mismo objeto (sin copiar: se usa al abrir la app y cada milisegundo cuenta). */
export function expandNetwork(dto: CompactNetworkDto): NetworkDto {
  for (const s of dto.shapes) {
    const p = s.pts;
    let a = 0, b = 0;
    for (let i = 0; i + 1 < p.length; i += 2) { a += p[i]!; b += p[i + 1]!; p[i] = a / SCALE; p[i + 1] = b / SCALE; }
  }
  return dto;
}
