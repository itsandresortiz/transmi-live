/**
 * Recolector compartido por `signalcheck.ts` (a mano) y `signalstats.ts` (cada 10 min): por cada reporte de un bus que se ACERCA a un
 * semáforo medido a mano (a ≤60 m, sin alejarse), anota si iba detenido y hacia dónde iba; y si un bus que estaba detenido arrancó, el
 * intervalo en que lo hizo. Para el semáforo de TransMilenio solo cuentan troncales y duales; para los de carros, los demás.
 * No guarda la identidad del bus: solo hora, detenido o no y dirección.
 */
import type { BusGo, BusNearSignal, Heading } from "@transmi/application";

export const NEAR_SIGNAL_M = 60;
const STILL_MPS = 1.2, GO_MPS = 2;
const meters = (lon1: number, lat1: number, lon2: number, lat2: number) => Math.hypot((lon1 - lon2) * 111_320 * Math.cos((4.65 * Math.PI) / 180), (lat1 - lat2) * 110_570);
const bearingOf = (dLon: number, dLat: number) => Math.round(((Math.atan2(dLon * Math.cos((4.65 * Math.PI) / 180), dLat) * 180) / Math.PI + 360) % 360);
const headingOf = (dLon: number, dLat: number): Heading => { const deg = ((Math.atan2(dLon * Math.cos((4.65 * Math.PI) / 180), dLat) * 180) / Math.PI + 360) % 360; return (["N", "E", "S", "O"] as const)[Math.round(deg / 90) % 4]!; };

export interface NearSignal { lat: number; lon: number; tm: boolean }
export interface Report { id: string; lon: number; lat: number; t: number; trunk: boolean }

export class SignalNearCollector {
  readonly obs: BusNearSignal[][];
  readonly goes: BusGo[][];
  private prev = new Map<string, { lon: number; lat: number; t: number; h: Heading; b?: number; still: boolean }>();
  constructor(private readonly sigs: readonly NearSignal[]) { this.obs = sigs.map(() => []); this.goes = sigs.map(() => []); }

  add(r: Report): void {
    const p = this.prev.get(r.id);
    const moved = p ? meters(p.lon, p.lat, r.lon, r.lat) : 0;
    const h = p && moved > 8 ? headingOf(r.lon - p.lon, r.lat - p.lat) : p?.h ?? "?";
    const b = p && moved > 8 ? bearingOf(r.lon - p.lon, r.lat - p.lat) : p?.b;      // rumbo en grados (quieto: el último que se le vio)
    const dt = p ? r.t - p.t : 0, speed = dt > 0 ? moved / dt : 0, still = speed < STILL_MPS;
    if (p && r.t <= p.t) return;
    this.prev.set(r.id, { lon: r.lon, lat: r.lat, t: r.t, h, b, still });
    if (!p || dt < 8 || dt > 90) return;
    this.sigs.forEach((s, k) => {
      if (r.trunk !== s.tm) return;
      const d = meters(s.lon, s.lat, r.lon, r.lat), d0 = meters(s.lon, s.lat, p.lon, p.lat);
      // arranque: estaba detenido junto al semáforo y ahora avanza. Se anota ANTES de mirar si se aleja: con reportes cada ~20 s, el bus
      // que arrancó casi siempre ya pasó el semáforo en el reporte siguiente (antes se descartaba y en 4 días quedó 1 solo arranque)
      if (p.still && speed >= GO_MPS && d0 <= NEAR_SIGNAL_M && d <= NEAR_SIGNAL_M + 150) this.goes[k]!.push({ a: p.t, b: r.t, h, bb: b });
      if (d > NEAR_SIGNAL_M || d > d0 + 3) return;      // lejos o alejándose (ya pasó el semáforo: avanza con cualquier color)
      this.obs[k]!.push({ t: r.t, still, h, b });
    });
  }
}
