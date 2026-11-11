import { Vehicle, type VehicleReport, type VehicleId } from "./vehicle";

/** Cuánto se conserva un bus que dejó de aparecer en los lotes (la fuente a veces omite algunos). */
export const RETENTION_MS = 90_000;

/** Un bus sin reportar en tanto tiempo ya no está circulando (típico de madrugada, con la fuente congelada). */
export const MAX_REPORT_AGE_S = 600;

/** Desde cuándo el último reporte de un bus se considera viejo para mostrarlo como los demás. Hoy un reporte normal llega con 40–80 s de edad
 *  y cada bus cambia cada 30–100 s, así que hasta ~3 min es normal; más que eso, el bus dejó de reportar y se dibuja atenuado. */
export const STALE_REPORT_S = 240;
export const isStaleReport = (v: { reportedAt: number }, nowSec: number): boolean => nowSec - v.reportedAt > STALE_REPORT_S;

/** Agregado: la flota de buses en circulación. */
export class Fleet {
  private readonly byId = new Map<VehicleId, Vehicle>();
  /** Aumenta cada vez que cambia algo; sirve para que la interfaz sepa cuándo volver a leer. */
  version = 0;

  get size(): number { return this.byId.size; }
  get(id: VehicleId): Vehicle | undefined { return this.byId.get(id); }
  values(): IterableIterator<Vehicle> { return this.byId.values(); }
  toArray(): Vehicle[] { return [...this.byId.values()]; }

  /** Incorpora un lote de reportes. `onNew` permite resolver el sistema de un bus recién visto. */
  ingest(reports: readonly VehicleReport[], nowMs: number, onNew?: (v: Vehicle) => void): void {
    const seen = new Set<VehicleId>();
    for (const r of reports) {
      seen.add(r.id);
      const v = this.byId.get(r.id);
      if (v) v.apply(r, nowMs);
      else {
        const nv = new Vehicle(r, nowMs);
        onNew?.(nv);
        this.byId.set(r.id, nv);
      }
    }
    for (const [id, v] of this.byId) {
      if (!seen.has(id) && nowMs - v.lastSeenMs > RETENTION_MS) this.byId.delete(id);
    }
    this.version++;
  }

  /** Quita los buses cuyo último reporte (hora de la fuente, en segundos) es anterior a `minReportedAt`. Devuelve cuántos quitó. */
  dropReportedBefore(minReportedAt: number): number {
    let n = 0;
    for (const [id, v] of this.byId) if (v.reportedAt < minReportedAt) { this.byId.delete(id); n++; }
    if (n) this.version++;
    return n;
  }

  clear(): void { this.byId.clear(); this.version++; }
}
