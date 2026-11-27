import type { Map as MLMap } from "maplibre-gl";
import { TOP_H, TOP_LONG_H, TOP_W, busTopSprite } from "./busTop";

export interface BusDraw { id: string; /** dejó de reportar hace rato: se dibuja atenuado */ stale?: boolean; lon: number; lat: number; color: string; left: boolean; /** rumbo (grados desde el norte) o null si no se sabe */ angle?: number | null; /** vehículo articulado (troncal) */ long?: boolean; label: string; /** último servicio de su ruta */ last?: boolean; /** su ruta tiene un aviso vigente (desvío, cierre) */ alert?: boolean }

const W = TOP_W;
/** Tamaño del ícono según el zoom (igual que el que tenía la capa del mapa). */
function iconScale(z: number): number {
  const pts: [number, number][] = [[13, 0.5], [15, 0.8], [17, 1], [19, 1.25]];
  if (z <= pts[0]![0]) return pts[0]![1];
  for (let i = 1; i < pts.length; i++) {
    const [z1, s1] = pts[i]!, [z0, s0] = pts[i - 1]!;
    if (z <= z1) return s0 + ((s1 - s0) * (z - z0)) / (z1 - z0);
  }
  return pts[pts.length - 1]![1];
}

/** Dibuja los buses sobre el mapa con canvas 2D, cuadro a cuadro: así el movimiento es continuo
 *  (MapLibre tendría que reprocesar todo el GeoJSON en cada cuadro). */
export class BusCanvas {
  private readonly cv: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private sprites = new Map<string, HTMLCanvasElement>();
  private hits: { id: string; x: number; y: number; r: number }[] = [];
  private dpr = 1;
  private font = "600 11.5px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";
  haloColor = "#000";
  textColor = "#fff";

  constructor(private readonly map: MLMap) {
    this.cv = document.createElement("canvas");
    this.cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0";
    map.getCanvasContainer().appendChild(this.cv);
    this.ctx = this.cv.getContext("2d")!;
    this.resize();
    map.on("resize", () => this.resize());
  }
  private resize() {
    const c = this.map.getContainer();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cv.width = Math.round(c.clientWidth * this.dpr);
    this.cv.height = Math.round(c.clientHeight * this.dpr);
  }
  private sprite(color: string, long: boolean): HTMLCanvasElement {
    const key = `${color}|${long}`;
    let s = this.sprites.get(key);
    if (!s) {
      const img = busTopSprite(color, long, 2 * this.dpr > 3 ? 3 : 2);
      s = document.createElement("canvas"); s.width = img.width; s.height = img.height;
      s.getContext("2d")!.putImageData(img, 0, 0);
      this.sprites.set(key, s);
    }
    return s;
  }
  clear() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.cv.width, this.cv.height);
    this.hits = [];
  }
  /** `solid`: los buses se ven con volumen en el mapa (vista 3D de cerca): aquí solo van el nombre, el aro y la marca «!», y el toque.
   *  `lift` (buses modelados): punto de la pantalla a `alt` m sobre el bus; el nombre y la marca van sobre el techo y el toque cubre el cuerpo. */
  draw(items: readonly BusDraw[], solid = false, lift?: (b: BusDraw, alt: number) => { x: number; y: number } | null) {
    const ctx = this.ctx, z = this.map.getZoom(), k = iconScale(z), labels = z >= 16;
    const cw = this.cv.width / this.dpr, ch = this.cv.height / this.dpr;
    this.clear();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (labels) { ctx.font = this.font; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.lineJoin = "round"; ctx.lineWidth = 3.5; ctx.strokeStyle = this.haloColor; ctx.fillStyle = this.textColor; }
    // vista 3D (mapa inclinado): los buses lejanos se dibujan más pequeños y los cercanos algo más grandes, como el resto del mapa.
    // Se compara cuánto mide en pantalla un tramo corto de calle junto al bus con lo que mide en el centro.
    const pitched = this.map.getPitch() > 1, D = 0.0002;
    let ref = 1;
    if (pitched) { const c = this.map.getCenter(), a = this.map.project(c), b2 = this.map.project([c.lng + D, c.lat]); ref = Math.hypot(b2.x - a.x, b2.y - a.y) || 1; }
    for (const b of items) {
      const p = this.map.project([b.lon, b.lat]);
      let s = 1;
      if (pitched) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        if (p.x < -60 || p.y < -60 || p.x > cw + 60 || p.y > ch + 60) continue;      // fuera de la pantalla: no se mide
        const q = this.map.project([b.lon + D, b.lat]);
        s = Math.min(1.35, Math.max(0.45, Math.hypot(q.x - p.x, q.y - p.y) / ref));
      }
      const w = W * k * s;
      const h = (b.long ? TOP_LONG_H : TOP_H) * k * s;      // largo del bus (el dibujo mira hacia arriba)
      if (p.x < -h || p.y < -h || p.x > cw + h || p.y > ch + h) continue;
      // hacia dónde mira en la pantalla (grados desde arriba, en sentido del reloj); sin rumbo, de lado según su sentido
      const deg = b.angle != null ? b.angle - this.map.getBearing() : b.left ? -90 : 90, rad = (deg * Math.PI) / 180;
      if (b.last) { ctx.beginPath(); ctx.arc(p.x, p.y, h * 0.62, 0, Math.PI * 2); ctx.fillStyle = "rgba(245,158,11,.35)"; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = "#f59e0b"; ctx.stroke(); ctx.fillStyle = this.textColor; ctx.lineWidth = 3.5; ctx.strokeStyle = this.haloColor; }
      if (!solid) {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(rad);
        if (b.stale) ctx.globalAlpha = 0.38;
        ctx.drawImage(this.sprite(b.color, !!b.long), -w / 2, -h / 2, w, h);
        ctx.restore();
      }
      // bus modelado: su techo en la pantalla (a 3,3 m) y su cuerpo (a 1,5 m)
      const top = solid && lift ? lift(b, 3.3) : null, mid = top && lift ? lift(b, 1.5) : null;
      if (b.alert) {
        // marca ámbar «!» arriba a la derecha del bus: su ruta tiene un aviso vigente
        const r = Math.max(4, 5.5 * k), cx = (top?.x ?? p.x) + w * 0.55, cy = top ? top.y - 2 : p.y - h * 0.35;
        ctx.save();
        if (b.stale) ctx.globalAlpha = 0.38;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = "#f59e0b"; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = "#ffffff"; ctx.stroke();
        ctx.fillStyle = "#ffffff"; ctx.font = `700 ${Math.round(r * 1.5)}px system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("!", cx, cy + 0.5);
        ctx.restore();
        if (labels) { ctx.font = this.font; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; }
      }
      if (labels) {
        const up = (Math.abs(Math.cos(rad)) * h + Math.abs(Math.sin(rad)) * w) / 2;      // cuánto se extiende el bus hacia arriba, según su giro
        const lx = top?.x ?? p.x, ly = top ? Math.min(p.y - up - 3, top.y - 8) : p.y - up - 3;
        ctx.strokeText(b.label, lx, ly); ctx.fillText(b.label, lx, ly);
      }
      this.hits.push({ id: b.id, x: p.x, y: p.y, r: (b.long ? 20 : 13) * k * s + 5 });
      if (mid) this.hits.push({ id: b.id, x: mid.x, y: mid.y, r: (b.long ? 20 : 13) * k * s + 5 });
    }
  }
  /** Bus bajo el dedo/cursor: se toca el dibujo del bus (con un margen para el dedo), no un círculo grande a su alrededor. */
  hitTest(pt: { x: number; y: number }): string | null {
    let best: string | null = null, bd = Infinity;
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i]!, dx = h.x - pt.x, dy = h.y - pt.y, d = dx * dx + dy * dy;
      if (d > h.r * h.r) continue;
      if (d < bd) { bd = d; best = h.id; }
    }
    return best;
  }
}
