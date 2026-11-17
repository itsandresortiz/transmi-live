import type { RouteShape } from "@transmi/domain";

/**
 * Tiempos reales entre paradas, aprendidos de los buses de verdad (lo graba `tools/hopstats.ts` en la rama `hop-stats`).
 *
 * Para cada ruta, sentido, tramo (de la parada i a la i+1), tipo de día y franja horaria se sabe cuántos segundos tardan los buses en
 * recorrerlo, incluida la parada, los semáforos y el trancón. El cálculo de llegada usaba un valor fijo por parada para todo; con esto
 * cada tramo tiene su propio tiempo según la hora (en hora pico un tramo puede tardar el doble que de noche).
 *
 * Un tramo con pocas pasadas no es confiable: su tiempo se mezcla con el valor fijo según cuántas pasadas tiene (`seconds`).
 */

/** Franjas del día en Bogotá: madrugada, pico de la mañana, valle, pico de la tarde, noche (las mismas de `tools/hopstats.ts`). */
export const HOP_BUCKETS = ["0-6", "6-10", "10-16", "16-20", "20-24"] as const;
export type HopDay = "wk" | "sa" | "su";

/** Tipo de día y franja en Bogotá (UTC-5, sin horario de verano) para una hora en milisegundos. */
export function hopTag(nowMs: number): { day: HopDay; bucket: number } {
  const d = new Date(nowMs - 5 * 3600_000), h = d.getUTCHours(), w = d.getUTCDay();
  return { day: w === 0 ? "su" : w === 6 ? "sa" : "wk", bucket: h < 6 ? 0 : h < 10 ? 1 : h < 16 ? 2 : h < 20 ? 3 : 4 };
}

/** Formato publicado: `r["ruta|sentido"]["wk|1"] = [segundos0, pasadas0, segundos1, pasadas1, …]` (0, 0 = sin datos de ese tramo). */
export interface HopProfileData { v: 1; updated: string; /** `false` = publicado solo para medir; la app no lo usa todavía. */ use?: boolean; /** Cuánto pesa el valor fijo (sobrescribe `HOP_PRIOR_N` en apps ya publicadas). */ prior?: number; r: Record<string, Record<string, number[]>> }

/** Un tramo tiene que haberse recorrido al menos esto (en tramos completos) para usar su tiempo. */
export const HOP_MIN_N = 3;
/** Cuántas «pasadas» vale el valor fijo al mezclarlo con lo aprendido. Medido el 2026-11-17 en hora pico (≈27.000 llegadas): sin mezcla
 *  (0) erró menos (mediana 51/63/100 s a 1/2/3 paradas) que mezclando con 3 (54/67/108 s) y que el valor fijo solo (90/122/178 s). */
export const HOP_PRIOR_N = 0;
const MIN_S = 8, MAX_S = 900;

export class HopProfile {
  /** Si es `false`, el cálculo de llegada usa solo el valor fijo (para comparar). */
  apply = true;
  minN = HOP_MIN_N;
  priorN = HOP_PRIOR_N;
  private routes = new Map<string, Record<string, number[]>>();
  private stamp = "";
  private tag = hopTag(0);
  private tagAt = -Infinity;

  get size(): number { return this.routes.size; }
  get updated(): string { return this.stamp; }

  /** Carga el perfil publicado. Devuelve `false` (y no cambia nada) si el formato no es el esperado. */
  load(data: unknown): boolean {
    const d = data as Partial<HopProfileData> | null;
    if (!d || d.v !== 1 || typeof d.r !== "object" || !d.r) return false;
    const next = new Map<string, Record<string, number[]>>();
    for (const [k, tags] of Object.entries(d.r)) {
      if (!tags || typeof tags !== "object") continue;
      const ok: Record<string, number[]> = {};
      for (const [t, arr] of Object.entries(tags)) if (Array.isArray(arr) && arr.every((x) => typeof x === "number" && Number.isFinite(x))) ok[t] = arr;
      next.set(k, ok);
    }
    this.routes = next;
    this.stamp = typeof d.updated === "string" ? d.updated : "";
    this.apply = d.use !== false;          // se enciende o apaga desde los datos, sin sacar una versión nueva de la app
    if (typeof d.prior === "number" && d.prior >= 0) this.priorN = d.prior;
    return true;
  }

  /** Segundos para el tramo `i` (de la parada i a la i+1) del recorrido a esta hora: lo aprendido mezclado con `fallback` (el valor fijo).
   *  Sin datos suficientes devuelve `fallback` tal cual. Los fines de semana sin datos propios usan los de entre semana de la misma franja. */
  seconds(shape: RouteShape, i: number, nowMs: number, fallback: number): number {
    if (!this.apply) return fallback;
    const r = this.routes.get(`${shape.routeId}|${shape.direction}`);
    if (!r) return fallback;
    if (Math.abs(nowMs - this.tagAt) > 30_000) { this.tag = hopTag(nowMs); this.tagAt = nowMs; }      // se calcula pocas veces: se pide miles de veces por lote
    const { day, bucket } = this.tag;
    let hit = pick(r[`${day}|${bucket}`], i, this.minN);
    if (!hit && day !== "wk") hit = pick(r[`wk|${bucket}`], i, this.minN);
    if (!hit) return fallback;
    const s = Math.min(MAX_S, Math.max(MIN_S, hit.s));
    return (hit.n * s + this.priorN * fallback) / (hit.n + this.priorN);
  }
}

function pick(arr: number[] | undefined, i: number, minN: number): { s: number; n: number } | null {
  if (!arr) return null;
  const s = arr[2 * i], n = arr[2 * i + 1];
  return s != null && n != null && s > 0 && n >= minN ? { s, n } : null;
}

/** Arma el perfil publicado a partir de las sumas que acumula `tools/hopstats.ts` (`ruta|sentido|tramo|día|franja` → pasadas y segundos).
 *  `stopsOf` dice cuántas paradas tiene cada recorrido hoy: si el GTFS cambió y la ruta ya no tiene ese tramo, se descarta. */
export function buildHopProfile(stats: Record<string, { n: number; sum: number }>, stopsOf: (routeDir: string) => number | undefined, updated: string, minN = HOP_MIN_N, use = true, prior = HOP_PRIOR_N): HopProfileData {
  const r: Record<string, Record<string, number[]>> = {};
  for (const [key, a] of Object.entries(stats)) {
    const [route, dir, idx, day, bucket] = key.split("|");
    const i = Number(idx), rd = `${route}|${dir}`, stops = stopsOf(rd);
    // los tramos con menos pasadas que el mínimo no se publican (no se usarían y el archivo pesa menos)
    if (!route || dir == null || !day || bucket == null || !Number.isInteger(i) || stops == null || i < 0 || i >= stops - 1 || !(a.n >= minN)) continue;
    const arr = ((r[rd] ??= {})[`${day}|${bucket}`] ??= new Array<number>(2 * (stops - 1)).fill(0));
    arr[2 * i] = Math.round(a.sum / a.n);
    arr[2 * i + 1] = Math.min(999, Math.round(a.n));
  }
  return { v: 1, updated, use, prior, r };
}
