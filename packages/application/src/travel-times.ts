import type { SystemType } from "@transmi/domain";
import type { TransitState } from "./transit-state";

/** Tiempo típico por parada de cada sistema (medido con lotes reales); es el punto de partida mientras no hay datos propios. */
export const DEFAULT_SECONDS_PER_STOP: Record<SystemType, number> = { troncal: 58, dual: 58, alimentador: 62, zonal: 50, otro: 55 };

type Daypart = "madrugada" | "pico-am" | "valle" | "pico-pm" | "noche";
/** Franja del día en Bogotá (UTC-5, sin horario de verano). */
export function daypartOf(nowMs: number): Daypart {
  const h = new Date(nowMs - 5 * 3600_000).getUTCHours();
  return h < 5 ? "madrugada" : h < 9 ? "pico-am" : h < 16 ? "valle" : h < 20 ? "pico-pm" : "noche";
}

interface Stat { mean: number; n: number }
interface Seen { stop: string; since: number; known: boolean }
const MIN_HOP = 10, MAX_HOP = 400, MAX_WEIGHT = 40;
const MIN_ROUTE_SAMPLES = 8, MIN_SYSTEM_SAMPLES = 20;

/** Aprende cuánto tarda de verdad cada ruta entre paradas, según la franja del día, observando cuándo cambia la «próxima parada» de cada bus. */
export class TravelTimes {
  /** Si es `false` (por defecto) se usan siempre los tiempos típicos: lo aprendido por cada dispositivo daba resultados distintos entre
   *  aparatos y, medido con lotes reales, erraba más que el valor típico (ver README). */
  apply = false;
  private stats = new Map<string, Stat>();
  private seen = new Map<string, Seen>();

  /** Segundos por parada para una ruta ahora: lo aprendido de la ruta, si no del sistema, si no el valor típico. */
  secondsPerStop(routeId: string, system: SystemType, nowMs: number): number {
    if (!this.apply) return DEFAULT_SECONDS_PER_STOP[system];
    const part = daypartOf(nowMs);
    const r = this.stats.get(`r|${routeId}|${part}`);
    if (r && r.n >= MIN_ROUTE_SAMPLES) return r.mean;
    const s = this.stats.get(`s|${system}|${part}`);
    if (s && s.n >= MIN_SYSTEM_SAMPLES) return s.mean;
    return DEFAULT_SECONDS_PER_STOP[system];
  }

  /** Cuántas observaciones lleva aprendidas (para saber si ya sirve). */
  get samples(): number { let n = 0; for (const [k, v] of this.stats) if (k.startsWith("s|")) n += v.n; return n; }

  private add(key: string, x: number) {
    const st = this.stats.get(key) ?? { mean: x, n: 0 };
    st.n++;
    st.mean += (x - st.mean) / Math.min(st.n, MAX_WEIGHT);
    this.stats.set(key, st);
  }

  /** Revisa la flota tras un lote nuevo: si la próxima parada de un bus avanzó una posición, midió un tramo. */
  observe(state: TransitState): void {
    if (!this.apply) return;
    for (const v of state.fleet.values()) {
      const stop = v.lastStopId;
      if (!stop) continue;
      const prev = this.seen.get(v.id);
      if (!prev) { this.seen.set(v.id, { stop, since: v.reportedAt, known: false }); continue; }
      if (prev.stop === stop) continue;
      const elapsed = v.reportedAt - prev.since;
      // si entre dos lotes el bus avanzó varias paradas, el tiempo por parada es lo transcurrido entre ellas
      // (si solo se contaran los tramos de una parada, se descartarían los rápidos y el promedio saldría inflado)
      const hops = prev.known ? this.hopsBetween(state, v.routeId, prev.stop, stop) : 0;
      if (hops > 0 && elapsed >= MIN_HOP * hops && elapsed <= MAX_HOP * hops) {
        const part = daypartOf(v.reportedAt * 1000);
        for (let k = 0; k < hops; k++) { this.add(`r|${v.routeId}|${part}`, elapsed / hops); this.add(`s|${v.system}|${part}`, elapsed / hops); }
      }
      this.seen.set(v.id, { stop, since: v.reportedAt, known: true });
    }
    if (this.seen.size > state.fleet.size * 2 + 100) for (const id of this.seen.keys()) if (!state.fleet.get(id)) this.seen.delete(id);
  }

  /** Cuántas paradas hay de `from` a `to` en el recorrido de la ruta (1 a 4), o 0 si no es un avance normal. */
  private hopsBetween(state: TransitState, routeId: string, from: string, to: string): number {
    for (const sh of state.network.shapes.get(routeId) ?? []) {
      const i = sh.stopIds.indexOf(from), j = sh.stopIds.indexOf(to);
      if (i >= 0 && j > i && j - i <= 4) return j - i;
    }
    return 0;
  }

  toJSON(): [string, number, number][] { return [...this.stats].map(([k, v]) => [k, Math.round(v.mean * 10) / 10, v.n]); }
  load(data: unknown): void {
    if (!Array.isArray(data)) return;
    for (const row of data) if (Array.isArray(row) && typeof row[0] === "string" && Number.isFinite(row[1]) && Number.isFinite(row[2])) this.stats.set(row[0], { mean: row[1], n: Math.min(row[2], 1e6) });
  }
}
