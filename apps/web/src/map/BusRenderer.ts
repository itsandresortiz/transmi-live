import type { Feature, FeatureCollection, Point } from "geojson";
import type { TransitState } from "@transmi/application";
import { type GeoPoint, type RouteLock, RoadPath, type SystemType, type Vehicle, type WorldPoint, DEFAULT_PREDICTION, distanceMeters, lockToRoute, motionSeconds, predictPosition, toGeo } from "@transmi/domain";
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
  ) {}

  start() {
    const loop = (t: number) => {
      this.raf = requestAnimationFrame(loop);
      if (t - this.last < this.interval()) return;
      this.last = t;
      this.tick();
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop() { cancelAnimationFrame(this.raf); }
  /** Pide dibujar en el próximo cuadro (por ejemplo, tras cambiar un filtro). */
  refresh() { this.last = 0; }
  setFollow(id: string | null) { this.followId = id; this.last = 0; }

  /** Con el mapa lejano los buses casi no se mueven en pantalla: se actualiza menos y se ahorra batería. */
  private interval(): number {
    if (this.followId) return 150;
    const z = this.mapc.zoom;
    return z < 13 ? 1500 : z < 15.5 ? 500 : 150;
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

  private tick() {
    const o = this.options(), th = this.theme();
    if (!o.visible) { this.mapc.setBuses(EMPTY); return; }
    const nowMs = Date.now(), nowSec = nowMs / 1000, zoom = this.mapc.zoom;
    const cull = zoom >= 13;
    const bounds = cull ? this.mapc.map.getBounds() : null;
    const padLng = bounds ? (bounds.getEast() - bounds.getWest()) * 0.25 : 0;
    const padLat = bounds ? (bounds.getNorth() - bounds.getSouth()) * 0.25 : 0;
    const icons = zoom >= 12.5;
    const features: Feature<Point>[] = [];
    const tau = o.motion === "predict" ? TAU_PREDICT_MS : TAU_REPORTED_MS;

    for (const v of this.state.fleet.values()) {
      if (o.system && v.system !== o.system) continue;
      if (o.routeId && v.routeId !== o.routeId) continue;
      const target = o.motion === "predict" ? this.predict(v, nowSec, cull) : v.world;
      const w = this.step(v.id, target, nowMs, tau);
      const g = toGeo(w);
      if (bounds && (g.lon < bounds.getWest() - padLng || g.lon > bounds.getEast() + padLng || g.lat < bounds.getSouth() - padLat || g.lat > bounds.getNorth() + padLat)) continue;
      const color = o.colorMode === "system" ? th.system[v.system] : this.delayColor(v, th);
      features.push({
        type: "Feature",
        properties: {
          id: v.id, color,
          icon: icons ? this.mapc.busIcon(color, v.bearing != null && v.bearing > 180) : "",
          label: this.state.routeOf(v)?.shortName ?? v.routeId,
        },
        geometry: { type: "Point", coordinates: [g.lon, g.lat] },
      });
    }
    this.mapc.setBuses({ type: "FeatureCollection", features });

    if (this.followId) {
      const p = this.position(this.followId);
      if (p) this.mapc.follow(p);
    }
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
