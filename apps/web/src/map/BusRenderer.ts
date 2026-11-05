import type { Feature, FeatureCollection, Point } from "geojson";
import type { TransitState } from "@transmi/application";
import { type GeoPoint, type RouteLock, RoadPath, type SystemType, type Vehicle, type WorldPoint, DEFAULT_PREDICTION, METERS_PER_WORLD_UNIT, distanceMeters, toWorld, lockToRoute, motionSeconds, predictPosition, toGeo } from "@transmi/domain";
import { type BusDraw, BusCanvas } from "./BusCanvas";
import type { MapController } from "./MapController";
import type { MapTheme } from "./theme";

export type ColorMode = "system" | "delay";
export type Motion = "predict" | "reported";
export interface BusViewOptions {
  colorMode: ColorMode;
  motion: Motion;
  system: SystemType | null;
  routeId: string | null;
  visible: boolean;
}

interface Shown { x: number; y: number; t: number }
const EMPTY: FeatureCollection<Point> = { type: "FeatureCollection", features: [] };
/** Constante de tiempo con que el bus dibujado alcanza su objetivo (suaviza correcciones y saltos). */
const TAU_PREDICT_MS = 3500;
const TAU_REPORTED_MS = 12000;

/** Convierte la flota en los puntos que dibuja el mapa, con movimiento suave entre reportes. */
export class BusRenderer {
  private shown = new Map<string, Shown>();
  private raf = 0;
  private last = 0;
  private items: BusDraw[] = [];
  private readonly canvas: BusCanvas;
  private lastPrune = 0;
  private followId: string | null = null;
  private paths = new Map<string, RoadPath[]>();
  private pathsFor: object | null = null;
  /** Por bus: a qué trazado quedó pegado con su último reporte (se recalcula solo cuando llega un reporte nuevo). */
  private locks = new Map<string, { at: number; lock: RouteLock | null }>();

  constructor(
    private readonly state: TransitState,
    private readonly mapc: MapController,
    private readonly options: () => BusViewOptions,
    private readonly theme: () => MapTheme,
  ) { this.canvas = new BusCanvas(mapc.map); }

  start() {
    this.mapc.busHit = (pt) => this.canvas.hitTest(pt);
    // al mover o acercar el mapa se redibuja en el mismo cuadro, sin desfase
    this.mapc.map.on("move", () => { if (this.canvasOn) this.canvas.draw(this.items); });
    const loop = (t: number) => { this.raf = requestAnimationFrame(loop); this.frame(t); };
    this.raf = requestAnimationFrame(loop);
  }
  stop() { cancelAnimationFrame(this.raf); }
  /** Pide dibujar en el próximo cuadro (por ejemplo, tras cambiar un filtro). */
  refresh() { this.last = 0; this.lastDots = 0; }
  setFollow(id: string | null) { this.followId = id; this.followLast = 0; }
  setFollowPaused(v: boolean) { this.paused = v; }
  private paused = false;
  private hold = false;
  /** Mientras hay un dedo sobre el mapa no se mueve la cámara (si no, el gesto se corta). */
  setHold(v: boolean) { this.hold = v; }
  private followLast = 0;
  /** Mantiene el bus seguido en el centro, con un deslizamiento suave (independiente de los cuadros por segundo). */
  private applyFollow(nowMs: number) {
    if (!this.followId || this.paused || this.hold) return;
    const p = this.position(this.followId); if (!p) return;
    const dt = this.followLast ? Math.min(250, nowMs - this.followLast) : 1000;
    this.followLast = nowMs;
    this.mapc.follow(p, 1 - Math.exp(-dt / 220));
  }

  position(id: string): GeoPoint | null {
    const s = this.shown.get(id);
    return s ? toGeo(s) : null;
  }

  private step(id: string, target: WorldPoint, now: number, tau: number): WorldPoint {
    const s = this.shown.get(id);
    if (!s) { this.shown.set(id, { x: target.x, y: target.y, t: now }); return target; }
    const dt = now - s.t;
    s.t = now;
    if (dt > 0) {
      if (distanceMeters(s, target) > 800) { s.x = target.x; s.y = target.y; }
      else { const a = 1 - Math.exp(-dt / tau); s.x += (target.x - s.x) * a; s.y += (target.y - s.y) * a; }
    }
    return s;
  }

  private pathsOf(routeId: string): RoadPath[] {
    const net = this.state.network;
    if (this.pathsFor !== net) { this.paths = new Map(); this.locks.clear(); this.pathsFor = net; }
    let list = this.paths.get(routeId);
    if (!list) {
      list = (net.shapes.get(routeId) ?? []).filter((sh) => sh.points.length > 1).map((sh) => new RoadPath(sh.points));
      this.paths.set(routeId, list);
    }
    return list;
  }

  /** Avanza al bus por el trazado de su ruta (curvas incluidas); si no va por ella, en línea recta. */
  private predict(v: Vehicle, nowSec: number, snap: boolean): WorldPoint {
    const vel = v.velocity;
    if (!snap || !vel || vel.speedMps < DEFAULT_PREDICTION.minSpeedMps) return predictPosition(v, nowSec);
    let c = this.locks.get(v.id);
    if (!c || c.at !== v.reportedAt) {
      const paths = this.pathsOf(v.routeId);
      c = { at: v.reportedAt, lock: paths.length ? lockToRoute(paths, v.world, vel) : null };
      this.locks.set(v.id, c);
    }
    if (!c.lock) return predictPosition(v, nowSec);
    const meters = vel.speedMps * motionSeconds(nowSec - v.reportedAt);
    return c.lock.path.pointAt(c.lock.s + meters);
  }

  private lastDots = 0;
  private canvasOn = false;

  private frame(t: number) {
    const o = this.options(), th = this.theme();
    const zoom = this.mapc.zoom, nowMs = Date.now(), nowSec = nowMs / 1000;
    if (!o.visible) { if (this.canvasOn) { this.canvas.clear(); this.canvasOn = false; } this.mapc.setBuses(EMPTY); this.lastDots = t; return; }
    const tau = o.motion === "predict" ? TAU_PREDICT_MS : TAU_REPORTED_MS;

    if (zoom < 13) {
      // vista lejana: puntos simples, pocas veces por segundo
      if (this.canvasOn) { this.canvas.clear(); this.canvasOn = false; this.lastDots = 0; }
      if (t - this.lastDots < 1500 && this.last) return;
      this.last = 1; this.lastDots = t;
      const features: Feature<Point>[] = [];
      for (const v of this.state.fleet.values()) {
        if (o.system && v.system !== o.system) continue;
        if (o.routeId && v.routeId !== o.routeId) continue;
        const w = this.step(v.id, o.motion === "predict" ? this.predict(v, nowSec, false) : v.world, nowMs, tau);
        const g = toGeo(w);
        features.push({ type: "Feature", properties: { id: v.id, color: o.colorMode === "system" ? th.system[v.system] : this.delayColor(v, th) }, geometry: { type: "Point", coordinates: [g.lon, g.lat] } });
      }
      this.mapc.setBuses({ type: "FeatureCollection", features });
      this.applyFollow(nowMs);
      return;
    }

    // vista cercana: canvas, un cuadro tras otro
    if (!this.canvasOn) { this.mapc.setBuses(EMPTY); this.canvasOn = true; }
    const b = this.mapc.map.getBounds();
    const sw = toWorld({ lat: b.getSouth(), lon: b.getWest() }), ne = toWorld({ lat: b.getNorth(), lon: b.getEast() });
    const pad = 1800 / METERS_PER_WORLD_UNIT;   // un bus fuera de pantalla puede entrar en lo que dura la estimación
    const x0 = sw.x - pad, x1 = ne.x + pad, y0 = ne.y - pad, y1 = sw.y + pad;
    const items: BusDraw[] = [];
    for (const v of this.state.fleet.values()) {
      if (v.world.x < x0 || v.world.x > x1 || v.world.y < y0 || v.world.y > y1) continue;
      if (o.system && v.system !== o.system) continue;
      if (o.routeId && v.routeId !== o.routeId) continue;
      const w = this.step(v.id, o.motion === "predict" ? this.predict(v, nowSec, true) : v.world, nowMs, tau);
      const g = toGeo(w);
      items.push({ id: v.id, lon: g.lon, lat: g.lat, color: o.colorMode === "system" ? th.system[v.system] : this.delayColor(v, th),
        left: v.bearing != null && v.bearing > 180, label: this.state.routeOf(v)?.shortName ?? v.routeId });
    }
    this.canvas.haloColor = th.halo; this.canvas.textColor = th.labelStrong;
    this.items = items;
    this.canvas.draw(items);
    this.applyFollow(nowMs);
    if (nowMs - this.lastPrune > 30_000) {
      this.lastPrune = nowMs;
      for (const id of this.shown.keys()) if (!this.state.fleet.get(id)) { this.shown.delete(id); this.locks.delete(id); }
    }
  }

  private delayColor(v: Parameters<TransitState["delayOf"]>[0], th: MapTheme): string {
    const d = this.state.delayOf(v);
    switch (d.kind) {
      case "onTime": return th.delay.ok;
      case "early": return th.delay.early;
      case "late": return d.severe ? th.delay.bad : th.delay.warn;
      default: return th.delay.none;
    }
  }
}
