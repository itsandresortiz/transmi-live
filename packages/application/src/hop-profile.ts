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
export interface HopProfileData { v: 1; updated: string; /** `false` = publicado solo para medir; la app no lo usa todavía. */ use?: boolean; /** Cuánto pesa el valor fijo (sobrescribe `HOP_PRIOR_N` en apps ya publicadas). */ prior?: number; /** Segundos de más en cada llegada (`HOP_EXTRA_S`). Lo leen las apps viejas; las nuevas prefieren `extraBy`. */ extra?: number; /** Lo mismo por franja (`HOP_BUCKETS`, 5 valores): el sesgo no es igual en hora pico que de noche. */ extraBy?: number[]; /** Corrección aparte para la próxima parada (`next`) y para las demás (`later`), 5 valores por franja cada una. Las apps que la entienden la prefieren a `extra`/`extraBy`. */ split?: { next: number[]; later: number[] }; r: Record<string, Record<string, number[]>> }

/** Un tramo tiene que haberse recorrido al menos esto (en tramos completos) para usar su tiempo. */
export const HOP_MIN_N = 3;
/** Cuántas «pasadas» vale el valor fijo al mezclarlo con lo aprendido. Medido el 2026-11-17 en hora pico (≈27.000 llegadas): sin mezcla
 *  (0) erró menos (mediana 51/63/100 s a 1/2/3 paradas) que mezclando con 3 (54/67/108 s) y que el valor fijo solo (90/122/178 s). */
export const HOP_PRIOR_N = 0;
/** Segundos que se suman a cada llegada calculada con lo aprendido. Medido el 2026-11-17 en valle (≈32.000 llegadas): sin esto la app
 *  decía que el bus llegaba ~20 s antes de lo real; con +15 s el sesgo baja a ~−5 s y el error típico mejora un poco (33→31 s a una
 *  parada). Va en el archivo publicado (`extra`), así se puede ajustar sin sacar versión nueva. */
export const HOP_EXTRA_S = 15;
/** `HOP_EXTRA_S` por franja (`HOP_BUCKETS`: madrugada, pico mañana, valle, pico tarde, noche), p. ej. `[15, 30, 15, 30, 10]`. Si no es
 *  `null`, el perfil publicado lo lleva en `extraBy` (las apps viejas siguen leyendo `extra`). Se deja apagado hasta medir las otras franjas:
 *  el 2026-11-24 solo se pudo medir el valle (2 capturas, 47 lotes, ≈5.300 buses, 37.000 llegadas a 1 parada). Ahí el mejor ajuste es
 *  +10/+15 s (sesgo a 1 parada −15/−21 s sin ajuste, ~0 con +15), igual que el +15 actual, y el sesgo casi no está en las paradas
 *  siguientes (−3/−5 s a 2–3 paradas): +15 s las empeora un poco (error 36→40 s a 2 paradas). Medir con el workflow «Medir precisión de
 *  los tiempos de llegada» en pico (6–10 y 16–20) y de noche, y llenar esto solo si alguna franja pide más de ~10 s distinto al valle. */
export const HOP_EXTRA_BY: readonly number[] | null = null;
/** Corrección separada para la **próxima parada** (`HOP_SPLIT_NEXT`) y para **las demás** (`HOP_SPLIT_LATER`), por franja (`HOP_BUCKETS`).
 *  Va en el perfil como `split`; las apps viejas no lo leen y siguen con `extra` (+15 a todas). Por qué: el sesgo está casi todo en la
 *  próxima parada y sumar lo mismo a las siguientes las empeoraba. Medido el 2026-11-27 con `tools/etaprecision.ts` sobre la captura del
 *  2026-11-24 en valle (70 lotes de ~5.300 buses, 10:53–11:45; 115.000 / 195.000 / 204.000 pronósticos a 1 / 2 / 3 paradas):
 *    sin corrección:      sesgo −18 / −4 / +1 s, error mediano 37 / 38 / 50 s, p90 253 / 179 / 218 s
 *    +15 a todas (antes): sesgo  −3 / +11 / +16 s, error mediano 37 / 42 / 55 s, p90 240 / 173 / 213 s
 *    +15 y luego +0:      sesgo  −3 / −4 / +1 s,  error mediano 37 / 38 / 50 s, p90 240 / 179 / 218 s
 *  (+10 a la próxima da 36 s de mediana pero sesgo −8 y p90 244; −5 a las demás gana 1 s de mediana: dentro del ruido.) Cada mitad de
 *  la captura por separado (34 y 27 lotes) da lo mismo: con +15 y luego +0, sesgo −3/−3/+2 y 0/−2/+1 s.
 *  Solo el valle (posición 2) está medido; las otras franjas copian el valle hasta medirlas con el workflow «Medir precisión de los
 *  tiempos de llegada» (su resumen trae la tabla «primera parada + N s, las demás + L s»). */
export const HOP_SPLIT_NEXT: readonly number[] | null = [15, 15, 15, 15, 15];
export const HOP_SPLIT_LATER: readonly number[] | null = [0, 0, 0, 0, 0];
const MIN_S = 8, MAX_S = 900;

export class HopProfile {
  /** Si es `false`, el cálculo de llegada usa solo el valor fijo (para comparar). */
  apply = true;
  minN = HOP_MIN_N;
  priorN = HOP_PRIOR_N;
  /** Segundos que se suman a cada llegada mientras se usa lo aprendido (ver `HOP_EXTRA_S`). */
  extra = 0;
  /** Lo mismo por franja (`HOP_BUCKETS`); `null` = el mismo `extra` todo el día. */
  extraBy: number[] | null = null;
  /** Corrección aparte para la próxima parada y para las demás, por franja (ver `HOP_SPLIT_NEXT`); `null` = la de `extra`/`extraBy`. */
  split: { next: number[]; later: number[] } | null = null;
  private routes = new Map<string, Record<string, number[]>>();
  private stamp = "";
  private tag = hopTag(0);
  /** Tipo de día de servicio (lo pone `TransitState` con el calendario de festivos): un lunes festivo usa los tiempos de domingo, no los de
   *  un lunes en hora pico. Sin él, solo se mira el día de la semana. */
  dayOf: ((nowMs: number) => HopDay) | null = null;
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
    this.extra = okExtra(d.extra) ? d.extra : 0;
    this.extraBy = okBy(d.extraBy) ? d.extraBy.slice() : null;
    const sp = d.split;
    this.split = sp && okBy(sp.next) && okBy(sp.later) ? { next: sp.next.slice(), later: sp.later.slice() } : null;
    return true;
  }

  /** Segundos que se suman a una llegada calculada a esta hora a `away` paradas del bus (1 = la próxima): la corrección aparte de la
   *  próxima parada y las demás si el perfil la trae; si no, la de su franja; si no, la general. */
  extraAt(nowMs: number, away = 1): number {
    if (this.split) return (away <= 1 ? this.split.next : this.split.later)[hopTag(nowMs).bucket]!;
    return this.extraBy ? this.extraBy[hopTag(nowMs).bucket]! : this.extra;
  }

  /** Segundos para el tramo `i` (de la parada i a la i+1) del recorrido a esta hora: lo aprendido mezclado con `fallback` (el valor fijo).
   *  Sin datos suficientes devuelve `fallback` tal cual. Los fines de semana sin datos propios usan los de entre semana de la misma franja. */
  seconds(shape: RouteShape, i: number, nowMs: number, fallback: number): number {
    const hit = this.learned(shape, i, nowMs);
    if (!hit) return fallback;
    const s = Math.min(MAX_S, Math.max(MIN_S, hit.s));
    return (hit.n * s + this.priorN * fallback) / (hit.n + this.priorN);
  }

  /** ¿Hay tiempo aprendido para ese tramo a esta hora? (Para quien quiere usarlo solo si existe, sin valor fijo con qué mezclarlo.) */
  has(shape: RouteShape, i: number, nowMs: number): boolean { return this.learned(shape, i, nowMs) != null; }

  private learned(shape: RouteShape, i: number, nowMs: number): { s: number; n: number } | null {
    if (!this.apply) return null;
    const r = this.routes.get(`${shape.routeId}|${shape.direction}`);
    if (!r) return null;
    if (Math.abs(nowMs - this.tagAt) > 30_000) { const t = hopTag(nowMs); this.tag = this.dayOf ? { ...t, day: this.dayOf(nowMs) } : t; this.tagAt = nowMs; }      // se calcula pocas veces: se pide miles de veces por lote
    const { day, bucket } = this.tag;
    let hit = pick(r[`${day}|${bucket}`], i, this.minN);
    if (!hit && day !== "wk") hit = pick(r[`wk|${bucket}`], i, this.minN);
    return hit;
  }
}

function okExtra(x: unknown): x is number { return typeof x === "number" && Number.isFinite(x) && x >= -120 && x <= 120; }
function okBy(x: unknown): x is number[] { return Array.isArray(x) && x.length === HOP_BUCKETS.length && x.every(okExtra); }

function pick(arr: number[] | undefined, i: number, minN: number): { s: number; n: number } | null {
  if (!arr) return null;
  const s = arr[2 * i], n = arr[2 * i + 1];
  return s != null && n != null && s > 0 && n >= minN ? { s, n } : null;
}

/** Arma el perfil publicado a partir de las sumas que acumula `tools/hopstats.ts` (`ruta|sentido|tramo|día|franja` → pasadas y segundos).
 *  `stopsOf` dice cuántas paradas tiene cada recorrido hoy: si el GTFS cambió y la ruta ya no tiene ese tramo, se descarta. */
export function buildHopProfile(stats: Record<string, { n: number; sum: number }>, stopsOf: (routeDir: string) => number | undefined, updated: string, minN = HOP_MIN_N, use = true, prior = HOP_PRIOR_N, extra = HOP_EXTRA_S, extraBy: readonly number[] | null = HOP_EXTRA_BY, split: { next: readonly number[]; later: readonly number[] } | null = HOP_SPLIT_NEXT && HOP_SPLIT_LATER ? { next: HOP_SPLIT_NEXT, later: HOP_SPLIT_LATER } : null): HopProfileData {
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
  return { v: 1, updated, use, prior, extra, ...(extraBy ? { extraBy: [...extraBy] } : {}), ...(split ? { split: { next: [...split.next], later: [...split.later] } } : {}), r };
}
