/** Ícono de un bus visto de lado, en el color pedido. `left` lo voltea para que mire hacia la izquierda. */
export function busSprite(color: string, left: boolean, ratio = 2, long = false): ImageData {
  const W = long ? BUS_LONG_W : BUS_W, H = 22;
  const canvas = document.createElement("canvas");
  canvas.width = W * ratio; canvas.height = H * ratio;
  const c = canvas.getContext("2d")!;
  c.scale(ratio, ratio);
  c.translate(W / 2, H / 2 - 0.5);
  if (left) c.scale(-1, 1);
  c.lineWidth = 1.7; c.strokeStyle = "#fff"; c.fillStyle = color;
  if (!long) {
    rounded(c, -12, -6.5, 24, 12.5, 3.2); c.fill(); c.stroke();
    c.fillStyle = "rgba(255,255,255,.92)";
    for (let i = 0; i < 4; i++) c.fillRect(-9.2 + i * 4.5, -4.4, 3.4, 3.3);
    c.fillRect(8.4, -4.4, 2.6, 5.6);
    c.fillStyle = "rgba(0,0,0,.28)"; c.fillRect(-12, 2.2, 24, 1.6);
    c.fillStyle = "#1b1f27";
    for (const x of [-6.4, 6.4]) { c.beginPath(); c.arc(x, 6, 2.2, 0, 6.3); c.fill(); c.lineWidth = 0.8; c.stroke(); }
    return c.getImageData(0, 0, canvas.width, canvas.height);
  }
  // articulado: dos cuerpos unidos por un fuelle, como los de TransMilenio
  const L = 21;                                         // medio largo del vehículo
  rounded(c, -L, -6.5, L - 1.4, 12.5, 3.2); c.fill(); c.stroke();
  rounded(c, 1.4, -6.5, L - 1.4, 12.5, 3.2); c.fill(); c.stroke();
  c.fillStyle = "#1b1f27"; c.fillRect(-1.6, -4.6, 3.2, 8.4);               // fuelle
  c.fillStyle = "rgba(255,255,255,.92)";
  for (let i = 0; i < 4; i++) c.fillRect(-L + 3.2 + i * 4.4, -4.4, 3.2, 3.3);   // ventanas del cuerpo trasero
  for (let i = 0; i < 3; i++) c.fillRect(3.6 + i * 4.4, -4.4, 3.2, 3.3);        // ventanas del cuerpo delantero
  c.fillRect(L - 4.4, -4.4, 2.8, 5.6);                                          // parabrisas
  c.fillStyle = "rgba(0,0,0,.28)"; c.fillRect(-L, 2.2, L * 2, 1.6);
  c.fillStyle = "#1b1f27";
  for (const x of [-L + 7, 8.4, L - 6.2]) { c.beginPath(); c.arc(x, 6, 2.2, 0, 6.3); c.fill(); c.lineWidth = 0.8; c.stroke(); }
  return c.getImageData(0, 0, canvas.width, canvas.height);
}
export const BUS_W = 34, BUS_LONG_W = 52;

function rounded(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath(); c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

/** Etiqueta de estación: fondo redondeado que se estira según el nombre, con un cuadro rojo con el bus a la izquierda. */
export function stationChipImage(dark: boolean, color = "#e11d2e"): { image: ImageData; options: { pixelRatio: number; stretchX: [number, number][]; stretchY: [number, number][]; content: [number, number, number, number] } } {
  const W = 120, H = 48;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = dark ? "#1c1c1e" : "#ffffff"; g.strokeStyle = dark ? "rgba(255,255,255,.22)" : "rgba(60,70,90,.35)"; g.lineWidth = 2;
  rounded(g, 1, 1, W - 2, H - 2, 12); g.fill(); g.stroke();
  g.fillStyle = color; rounded(g, 4, 4, 40, 40, 9); g.fill();
  // bus de frente, en blanco
  g.strokeStyle = "#fff"; g.fillStyle = "#fff"; g.lineWidth = 2.4; g.lineCap = "round"; g.lineJoin = "round";
  rounded(g, 13, 11, 22, 20, 5); g.stroke();
  g.beginPath(); g.moveTo(13, 22); g.lineTo(35, 22); g.stroke();
  g.beginPath(); g.arc(19.5, 27, 1.5, 0, 6.3); g.fill(); g.beginPath(); g.arc(28.5, 27, 1.5, 0, 6.3); g.fill();
  g.beginPath(); g.moveTo(18, 35); g.lineTo(20, 31.5); g.moveTo(30, 35); g.lineTo(28, 31.5); g.stroke();
  return { image: g.getImageData(0, 0, W, H), options: { pixelRatio: 2, stretchX: [[56, 88]], stretchY: [[16, 32]], content: [52, 8, 112, 40] } };
}
