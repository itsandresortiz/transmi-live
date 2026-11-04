import { Vehicle, type VehicleReport, type VehicleId } from "./vehicle";

/** Cuánto se conserva un bus que dejó de aparecer en los lotes (la fuente a veces omite algunos). */
export const RETENTION_MS = 90_000;

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

  clear(): void { this.byId.clear(); this.version++; }
}
