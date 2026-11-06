import { type DayType } from "./service-ends";

/** Horas de salida programadas por ruta y sentido, y cuánto tarda cada recorrido en llegar a cada parada (sale del horario del GTFS). */
export interface DeparturesData {
  v: number;
  routes: Record<string, Record<string, { stops: string[]; off: number[] } & Partial<Record<DayType, number[]>>>>;
}
export interface ScheduledPass { routeId: string; direction: string; /** Segundos desde la medianoche del día de servicio (puede pasar de 86 400). */ times: number[] }

const decode = (d: readonly number[]): number[] => { let t = 0; return d.map((x) => (t += x)); };

/** Qué dice el horario programado (no son buses en vivo): próximas horas de paso por una parada y frecuencia a cierta hora. */
export class Departures {
  private data: DeparturesData["routes"] = {};
  private starts = new Map<string, number[]>();
  private byStop: Map<string, { routeId: string; direction: string; index: number }[]> | null = null;
  get size(): number { return Object.keys(this.data).length; }

  load(d: DeparturesData): void { this.data = d.routes ?? {}; this.starts.clear(); this.byStop = null; }

  private startsOf(routeId: string, direction: string, type: DayType): number[] {
    const key = `${routeId}|${direction}|${type}`;
    let v = this.starts.get(key);
    if (!v) { const enc = this.data[routeId]?.[direction]?.[type]; v = enc ? decode(enc) : []; this.starts.set(key, v); }
    return v;
  }

  /** Próximas `n` horas de paso de cada ruta y sentido por la parada, desde `secs` (segundos del día de servicio). */
  nextAt(stopId: string, type: DayType, secs: number, n = 3): ScheduledPass[] {
    if (!this.byStop) {
      this.byStop = new Map();
      for (const [routeId, dirs] of Object.entries(this.data))
        for (const [direction, e] of Object.entries(dirs)) e.stops.forEach((s, index) => (this.byStop!.get(s) ?? this.byStop!.set(s, []).get(s)!).push({ routeId, direction, index }));
    }
    const out: ScheduledPass[] = [];
    for (const { routeId, direction, index } of this.byStop.get(stopId) ?? []) {
      const off = this.data[routeId]![direction]!.off[index];
      if (off == null || index === this.data[routeId]![direction]!.stops.length - 1) continue;       // la última parada de un recorrido solo es de llegada
      const starts = this.startsOf(routeId, direction, type);
      let lo = 0, hi = starts.length;                                                                 // primera salida cuyo paso por la parada es >= secs
      while (lo < hi) { const mid = (lo + hi) >> 1; if (starts[mid]! + off < secs - 30) lo = mid + 1; else hi = mid; }
      const times = starts.slice(lo, lo + n).map((s) => s + off);
      if (times.length) out.push({ routeId, direction, times });
    }
    return out.sort((a, b) => a.times[0]! - b.times[0]!);
  }

  /** Cada cuántos segundos sale un bus de la ruta alrededor de `secs` (mediana de los intervalos de la hora anterior y siguiente). */
  headwayAt(routeId: string, type: DayType, secs: number): number | undefined {
    const gaps: number[] = [];
    for (const direction of Object.keys(this.data[routeId] ?? {})) {
      const s = this.startsOf(routeId, direction, type).filter((t) => t >= secs - 3600 && t <= secs + 3600);
      for (let i = 1; i < s.length; i++) gaps.push(s[i]! - s[i - 1]!);
    }
    if (!gaps.length) return undefined;
    gaps.sort((a, b) => a - b);
    return gaps[Math.floor(gaps.length / 2)];
  }
}
