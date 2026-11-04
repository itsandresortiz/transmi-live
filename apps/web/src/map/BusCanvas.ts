import type { Map as MLMap } from "maplibre-gl";
import { busSprite } from "./sprites";

export interface BusDraw { id: string; lon: number; lat: number; color: string; left: boolean; label: string }

const W = 34, H = 22;
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
  private hits: { id: string; x: number; y: number }[] = [];
  private dpr = 1;
  private font = "600 11.5px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";
  haloColor = "#000";
  textColor = "#fff";

  constructor(private readonly map: MLMap) {
    this.cv = document.createElement("canvas");
    this.cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1";
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
  private sprite(color: string, left: boolean): HTMLCanvasElement {
    const key = `${color}|${left}`;
    let s = this.sprites.get(key);
    if (!s) {
      const img = busSprite(color, left, 2 * this.dpr > 3 ? 3 : 2);
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
      if (p.x < -w || p.y < -h || p.x > cw + w || p.y > ch + h) continue;
      ctx.drawImage(this.sprite(b.color, b.left), p.x - w / 2, p.y - h / 2, w, h);
      if (labels) { ctx.strokeText(b.label, p.x, p.y - h / 2 - 3); ctx.fillText(b.label, p.x, p.y - h / 2 - 3); }
      this.hits.push({ id: b.id, x: p.x, y: p.y });
    }
  }
  /** Bus bajo el dedo/cursor (el de arriba si hay varios). */
  hitTest(pt: { x: number; y: number }): string | null {
    const r = Math.max(14, 11 * iconScale(this.map.getZoom()) + 6);
    let best: string | null = null, bd = r * r;
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i]!, d = (h.x - pt.x) ** 2 + (h.y - pt.y) ** 2;
      if (d <= bd) { bd = d; best = h.id; }
    }
    return best;
  }
}
