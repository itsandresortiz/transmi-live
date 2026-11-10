/** Un bus visto desde arriba, mirando hacia ARRIBA (norte): techo, parabrisas al frente, puertas del lado derecho y, en los articulados, el fuelle.
 *  Lo dibuja la web con canvas y de él salen también las imágenes de la app (tools/bus-sprites.ts): así se ven iguales en los dos. */
export const TOP_W = 19, TOP_H = 34, TOP_LONG_H = 53;      // tamaño del lienzo (unidades), con margen para la sombra
const BW = 11, L_STD = 26, FRONT = 24, GAP = 2.4, REAR = 18.6, L_LONG = FRONT + GAP + REAR;

function rounded(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath(); c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

/** Dibuja un cuerpo del bus con sus detalles; `front` lleva parabrisas y espejos, `rear` la luneta. */
function body(c: CanvasRenderingContext2D, y: number, h: number, front: boolean, rear: boolean, doors: number) {
  const x = -BW / 2;
  // techo: un panel más claro con dos claraboyas
  c.fillStyle = "rgba(255,255,255,.17)"; rounded(c, x + 1.5, y + (front ? 5.8 : 1.6), BW - 3, h - (front ? 5.8 : 1.6) - (rear ? 3.6 : 1.6), 1.6); c.fill();
  c.fillStyle = "rgba(0,0,0,.16)";
  const vy0 = y + (front ? 8.6 : 3.6), vy1 = y + h - (rear ? 6 : 4.4);
  for (const t of [0.0, 0.5, 1.0]) { const yy = vy0 + (vy1 - vy0) * t; if (yy + 2 < y + h - 2) c.fillRect(-2.2, yy, 4.4, 1.7); }
  if (front) {
    c.fillStyle = "rgba(18,24,34,.9)"; rounded(c, x + 1.5, y + 1.1, BW - 3, 4.1, 1.3); c.fill();       // parabrisas
    c.fillStyle = "rgba(255,255,255,.3)"; c.fillRect(x + 2.4, y + 1.7, BW - 4.8, 0.7);                 // reflejo
    c.fillStyle = "#1b1f27";                                                                          // espejos
    rounded(c, x - 1.3, y + 5.2, 1.7, 2.8, 0.7); c.fill(); rounded(c, -x - 0.4, y + 5.2, 1.7, 2.8, 0.7); c.fill();
  }
  if (rear) { c.fillStyle = "rgba(18,24,34,.72)"; rounded(c, x + 2.2, y + h - 2.8, BW - 4.4, 1.5, 0.7); c.fill(); }
  // puertas: marcas claras en el costado derecho (se maneja por la derecha)
  c.fillStyle = "rgba(255,255,255,.92)";
  for (let i = 0; i < doors; i++) c.fillRect(BW / 2 - 1.5, y + (front ? 8 : 3) + ((h - (front ? 12 : 7)) * (i + 0.5)) / doors - 2.2, 1.7, 4.4);
}

/** `ratio` es cuántos píxeles tiene cada unidad (la sombra se mide en píxeles). */
export function drawTopBus(c: CanvasRenderingContext2D, color: string, long: boolean, ratio = 1): void {
  const L = long ? L_LONG : L_STD, top = -L / 2, x = -BW / 2;
  c.save();
  c.shadowColor = "rgba(0,0,0,.3)"; c.shadowBlur = 3 * ratio; c.shadowOffsetX = 1.1 * ratio; c.shadowOffsetY = 1.5 * ratio;
  c.lineWidth = 1.1; c.strokeStyle = "#fff"; c.fillStyle = color;
  if (!long) { rounded(c, x, top, BW, L, 3.4); c.fill(); c.stroke(); }
  else { rounded(c, x, top, BW, FRONT, 3.4); c.fill(); c.stroke(); rounded(c, x, top + FRONT + GAP, BW, REAR, 3.4); c.fill(); c.stroke(); }
  c.restore();
  c.save();
  if (!long) body(c, top, L, true, true, 2);
  else {
    body(c, top, FRONT, true, false, 2);
    body(c, top + FRONT + GAP, REAR, false, true, 2);
    // fuelle: negro con pliegues
    c.fillStyle = "#1b1f27"; c.fillRect(x + 1.1, top + FRONT - 0.5, BW - 2.2, GAP + 1);
    c.strokeStyle = "rgba(255,255,255,.35)"; c.lineWidth = 0.5;
    for (const t of [0.3, 0.55, 0.8]) { const yy = top + FRONT - 0.5 + (GAP + 1) * t; c.beginPath(); c.moveTo(x + 1.6, yy); c.lineTo(-x - 1.6, yy); c.stroke(); }
  }
  c.restore();
}

/** Imagen del bus de arriba lista para usar en un mapa (mirando al norte). */
export function busTopSprite(color: string, long: boolean, ratio = 2): ImageData {
  const W = TOP_W, H = long ? TOP_LONG_H : TOP_H;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(W * ratio); canvas.height = Math.round(H * ratio);
  const c = canvas.getContext("2d")!;
  c.scale(ratio, ratio); c.translate(W / 2, H / 2);
  drawTopBus(c, color, long, ratio);
  return c.getImageData(0, 0, canvas.width, canvas.height);
}
