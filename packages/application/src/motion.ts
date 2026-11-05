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
  /** Velocidad mostrada (m/s) a lo largo del trazado, o vector (m/s) sin trazado. */
  u: number; ux: number; uy: number;
  lastT: number;
}

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
    const speed = vel ? vel.speedMps : 0;
    /** Ritmo al que avanza lo esperado: la velocidad medida por la fracción calibrada (los buses frenan y esperan). */
    const rate = speed * p.rateGain;

    // 1) reporte nuevo (o bus que no se miraba): se vuelve a pegar a su ruta
    if (!t || nowSec - t.lastT > STALE_SECONDS || t.reportedAt !== v.reportedAt) {
      const paths = this.pathsOf(v.routeId);
      const lock = paths.length && vel ? lockToRoute(paths, v.world, vel, p.lockMeters, t?.lock?.path) : null;
      if (!t || nowSec - t.lastT > STALE_SECONDS) {
        const target = this.target(v, nowSec, lock);
        t = { reportedAt: v.reportedAt, lock, s: target.s, s0: lock ? lock.s : 0, sStop: this.stopS(v, lock), x: target.world.x, y: target.world.y, bx: target.world.x, by: target.world.y, ox: 0, oy: 0, u: rate, ux: (vel?.ux ?? 0) * rate, uy: (vel?.uy ?? 0) * rate, lastT: nowSec };
        this.tracks.set(v.id, t);
        return { x: t.x, y: t.y };
      }
      if (lock && t.lock && lock.path === t.lock.path) { t.lock = lock; t.s0 = lock.s; t.sStop = this.stopS(v, lock); }
      else if (lock) {
        // cambió de trazado (u otro sentido): se continúa desde donde se está dibujado, si cae sobre el nuevo
        const hit = lock.path.project({ x: t.bx, y: t.by }, 0, 0, 60);
        t.lock = lock; t.s0 = lock.s; t.s = hit ? hit.s : lock.s; t.sStop = this.stopS(v, lock);
        if (!hit) { const q = lock.path.pointAt(t.s); t.ox += t.bx - q.x; t.oy += t.by - q.y; }   // se desliza, no salta
      } else { t.lock = null; t.sStop = Infinity; }
      t.reportedAt = v.reportedAt;
    }

    const dt = Math.min(MAX_STEP, Math.max(0, nowSec - t.lastT));
    t.lastT = nowSec;
    if (dt <= 0) return { x: t.x, y: t.y };
    const tgt = this.target(v, nowSec, t.lock);
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

  /** Distancia de la próxima parada del bus sobre su trazado; `Infinity` si no se conoce o queda atrás. */
  private stopS(v: Vehicle, lock: RouteLock | null): number {
    if (!lock || !v.nextStopId) return Infinity;
    const stop = this.state.stopById(v.nextStopId);
    if (!stop) return Infinity;
    const hit = lock.path.project(toWorld(stop.position), 0, 0, 40);
    return hit && hit.s >= lock.s - 25 ? hit.s : Infinity;
  }

  /** Dónde se espera que esté el bus ahora: su último reporte más lo que habrá avanzado, con la política calibrada. */
  private target(v: Vehicle, nowSec: number, lock: RouteLock | null): { s: number; world: WorldPoint } {
    const age = nowSec - v.reportedAt;
    if (lock && v.velocity) {
      const s = lock.s + v.velocity.speedMps * motionSeconds(age, DEFAULT_PREDICTION);
      return { s, world: lock.path.pointAt(s) };
    }
    return { s: 0, world: predictPosition(v, nowSec) };
  }
}
