import {
  DEFAULT_PREDICTION, METERS_PER_WORLD_UNIT, RoadPath, type RouteLock, type Vehicle, type WorldPoint,
  lockToRoute, motionSeconds, predictPosition, toWorld,
} from "@transmi/domain";
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
}
export const DEFAULT_MOTION: MotionParams = {
  rateGain: 1, catchUp: 0.18, speedSmoothing: 1.5, maxRush: 3, rushMarginMps: 3,
  snapMeters: 800, glideSeconds: 1.8, creep: 0.5, lockMeters: 45, stopClamp: false, stopSlackMeters: 12,
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
}

/** Velocidad típica entre paradas (m/s) cuando no hay nada mejor. */
const TYPICAL_SPEED_MPS: Record<string, number> = { troncal: 6, dual: 5, alimentador: 4, zonal: 4, otro: 4 };
const STALE_SECONDS = 5;
const MAX_STEP = 0.25;

/** Calcula, cuadro a cuadro, dónde dibujar cada bus: sigue el trazado de su ruta, nunca retrocede y
 *  corrige los errores acelerando o frenando poco a poco en vez de dar saltos. */
export class MotionEngine {
  private tracks = new Map<string, Track>();
  private paths = new Map<string, RoadPath[]>();
  private pathsFor: object | null = null;

  constructor(private readonly state: TransitState, readonly params: MotionParams = DEFAULT_MOTION) {}

  private pathsOf(routeId: string): RoadPath[] {
    const net = this.state.network;
    if (this.pathsFor !== net) { this.paths = new Map(); this.tracks.clear(); this.pathsFor = net; }
    let list = this.paths.get(routeId);
    if (!list) {
      list = (net.shapes.get(routeId) ?? []).filter((sh) => sh.points.length > 1).map((sh) => new RoadPath(sh.points));
      this.paths.set(routeId, list);
    }
    return list;
  }

  /** Posición mostrada actualmente de un bus (sin avanzar el tiempo). */
  peek(id: string): WorldPoint | undefined { const t = this.tracks.get(id); return t ? { x: t.x, y: t.y } : undefined; }
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
        const r0 = sp * p.rateGain;
        const target = this.target(v, nowSec, lock, sp);
        t = { reportedAt: v.reportedAt, lock, speed: sp, s: target.s, s0: lock ? lock.s : 0, sStop: this.stopS(v, lock), x: target.world.x, y: target.world.y, bx: target.world.x, by: target.world.y, ox: 0, oy: 0, u: r0, ux: (vel?.ux ?? 0) * r0, uy: (vel?.uy ?? 0) * r0, lastT: nowSec };
        this.tracks.set(v.id, t);
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
      t.reportedAt = v.reportedAt;
    }
    const rate = t.speed * p.rateGain;

    const dt = Math.min(MAX_STEP, Math.max(0, nowSec - t.lastT));
    t.lastT = nowSec;
    if (dt <= 0) return { x: t.x, y: t.y };
    const tgt = this.target(v, nowSec, t.lock, t.speed);
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
      if (Math.hypot(ex, ey) > p.snapMeters) { t.ox += t.bx - tgt.world.x; t.oy += t.by - tgt.world.y; t.bx = tgt.world.x; t.by = tgt.world.y; t.ux = (vel?.ux ?? 0) * rate; t.uy = (vel?.uy ?? 0) * rate; }
      else {
        const vx = (vel?.ux ?? 0) * rate, vy = (vel?.uy ?? 0) * rate;
        let wx = vx + p.catchUp * ex, wy = vy + p.catchUp * ey;
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
    return { x: t.x, y: t.y };
  }

  /** Trazado y velocidad de referencia de un bus. Con historial: lo medido. Sin historial (recién abierta la página o bus nuevo):
   *  se deduce de su ruta y su próxima parada, para que se mueva desde el primer cuadro y no espere dos o tres lotes. */
  private resolve(v: Vehicle, nowSec: number, prefer?: RoadPath): { lock: RouteLock | null; speed: number } {
    const paths = this.pathsOf(v.routeId);
    if (!paths.length) return { lock: null, speed: v.velocity?.speedMps ?? 0 };
    const vel = v.velocity;
    if (vel) return { lock: lockToRoute(paths, v.world, vel, this.params.lockMeters, prefer), speed: vel.speedMps };
    const next = this.state.nextStopOf(v, nowSec * 1000);     // la parada que sigue a la última que informó el bus
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
    const stop = this.state.nextStopOf(v)?.stop;
    if (!stop) return Infinity;
    const hit = lock.path.project(toWorld(stop.position), 0, 0, 40);
    return hit && hit.s >= lock.s - 25 ? hit.s : Infinity;
  }

  /** Dónde se espera que esté el bus ahora: su último reporte más lo que habrá avanzado, con la política calibrada. */
  private target(v: Vehicle, nowSec: number, lock: RouteLock | null, speed: number): { s: number; world: WorldPoint } {
    const age = nowSec - v.reportedAt;
    if (lock) {
      const s = lock.s + speed * motionSeconds(age, DEFAULT_PREDICTION);
      return { s, world: lock.path.pointAt(s) };
    }
    return { s: 0, world: predictPosition(v, nowSec) };
  }
}
