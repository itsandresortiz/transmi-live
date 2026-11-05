import type { Map as MLMap } from "maplibre-gl";
import { BUS_LONG_W, BUS_W, busSprite } from "./sprites";

export interface BusDraw { id: string; lon: number; lat: number; color: string; left: boolean; /** rumbo (grados desde el norte) o null si no se sabe */ angle?: number | null; /** vehículo articulado (troncal) */ long?: boolean; label: string; /** último servicio de su ruta */ last?: boolean }

const W = BUS_W, H = 22;
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
  private sprite(color: string, left: boolean, long: boolean): HTMLCanvasElement {
    const key = `${color}|${left}|${long}`;
    let s = this.sprites.get(key);
    if (!s) {
      const img = busSprite(color, left, 2 * this.dpr > 3 ? 3 : 2, long);
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
  draw(items: readonly BusDraw[]) {
    const ctx = this.ctx, z = this.map.getZoom(), k = iconScale(z), w = W * k, h = H * k, labels = z >= 16;
    const cw = this.cv.width / this.dpr, ch = this.cv.height / this.dpr;
    this.clear();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (labels) { ctx.font = this.font; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.lineJoin = "round"; ctx.lineWidth = 3.5; ctx.strokeStyle = this.haloColor; ctx.fillStyle = this.textColor; }
    for (const b of items) {
      const p = this.map.project([b.lon, b.lat]);
      const bw = b.long ? BUS_LONG_W * k : w;
      if (p.x < -bw || p.y < -bw || p.x > cw + bw || p.y > ch + bw) continue;
      if (b.last) { ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(bw, h) * 0.62, 0, Math.PI * 2); ctx.fillStyle = "rgba(245,158,11,.35)"; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = "#f59e0b"; ctx.stroke(); ctx.fillStyle = this.textColor; ctx.lineWidth = 3.5; ctx.strokeStyle = this.haloColor; }
      if (b.angle != null) {
        // el bus apunta por donde va su ruta; nunca queda de cabeza (si va hacia la izquierda se dibuja espejado)
        const a = (((b.angle - this.map.getBearing()) % 360) + 360) % 360, flip = a > 180;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(((flip ? a - 270 : a - 90) * Math.PI) / 180);
        ctx.drawImage(this.sprite(b.color, flip, !!b.long), -bw / 2, -h / 2, bw, h);
        ctx.restore();
      } else ctx.drawImage(this.sprite(b.color, b.left, !!b.long), p.x - bw / 2, p.y - h / 2, bw, h);
      if (labels) { ctx.strokeText(b.label, p.x, p.y - Math.max(h, b.angle != null ? bw * 0.5 : h) / 2 - 3); ctx.fillText(b.label, p.x, p.y - Math.max(h, b.angle != null ? bw * 0.5 : h) / 2 - 3); }
      this.hits.push({ id: b.id, x: p.x, y: p.y, r: (b.long ? 20 : 13) * k + 5 });
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
