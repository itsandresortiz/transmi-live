import { signalFootprints, type Footprint } from "./signal-footprint";

/**
 * Informe por cruce semafórico con lo que dicen los buses (para compartir con la Secretaría de Movilidad).
 *
 * Parte de los conteos que publica `tools/signalstats.ts` en la rama `signal-stats` («lon,lat|día|franja|dirección» → pasadas, detenidos,
 * lentos, suma de velocidades e histogramas de la vuelta) y los resume por cruce: cuántos buses pasaron, qué parte iba detenida, a qué
 * velocidad media llegaban, y en qué día, franja y sentido esperan más. Suma la «huella» de los cruces que parecen de tiempo fijo
 * (`signalFootprints`). Solo usa claves con dirección (desde el 2026-11-17): las viejas no dicen a quién aplican.
 *
 * Para ordenar no se usa la proporción a secas (un cruce con 3 pasadas y 3 detenidos saldría primero): se usa el límite bajo del
 * intervalo de Wilson al 95 %, que castiga los cruces con pocos datos.
 */
export interface ReportStats { n: number; still: number; slow: number; sumV: number; p90?: number[]; p120?: number[] }

export const REPORT_DAYS = ["wk", "sa", "su"] as const;
export const REPORT_DAY_NAMES: Record<string, string> = { wk: "Entre semana", sa: "Sábado", su: "Domingo" };
export const REPORT_BUCKET_NAMES = ["Madrugada (0–6 h)", "Pico de la mañana (6–10 h)", "Mediodía (10–16 h)", "Pico de la tarde (16–20 h)", "Noche (20–24 h)"];
export const REPORT_DIR_NAMES: Record<string, string> = { N: "hacia el norte", E: "hacia el oriente", S: "hacia el sur", O: "hacia el occidente", "?": "sentido sin determinar" };

/** Un grupo (cruce × día × franja × sentido). `share`: parte de pasadas detenidas; `kmh`: velocidad media al acercarse; `lb`: límite bajo. */
export interface ReportGroup { day: string; bucket: number; dir: string; n: number; still: number; slow: number; share: number; kmh: number; lb: number }
/** Huella de tiempo fijo: ciclo, inicio del rojo (s dentro de cada vuelta, que empieza a la hora en punto), rojo estimado, fuerza, detenciones. */
export interface ReportPrint { day: string; bucket: number; dir: string; cycle: number; redStart: number; red: number; z: number; stops: number }
export interface ReportCrossing {
  lon: number; lat: number; n: number; still: number; share: number; kmh: number; lb: number;
  /** El grupo con más espera (entre los que tienen datos suficientes), o null. */
  worst: ReportGroup | null;
  groups: ReportGroup[];
  prints: ReportPrint[];
}
export interface SignalReport { crossings: ReportCrossing[]; observations: number; stops: number; groups: number; minGroup: number; minCrossing: number }

/** Límite bajo del intervalo de Wilson (95 %) para `k` de `n`. */
export function wilsonLow(k: number, n: number, z = 1.96): number {
  if (n <= 0) return 0;
  const p = k / n, d = 1 + (z * z) / n;
  return Math.max(0, (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d);
}

const r3 = (x: number) => Math.round(x * 1000) / 1000, r1 = (x: number) => Math.round(x * 10) / 10;

/** Arma el informe. `minGroup`: pasadas mínimas para que un día/franja/sentido cuente; `minCrossing`: lo mismo para el cruce entero. */
export function signalReport(stats: Record<string, ReportStats>, minGroup = 80, minCrossing = 300): SignalReport {
  const byCross = new Map<string, { n: number; still: number; sumV: number; groups: ReportGroup[] }>();
  let observations = 0, stops = 0, groups = 0;
  const v2: Record<string, ReportStats> = {};
  for (const [key, a] of Object.entries(stats)) {
    const p = key.split("|");
    if (p.length < 4 || !a.n) continue;
    v2[key] = a;
    observations += a.n; stops += a.still; groups++;
    const c = byCross.get(p[0]!) ?? byCross.set(p[0]!, { n: 0, still: 0, sumV: 0, groups: [] }).get(p[0]!)!;
    c.n += a.n; c.still += a.still; c.sumV += a.sumV;
    if (a.n >= minGroup) c.groups.push({ day: p[1]!, bucket: Number(p[2]), dir: p[3]!, n: a.n, still: a.still, slow: a.slow, share: r3(a.still / a.n), kmh: r1((a.sumV / a.n) * 3.6), lb: r3(wilsonLow(a.still, a.n)) });
  }
  const prints = new Map<string, ReportPrint[]>();
  for (const [key, fp] of Object.entries(signalFootprints(v2)) as [string, Footprint][]) {
    const [pos, day, b, dir] = key.split("|");
    (prints.get(pos!) ?? prints.set(pos!, []).get(pos!)!).push({ day: day!, bucket: Number(b), dir: dir!, cycle: fp[0], redStart: fp[1], red: fp[2], z: fp[3], stops: fp[4] });
  }
  const crossings: ReportCrossing[] = [];
  for (const [pos, c] of byCross) {
    if (c.n < minCrossing) continue;
    const [lon, lat] = pos.split(",").map(Number) as [number, number];
    const gs = c.groups.sort((a, b) => b.lb - a.lb);
    crossings.push({
      lon, lat, n: c.n, still: c.still, share: r3(c.still / c.n), kmh: r1((c.sumV / c.n) * 3.6), lb: r3(wilsonLow(c.still, c.n)),
      worst: gs[0] ?? null, groups: gs, prints: (prints.get(pos) ?? []).sort((a, b) => b.z - a.z),
    });
  }
  crossings.sort((a, b) => b.lb - a.lb);
  return { crossings, observations, stops, groups, minGroup, minCrossing };
}

/** Las primeras horas en que empezaría el rojo dentro de una hora (las vueltas de 90 y 120 s caben exactas en una hora), p. ej.
 *  `redTimes(120, 35, 7)` → ["7:00:35", "7:02:35", "7:04:35"]. */
export function redTimes(cycle: number, start: number, hour: number, count = 3): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const s = start + i * cycle, m = Math.floor(s / 60), sec = s % 60;
    out.push(`${hour}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`);
  }
  return out;
}
