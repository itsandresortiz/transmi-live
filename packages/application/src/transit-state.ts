import {
  Fleet, type Delay, type Route, type ServiceAlert, type Stop, type SystemType, type TripUpdate, type Vehicle, type RouteShape,
  type VehicleReport, type StopLabel, TransitNetwork, delayFromSeconds, inferSystemFromReport, isAlertActive, parseStopName, MAX_REPORT_AGE_S,
} from "@transmi/domain";
import { arrivalAtIndex, displayNextIndex, shapeStops } from "./eta";
import { type RouteDayStatus, ServiceEnds, type ServiceMark } from "./service-ends";
import { Departures } from "./departures";
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
  /** Última vez (ms) que la consulta falló (sin red o sin respuesta) y cuántas van seguidas. */
  lastPollFailAt: number | null = null;
  pollFailures = 0;
  source: FeedSource | null = null;
  version = 0;
  /** Lo que se ha aprendido de cuánto tarda cada ruta por parada. */
  readonly travelTimes = new TravelTimes();
  /** Primer y último viaje de cada ruta, para marcar «último servicio». */
  readonly serviceEnds = new ServiceEnds();
  readonly departures = new Departures();
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

  setDepartures(data: Parameters<Departures["load"]>[0]): void { this.departures.load(data); this.touch(); }
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

  /** La «última parada» que informa TransMilenio suele estar mal (hoy, ~9 de cada 10 buses van a más de 1 km de ella, a veces a más de 10 km: es la de otro tramo del día).
   *  Si no concuerda con dónde está el bus sobre el recorrido, se reemplaza por la última parada que de verdad pasó, calculada con su posición; así todo lo que se apoya en ella
   *  (próxima parada, llegadas, tiempos aprendidos) parte de un dato verdadero. */
  private fixedStops = new Map<string, { reportedAt: number; stopId?: string; clear?: boolean }>();
  private reconcileLastStops(): void {
    if (!this.network.shapes.size) return;
    for (const v of this.fleet.values()) {
      if (!v.lastStopId) continue;      // sin parada informada no se inventa una: solo se corrige la que viene mal
      const memo = this.fixedStops.get(v.id);
      if (memo && memo.reportedAt === v.reportedAt) { if (memo.stopId) v.lastStopId = memo.stopId; else if (memo.clear) v.lastStopId = undefined; continue; }      // mismo reporte: ya se revisó
      let fix: string | undefined;
      const reported = this.sequenceByStop(v);
      const info = reported ? shapeStops(this, reported.shape) : null;
      const hit = info ? info.path.project(v.world, 0, 0, 300) : null;
      // concuerda si el bus va por el tramo que sigue a esa parada. Si el recorrido existe pero el bus anda a más de 300 m de él (va a un patio, cambió de ruta), la parada informada no es creíble.
      const agrees = reported && info ? !!hit && hit.s >= info.s[reported.index]! - 150 && hit.s <= (info.s[reported.index + 1] ?? Infinity) + 150 : !!reported;     // sin recorrido con qué comprobarlo, se deja la informada
      if (!agrees) { const pos = this.sequenceByPosition(v); if (pos) fix = pos.shape.stopIds[pos.index]; }
      // si no concuerda y tampoco se pudo ubicar por su posición, el dato está mal y no hay con qué reemplazarlo: se quita (mejor «sin próxima parada» que anunciar una a kilómetros)
      const clear = !agrees && !fix;
      if (fix) v.lastStopId = fix; else if (clear) v.lastStopId = undefined;
      this.fixedStops.set(v.id, { reportedAt: v.reportedAt, stopId: fix, clear });
    }
    if (this.fixedStops.size > this.fleet.size * 2) for (const id of this.fixedStops.keys()) if (!this.fleet.get(id)) this.fixedStops.delete(id);
  }

  /** Dónde va el bus dentro del recorrido de su ruta: su última parada, la lista de paradas y su posición en ella. */
  sequenceOf(v: Vehicle): { shape: RouteShape; index: number } | undefined {
    return this.sequenceByStop(v);
  }
  /** Dónde va el bus para mostrárselo al usuario: por su última parada y, si esa no sirve, por su posición sobre el recorrido. */
  sequenceForDisplay(v: Vehicle): { shape: RouteShape; index: number } | undefined { return this.sequenceOf(v) ?? this.sequenceByPosition(v); }
  /** Si la última parada informada no sirve (no está en el trazado de su ruta), se ubica al bus por dónde va: el recorrido más cercano a él y la última parada que ya pasó. */
  private sequenceByPosition(v: Vehicle): { shape: RouteShape; index: number } | undefined {
    const tripRoute = v.tripId?.split(".").pop();
    const ux = v.bearing != null ? Math.sin((v.bearing * Math.PI) / 180) : 0, uy = v.bearing != null ? -Math.cos((v.bearing * Math.PI) / 180) : 0;
    let best: { shape: RouteShape; index: number; dist: number } | undefined;
    for (const rid of tripRoute && tripRoute !== v.routeId ? [v.routeId, tripRoute] : [v.routeId]) {
      for (const shape of this.network.shapes.get(rid) ?? []) {
        const info = shapeStops(this, shape);
        const hit = info?.path.projectAlong(v.world, ux, uy, 40);      // la pasada que va en el sentido del bus (ida y vuelta por la misma calle)
        if (!info || !hit || (v.bearing != null && !hit.forward)) continue;      // sin rumbo conocido se acepta el sentido que sea; con rumbo, solo el que coincide
        let index = -1;
        for (let i = 0; i < info.s.length; i++) if (info.s[i]! <= hit.s + 10) index = i; else break;
        if (index < 0 || index >= shape.stopIds.length - 1) continue;
        if (!best || hit.dist < best.dist) best = { shape, index, dist: hit.dist };
      }
      if (best) break;
    }
    return best ? { shape: best.shape, index: best.index } : undefined;
  }
  private sequenceByStop(v: Vehicle): { shape: RouteShape; index: number } | undefined {
    if (!v.lastStopId) return undefined;
    const key = `${v.routeId}|${v.lastStopId}|${v.tripId?.split(".").pop() ?? ""}`;
    let hit = this.seq.get(key);
    if (hit === undefined) {
      hit = null;
      // la ruta que informa TransMilenio a veces no es la del viaje: si la parada no está en su trazado, se prueba con la ruta que nombra el viaje (último tramo de su código)
      const tripRoute = v.tripId?.split(".").pop();
      for (const rid of tripRoute && tripRoute !== v.routeId ? [v.routeId, tripRoute] : [v.routeId]) {
        for (const shape of this.network.shapes.get(rid) ?? []) {
          const index = shape.stopIds.indexOf(v.lastStopId);
          if (index >= 0) { hit = { shape, index }; break; }
        }
        if (hit) break;
      }
      this.seq.set(key, hit);
    }
    return hit ?? undefined;
  }
  /** La parada que sigue (la última que informa TransMilenio ya la pasó) y la hora estimada de llegada, en segundos desde 1970. */
  nextStopOf(v: Vehicle, nowMs = Date.now(), byPosition = true): { stopId: string; stop?: Stop; arrivalAt?: number } | undefined {
    const seq = byPosition ? this.sequenceForDisplay(v) : this.sequenceOf(v);   // por posición solo para mostrar; el movimiento de los buses pide solo la parada informada
    if (!seq) return undefined;
    // para mostrar se salta la parada que el bus ya debió pasar; el motor de movimiento pide la que sigue a la informada, sin saltos
    const j = byPosition ? displayNextIndex(this, v, seq.shape, seq.index, nowMs) : seq.index + 1;
    const stopId = seq.shape.stopIds[j];
    if (!stopId) return undefined;
    return { stopId, stop: this.stopById(stopId), arrivalAt: arrivalAtIndex(this, v, seq.shape, seq.index, j, nowMs) };
  }

  /** Saca de la flota los buses que llevan mucho sin reportar. Hay que llamarlo aunque no lleguen datos nuevos. */
  dropStale(nowMs: number): void {
    if (this.fleet.dropReportedBefore(nowMs / 1000 - MAX_REPORT_AGE_S)) { this.resolveSystems(); this.touch(); }
  }

  applyPositions(reports: readonly VehicleReport[], nowMs: number): void {
    this.fleet.ingest(reports.filter((r) => r.reportedAt >= nowMs / 1000 - MAX_REPORT_AGE_S), nowMs);
    this.reconcileLastStops();
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
    this.seq.clear(); this.trunk = null; this.served = null; this.labels.clear(); this.fixedStops.clear();
    this.resolveSystems();
    this.reconcileLastStops();
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
