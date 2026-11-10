import { type GeoPoint, type Route, type RouteShape, RoadPath, type SystemType, toWorld } from "@transmi/domain";
import { hav } from "./eta";
import type { TransitState } from "./transit-state";
import { searchStopGroups, upcomingAtStop } from "./queries";

/* ====================================================================================================
 *  Planificador de viajes.
 *
 *  Busca cómo ir de un punto a otro combinando caminata y rutas (troncal, dual, alimentadora y zonal), con trasbordos.
 *  Método: RAPTOR (rondas por número de viajes en bus) sobre los recorridos del GTFS.
 *   - Tiempo en bus entre paradas: el mismo modelo del cálculo de llegadas (segundos por parada de cada sistema + distancia).
 *   - Espera al subir: en el primer bus, la llegada real de los buses en vivo; en los trasbordos, la mitad del intervalo entre
 *     buses de esa ruta, que se estima con cuántos buses hay circulando ahora.
 *   - Caminata: línea recta con un factor por las calles (1,25) a 1,25 m/s.
 *   - Rutas sin servicio hoy (según el horario programado) no se usan.
 *  Para dar varias opciones distintas se repite la búsqueda prohibiendo la ruta que más se usa en la mejor opción.
 * ==================================================================================================== */

export interface PlanPlace { name: string; position: GeoPoint }
export interface StopRef { id: string; name: string; position: GeoPoint }

export interface WalkLeg { kind: "walk"; from: GeoPoint; to: GeoPoint; fromName: string; toName: string; meters: number; seconds: number; line: GeoPoint[] }
export interface RideLeg {
  kind: "ride"; routeId: string; shortName: string; longName: string; headsign: string; system: SystemType;
  board: StopRef; alight: StopRef; stops: number;
  /** Espera hasta que pase el bus (s) y de dónde sale ese dato. */
  waitSeconds: number; waitKind: "live" | "estimated";
  departAt: number; arriveAt: number; rideSeconds: number;
  /** Recorrido por la calle entre la parada donde se sube y donde se baja. */
  line: GeoPoint[];
  /** Cada cuántos minutos pasa más o menos (estimado con los buses que circulan). */
  headwaySeconds: number;
  /** Cuando la espera sale de un bus real: cuál es (para seguirlo en el mapa). */
  busId?: string; busLabel?: string;
  /** Paradas por las que pasa entre la de subida y la de bajada (sin incluirlas). */
  between: StopRef[];
  /** Avisos de servicio vigentes que tocan esta ruta. */
  alerts: number;
  /** Pasa con poca frecuencia (más de 15 min entre buses). */
  lowFrequency: boolean;
}
export type Leg = WalkLeg | RideLeg;

export interface Itinerary {
  legs: Leg[];
  departAt: number; arriveAt: number; seconds: number;
  walkMeters: number; walkSeconds: number; waitSeconds: number;
  /** Cambios de bus (viajes en bus − 1). */
  transfers: number;
  /** Si el primer bus se calculó con buses reales. */
  live: boolean;
  /** Etiquetas: «Más rápida», «Menos trasbordos», «Menos caminata»… */
  tags: string[];
}

export interface PlanOptions {
  nowMs?: number;
  /** Planear para otra hora (más tarde): se ignoran los buses en vivo y se usan frecuencias y horarios. */
  scheduled?: boolean;
  /** Cuánto se está dispuesto a caminar para llegar a la primera parada y desde la última (m). */
  maxAccessMeters?: number;
  maxTransfers?: number;
  /** Solo usar rutas de estos sistemas (p. ej. solo troncal y dual, o solo zonal). Sin esto, todos. */
  systems?: readonly SystemType[];
  /** Máximo de opciones a devolver. */
  limit?: number;
}

const WALK_MPS = 1.25, WALK_DETOUR = 1.25, TRANSFER_WALK_M = 260, MAX_ACCESS_M = 900;
const DETOUR = 1.15;
/** Tiempo en bus entre paradas = parada (frenar, subir y bajar) + distancia / velocidad de crucero. Con tramos largos (rutas exprés) la distancia pesa;
 *  con tramos cortos manda la parada. Los valores dan ~24 km/h en la troncal con paradas cada 700 m y ~35 km/h con tramos de 3 km. */
const RIDE_MODEL: Record<SystemType, { dwell: number; cruise: number }> = {
  troncal: { dwell: 45, cruise: 12 }, dual: { dwell: 45, cruise: 10 }, alimentador: { dwell: 40, cruise: 6.5 }, zonal: { dwell: 35, cruise: 6.5 }, otro: { dwell: 45, cruise: 8 },
};
/** Cada trasbordo se cuenta como si costara esto de más al ordenar las opciones (la gente prefiere no cambiar de bus). */
const TRANSFER_PENALTY_S = 150;
const LAYOVER_S = 240;
const DEFAULT_HEADWAY: Record<SystemType, number> = { troncal: 270, dual: 420, alimentador: 480, zonal: 660, otro: 900 };
const walkSeconds = (meters: number) => (meters * WALK_DETOUR) / WALK_MPS;
const walkMetersOf = (a: GeoPoint, b: GeoPoint) => hav(a, b) * WALK_DETOUR;

/* ---------- índice de la red (se arma una vez por GTFS) ---------- */

interface Pattern {
  routeId: string; route: Route; shape: RouteShape; shapeIndex: number;
  stops: Int32Array;          // índices de parada
  cum: Float64Array;          // segundos acumulados en bus desde la primera parada
  runSeconds: number;
}
interface Index {
  stopIds: string[]; stopIdx: Map<string, number>; lat: Float64Array; lon: Float64Array;
  patterns: Pattern[];
  /** parada → (patrón, posición) */
  atStop: { p: number; i: number }[][];
  grid: Map<string, number[]>;
  neighbors: Map<number, { s: number; sec: number }[]>;
  byRoute: Map<string, number[]>;
}
const CELL = 0.003;                                   // ~330 m
const cellKey = (lat: number, lon: number) => `${Math.floor(lat / CELL)},${Math.floor(lon / CELL)}`;
const indexCache = new WeakMap<object, Index>();

function buildIndex(state: TransitState): Index {
  const cached = indexCache.get(state.network);
  if (cached) return cached;
  const stopIds: string[] = [], stopIdx = new Map<string, number>();
  const lat: number[] = [], lon: number[] = [];
  const idxOf = (id: string): number => {
    let i = stopIdx.get(id);
    if (i != null) return i;
    const s = state.stopById(id); if (!s) return -1;
    i = stopIds.length; stopIds.push(id); stopIdx.set(id, i); lat.push(s.position.lat); lon.push(s.position.lon);
    return i;
  };
  const patterns: Pattern[] = [], byRoute = new Map<string, number[]>();
  for (const [routeId, shapes] of state.network.shapes) {
    const route = state.routeById(routeId); if (!route || route.provisional) continue;
    shapes.forEach((shape, shapeIndex) => {
      const ids = shape.stopIds.map(idxOf).filter((i) => i >= 0);
      if (ids.length < 2) return;
      const cum = new Float64Array(ids.length), model = RIDE_MODEL[route.system];
      for (let k = 1; k < ids.length; k++) {
        const a = ids[k - 1]!, b = ids[k]!;
        const m = hav({ lat: lat[a]!, lon: lon[a]! }, { lat: lat[b]!, lon: lon[b]! }) * DETOUR;
        cum[k] = cum[k - 1]! + m / model.cruise + model.dwell;
      }
      const list = byRoute.get(routeId) ?? byRoute.set(routeId, []).get(routeId)!;
      list.push(patterns.length);
      patterns.push({ routeId, route, shape, shapeIndex, stops: Int32Array.from(ids), cum, runSeconds: cum[ids.length - 1]! });
    });
  }
  const atStop: { p: number; i: number }[][] = stopIds.map(() => []);
  patterns.forEach((pt, p) => pt.stops.forEach((s, i) => atStop[s]!.push({ p, i })));
  const grid = new Map<string, number[]>();
  stopIds.forEach((_, i) => { const k = cellKey(lat[i]!, lon[i]!); (grid.get(k) ?? grid.set(k, []).get(k)!).push(i); });
  const out: Index = { stopIds, stopIdx, lat: Float64Array.from(lat), lon: Float64Array.from(lon), patterns, atStop, grid, neighbors: new Map(), byRoute };
  indexCache.set(state.network, out);
  return out;
}

function stopsNear(ix: Index, p: GeoPoint, meters: number): { s: number; m: number }[] {
  const out: { s: number; m: number }[] = [];
  const r = Math.ceil(meters / 330), ci = Math.floor(p.lat / CELL), cj = Math.floor(p.lon / CELL);
  for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++)
    for (const s of ix.grid.get(`${ci + di},${cj + dj}`) ?? []) {
      if (ix.atStop[s]!.length === 0) continue;
      const m = hav(p, { lat: ix.lat[s]!, lon: ix.lon[s]! });
      if (m <= meters) out.push({ s, m });
    }
  return out;
}
function neighborsOf(ix: Index, s: number): { s: number; sec: number }[] {
  let n = ix.neighbors.get(s);
  if (!n) {
    const here = { lat: ix.lat[s]!, lon: ix.lon[s]! };
    n = stopsNear(ix, here, TRANSFER_WALK_M).filter((x) => x.s !== s).map((x) => ({ s: x.s, sec: walkSeconds(x.m) + 20 }));
    ix.neighbors.set(s, n);
  }
  return n;
}

/* ---------- datos en vivo: cuántos buses hay y qué rutas funcionan ---------- */

interface Live {
  hasLive: boolean;
  headway: Map<string, number>;          // ruta → segundos entre buses
  running: Set<string>;                  // rutas que se pueden usar ahora
}
function liveInfo(state: TransitState, ix: Index, nowMs: number, scheduled = false): Live {
  const counts = new Map<string, number>();
  for (const v of state.fleet.values()) counts.set(v.routeId, (counts.get(v.routeId) ?? 0) + 1);
  const hasLive = !scheduled && state.fleet.size >= 50;
  const headway = new Map<string, number>(), running = new Set<string>();
  for (const [routeId, list] of ix.byRoute) {
    const pat = ix.patterns[list[0]!]!, n = scheduled ? 0 : counts.get(routeId) ?? 0;
    const status = (hasLive ? state.routeStatus(routeId, nowMs) : state.serviceEnds.routeStatus(routeId, nowMs, 0))?.state;
    if (status === "ended" || status === "before") continue;                   // fuera de su horario de hoy
    if (scheduled && status === undefined) continue;                           // a otra hora, sin horario conocido no se puede asegurar que funcione
    if (hasLive && n === 0 && status !== "running") continue;                  // con datos en vivo y sin buses ni horario que la respalde
    const cycle = list.reduce((a, p) => a + ix.patterns[p]!.runSeconds, 0) + (list.length > 1 ? 2 : 1) * LAYOVER_S;
    const sched = scheduled ? state.departures.headwayAt(routeId, state.serviceEnds.dayAt(nowMs).type, state.serviceEnds.dayAt(nowMs).secs) : undefined;
    const h = sched ?? (n > 0 ? cycle / n : DEFAULT_HEADWAY[pat.route.system]);
    headway.set(routeId, Math.min(1800, Math.max(75, h)));
    running.add(routeId);
  }
  return { hasLive, headway, running };
}

/* ---------- RAPTOR ---------- */

type Parent =
  | { t: "access"; sec: number }
  | { t: "walk"; from: number; sec: number }
  | { t: "ride"; p: number; board: number; bi: number; ai: number; dep: number; arr: number; wait: number; liveWait: boolean; from: number; bus?: LiveBus };

/** Un bus real que se acerca a una parada: cuándo llega y cuál es. */
interface LiveBus { eta: number; id: string; label?: string }
interface RunResult { best: { k: number; arrive: number; stop: number }[]; parents: (Parent | undefined)[][]; tau: Float64Array[] }

function raptor(ix: Index, live: Live, origin: GeoPoint, dest: GeoPoint, nowSec: number, banned: ReadonlySet<string>,
  liveEtas: Map<number, Map<number, LiveBus[]>>, maxRounds: number, maxAccess: number): RunResult {
  const nS = ix.stopIds.length, INF = Infinity;
  const tau = Array.from({ length: maxRounds + 1 }, () => new Float64Array(nS).fill(INF));
  const parents: (Parent | undefined)[][] = Array.from({ length: maxRounds + 1 }, () => new Array<Parent | undefined>(nS));
  const bestAll = new Float64Array(nS).fill(INF);
  const egress = stopsNear(ix, dest, maxAccess).map((x) => ({ s: x.s, sec: walkSeconds(x.m) }));
  const egressSec = new Map(egress.map((e) => [e.s, e.sec]));
  let bound = INF;                                                    // mejor llegada al destino hasta ahora
  let marked = new Set<number>();

  for (const a of stopsNear(ix, origin, maxAccess)) {
    const t = nowSec + walkSeconds(a.m);
    if (t < tau[0]![a.s]!) { tau[0]![a.s] = t; parents[0]![a.s] = { t: "access", sec: walkSeconds(a.m) }; bestAll[a.s] = t; marked.add(a.s); }
  }

  const waitFor = (p: number, i: number, t: number, k: number): { dep: number; wait: number; live: boolean; bus?: LiveBus } => {
    const pat = ix.patterns[p]!, h = live.headway.get(pat.routeId) ?? DEFAULT_HEADWAY[pat.route.system];
    if (k === 1) {
      const etas = liveEtas.get(pat.stops[i]!)?.get(p);
      if (etas) {
        const next = etas.find((e) => e.eta >= t - 10);
        if (next) return { dep: Math.max(next.eta, t), wait: Math.max(0, next.eta - t), live: true, bus: next };
        // los buses vivos ya pasaron: el siguiente llega a un intervalo después del último
        const last = etas[etas.length - 1]!.eta;
        const dep = Math.max(t + h * 0.6, last + h);
        return { dep, wait: dep - t, live: false };
      }
    }
    const w = h * 0.5 + (k === 1 ? 20 : 35);
    return { dep: t + w, wait: w, live: false };
  };

  for (let k = 1; k <= maxRounds; k++) {
    const queue = new Map<number, number>();                        // patrón → posición más temprana marcada
    for (const s of marked) for (const { p, i } of ix.atStop[s]!) {
      if (!live.running.has(ix.patterns[p]!.routeId) || banned.has(ix.patterns[p]!.route.shortName)) continue;
      const cur = queue.get(p);
      if (cur == null || i < cur) queue.set(p, i);
    }
    const improved = new Set<number>();
    for (const [p, start] of queue) {
      const pat = ix.patterns[p]!;
      let board = -1, dep = 0, wait = 0, liveW = false, bus: LiveBus | undefined;
      for (let i = start; i < pat.stops.length; i++) {
        const s = pat.stops[i]!;
        if (board >= 0) {
          const arr = dep + pat.cum[i]! - pat.cum[board]!;
          if (arr < tau[k]![s]! && arr < bestAll[s]! && arr < bound) {
            tau[k]![s] = arr;
            parents[k]![s] = { t: "ride", p, board: pat.stops[board]!, bi: board, ai: i, dep, arr, wait, liveWait: liveW, from: pat.stops[board]!, bus };
            improved.add(s);
          }
        }
        const prev = tau[k - 1]![s]!;
        if (prev < INF) {
          const w = waitFor(p, i, prev, k);
          const here = board >= 0 ? dep + pat.cum[i]! - pat.cum[board]! : INF;
          if (board < 0 || w.dep < here) { board = i; dep = w.dep; wait = w.wait; liveW = w.live; bus = w.bus; }
        }
      }
    }
    // a pie entre paradas cercanas
    const walked = new Set<number>();
    for (const s of improved) for (const n of neighborsOf(ix, s)) {
      const t = tau[k]![s]! + n.sec;
      if (t < tau[k]![n.s]! && t < bestAll[n.s]! && t < bound) { tau[k]![n.s] = t; parents[k]![n.s] = { t: "walk", from: s, sec: n.sec }; walked.add(n.s); }
    }
    for (const s of improved) bestAll[s] = Math.min(bestAll[s]!, tau[k]![s]!);
    for (const s of walked) bestAll[s] = Math.min(bestAll[s]!, tau[k]![s]!);
    marked = new Set([...improved, ...walked]);
    for (const s of marked) { const e = egressSec.get(s); if (e != null && parents[k]![s]?.t === "ride") bound = Math.min(bound, tau[k]![s]! + e); }
    if (!marked.size) break;
  }

  // mejor llegada por número de viajes en bus
  const best: { k: number; arrive: number; stop: number }[] = [];
  for (let k = 1; k <= maxRounds; k++) {
    let bs = -1, ba = INF;
    for (const e of egress) {
      const par = parents[k]![e.s];
      if (!par || par.t !== "ride") continue;                       // se llega en bus, no caminando entre paradas
      const arrive = tau[k]![e.s]! + e.sec;
      if (arrive < ba) { ba = arrive; bs = e.s; }
    }
    if (bs >= 0) best.push({ k, arrive: ba, stop: bs });
  }
  return { best, parents, tau };
}

/* ---------- armar el itinerario ---------- */

const pathCache = new WeakMap<RouteShape, RoadPath | null>();
function pathOf(shape: RouteShape): RoadPath | null {
  let c = pathCache.get(shape);
  if (c === undefined) { c = shape.points.length > 1 ? new RoadPath(shape.points) : null; pathCache.set(shape, c); }
  return c;
}

function stopRef(state: TransitState, ix: Index, s: number): StopRef {
  const st = state.stopById(ix.stopIds[s]!);
  const l = st ? state.labelOf(st) : undefined;
  const name = l ? (l.wagon ? `${l.title} · vagón ${l.wagon}` : l.platform ? `${l.title} · ${l.platform}` : l.title) : ix.stopIds[s]!;
  return { id: ix.stopIds[s]!, name, position: { lat: ix.lat[s]!, lon: ix.lon[s]! } };
}

function walkLeg(from: GeoPoint, to: GeoPoint, fromName: string, toName: string): WalkLeg {
  const meters = walkMetersOf(from, to);
  return { kind: "walk", from, to, fromName, toName, meters, seconds: walkSeconds(hav(from, to)), line: [from, to] };
}

function build(state: TransitState, ix: Index, live: Live, run: RunResult, k: number, stop: number, origin: PlanPlace, dest: PlanPlace, nowSec: number): Itinerary | null {
  const legs: Leg[] = [];
  // egreso
  const lastStop = stopRef(state, ix, stop);
  const egress = walkLeg(lastStop.position, dest.position, lastStop.name, dest.name);
  if (egress.meters > 20) legs.push(egress);
  let round = k, s = stop;
  const rev: Leg[] = [];
  for (;;) {
    const par = run.parents[round]![s];
    if (!par) return null;
    if (par.t === "access") {
      const first = stopRef(state, ix, s);
      const w = walkLeg(origin.position, first.position, origin.name, first.name);
      if (w.meters > 20) rev.push(w);
      break;
    }
    if (par.t === "walk") {
      const a = stopRef(state, ix, par.from), b = stopRef(state, ix, s);
      rev.push({ ...walkLeg(a.position, b.position, a.name, b.name), seconds: par.sec });
      s = par.from; continue;
    }
    const pat = ix.patterns[par.p]!;
    const board = stopRef(state, ix, par.board), alight = stopRef(state, ix, s);
    const path = pathOf(pat.shape);
    let line: GeoPoint[] = [board.position, alight.position];
    if (path) {
      const h0 = path.project(toWorld(board.position), 0, 0, 150), h1 = path.project(toWorld(alight.position), 0, 0, 150);
      if (h0 && h1 && h1.s > h0.s) line = path.slice(h0.s, h1.s);
    }
    const between: StopRef[] = [];
    for (let q = par.bi + 1; q < par.ai; q++) between.push(stopRef(state, ix, pat.stops[q]!));
    const headway = live.headway.get(pat.routeId) ?? DEFAULT_HEADWAY[pat.route.system];
    rev.push({
      kind: "ride", routeId: pat.routeId, shortName: pat.route.shortName, longName: pat.route.longName, headsign: pat.shape.headsign, system: pat.route.system,
      board, alight, stops: par.ai - par.bi, waitSeconds: par.wait, waitKind: par.liveWait ? "live" : "estimated",
      departAt: par.dep, arriveAt: par.arr, rideSeconds: par.arr - par.dep, line,
      headwaySeconds: headway, busId: par.bus?.id, busLabel: par.bus?.label, between,
      alerts: state.alertsByRoute.get(pat.routeId)?.length ?? 0, lowFrequency: headway > 900,
    });
    s = par.from; round--;
    if (round < 0) return null;
  }
  const all = [...rev.reverse(), ...legs.reverse()];
  const rides = all.filter((l): l is RideLeg => l.kind === "ride");
  if (!rides.length) return null;
  if (rides.length > 1 && rides.some((r) => r.stops < 2)) return null;           // cambiar de bus para avanzar una sola parada no tiene sentido
  const arriveAt = run.best.find((b) => b.k === k && b.stop === stop)!.arrive;
  const walk = all.filter((l): l is WalkLeg => l.kind === "walk");
  return {
    legs: all, departAt: nowSec, arriveAt, seconds: arriveAt - nowSec,
    walkMeters: walk.reduce((a, l) => a + l.meters, 0), walkSeconds: walk.reduce((a, l) => a + l.seconds, 0),
    waitSeconds: rides.reduce((a, l) => a + l.waitSeconds, 0), transfers: rides.length - 1, live: rides[0]!.waitKind === "live", tags: [],
  };
}

const sig = (it: Itinerary) => it.legs.filter((l): l is RideLeg => l.kind === "ride").map((l) => `${l.shortName}:${l.board.id}>${l.alight.id}`).join("|");

/** Planifica un viaje desde `origin` hasta `dest`, saliendo ahora. Devuelve de 0 a `limit` opciones ordenadas por llegada. */
export function planTrip(state: TransitState, origin: PlanPlace, dest: PlanPlace, opts: PlanOptions = {}): Itinerary[] {
  const nowMs = opts.nowMs ?? Date.now(), nowSec = nowMs / 1000;
  const limit = opts.limit ?? 5, maxRounds = (opts.maxTransfers ?? 3) + 1, maxAccess = opts.maxAccessMeters ?? MAX_ACCESS_M;
  const ix = buildIndex(state);
  if (!ix.patterns.length) return [];
  let live = liveInfo(state, ix, nowMs, opts.scheduled);
  if (opts.systems) {
    // la persona eligió con qué viajar: las rutas de los demás sistemas se tratan como si no operaran
    const ok = new Set<SystemType>(opts.systems);
    live = { ...live, running: new Set([...live.running].filter((id) => { const r = state.routeById(id); return !!r && ok.has(r.system); })) };
  }

  // llegada real de los buses a las paradas cercanas al origen (para el tiempo de espera del primer bus)
  const liveEtas = new Map<number, Map<number, LiveBus[]>>();
  const access = stopsNear(ix, origin.position, maxAccess).sort((a, b) => a.m - b.m).slice(0, 24);
  if (live.hasLive) for (const a of access) {
    const per = new Map<number, LiveBus[]>();
    for (const row of upcomingAtStop(state, ix.stopIds[a.s]!, nowSec, 4)) {
      for (const p of ix.byRoute.get(row.route.id) ?? []) {
        const pat = ix.patterns[p]!;
        if (pat.shape.direction !== row.direction) continue;
        const i = pat.stops.indexOf(a.s); if (i < 0) continue;
        per.set(p, row.buses.map((b) => ({ eta: b.etaAt, id: b.vehicle.id, label: b.vehicle.plate || b.vehicle.label })).sort((x, y) => x.eta - y.eta));
      }
    }
    liveEtas.set(a.s, per);
  }

  const candidates = new Map<string, Itinerary>();
  const banned = new Set<string>();
  for (let pass = 0; pass < 6; pass++) {
    const run = raptor(ix, live, origin.position, dest.position, nowSec, banned, liveEtas, maxRounds, maxAccess);
    if (!run.best.length) break;
    let fastest: Itinerary | null = null;
    for (const b of run.best) {
      const it = build(state, ix, live, run, b.k, b.stop, origin, dest, nowSec);
      if (!it) continue;
      if (!candidates.has(sig(it))) candidates.set(sig(it), it);
      if (!fastest || it.arriveAt < fastest.arriveAt) fastest = it;
    }
    // la siguiente pasada prohíbe la ruta que más se usa en la mejor opción, para encontrar alternativas distintas
    const main = fastest?.legs.filter((l): l is RideLeg => l.kind === "ride").sort((a, b) => b.rideSeconds - a.rideSeconds)[0];
    if (!main) break;
    banned.add(main.shortName);
  }

  // a pie, si es corto
  const direct = hav(origin.position, dest.position);
  if (direct <= 2600) {
    const w = walkLeg(origin.position, dest.position, origin.name, dest.name);
    candidates.set("walk", { legs: [w], departAt: nowSec, arriveAt: nowSec + w.seconds, seconds: w.seconds, walkMeters: w.meters, walkSeconds: w.seconds, waitSeconds: 0, transfers: -1, live: false, tags: [] });
  }

  const score = (x: Itinerary) => x.arriveAt + TRANSFER_PENALTY_S * Math.max(0, x.transfers);
  let list = [...candidates.values()].sort((a, b) => score(a) - score(b));
  if (!list.length) return [];
  // quita lo que otra opción supera en todo: llega antes o igual (±1 min), con menos o igual trasbordos y caminata
  list = list.filter((a, i) => !list.some((b, j) => j !== i && b.arriveAt <= a.arriveAt + 60 && b.transfers <= a.transfers && b.walkMeters <= a.walkMeters + 50
    && (b.arriveAt < a.arriveAt - 60 || b.transfers < a.transfers || b.walkMeters < a.walkMeters - 50 || (j < i && b.arriveAt <= a.arriveAt))));
  // y las que llegan mucho después de la mejor (más de 35 min o el doble del tiempo)
  const best = [...list].sort((a, b) => a.arriveAt - b.arriveAt)[0]!;
  // (una opción sin trasbordos se conserva aunque sea bastante más lenta: mucha gente prefiere no cambiar de bus)
  list = list.filter((a) => (a.transfers <= 0 ? a.seconds <= Math.max(best.seconds * 2.2, best.seconds + 1800) : a.seconds <= Math.max(best.seconds * 1.8, best.seconds + 900) && a.seconds <= best.seconds + 2400));
  list = list.slice(0, limit);

  const rideOnes = list.filter((x) => x.transfers >= 0);
  const mark = (it: Itinerary | undefined, tag: string) => { if (it && !it.tags.includes(tag)) it.tags.push(tag); };
  const earliest = [...list].sort((a, b) => a.arriveAt - b.arriveAt)[0];
  mark(earliest, earliest?.transfers === -1 ? "A pie" : "Más rápida");
  const fewest = [...rideOnes].sort((a, b) => a.transfers - b.transfers || a.arriveAt - b.arriveAt)[0];
  if (fewest && fewest !== earliest && fewest.arriveAt <= best.arriveAt + 15 * 60) mark(fewest, fewest.transfers === 0 ? "Sin trasbordos" : "Menos trasbordos");
  else if (fewest && fewest === earliest && fewest.transfers === 0) mark(fewest, "Sin trasbordos");
  const leastWalk = [...list].sort((a, b) => a.walkMeters - b.walkMeters || a.arriveAt - b.arriveAt)[0];
  if (leastWalk && leastWalk !== earliest && leastWalk.transfers >= 0 && leastWalk.arriveAt <= best.arriveAt + 15 * 60) mark(leastWalk, "Menos caminata");
  return list.map((it) => ({ ...it, transfers: Math.max(0, it.transfers) }));
}

export type PlanSort = "mejor" | "rapida" | "trasbordos" | "caminata";
/** Ordena las opciones. «Mejor» pone primero las que no tienen trasbordos (aunque lleguen un poco después) y, dentro de cada grupo, la que llega antes. */
export function sortItineraries(list: readonly Itinerary[], by: PlanSort): Itinerary[] {
  const r = list.slice();
  if (by === "rapida") r.sort((a, b) => a.arriveAt - b.arriveAt);
  else if (by === "caminata") r.sort((a, b) => a.walkMeters - b.walkMeters || a.arriveAt - b.arriveAt);
  else r.sort((a, b) => a.transfers - b.transfers || a.arriveAt - b.arriveAt);          // «mejor» y «trasbordos»
  return r;
}

/** Por qué no se encontró nada: cuántas paradas hay cerca de cada punto y si hay rutas operando. */
export function diagnosePlan(state: TransitState, origin: PlanPlace, dest: PlanPlace, nowMs = Date.now()): { nearOrigin: number; nearDest: number; routesRunning: number; liveData: boolean } {
  const ix = buildIndex(state), live = liveInfo(state, ix, nowMs);
  return { nearOrigin: stopsNear(ix, origin.position, MAX_ACCESS_M).length, nearDest: stopsNear(ix, dest.position, MAX_ACCESS_M).length, routesRunning: live.running.size, liveData: live.hasLive };
}

/* ---------- búsqueda de lugares (paradas, estaciones y portales) ---------- */

/** Estaciones, portales y paradas que coinciden con el texto, como lugares donde empezar o terminar un viaje. */
export function searchPlanPlaces(state: TransitState, text: string, limit = 6): PlanPlace[] {
  const q = text.trim();
  if (q.length < 2) return [];
  return searchStopGroupsLite(state, q, limit);
}
function searchStopGroupsLite(state: TransitState, q: string, limit: number): PlanPlace[] {
  return searchStopGroups(state, q, limit).map((g) => {
    const kind = g.stops.some((s) => state.labelOf(s).platform) ? "Portal" : g.stops.some((s) => state.labelOf(s).wagon) ? "Estación" : "Parada";
    return { name: kind === "Parada" ? g.title : `${kind} ${g.title}`.replace(/^(Portal|Estación) (Portal|Estación)\b/i, "$2"), position: g.position };
  });
}

/* ---------- con qué viajar ---------- */

/** Lo que la persona puede elegir en «Cómo llegar»: TransMilenio (troncales y duales), SITP zonal (buses azules) y alimentadores (verdes). */
export type TravelMode = "troncal" | "zonal" | "alimentador";
export const TRAVEL_MODES: readonly { key: TravelMode; label: string; systems: readonly SystemType[] }[] = [
  { key: "troncal", label: "TransMilenio", systems: ["troncal", "dual"] },
  { key: "zonal", label: "SITP zonal", systems: ["zonal", "otro"] },
  { key: "alimentador", label: "Alimentador", systems: ["alimentador"] },
];
export type TravelModes = Record<TravelMode, boolean>;
export const ALL_MODES: TravelModes = { troncal: true, zonal: true, alimentador: true };
/** Los sistemas permitidos para `planTrip`, o `undefined` si están todos (sin filtro). */
export function systemsFor(modes: TravelModes): SystemType[] | undefined {
  return TRAVEL_MODES.every((m) => modes[m.key]) ? undefined : TRAVEL_MODES.filter((m) => modes[m.key]).flatMap((m) => [...m.systems]);
}
/** Prende o apaga un modo; siempre queda al menos uno prendido. */
export function toggleMode(modes: TravelModes, k: TravelMode): TravelModes {
  const next = { ...modes, [k]: !modes[k] };
  return TRAVEL_MODES.some((m) => next[m.key]) ? next : modes;
}
