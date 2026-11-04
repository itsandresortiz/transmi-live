import {
  Fleet, type Delay, type Route, type ServiceAlert, type Stop, type SystemType, type TripUpdate, type Vehicle,
  type VehicleReport, TransitNetwork, delayFromSeconds, inferSystemFromReport,
} from "@transmi/domain";
import type { FeedSource } from "./ports";

export interface Arrival { routeId: string; tripId: string; arrivalAt?: number; delaySeconds: number | null }

/** Estado vivo de todo lo que sabe la aplicación: flota, red, retrasos y avisos. */
export class TransitState {
  readonly fleet = new Fleet();
  network = new TransitNetwork();
  tripUpdates = new Map<string, TripUpdate>();
  alerts: ServiceAlert[] = [];
  alertsByRoute = new Map<string, number[]>();
  alertsByStop = new Map<string, number[]>();
  arrivalsByStop = new Map<string, Arrival[]>();
  /** Hora del último lote de posiciones (segundos desde 1970). */
  lastBatchAt: number | null = null;
  source: FeedSource | null = null;
  version = 0;
  private provisional = new Map<string, Route>();
  private listeners = new Set<() => void>();

  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private touch(): void { this.version++; for (const l of this.listeners) l(); }

  /** Rutas conocidas: las del GTFS o, mientras no cargan, las deducidas de los buses. */
  routes(): Route[] { return this.network.routes.size ? [...this.network.routes.values()] : [...this.provisional.values()]; }
  routeById(id: string): Route | undefined { return this.network.routes.get(id) ?? this.provisional.get(id); }
  routeOf(v: Vehicle): Route | undefined { return this.routeById(v.routeId); }
  stopById(id: string | undefined): Stop | undefined { return id ? this.network.stops.get(id) : undefined; }

  delayOf(v: Vehicle): Delay { return delayFromSeconds(v.tripId ? this.tripUpdates.get(v.tripId)?.delaySeconds : null); }
  nextStopOf(v: Vehicle): { stopId: string; stop?: Stop; arrivalAt?: number } | undefined {
    const tu = v.tripId ? this.tripUpdates.get(v.tripId) : undefined;
    const stopId = tu?.nextStop?.stopId ?? v.nextStopId;
    return stopId ? { stopId, stop: this.stopById(stopId), arrivalAt: tu?.nextStop?.arrivalAt } : undefined;
  }

  applyPositions(reports: readonly VehicleReport[], nowMs: number): void {
    this.fleet.ingest(reports, nowMs);
    let latest = this.lastBatchAt ?? 0;
    for (const r of reports) if (r.reportedAt > latest) latest = r.reportedAt;
    if (latest) this.lastBatchAt = latest;
    this.resolveSystems();
    this.touch();
  }

  applyTripUpdates(updates: readonly TripUpdate[]): void {
    this.tripUpdates = new Map(updates.map((u) => [u.tripId, u]));
    const arrivals = new Map<string, Arrival[]>();
    for (const u of updates) {
      const s = u.nextStop;
      if (!s) continue;
      const list = arrivals.get(s.stopId) ?? [];
      list.push({ routeId: u.routeId ?? "", tripId: u.tripId, arrivalAt: s.arrivalAt, delaySeconds: u.delaySeconds });
      arrivals.set(s.stopId, list);
    }
    this.arrivalsByStop = arrivals;
    this.touch();
  }

  applyAlerts(alerts: readonly ServiceAlert[]): void {
    this.alerts = [...alerts];
    this.alertsByRoute = new Map();
    this.alertsByStop = new Map();
    this.alerts.forEach((a, i) => {
      for (const r of a.routeIds) (this.alertsByRoute.get(r) ?? this.alertsByRoute.set(r, []).get(r)!).push(i);
      for (const s of a.stopIds) (this.alertsByStop.get(s) ?? this.alertsByStop.set(s, []).get(s)!).push(i);
    });
    this.touch();
  }

  setNetwork(network: TransitNetwork): void {
    this.network = network;
    this.resolveSystems();
    this.touch();
  }

  /** Asigna el sistema a cada bus: por la ruta del GTFS o, sin GTFS, por votación de sus reportes. */
  private resolveSystems(): void {
    const votes = new Map<string, Map<SystemType, number>>();
    for (const v of this.fleet.values()) {
      const route = this.network.routes.get(v.routeId);
      if (route) { v.system = route.system; continue; }
      const sys = inferSystemFromReport({ tripId: v.tripId, label: v.label, id: v.id });
      const m = votes.get(v.routeId) ?? votes.set(v.routeId, new Map()).get(v.routeId)!;
      m.set(sys, (m.get(sys) ?? 0) + 1);
    }
    for (const [routeId, m] of votes) {
      const system = [...m.entries()].sort((a, b) => b[1] - a[1])[0]![0];
      this.provisional.set(routeId, { id: routeId, shortName: routeId, longName: "", system, provisional: true });
    }
    for (const v of this.fleet.values()) {
      if (!this.network.routes.has(v.routeId)) v.system = this.provisional.get(v.routeId)?.system ?? "otro";
    }
  }
}
