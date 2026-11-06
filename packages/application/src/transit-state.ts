import {
  Fleet, type Delay, type Route, type ServiceAlert, type Stop, type SystemType, type TripUpdate, type Vehicle, type RouteShape,
  type VehicleReport, type StopLabel, TransitNetwork, delayFromSeconds, inferSystemFromReport, isAlertActive, parseStopName, MAX_REPORT_AGE_S,
} from "@transmi/domain";
import { arrivalAtIndex } from "./eta";
import { type RouteDayStatus, ServiceEnds, type ServiceMark } from "./service-ends";
import { TravelTimes } from "./travel-times";
import type { FeedSource } from "./ports";

/** Estado vivo de todo lo que sabe la aplicación: flota, red, retrasos y avisos. */
export class TransitState {
  readonly fleet = new Fleet();
  network = new TransitNetwork();
  tripUpdates = new Map<string, TripUpdate>();
  alerts: ServiceAlert[] = [];
  alertsByRoute = new Map<string, number[]>();
  alertsByStop = new Map<string, number[]>();
  /** Hora del último lote de posiciones (segundos desde 1970). */
  lastBatchAt: number | null = null;
  /** Última vez (ms) que la fuente respondió bien, haya traído datos nuevos o no. */
  lastPollOkAt: number | null = null;
  source: FeedSource | null = null;
  version = 0;
  /** Lo que se ha aprendido de cuánto tarda cada ruta por parada. */
  readonly travelTimes = new TravelTimes();
  /** Primer y último viaje de cada ruta, para marcar «último servicio». */
  readonly serviceEnds = new ServiceEnds();
  private provisional = new Map<string, Route>();
  private trunk: Set<string> | null = null;
  private served: Set<string> | null = null;
  private labels = new Map<string, StopLabel>();
  private seq = new Map<string, { shape: RouteShape; index: number } | null>();
  private listeners = new Set<() => void>();

  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private touch(): void { this.version++; for (const l of this.listeners) l(); }

  /** Rutas conocidas: las del GTFS o, mientras no cargan, las deducidas de los buses. */
  routes(): Route[] { return this.network.routes.size ? [...this.network.routes.values()] : [...this.provisional.values()]; }
  routeById(id: string): Route | undefined { return this.network.routes.get(id) ?? this.provisional.get(id); }
  routeOf(v: Vehicle): Route | undefined { return this.routeById(v.routeId); }
  stopById(id: string | undefined): Stop | undefined { return id ? this.network.stops.get(id) : undefined; }

  setServiceEnds(data: Parameters<ServiceEnds["load"]>[0]): void { this.serviceEnds.load(data); this.touch(); }
  /** ¿Este bus hace el último (o el primer) viaje programado de su ruta? */
  serviceOf(v: Vehicle): ServiceMark | undefined { return this.serviceEnds.markOf(v.tripId); }

  /** Estado de la ruta hoy (antes del primer servicio, en servicio o terminada). Sin datos en vivo no se afirma nada. */
  routeStatus(routeId: string, nowMs: number): RouteDayStatus | undefined {
    if (this.fleet.size < 50) return undefined;
    let n = 0;
    for (const v of this.fleet.values()) if (v.routeId === routeId) n++;
    return this.serviceEnds.routeStatus(routeId, nowMs, n);
  }

  delayOf(v: Vehicle): Delay { return delayFromSeconds(v.tripId ? this.tripUpdates.get(v.tripId)?.delaySeconds : null); }
  /** La parada tiene al menos una ruta que se detiene en ella (hay paradas del archivo sin servicio). */
  isServed(id: string): boolean {
    if (!this.served) { this.served = new Set(); for (const shapes of this.network.shapes.values()) for (const sh of shapes) for (const sid of sh.stopIds) this.served.add(sid); }
    return this.served.has(id);
  }
  /** Paradas por las que pasan rutas troncales o duales (donde el nombre trae vagón o plataforma). */
  isTrunkStop(id: string): boolean {
    if (!this.trunk) {
      this.trunk = new Set();
      for (const [rid, shapes] of this.network.shapes) {
        const sys = this.network.routes.get(rid)?.system;
        if (sys === "troncal" || sys === "dual") for (const sh of shapes) for (const sid of sh.stopIds) this.trunk.add(sid);
      }
    }
    return this.trunk.has(id);
  }
  /** Nombre limpio de la parada y su vagón (estaciones) o plataforma (portales). */
  labelOf(stop: Stop): StopLabel {
    let l = this.labels.get(stop.id);
    if (!l) { l = parseStopName(stop.name, this.isTrunkStop(stop.id)); this.labels.set(stop.id, l); }
    return l;
  }

  /** Dónde va el bus dentro del recorrido de su ruta: su última parada, la lista de paradas y su posición en ella. */
  sequenceOf(v: Vehicle): { shape: RouteShape; index: number } | undefined {
    if (!v.lastStopId) return undefined;
    const key = `${v.routeId}|${v.lastStopId}`;
    let hit = this.seq.get(key);
    if (hit === undefined) {
      hit = null;
      for (const shape of this.network.shapes.get(v.routeId) ?? []) {
        const index = shape.stopIds.indexOf(v.lastStopId);
        if (index >= 0) { hit = { shape, index }; break; }
      }
      this.seq.set(key, hit);
    }
    return hit ?? undefined;
  }
  /** La parada que sigue (la última que informa TransMilenio ya la pasó) y la hora estimada de llegada, en segundos desde 1970. */
  nextStopOf(v: Vehicle, nowMs = Date.now()): { stopId: string; stop?: Stop; arrivalAt?: number } | undefined {
    const seq = this.sequenceOf(v);
    const stopId = seq?.shape.stopIds[seq.index + 1];
    if (!seq || !stopId) return undefined;
    return { stopId, stop: this.stopById(stopId), arrivalAt: arrivalAtIndex(this, v, seq.shape, seq.index, seq.index + 1, nowMs) };
  }

  /** Saca de la flota los buses que llevan mucho sin reportar. Hay que llamarlo aunque no lleguen datos nuevos. */
  dropStale(nowMs: number): void {
    if (this.fleet.dropReportedBefore(nowMs / 1000 - MAX_REPORT_AGE_S)) { this.resolveSystems(); this.touch(); }
  }

  applyPositions(reports: readonly VehicleReport[], nowMs: number): void {
    this.fleet.ingest(reports.filter((r) => r.reportedAt >= nowMs / 1000 - MAX_REPORT_AGE_S), nowMs);
    let latest = this.lastBatchAt ?? 0;
    for (const r of reports) if (r.reportedAt > latest) latest = r.reportedAt;
    if (latest) this.lastBatchAt = latest;
    this.resolveSystems();
    this.travelTimes.observe(this);
    this.touch();
  }

  applyTripUpdates(updates: readonly TripUpdate[]): void {
    this.tripUpdates = new Map(updates.map((u) => [u.tripId, u]));
    this.touch();
  }

  applyAlerts(alerts: readonly ServiceAlert[], nowMs: number = Date.now()): void {
    // solo los avisos vigentes: los vencidos (o que aún no empiezan) no le sirven a nadie
    this.alerts = alerts.filter((a) => isAlertActive(a, nowMs / 1000));
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
    this.seq.clear(); this.trunk = null; this.served = null; this.labels.clear();
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
