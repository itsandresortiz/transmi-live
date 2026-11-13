import { routeTitle, type Route, type SystemType, type Vehicle, type ServiceAlert, type Stop, alertSeverity } from "@transmi/domain";
import { arrivalOrPassed, hav } from "./eta";
import type { TransitState } from "./transit-state";

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

const collator = new Intl.Collator("es", { numeric: true });
const routeText = new WeakMap<Route, string>();
const textOf = (r: Route): string => { let t = routeText.get(r); if (t === undefined) { t = normalize(`${r.shortName} ${r.longName} ${routeTitle(r)}`); routeText.set(r, t); } return t; };
const headsignText = new WeakMap<string[], string[]>();
const headsignsOf = (hs: string[]): string[] => { let t = headsignText.get(hs); if (!t) { t = hs.map(normalize); headsignText.set(hs, t); } return t; };

const SYSTEM_ORDER: Record<SystemType, number> = { troncal: 0, dual: 1, alimentador: 2, zonal: 3, otro: 4 };

/** Qué tan bien responde una ruta a lo que se escribió (menos es mejor): el nombre exacto primero («7» → la ruta 7, no las cien que
 *  tienen un 7 en el nombre), luego las que empiezan así, las que lo contienen en el nombre y, al final, las que solo coinciden por
 *  su destino o descripción. */
function matchRank(r: Route, q: string): number {
  const sn = normalize(r.shortName);
  if (sn === q) return 0;
  if (sn.startsWith(q)) return 1;
  if (sn.includes(q)) return 2;
  return 3;
}

/** Rutas que responden a la búsqueda. Sin texto, las de más buses primero. Con texto, por qué tan bien coinciden (`matchRank`) y,
 *  entre iguales, troncales antes que zonales y las de más buses primero. Busca por nombre y por destino.
 *  `mergeDirections`: TransMilenio publica cada sentido como una ruta aparte con el mismo nombre; con esto sale una sola por nombre
 *  (la del sentido con más buses), para no mostrar dos «7» iguales. */
export function searchRoutes(state: TransitState, o: { query?: string; system?: SystemType | null; mergeDirections?: boolean } = {}): Route[] {
  const q = normalize((o.query ?? "").trim());
  const counts = vehiclesByRoute(state);
  const n = (r: Route) => counts.get(r.id) ?? 0;
  let list = state.routes()
    .filter((r) => {
      if (o.system && r.system !== o.system) return false;
      if (!q) return true;
      if (textOf(r).includes(q)) return true;
      const hs = state.network.headsigns.get(r.id);
      return !!hs && headsignsOf(hs).some((h) => h.includes(q));
    });
  // buses de la ruta contando sus dos sentidos (para ordenar): así el sentido con pocos buses no hunde a la ruta
  const total = new Map<string, number>();
  const key = (r: Route) => `${r.system}|${r.shortName}`;
  for (const r of list) total.set(key(r), (total.get(key(r)) ?? 0) + n(r));
  if (o.mergeDirections) {
    const best = new Map<string, Route>();
    for (const r of list) { const cur = best.get(key(r)); if (!cur || n(r) > n(cur)) best.set(key(r), r); }
    list = [...best.values()];
  }
  const byBuses = (a: Route, b: Route) => (total.get(key(b)) ?? 0) - (total.get(key(a)) ?? 0) || collator.compare(a.shortName, b.shortName) || n(b) - n(a);
  if (!q) return list.sort(byBuses);
  return list.sort((a, b) => matchRank(a, q) - matchRank(b, q) || (matchRank(a, q) <= 1 ? SYSTEM_ORDER[a.system] - SYSTEM_ORDER[b.system] : 0) || byBuses(a, b));
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

/** Una estación o portal: todas sus paradas (vagones o plataformas) agrupadas bajo un nombre. */
export interface StopGroup { key: string; title: string; stops: Stop[]; position: { lat: number; lon: number } }

const LINK_METERS = 200;
const titleKeys = new WeakMap<Stop, string>();
function keyOf(state: TransitState, stop: Stop): string {
  let k = titleKeys.get(stop);
  if (k === undefined) { k = normalize(state.labelOf(stop).title).replace(/^(la|el|los|las)\s+/, ""); titleKeys.set(stop, k); }   // «Campiña» y «La Campiña» son la misma estación
  return k;
}
/** Ordena las paradas de una estación: vagón 1, 2, 3…, luego plataformas, luego el resto. */
export function sortStationStops(state: TransitState, stops: Stop[]): Stop[] {
  const rank = (s: Stop) => { const l = state.labelOf(s); return l.wagon ?? (l.platform ? 100 : 200); };
  return stops.slice().sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "es", { numeric: true }));
}

/** Une en una misma estación las paradas de igual nombre que están encadenadas a menos de 200 m (una estación puede medir 400 m). */
function clusterStops(state: TransitState, stops: Stop[]): Stop[][] {
  const byKey = new Map<string, Stop[]>();
  for (const s of stops) { const k = keyOf(state, s); const l = byKey.get(k); l ? l.push(s) : byKey.set(k, [s]); }
  const out: Stop[][] = [];
  for (const list of byKey.values()) {
    const left = list.slice();
    while (left.length) {
      const cluster = [left.pop()!];
      for (let i = 0; i < cluster.length; i++) {
        for (let j = left.length - 1; j >= 0; j--) if (hav(cluster[i]!.position, left[j]!.position) <= LINK_METERS) cluster.push(left.splice(j, 1)[0]!);
      }
      out.push(cluster);
    }
  }
  return out;
}

/** Nombres nuevos de estaciones: a veces TransMilenio agrega una parada sin rutas (p. ej. «Calle 53 - Universidad Manuela Beltrán») justo donde ya está una estación con otro nombre («Calle 53»).
 *  Si el nombre de esa parada empieza por el de la estación y queda a menos de 80 m de uno de sus vagones, se usa como nombre completo de la estación. */
const aliasCache = new WeakMap<object, Map<string, string>>();
/** Otros nombres con los que TransMilenio conoce el lugar de una estación (paradas sin rutas pegadas a ella, p. ej. «Marly» donde hoy está «Calle 53»): solo sirven para encontrarla al buscar. */
const otherNamesCache = new WeakMap<object, Map<string, string[]>>();
const otherNames = (state: TransitState, title: string): string[] => { stationAliases(state); return otherNamesCache.get(state.network)?.get(normalize(title)) ?? []; };
function stationAliases(state: TransitState): Map<string, string> {
  let out = aliasCache.get(state.network);
  if (out) return out;
  out = new Map();
  const others = new Map<string, string[]>();
  otherNamesCache.set(state.network, others);
  if (state.network.shapes.size) {
    const wagons = [...state.network.stops.values()].filter((s) => state.isServed(s.id) && state.labelOf(s).wagon);
    for (const stop of state.network.stops.values()) {
      if (state.isServed(stop.id) || !stop.name || stop.code) continue;      // solo registros nuevos sin código y sin rutas (las paradas del SITP siempre traen código)
      const alias = stop.name.trim(), a = normalize(alias);
      for (const w of wagons) {
        if (Math.abs(w.position.lat - stop.position.lat) > 80 / 111_000 || hav(w.position, stop.position) > 80) continue;
        const title = state.labelOf(w).title, t = normalize(title);
        if (t && a.length > t.length && a.startsWith(t) && !out.has(t)) out.set(t, alias);
        else if (t && a !== t && hav(w.position, stop.position) <= 40) { const l = others.get(t) ?? others.set(t, []).get(t)!; if (!l.includes(alias)) l.push(alias); }
      }
    }
  }
  aliasCache.set(state.network, out);
  return out;
}
export const stationTitle = (state: TransitState, title: string): string => stationAliases(state).get(normalize(title)) ?? title;

/** Busca estaciones y paradas por nombre. Los vagones y plataformas de una misma estación salen juntos, no repetidos. */
export function searchStopGroups(state: TransitState, query: string, limit = 40): StopGroup[] {
  const q = normalize(query.trim());
  if (!q) return [];
  const hits: Stop[] = [];
  for (const stop of state.network.stops.values()) {
    if (state.network.shapes.size && !state.isServed(stop.id)) continue;      // sin ninguna ruta: no sirve para el usuario
    if (normalize(`${stop.name} ${stop.code}`).includes(q) || (state.labelOf(stop).wagon && normalize(`${stationTitle(state, state.labelOf(stop).title)} ${otherNames(state, state.labelOf(stop).title).join(" ")}`).includes(q))) hits.push(stop);
  }
  const groups = clusterStops(state, hits).map((stops): StopGroup => {
    const sorted = sortStationStops(state, stops);
    return { key: keyOf(state, sorted[0]!), title: stationTitle(state, state.labelOf(sorted[0]!).title), stops: sorted, position: sorted[0]!.position };
  });
  // primero las estaciones y portales (con vagones o plataformas), luego las más grandes
  const trunkish = (g: StopGroup) => (g.stops.some((s) => state.labelOf(s).wagon || state.labelOf(s).platform) ? 0 : 1);
  groups.sort((a, b) => trunkish(a) - trunkish(b) || b.stops.length - a.stops.length || a.title.localeCompare(b.title, "es"));
  return groups.slice(0, limit);
}

/** Las demás paradas de la misma estación (otros vagones o plataformas), incluida ésta. */
export function siblingStops(state: TransitState, stop: Stop): Stop[] {
  const key = keyOf(state, stop), near: Stop[] = [];
  for (const s of state.network.stops.values()) {
    if (Math.abs(s.position.lat - stop.position.lat) > 1200 / 111_000) continue;
    if (keyOf(state, s) === key && (!state.network.shapes.size || state.isServed(s.id))) near.push(s);
  }
  const cluster = clusterStops(state, near).find((c) => c.some((s) => s.id === stop.id)) ?? [stop];
  return sortStationStops(state, cluster);
}

const routesAtStopCache = new WeakMap<object, Map<string, Route[]>>();
/** Rutas que paran en una parada. Se arma una sola vez por red (antes se recorrían todos los recorridos en cada consulta, y las pantallas de parada lo piden cada segundo). */
export function routesAtStop(state: TransitState, stopId: string): Route[] {
  let index = routesAtStopCache.get(state.network);
  if (!index) {
    index = new Map();
    for (const [routeId, shapes] of state.network.shapes) {
      const r = state.routeById(routeId); if (!r) continue;
      const seen = new Set<string>();
      for (const sh of shapes) for (const id of sh.stopIds) { if (seen.has(id)) continue; seen.add(id); (index.get(id) ?? index.set(id, []).get(id)!).push(r); }
    }
    routesAtStopCache.set(state.network, index);
  }
  return index.get(stopId) ?? [];
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

/** Para cada ruta que pasa por la parada: los próximos buses que vienen hacia ella, con su hora estimada de llegada.
 *  Un bus «viene» si su última parada queda antes que ésta en su recorrido (si ya la pasó, no cuenta). */
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
        if (!v.lastStopId) continue;
        const k = shape.stopIds.indexOf(v.lastStopId);
        if (k < 0 || k >= j) continue;                       // ya la pasó (o está en ella) o va por otro sentido
        const etaAt = arrivalOrPassed(state, v, shape, k, j, nowSec * 1000);
        if (etaAt == null) continue;                         // la cuenta venció hace rato: lo más probable es que ya pasó por esta parada
        buses.push({ vehicle: v, etaAt, official: false, stopsAway: j - k });
      }
      if (!buses.length) continue;
      buses.sort((a, b) => a.etaAt - b.etaAt);
      out.push({ route, headsign: shape.headsign, direction: shape.direction, buses: buses.slice(0, perRoute) });
    }
  }
  return out.sort((a, b) => a.buses[0]!.etaAt - b.buses[0]!.etaAt);
}

/* ---------- cerca de mí y avisos que te importan ---------- */

export interface NearbyStop { stop: Stop; meters: number }
/** Paradas más cercanas a un punto (una por nombre: la más próxima). */
export function nearestStops(state: TransitState, p: { lat: number; lon: number }, count = 6, maxMeters = 1200): NearbyStop[] {
  const out: NearbyStop[] = [];
  for (const stop of state.network.stops.values()) {
    const dLat = Math.abs(stop.position.lat - p.lat);
    if (dLat > maxMeters / 111_000) continue;
    // el GTFS trae un registro «de la estación» en medio de cada estación o portal, sin código ni rutas: no es una parada donde pare un bus
    if (state.network.shapes.size && !state.isServed(stop.id)) continue;
    const m = hav(stop.position, p);
    if (m <= maxMeters) out.push({ stop, meters: m });
  }
  out.sort((a, b) => a.meters - b.meters);
  const seen = new Set<string>(), res: NearbyStop[] = [];
  for (const n of out) { const k = keyOf(state, n.stop); if (seen.has(k)) continue; seen.add(k); res.push(n); if (res.length >= count) break; }
  return res;
}

/** Avisos que tocan alguna de estas rutas o paradas. */
export function alertsFor(state: TransitState, routeIds: ReadonlySet<string>, stopIds: ReadonlySet<string>): { alert: ServiceAlert; index: number }[] {
  return searchAlerts(state).filter(({ alert }) => alert.routeIds.some((r) => routeIds.has(r)) || alert.stopIds.some((s) => stopIds.has(s)));
}

/** Rutas que pasan por alguna de estas paradas. */
export function routeIdsAtStops(state: TransitState, stopIds: readonly string[]): Set<string> {
  const want = new Set(stopIds), out = new Set<string>();
  for (const [rid, shapes] of state.network.shapes) if (shapes.some((s) => s.stopIds.some((id) => want.has(id)))) out.add(rid);
  return out;
}


/** Estación de la troncal: sus vagones agrupados. Se calcula una vez por red cargada. */
export interface Station { title: string; stops: Stop[] }
const stationCache = new WeakMap<object, Station[]>();
export function trunkStations(state: TransitState): Station[] {
  let out = stationCache.get(state.network);
  if (!out) {
    const wagonStops = [...state.network.stops.values()].filter((s) => state.isServed(s.id) && state.labelOf(s).wagon);
    out = clusterStops(state, wagonStops).map((stops) => { const sorted = sortStationStops(state, stops); return { title: stationTitle(state, state.labelOf(sorted[0]!).title), stops: sorted }; });
    stationCache.set(state.network, out);
  }
  return out;
}

/* ---------- cada cuánto está pasando una ruta ahora ---------- */

/** Con las horas de llegada de los próximos buses de una ruta a una parada (en vivo), dice cada cuánto están pasando y si hay un hueco antes del primero.
 *  Devuelve un texto listo para mostrar, o `undefined` si con un solo bus cercano no hay nada que decir. */
export function frequencyText(etas: readonly number[], nowSec: number): string | undefined {
  const t = etas.filter((e) => e >= nowSec - 30).slice().sort((a, b) => a - b);
  if (!t.length) return undefined;
  const mins = (s: number) => Math.max(1, Math.round(s / 60));
  const gaps = t.slice(1).map((e, i) => e - t[i]!).sort((a, b) => a - b);
  const every = gaps.length ? gaps[gaps.length >> 1]! : undefined;                 // intervalo típico entre los que vienen
  const wait = t[0]! - nowSec;
  // hueco: el primero tarda bastante y mucho más que el ritmo de los que vienen detrás (o es el único que viene)
  if (wait >= 12 * 60 && (every == null || wait >= every * 2)) return every != null ? `Hay un hueco: el próximo tarda ~${mins(wait)} min; después pasan cada ~${mins(every)} min.` : `Hay un hueco: el próximo tarda ~${mins(wait)} min y no viene otro cerca.`;
  if (every == null) return undefined;
  if (every < 90) return "Ahora vienen varios seguidos.";
  return `Ahora pasa cada ~${mins(every)} min.`;
}
