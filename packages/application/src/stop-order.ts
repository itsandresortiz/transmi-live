import type { RouteShape, TransitNetwork, VehicleReport } from "@transmi/domain";
import { hav } from "./eta";

/**
 * Aprender el orden de paradas de cada ruta con lo que reportan los buses.
 *
 * El GTFS de TransMilenio a veces va por detrás de lo que opera en la calle (la H15 paraba en Calle 57 y el GTFS no lo traía; la E32 sale
 * del Portal Américas y el GTFS la hace empezar en Tv. 86). Desde nov. 2026 la «última parada» que manda cada bus avanza con él (medido el
 * 2026-11-24: 7.201 de 7.373 buses la cambiaron en 52 min y, al cambiarla, la mediana de distancia a esa parada era ~100 m). La secuencia de
 * paradas que va informando cada bus es, entonces, el recorrido que de verdad hace.
 *
 * Se cuentan los **pasos** de una parada a la siguiente (a → b) por ruta, cuántos buses distintos los hicieron y en cuántos días. Con eso
 * se buscan, contra el recorrido del GTFS: paradas que faltan (los buses pasan por X entre A y B), paradas que los buses nunca visitan
 * (pasan de A a B saltándose X, cuando en el resto de la ruta casi no se saltan ninguna) y pares en orden invertido. Solo se propone
 * una corrección con evidencia fuerte (muchos buses, varios días); se aplica como las de `STOP_PATCHES` y deja de hacer algo sola
 * cuando TransMilenio publique el dato corregido.
 */

/* ---------- 1. observar los lotes ---------- */

/** Pasos vistos en una corrida: ruta → «a>b» → buses distintos que lo hicieron. */
export type StopSteps = Map<string, Map<string, Set<string>>>;

/** Un bus que cambia de parada a más de esto de la parada nueva: el dato no es creíble (se ignora). */
const PLAUSIBLE_M = 1000;
/** Entre dos reportes con más tiempo que esto pudo pasar de todo (otra vuelta, patio): no se cuenta el paso. */
const MAX_GAP_S = 600;

/** Sigue a cada bus lote a lote y anota sus pasos de parada a parada. Usa los reportes tal cual llegan (la «última parada» informada,
 *  no la corregida por posición: aquí lo que interesa es justamente lo que dice TransMilenio). */
export class StopOrderObserver {
  readonly steps: StopSteps = new Map();
  /** Por bus: ruta, última parada vista, si esa parada es «fresca» (la cambió estando ya en esta ruta) y la hora del reporte. */
  private last = new Map<string, { routeId: string; stop: string; fresh: boolean; at: number }>();
  reports = 0;

  constructor(private readonly network: TransitNetwork) {}

  observe(reports: readonly VehicleReport[]): void {
    for (const r of reports) {
      if (!r.lastStopId || !r.routeId) continue;
      const prev = this.last.get(r.id);
      if (prev && prev.at === r.reportedAt) continue;           // el mismo reporte otra vez
      this.reports++;
      if (!prev || prev.routeId !== r.routeId || r.reportedAt - prev.at > MAX_GAP_S) {
        // primera vez que se ve, o cambió de ruta: la parada que trae puede ser la última del viaje anterior. No sirve como origen de un paso
        this.last.set(r.id, { routeId: r.routeId, stop: r.lastStopId, fresh: false, at: r.reportedAt });
        continue;
      }
      if (prev.stop === r.lastStopId) { prev.at = r.reportedAt; continue; }
      const to = this.network.stops.get(r.lastStopId);
      const plausible = !!to && hav(to.position, r.position) <= PLAUSIBLE_M;
      if (plausible && prev.fresh) {
        const m = this.steps.get(r.routeId) ?? this.steps.set(r.routeId, new Map()).get(r.routeId)!;
        const k = `${prev.stop}>${r.lastStopId}`;
        (m.get(k) ?? m.set(k, new Set()).get(k)!).add(r.id);
      }
      this.last.set(r.id, { routeId: r.routeId, stop: r.lastStopId, fresh: plausible, at: r.reportedAt });
    }
  }
}

/* ---------- 2. acumular entre corridas y días ---------- */

/** Lo acumulado: por ruta y paso, [buses (suma de corridas), días distintos, último día AAAA-MM-DD]. */
export interface StopOrderStats { v: 1; updated: string; steps: Record<string, Record<string, [number, number, string]>> }

export const emptyStopOrderStats = (): StopOrderStats => ({ v: 1, updated: "", steps: {} });

/** Suma una corrida (`day` = fecha de Bogotá) a lo acumulado. Olvida los pasos que nadie repite en `keepDays` días (rutas que cambiaron). */
export function mergeStopSteps(total: StopOrderStats, run: StopSteps, day: string, keepDays = 30): StopOrderStats {
  for (const [rid, m] of run) {
    const t = (total.steps[rid] ??= {});
    for (const [k, buses] of m) {
      const e = t[k];
      if (!e) t[k] = [buses.size, 1, day];
      else { e[0] += buses.size; if (e[2] !== day) { e[1]++; e[2] = day; } }
    }
  }
  const oldest = new Date(Date.parse(`${day}T00:00:00Z`) - keepDays * 86400_000).toISOString().slice(0, 10);
  for (const [rid, t] of Object.entries(total.steps)) {
    for (const [k, e] of Object.entries(t)) if (e[2] < oldest) delete t[k];
    if (!Object.keys(t).length) delete total.steps[rid];
  }
  total.updated = day;
  return total;
}

/* ---------- 3. decidir correcciones ---------- */

export interface StopFixEvidence { buses: number; days: number; share: number }
/** Corrección aprendida al recorrido de una ruta (por su nombre corto, como `STOP_PATCHES`). Cada una solo se aplica si el recorrido
 *  sigue como cuando se aprendió (las paradas vecinas son las mismas): si TransMilenio corrige el GTFS, deja de hacer algo sola. */
export type LearnedStopFix =
  /** Falta `stop`: va justo antes/después de `anchor` (y, si se da, entre `anchor` y `next`). */
  | { kind: "add"; route: string; stop: string; anchor: string; where: "before" | "after"; next?: string; why: string; evidence: StopFixEvidence }
  /** Los buses no paran en `stop` (entre `prev` y `next`). */
  | { kind: "drop"; route: string; stop: string; prev: string; next: string; why: string; evidence: StopFixEvidence }
  /** `first` y `second` van al revés: los buses pasan por `second` antes que por `first`. */
  | { kind: "swap"; route: string; first: string; second: string; why: string; evidence: StopFixEvidence };

export interface StopOrderThresholds {
  /** Mínimo de buses (sumados entre corridas) en cada paso que sostiene una corrección. */
  minBuses: number;
  /** Mínimo de días distintos con ese paso. */
  minDays: number;
  /** Qué parte de los buses que salen de la parada anterior tiene que ir a la nueva (no es un desvío de unos pocos). */
  minShare: number;
}
/** Evidencia fuerte por defecto: lo bastante para no publicar una corrección por un desvío de un día o un dato raro. */
export const STOP_ORDER_STRONG: StopOrderThresholds = { minBuses: 40, minDays: 3, minShare: 0.7 };

const stepOf = (t: Record<string, [number, number, string]> | undefined, a: string, b: string): [number, number] => { const e = t?.[`${a}>${b}`]; return e ? [e[0], e[1]] : [0, 0]; };

/** Compara lo que hacen los buses con el recorrido de cada ruta y devuelve las correcciones con evidencia suficiente. */
export function learnStopFixes(stats: StopOrderStats, network: TransitNetwork, th: StopOrderThresholds = STOP_ORDER_STRONG): LearnedStopFix[] {
  const out: LearnedStopFix[] = [];
  const name = (id: string) => network.stops.get(id)?.name ?? id;
  for (const [rid, shapes] of network.shapes) {
    const route = network.routes.get(rid), t = stats.steps[rid];
    if (!route || !t) continue;
    const inRoute = new Set(shapes.flatMap((s) => s.stopIds));
    // salidas y llegadas por parada (solo pasos de esta ruta)
    const outs = new Map<string, [string, number, number][]>(), ins = new Map<string, [string, number, number][]>();
    for (const [k, e] of Object.entries(t)) {
      const [a, b] = k.split(">") as [string, string];
      (outs.get(a) ?? outs.set(a, []).get(a)!).push([b, e[0], e[1]]);
      (ins.get(b) ?? ins.set(b, []).get(b)!).push([a, e[0], e[1]]);
    }
    for (const sh of shapes) {
      const ids = sh.stopIds, idx = new Map(ids.map((id, i) => [id, i] as const));
      const n = ids.length;
      if (n < 3) continue;
      const best = (l: [string, number, number][] | undefined, ok: (x: string) => boolean) => (l ?? []).filter((x) => ok(x[0])).sort((x, y) => y[1] - x[1])[0];
      const totalOut = (a: string) => (outs.get(a) ?? []).reduce((s, x) => s + x[1], 0);

      // (a) paradas que faltan: no están en ningún recorrido de la ruta, pero los buses pasan por ellas
      const candidates = new Set<string>();
      for (const id of ids) for (const [b] of outs.get(id) ?? []) if (!inRoute.has(b)) candidates.add(b);
      for (const id of ids) for (const [a] of ins.get(id) ?? []) if (!inRoute.has(a)) candidates.add(a);
      for (const x of candidates) {
        if (!network.stops.has(x)) continue;
        const pred = best(ins.get(x), (a) => idx.has(a)), succ = best(outs.get(x), (b) => idx.has(b));
        const strong = (s: [string, number, number] | undefined) => !!s && s[1] >= th.minBuses && s[2] >= th.minDays;
        if (pred && succ && idx.get(succ[0])! === idx.get(pred[0])! + 1) {
          const share = pred[1] / Math.max(1, totalOut(pred[0]));
          if (strong(pred) && strong(succ) && share >= th.minShare) out.push({ kind: "add", route: route.shortName, stop: x, anchor: pred[0], where: "after", next: succ[0], why: `Los buses de la ${route.shortName} pasan por ${name(x)} entre ${name(pred[0])} y ${name(succ[0])}`, evidence: { buses: Math.min(pred[1], succ[1]), days: Math.min(pred[2], succ[2]), share: round(share) } });
        } else if (!pred && succ && succ[0] === ids[0]) {
          // antes de la primera parada: el bus pasa por X y luego por la que el GTFS pone primero
          const share = succ[1] / Math.max(1, totalOut(x));
          if (strong(succ) && share >= th.minShare) out.push({ kind: "add", route: route.shortName, stop: x, anchor: ids[0]!, where: "before", why: `Los buses de la ${route.shortName} salen de ${name(x)} antes de ${name(ids[0]!)}`, evidence: { buses: succ[1], days: succ[2], share: round(share) } });
        }
        // al final no se agregan: un bus que termina sigue unos minutos con la ruta vieja mientras empieza el viaje siguiente
      }

      // (b) paradas que los buses se saltan siempre (no la primera ni la última)
      const visit: { i: number; hits: number; jumps: number }[] = [];
      for (let i = 1; i < n - 1; i++) {
        let hits = 0, jumps = 0;
        for (const [a, c] of ins.get(ids[i]!) ?? []) if ((idx.get(a) ?? n) < i) hits += c;
        for (let a = Math.max(0, i - 3); a < i; a++) for (let b = i + 1; b <= Math.min(n - 1, i + 3); b++) jumps += stepOf(t, ids[a]!, ids[b]!)[0];
        visit.push({ i, hits, jumps });
      }
      const rates = visit.filter((x) => x.hits + x.jumps >= th.minBuses).map((x) => x.hits / (x.hits + x.jumps)).sort((a, b) => a - b);
      const median = rates.length >= 3 ? rates[rates.length >> 1]! : 0;
      for (const { i, hits, jumps } of visit) {
        const direct = stepOf(t, ids[i - 1]!, ids[i + 1]!);
        if (median < 0.6 || hits + jumps < th.minBuses || hits > 0.1 * (hits + jumps) || direct[0] < th.minBuses || direct[1] < th.minDays) continue;
        out.push({ kind: "drop", route: route.shortName, stop: ids[i]!, prev: ids[i - 1]!, next: ids[i + 1]!, why: `Los buses de la ${route.shortName} pasan de ${name(ids[i - 1]!)} a ${name(ids[i + 1]!)} sin pasar por ${name(ids[i]!)}`, evidence: { buses: direct[0], days: direct[1], share: round(1 - hits / (hits + jumps)) } });
      }

      // (c) dos paradas seguidas al revés
      for (let i = 0; i + 1 < n; i++) {
        const fwd = stepOf(t, ids[i]!, ids[i + 1]!), back = stepOf(t, ids[i + 1]!, ids[i]!);
        if (back[0] < th.minBuses || back[1] < th.minDays || fwd[0] > (1 - th.minShare) * back[0]) continue;
        out.push({ kind: "swap", route: route.shortName, first: ids[i]!, second: ids[i + 1]!, why: `Los buses de la ${route.shortName} pasan por ${name(ids[i + 1]!)} antes que por ${name(ids[i]!)}`, evidence: { buses: back[0], days: back[1], share: round(back[0] / (back[0] + fwd[0])) } });
      }
    }
  }
  // la misma corrección puede salir de dos recorridos de la ruta: una sola vez
  const seen = new Set<string>();
  return out.filter((f) => { const k = JSON.stringify([f.kind, f.route, "stop" in f ? f.stop : f.first, "anchor" in f ? f.anchor : "prev" in f ? f.prev : f.second]); if (seen.has(k)) return false; seen.add(k); return true; });
}
const round = (x: number) => Math.round(x * 100) / 100;

/** Aplica las correcciones aprendidas a los recorridos (solo donde el recorrido sigue como cuando se aprendió). Devuelve las que cambiaron algo. */
export function applyLearnedStopFixes(shapes: { routeId: string; stopIds: string[] }[], routeName: (routeId: string) => string | undefined, knownStop: (id: string) => boolean, fixes: readonly LearnedStopFix[]): LearnedStopFix[] {
  const used = new Set<LearnedStopFix>();
  for (const f of fixes) {
    for (const sh of shapes) {
      if (routeName(sh.routeId) !== f.route) continue;
      const s = sh.stopIds;
      if (f.kind === "add") {
        if (!knownStop(f.stop) || s.includes(f.stop)) continue;
        const i = s.indexOf(f.anchor);
        if (i < 0) continue;
        if (f.where === "after" && f.next && s[i + 1] !== f.next) continue;
        s.splice(f.where === "before" ? i : i + 1, 0, f.stop); used.add(f);
      } else if (f.kind === "drop") {
        const i = s.indexOf(f.stop);
        if (i < 1 || s[i - 1] !== f.prev || s[i + 1] !== f.next) continue;
        s.splice(i, 1); used.add(f);
      } else {
        const i = s.indexOf(f.first);
        if (i < 0 || s[i + 1] !== f.second) continue;
        s[i] = f.second; s[i + 1] = f.first; used.add(f);
      }
    }
  }
  return fixes.filter((f) => used.has(f));
}

/** Cuántos buses respaldan cada paso de un recorrido (para el informe): útil para ver de un vistazo dónde no cuadra. */
export function shapeStepReport(stats: StopOrderStats, shape: RouteShape): { from: string; to: string; buses: number }[] {
  const t = stats.steps[shape.routeId];
  return shape.stopIds.slice(1).map((to, i) => ({ from: shape.stopIds[i]!, to, buses: stepOf(t, shape.stopIds[i]!, to)[0] }));
}
