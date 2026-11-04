import { type Route, type SystemType, type Vehicle, type ServiceAlert, type Stop, alertSeverity } from "@transmi/domain";
import type { Arrival, TransitState } from "./transit-state";

export const normalize = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export interface Kpis { vehicles: number; routes: number; late: number; alerts: number }
export function kpis(state: TransitState): Kpis {
  const routes = new Set<string>();
  let late = 0, n = 0;
  for (const v of state.fleet.values()) {
    n++;
    if (v.routeId) routes.add(v.routeId);
    const d = state.delayOf(v);
    if (d.kind === "late" && d.severe) late++;
  }
  return { vehicles: n, routes: routes.size, late, alerts: state.alerts.length };
}

export function vehiclesByRoute(state: TransitState): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of state.fleet.values()) m.set(v.routeId, (m.get(v.routeId) ?? 0) + 1);
  return m;
}

/** Rutas ordenadas por cantidad de buses; busca por nombre y por destino. */
export function searchRoutes(state: TransitState, o: { query?: string; system?: SystemType | null } = {}): Route[] {
  const q = normalize((o.query ?? "").trim());
  const counts = vehiclesByRoute(state);
  return state.routes()
    .filter((r) => {
      if (o.system && r.system !== o.system) return false;
      if (!q) return true;
      if (normalize(`${r.shortName} ${r.longName}`).includes(q)) return true;
      return (state.network.headsigns.get(r.id) ?? []).some((h) => normalize(h).includes(q));
    })
    .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.shortName.localeCompare(b.shortName, "es", { numeric: true }));
}

/** Retraso en segundos para ordenar (los desconocidos al final). */
const lateness = (state: TransitState, v: Vehicle) => state.delayOf(v).seconds ?? -1e9;

export function listVehicles(state: TransitState, o: { query?: string; system?: SystemType | null; lateOnly?: boolean; routeId?: string } = {}): Vehicle[] {
  const q = normalize((o.query ?? "").trim());
  const out: Vehicle[] = [];
  for (const v of state.fleet.values()) {
    if (o.routeId && v.routeId !== o.routeId) continue;
    if (o.system && v.system !== o.system) continue;
    if (o.lateOnly) { const d = state.delayOf(v); if (!(d.kind === "late" && d.severe)) continue; }
    if (q) {
      const r = state.routeOf(v);
      if (!normalize(`${v.plate ?? ""} ${v.label ?? ""} ${r?.shortName ?? v.routeId} ${r?.longName ?? ""}`).includes(q)) continue;
    }
    out.push(v);
  }
  return out.sort((a, b) => {
    if (q) {
      const pa = normalize(a.plate ?? "").startsWith(q) ? 0 : 1, pb = normalize(b.plate ?? "").startsWith(q) ? 0 : 1;
      if (pa !== pb) return pa - pb;
    }
    return lateness(state, b) - lateness(state, a);
  });
}

export function searchStops(state: TransitState, query: string, limit = 60): Stop[] {
  const q = normalize(query.trim());
  if (!q) return [];
  const out: Stop[] = [];
  for (const s of state.network.stops.values()) {
    if (normalize(`${s.name} ${s.code}`).includes(q)) { out.push(s); if (out.length >= limit) break; }
  }
  return out;
}

export function arrivalsAt(state: TransitState, stopId: string, limit = 6): Arrival[] {
  return (state.arrivalsByStop.get(stopId) ?? []).slice().sort((a, b) => (a.arrivalAt ?? 0) - (b.arrivalAt ?? 0)).slice(0, limit);
}

export function routesAtStop(state: TransitState, stopId: string): Route[] {
  const out: Route[] = [];
  for (const [routeId, shapes] of state.network.shapes) {
    if (shapes.some((s) => s.stopIds.includes(stopId))) { const r = state.routeById(routeId); if (r) out.push(r); }
  }
  return out;
}

export function searchAlerts(state: TransitState, query = ""): { alert: ServiceAlert; index: number }[] {
  const q = normalize(query.trim());
  return state.alerts
    .map((alert, index) => ({ alert, index }))
    .filter(({ alert }) => !q || normalize([alert.headline, alert.description, ...alert.routeIds.map((id) => state.routeById(id)?.shortName ?? id)].join(" ")).includes(q))
    .sort((x, y) => alertSeverity(x.alert.effect) - alertSeverity(y.alert.effect) || y.alert.routeIds.length - x.alert.routeIds.length);
}

export interface RouteDetail {
  route: Route;
  vehicles: Vehicle[];
  averageDelaySeconds: number | null;
  alerts: { alert: ServiceAlert; index: number }[];
}
export function routeDetail(state: TransitState, routeId: string): RouteDetail | undefined {
  const route = state.routeById(routeId);
  if (!route) return undefined;
  const vehicles = listVehicles(state, { routeId });
  const delays = vehicles.map((v) => state.delayOf(v).seconds).filter((d): d is number => d != null);
  return {
    route, vehicles,
    averageDelaySeconds: delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : null,
    alerts: (state.alertsByRoute.get(routeId) ?? []).map((i) => ({ alert: state.alerts[i]!, index: i })),
  };
}

/* ---------- próximos buses en una parada ---------- */

export interface UpcomingBus {
  vehicle: Vehicle;
  /** Hora de llegada a la parada (segundos desde 1970). */
  etaAt: number;
  /** `true` si es la hora oficial de TransMilenio (el bus va hacia esa parada); si no, es un cálculo. */
  official: boolean;
  /** Paradas que le faltan hasta llegar (1 = la siguiente). */
  stopsAway: number;
}
export interface UpcomingRoute { route: Route; headsign: string; direction: string; buses: UpcomingBus[] }

/** Tiempo medio por parada (frenar, subir/bajar gente y arrancar), medido con lotes reales de cada sistema. */
export const SECONDS_PER_STOP: Record<SystemType, number> = { troncal: 58, dual: 58, alimentador: 62, zonal: 50, otro: 55 };
const CRUISE_MPS = 18;        // velocidad entre paradas: casi no pesa frente al tiempo en cada parada
const DETOUR_FACTOR = 1.15;   // la calle es más larga que la línea recta entre paradas

function hav(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Estima cuántos segundos tarda un bus en ir de la parada `from` a la parada `to` de su recorrido.
 *  Se calibró con lotes reales: el tiempo lo domina el número de paradas, no la distancia ni la velocidad del momento. */
export function estimateTravelSeconds(state: TransitState, v: Vehicle, stopIds: readonly string[], from: number, to: number): number {
  let meters = 0;
  for (let i = from; i < to; i++) {
    const a = state.stopById(stopIds[i]), b = state.stopById(stopIds[i + 1]);
    if (a && b) meters += hav(a.position, b.position) * DETOUR_FACTOR;
  }
  return meters / CRUISE_MPS + (to - from) * SECONDS_PER_STOP[v.system];
}

/** Para cada ruta que pasa por la parada: los próximos buses que vienen hacia ella, con su hora de llegada. */
export function upcomingAtStop(state: TransitState, stopId: string, nowSec: number, perRoute = 3): UpcomingRoute[] {
  const out: UpcomingRoute[] = [];
  const byRoute = new Map<string, Vehicle[]>();
  for (const v of state.fleet.values()) { const l = byRoute.get(v.routeId); l ? l.push(v) : byRoute.set(v.routeId, [v]); }
  for (const [routeId, shapes] of state.network.shapes) {
    const route = state.routeById(routeId);
    const vehicles = byRoute.get(routeId);
    if (!route || !vehicles) continue;
    for (const shape of shapes) {
      const j = shape.stopIds.indexOf(stopId);
      if (j < 0) continue;
      const buses: UpcomingBus[] = [];
      for (const v of vehicles) {
        if (!v.nextStopId) continue;
        const k = shape.stopIds.indexOf(v.nextStopId);
        if (k < 0 || k > j) continue;
        const tu = v.tripId ? state.tripUpdates.get(v.tripId) : undefined;
        const nextAt = tu?.nextStop?.stopId === v.nextStopId && tu.nextStop.arrivalAt ? tu.nextStop.arrivalAt : undefined;
        if (k === j) {
          if (nextAt == null) continue;
          buses.push({ vehicle: v, etaAt: nextAt, official: true, stopsAway: 1 });
        } else {
          const base = nextAt ?? nowSec + 20;
          buses.push({ vehicle: v, etaAt: Math.max(base, nowSec) + estimateTravelSeconds(state, v, shape.stopIds, k, j), official: false, stopsAway: j - k + 1 });
        }
      }
      if (!buses.length) continue;
      buses.sort((a, b) => a.etaAt - b.etaAt);
      out.push({ route, headsign: shape.headsign, direction: shape.direction, buses: buses.slice(0, perRoute) });
    }
  }
  return out.sort((a, b) => a.buses[0]!.etaAt - b.buses[0]!.etaAt);
}
