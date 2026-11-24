import {
  DEFAULT_PREDICTION, METERS_PER_WORLD_UNIT, RoadPath, type RouteLock, type RouteShape, type Vehicle, type WorldPoint,
  lockToRoute, motionSeconds, toWorld,
} from "@transmi/domain";
import { estimateTravelSeconds, shapeStops } from "./eta";
import type { TransitState } from "./transit-state";

/** Parámetros del movimiento. Se calibraron con lotes reales (ver README, «Cómo se mueven los buses»). */
export interface MotionParams {
  /** Qué tan fuerte se corrige el error: 1/K segundos para cerrar la diferencia con la posición esperada. */
  catchUp: number;
  /** Suavizado de la velocidad mostrada (segundos): evita arranques y frenadas bruscas. */
  speedSmoothing: number;
  /** Fracción de la velocidad medida con la que avanza lo mostrado cuando va «al día» (ver `DEFAULT_PREDICTION.gain`). */
  rateGain: number;
  /** Un bus nunca se muestra más rápido que esto veces su velocidad (+ margen) al alcanzar a la realidad. */
  maxRush: number;
  rushMarginMps: number;
  /** Si el error pasa de esto (m) es un salto real: el bus se «desliza» a su sitio en pocos segundos. */
  snapMeters: number;
  /** Los saltos y cambios de trazado se absorben con un desfase visual que se disipa con esta constante de tiempo (s). */
  glideSeconds: number;
  /** Mientras el bus «debería» ir andando, nunca baja de esta fracción de su ritmo (no se ve congelado). */
  creep: number;
  /** Pegado a la ruta: distancia máxima (m) del reporte al trazado. */
  lockMeters: number;
  /** Un bus no pasa de su próxima parada mientras el reporte no diga que ya pasó (se queda «parado» en ella). */
  stopClamp: boolean;
  /** Cuánto se deja pasar la parada (m): el bus se detiene antes y después del punto exacto. */
  stopSlackMeters: number;
  /** Peso (0–1) de los tiempos reales por tramo (`state.hopProfile`) en el adelanto entre reportes, frente a la velocidad medida del bus.
   *  0 = solo la velocidad medida (como antes). Solo se usa en buses con parada conocida y con datos del tramo en que van. */
  hopWeight: number;
  /** Fracción del avance según los tiempos por tramo que se aplica por cada segundo de antigüedad del reporte. */
  hopGain: number;
  /** Peso de lo aprendido cuando la velocidad medida dice que el bus estaba detenido (semáforo, parada, trancón). */
  hopWeightStill: number;
}
/** Ver `MotionParams.hopWeight`, `hopGain` y `hopWeightStill`. Medido el 2026-11-24 en hora valle con `tools/precision.ts`
 *  (34 lotes, ≈5.400 buses, 130.606 comparaciones): con solo la velocidad medida el bus dibujado quedaba a 182 m (mediana; p90 508 m)
 *  de donde estaba de verdad y casi siempre atrás (−173 m a lo largo de la calle); con los tiempos por tramo, a 118 m (p90 353 m) y
 *  sin sesgo (−8 m). Mezclar a medias (0,5) dejaba 137 m; ir 10 % más rápido que lo aprendido (1,1), 121 m. En los buses que estaban
 *  detenidos lo aprendido los adelanta de más (103 → 145 m): con peso 0,25 para ellos, 134 m, sin empeorar a los demás. */
export const HOP_WEIGHT = 1, HOP_GAIN = 1, HOP_WEIGHT_STILL = 0.25;
export const DEFAULT_MOTION: MotionParams = {
  rateGain: 1, catchUp: 0.18, speedSmoothing: 1.5, maxRush: 3, rushMarginMps: 3,
  snapMeters: 800, glideSeconds: 1.8, creep: 0.5, lockMeters: 60, stopClamp: false, stopSlackMeters: 12,
  hopWeight: HOP_WEIGHT, hopGain: HOP_GAIN, hopWeightStill: HOP_WEIGHT_STILL,
};

interface Track {
  reportedAt: number;
  lock: RouteLock | null;
  /** Metros recorridos sobre el trazado (solo con `lock`). */
  s: number;
  /** Metros del reporte sobre el trazado. */
  s0: number;
  /** Metros de su próxima parada sobre el trazado (o `Infinity` si no se sabe). */
  sStop: number;
  /** Posición mostrada. */
  x: number; y: number;
  /** Posición «real» del modelo (sin desfase visual). */
  bx: number; by: number;
  /** Desfase visual (mundo) respecto a la posición «real» del modelo; se disipa solo. */
  ox: number; oy: number;
  /** Velocidad de referencia del bus (m/s): la medida, o una deducida de su ruta y su próxima parada si aún no hay historial. */
  speed: number;
  /** Velocidad mostrada (m/s) a lo largo del trazado, o vector (m/s) sin trazado. */
  u: number; ux: number; uy: number;
  lastT: number;
  /** Rumbo mostrado (grados desde el norte, en el sentido del reloj), suavizado. */
  h: number | null;
  /** Avance esperado desde el reporte según los tiempos reales de cada tramo (ver `hopPlan`), o `null` si no se sabe. */
  plan: HopPlan | null;
}

/** Puntos (segundos desde el reporte → metros sobre el trazado) por los que pasaría el bus yendo al ritmo típico de cada tramo a esta hora. */
interface HopPlan { ts: number[]; ss: number[] }
function planAt(p: HopPlan, t: number): { s: number; rate: number } {
  const { ts, ss } = p, n = ts.length;
  if (t <= 0) return { s: ss[0]!, rate: n > 1 ? (ss[1]! - ss[0]!) / (ts[1]! - ts[0]!) : 0 };
  for (let i = 1; i < n; i++) if (t <= ts[i]!) { const r = (ss[i]! - ss[i - 1]!) / (ts[i]! - ts[i - 1]!); return { s: ss[i - 1]! + r * (t - ts[i - 1]!), rate: r }; }
  return { s: ss[n - 1]!, rate: 0 };      // fin del recorrido (o del horizonte): ahí se queda
}

/** Velocidad típica entre paradas (m/s) cuando no hay nada mejor. */
const TYPICAL_SPEED_MPS: Record<string, number> = { troncal: 6, dual: 5, alimentador: 4, zonal: 4, otro: 4 };
const STALE_SECONDS = 5;
/** Por debajo de esto (m/s, medido en ≥28 s) el bus estaba detenido. */
const STILL_MPS = 0.5;
const MAX_STEP = 0.25;

/** Calcula, cuadro a cuadro, dónde dibujar cada bus: sigue el trazado de su ruta, nunca retrocede y
 *  corrige los errores acelerando o frenando poco a poco en vez de dar saltos. */
export class MotionEngine {
  private tracks = new Map<string, Track>();
  private paths = new Map<string, RoadPath[]>();
  private pathsFor: object | null = null;
  /** El recorrido (con sus paradas) del que sale cada trazado. */
  private shapeOf = new WeakMap<RoadPath, RouteShape>();

  constructor(private readonly state: TransitState, readonly params: MotionParams = DEFAULT_MOTION) {}

  private pathsOf(routeId: string): RoadPath[] {
    const net = this.state.network;
    if (this.pathsFor !== net) { this.paths = new Map(); this.tracks.clear(); this.pathsFor = net; }
    let list = this.paths.get(routeId);
    if (!list) {
      list = (net.shapes.get(routeId) ?? []).filter((sh) => sh.points.length > 1).map((sh) => { const p = new RoadPath(sh.points); this.shapeOf.set(p, sh); return p; });
      this.paths.set(routeId, list);
    }
    return list;
  }

  /** Posición mostrada actualmente de un bus (sin avanzar el tiempo). */
  peek(id: string): WorldPoint | undefined { const t = this.tracks.get(id); return t ? { x: t.x, y: t.y } : undefined; }
  /** Hacia dónde apunta el bus ahora (grados desde el norte): el de su trazado en ese punto, o el último rumbo informado. */
  heading(id: string): number | undefined { const h = this.tracks.get(id)?.h; return h == null ? undefined : h; }
  private targetHeading(t: Track, v: Vehicle): number | null {
    if (t.lock) { const { ux, uy } = t.lock.path.tangentAt(t.s); return ((Math.atan2(ux, -uy) * 180) / Math.PI + 360) % 360; }
    if (Math.hypot(t.ux, t.uy) > 0.8) return ((Math.atan2(t.ux, -t.uy) * 180) / Math.PI + 360) % 360;
    return v.bearing;
  }
  forget(id: string): void { this.tracks.delete(id); }
  prune(): void { for (const id of this.tracks.keys()) if (!this.state.fleet.get(id)) this.tracks.delete(id); }
  get size(): number { return this.tracks.size; }

  /** Avanza el bus hasta el instante `nowSec` y devuelve dónde dibujarlo. */
  step(v: Vehicle, nowSec: number): WorldPoint {
    const p = this.params;
    let t = this.tracks.get(v.id);
    const vel = v.velocity;

    // 1) reporte nuevo (o bus que no se miraba): se vuelve a pegar a su ruta
    if (!t || nowSec - t.lastT > STALE_SECONDS || t.reportedAt !== v.reportedAt) {
      const { lock, speed: sp } = this.resolve(v, nowSec, t?.lock?.path);
      if (!t || nowSec - t.lastT > STALE_SECONDS) {
        const plan = this.hopPlan(v, lock, nowSec);
        const target = this.target(v, nowSec, lock, sp, plan);
        t = { reportedAt: v.reportedAt, lock, speed: sp, s: target.s, s0: lock ? lock.s : 0, sStop: this.stopS(v, lock), x: target.world.x, y: target.world.y, bx: target.world.x, by: target.world.y, ox: 0, oy: 0, u: target.rate, ux: 0, uy: 0, lastT: nowSec, h: null, plan };
        this.tracks.set(v.id, t);
        t.h = this.targetHeading(t, v);
        return { x: t.x, y: t.y };
      }
      t.speed = sp;
      if (lock && t.lock && lock.path === t.lock.path) { t.lock = lock; t.s0 = lock.s; t.sStop = this.stopS(v, lock); }
      else if (lock) {
        // cambió de trazado (u otro sentido): se continúa desde donde se está dibujado, si cae sobre el nuevo
        const hit = lock.path.project({ x: t.bx, y: t.by }, 0, 0, 60);
        t.lock = lock; t.s0 = lock.s; t.s = hit ? hit.s : lock.s; t.sStop = this.stopS(v, lock);
        if (!hit) { const q = lock.path.pointAt(t.s); t.ox += t.bx - q.x; t.oy += t.by - q.y; }   // se desliza, no salta
      } else { t.lock = null; t.sStop = Infinity; }
      t.plan = this.hopPlan(v, t.lock, nowSec);
      t.reportedAt = v.reportedAt;
    }

    const dt = Math.min(MAX_STEP, Math.max(0, nowSec - t.lastT));
    t.lastT = nowSec;
    if (dt <= 0) return { x: t.x, y: t.y };
    const tgt = this.target(v, nowSec, t.lock, t.speed, t.plan);
    const rate = tgt.rate;
    if (t.lock && p.stopClamp && t.sStop !== Infinity) tgt.s = Math.min(tgt.s, Math.max(t.s0, t.sStop + p.stopSlackMeters));

    if (t.lock) {
      // 2) a lo largo del trazado: velocidad = la del bus + corrección proporcional al error; sin retroceder
      const e = tgt.s - t.s;
      if (Math.abs(e) > p.snapMeters) {
        const before = t.lock.path.pointAt(t.s);
        t.s = tgt.s; t.u = rate;
        const after = t.lock.path.pointAt(t.s);
        t.ox += before.x - after.x; t.oy += before.y - after.y;      // el salto se absorbe deslizando
      } else {
        const umax = rate * p.maxRush + p.rushMarginMps;
        const floor = rate > 1 && !(t.sStop !== Infinity && t.s >= t.sStop) ? rate * p.creep : 0;
        const want = Math.min(umax, Math.max(floor, rate + p.catchUp * e));
        t.u += (want - t.u) * (1 - Math.exp(-dt / p.speedSmoothing));
        t.s = Math.min(t.lock.path.length, t.s + t.u * dt);
      }
      const w = t.lock.path.pointAt(t.s);
      const k = Math.exp(-dt / p.glideSeconds);
      t.ox *= k; t.oy *= k;
      t.bx = w.x; t.by = w.y;
      t.x = w.x + t.ox; t.y = w.y + t.oy;
    } else {
      // 3) sin trazado: igual, pero en dos dimensiones
      const ex = (tgt.world.x - t.bx) * METERS_PER_WORLD_UNIT, ey = (tgt.world.y - t.by) * METERS_PER_WORLD_UNIT;
      if (Math.hypot(ex, ey) > p.snapMeters) { t.ox += t.bx - tgt.world.x; t.oy += t.by - tgt.world.y; t.bx = tgt.world.x; t.by = tgt.world.y; t.ux = 0; t.uy = 0; }
      else {
        let wx = p.catchUp * ex, wy = p.catchUp * ey;      // el objetivo está quieto: solo se acerca a él con suavidad
        const cap = rate * p.maxRush + p.rushMarginMps, m = Math.hypot(wx, wy);
        if (m > cap) { wx *= cap / m; wy *= cap / m; }
        const a = 1 - Math.exp(-dt / p.speedSmoothing);
        t.ux += (wx - t.ux) * a; t.uy += (wy - t.uy) * a;
        t.bx += (t.ux * dt) / METERS_PER_WORLD_UNIT; t.by += (t.uy * dt) / METERS_PER_WORLD_UNIT;
      }
      const k = Math.exp(-dt / p.glideSeconds);
      t.ox *= k; t.oy *= k;
      t.x = t.bx + t.ox; t.y = t.by + t.oy;
    }
    const th = this.targetHeading(t, v);
    if (th != null) {
      // se gira poco a poco por el camino más corto (en las esquinas del trazado no da un latigazo)
      if (t.h == null) t.h = th;
      else { const d = ((th - t.h + 540) % 360) - 180; t.h = (t.h + d * (1 - Math.exp(-dt / 0.3)) + 360) % 360; }
    }
    return { x: t.x, y: t.y };
  }

  /** Trazado y velocidad de referencia de un bus. Con historial: lo medido. Sin historial (recién abierta la página o bus nuevo):
   *  se deduce de su ruta y su próxima parada, para que se mueva desde el primer cuadro y no espere dos o tres lotes. */
  private resolve(v: Vehicle, nowSec: number, prefer?: RoadPath): { lock: RouteLock | null; speed: number } {
    const paths = this.pathsOf(v.routeId);
    if (!paths.length) return { lock: null, speed: v.velocity?.speedMps ?? 0 };
    const vel = v.velocity;
    if (vel) return { lock: lockToRoute(paths, v.world, vel, this.params.lockMeters, prefer), speed: vel.speedMps };
    const next = this.state.nextStopOf(v, nowSec * 1000, false);     // la parada que sigue a la última que informó el bus
    const stop = next?.stop;
    if (!next || !stop) return { lock: null, speed: 0 };
    const sw = toWorld(stop.position);
    let best: { lock: RouteLock; sStop: number } | null = null, bestDist = Infinity;
    for (const path of paths) {
      const hit = path.project(v.world, 0, 0, this.params.lockMeters);
      const st = hit && path.project(sw, 0, 0, 40);
      // sirve el trazado en cuyo sentido la próxima parada queda por delante
      if (hit && st && st.s >= hit.s - 15 && hit.dist < bestDist) { bestDist = hit.dist; best = { lock: { path, s: hit.s, sign: 1 }, sStop: st.s }; }
    }
    if (!best) return { lock: null, speed: 0 };
    const left = best.sStop - best.lock.s;
    if (left < 20) return { lock: best.lock, speed: 0 };            // ya está en la parada: espera su reporte
    const eta = next.arrivalAt;
    const speed = eta && eta - nowSec > 5 && eta - nowSec < 900
      ? Math.min(12, Math.max(1, left / (eta - nowSec)))              // lo que necesita para llegar a la hora oficial
      : TYPICAL_SPEED_MPS[v.system];
    return { lock: best.lock, speed };
  }

  /** Distancia de la próxima parada del bus sobre su trazado; `Infinity` si no se conoce o queda atrás. */
  private stopS(v: Vehicle, lock: RouteLock | null): number {
    if (!lock || !v.lastStopId) return Infinity;
    const stop = this.state.nextStopOf(v, Date.now(), false)?.stop;
    if (!stop) return Infinity;
    const hit = lock.path.project(toWorld(stop.position), 0, 0, 40);
    return hit && hit.s >= lock.s - 25 ? hit.s : Infinity;
  }

  /** Dónde se espera que esté el bus ahora: su último reporte más lo que habrá avanzado, con la política calibrada; y a qué ritmo (m/s)
   *  avanza ese punto. Con tiempos reales del tramo (`plan`) se mezclan los dos adelantos: la velocidad medida sabe si el bus va
   *  frenado ahora; lo aprendido sabe cuánto se demora de verdad ese tramo a esta hora (paradas, semáforos, trancón). */
  private target(v: Vehicle, nowSec: number, lock: RouteLock | null, speed: number, plan: HopPlan | null): { s: number; world: WorldPoint; rate: number } {
    const age = nowSec - v.reportedAt, p = this.params;
    if (lock) {
      let s = lock.s + speed * motionSeconds(age, DEFAULT_PREDICTION), rate = speed * p.rateGain;
      if (plan) {
        const vel = v.velocity;      // sin velocidad medida (primer lote) manda lo aprendido
        const w = !vel ? 1 : vel.speedMps < STILL_MPS ? p.hopWeightStill : p.hopWeight;
        const h = planAt(plan, Math.min(DEFAULT_PREDICTION.maxSeconds, Math.max(0, age)) * p.hopGain);
        s = w * h.s + (1 - w) * s;
        rate = w * h.rate * p.hopGain + (1 - w) * rate;
      }
      return { s, world: lock.path.pointAt(s), rate };
    }
    // sin trazado conocido NO se adelanta: en línea recta el bus se saldría de la calle y flotaría en el vacío mientras llega el siguiente dato
    return { s: 0, world: v.world, rate: speed * p.rateGain };
  }

  /** Por dónde iría el bus desde su reporte al ritmo típico de cada tramo a esta hora (`state.hopProfile`, como en `eta.ts`).
   *  Solo si el bus tiene parada conocida en ese mismo recorrido (no se le asigna una por su cuenta) y hay datos del tramo en que va;
   *  los tramos siguientes sin datos usan el valor fijo por parada. Nunca va hacia atrás: los puntos solo avanzan sobre el trazado. */
  private hopPlan(v: Vehicle, lock: RouteLock | null, nowSec: number): HopPlan | null {
    const prof = this.state.hopProfile, p = this.params;
    if (!lock || (p.hopWeight <= 0 && p.hopWeightStill <= 0) || p.hopGain <= 0 || !prof.apply || !prof.size) return null;
    const shape = this.shapeOf.get(lock.path);
    const seq = shape && this.state.sequenceOf(v);
    if (!shape || !seq || seq.shape !== shape) return null;
    const info = shapeStops(this.state, shape);
    if (!info) return null;
    const S = info.s, last = S.length - 1, nowMs = nowSec * 1000;
    let i = -1;
    for (let k = 0; k < last; k++) if (S[k]! <= lock.s) i = k; else break;
    if (i < 0 || lock.s >= S[last]!) return null;                    // antes de la primera parada o después de la última: no hay tramo
    if (!prof.has(shape, i, nowMs)) return null;                       // sin datos del tramo en que va: como antes
    const horizon = DEFAULT_PREDICTION.maxSeconds * p.hopGain;
    const ts = [0], ss = [lock.s];
    let t = 0, s = lock.s;
    for (let k = i; k < last && t < horizon; k++) {
      const len = S[k + 1]! - S[k]!;
      if (len <= 0) continue;
      const sec = prof.seconds(shape, k, nowMs, estimateTravelSeconds(this.state, v, shape.stopIds, k, k + 1, nowMs));
      const rate = len / Math.max(1, sec);
      const dt = (S[k + 1]! - s) / rate;
      if (dt <= 0) continue;
      t += dt; s = S[k + 1]!;
      ts.push(t); ss.push(s);
    }
    return ts.length > 1 ? { ts, ss } : null;
  }
}

/** Cada cuánto se recalculan los buses (ms): entre menos buses haya en pantalla y más cerca esté el mapa, más seguido, para que se vean deslizarse y no saltar.
 *  De cerca con pocos buses ≈15 veces por segundo; lejos y con cientos, 1–2 veces por segundo (ahí no se nota y cuesta mucho). */
export function cadenceMs(zoom: number, count: number): number {
  if (zoom >= 14.5 && count <= 40) return 66;
  if (zoom >= 13.5 && count <= 120) return 110;
  if (zoom >= 13 && count <= 300) return 180;
  return zoom < 13 ? 700 : zoom < 14.5 ? 400 : 250;
}

