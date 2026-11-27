import type { SignalModel } from "./signal-timing";

/**
 * La «huella» de un semáforo que nadie ha medido, sacada de cuándo se detienen los buses junto a él.
 *
 * `tools/signalstats.ts` cuenta, por semáforo oficial de Bogotá, tipo de día, franja y hacia dónde va el bus, en qué segundo de una vuelta
 * de 90 y de 120 s (contada desde 1970, en casillas de 5 s) estaba cada bus detenido. Un semáforo de tiempo fijo pone a los buses en rojo
 * siempre en el mismo tramo de la vuelta: las detenciones se amontonan ahí día tras día. Al azar se repartirían parejo (con la forma que
 * tiene el conjunto de toda la ciudad, que no es del todo plana por cómo llegan los reportes).
 *
 * Medido el 2026-11-27 con 2,4 millones de pasadas: de 1.256 semáforos con datos suficientes, ~330 tienen una huella clara de 120 s y ~30
 * de 90 s. En el semáforo medido a mano en el Portal Suba la huella de los buses que van al oriente cae dentro del rojo que les toca.
 */
export interface FootprintStats { still: number; p90?: number[]; p120?: number[] }
/** [vuelta en s, inicio del rojo (s dentro de la vuelta), duración del rojo en s, fuerza (z), detenciones] */
export type Footprint = [number, number, number, number, number];

/** Fuerza mínima de la huella (cuántas desviaciones por encima del azar) y detenciones mínimas para creerle. */
export const FOOTPRINT_MIN_Z = 6, FOOTPRINT_MIN_STOPS = 40;

/** Huellas de todos los semáforos con datos suficientes. `stats`: «lon,lat|día|franja|dirección» → conteos (como los publica signalstats). */
export function signalFootprints(stats: Record<string, FootprintStats>, minZ = FOOTPRINT_MIN_Z, minStops = FOOTPRINT_MIN_STOPS): Record<string, Footprint> {
  const base: Record<"p90" | "p120", number[] | null> = { p90: null, p120: null };
  for (const a of Object.values(stats)) for (const f of ["p90", "p120"] as const) { const h = a[f]; if (h) base[f] = base[f] ? base[f]!.map((x, i) => x + (h[i] ?? 0)) : [...h]; }
  const out: Record<string, Footprint> = {};
  for (const [key, a] of Object.entries(stats)) {
    if (key.split("|").length < 4) continue;      // claves viejas sin dirección: no se sabe a quién aplica
    let best: Footprint | null = null;
    for (const [f, cycle] of [["p90", 90], ["p120", 120]] as const) {
      const h = a[f], g = base[f];
      if (!h || !g) continue;
      const fp = footprintOf(h, g, cycle, minStops);
      if (fp && fp[3] >= minZ && (!best || fp[3] > best[3])) best = fp;
    }
    if (best) out[key] = best;
  }
  return out;
}

/** La huella de un histograma `h` (casillas de 5 s) frente a la forma de toda la ciudad `g`: el tramo de la vuelta donde se amontonan las
 *  detenciones (el que más detenciones tiene de más frente al azar, de 20 % a 60 % de la vuelta) y la fuerza de esa diferencia. */
export function footprintOf(h: readonly number[], g: readonly number[], cycle: number, minStops = FOOTPRINT_MIN_STOPS): Footprint | null {
  const n = h.reduce((s, x) => s + x, 0), tg = g.reduce((s, x) => s + x, 0), k = h.length, bin = cycle / k;
  if (n < minStops || !tg) return null;
  const exp = g.map((x) => (n * x) / tg);
  // fuerza: cuánto se aleja de la forma de toda la ciudad (chi cuadrado, llevado a desviaciones típicas)
  const chi = h.reduce((s, x, i) => s + (x - exp[i]!) ** 2 / Math.max(1e-9, exp[i]!), 0), z = (chi - (k - 1)) / Math.sqrt(2 * (k - 1));
  let bestStart = 0, bestLen = 0, bestGain = -Infinity;
  for (let len = Math.ceil(k * 0.2); len <= Math.floor(k * 0.6); len++) {
    for (let st = 0; st < k; st++) {
      let gain = 0;
      for (let j = 0; j < len; j++) { const i = (st + j) % k; gain += h[i]! - exp[i]!; }
      // a igual ganancia, el tramo más corto (más preciso)
      if (gain > bestGain + 1e-9) { bestGain = gain; bestStart = st; bestLen = len; }
    }
  }
  if (bestGain <= 0) return null;
  return [cycle, Math.round(bestStart * bin), Math.round(bestLen * bin), Math.round(z * 10) / 10, n];
}

/** La huella como plan de semáforo para el bus: rojo desde `start` durante `len` s, verde el resto. La vuelta va contada desde 1970. */
export function footprintModel(fp: Footprint): SignalModel {
  const [cycle, start, len] = fp;
  return { cycle: cycle * 1000, anchor: start * 1000, segs: [{ c: "r", d: len * 1000 }, { c: "g", d: (cycle - len) * 1000 }] };
}
