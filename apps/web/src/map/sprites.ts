/** Ícono de un bus visto de lado, en el color pedido. `left` lo voltea para que mire hacia la izquierda. */
export function busSprite(color: string, left: boolean, ratio = 2): ImageData {
  const W = 34, H = 22;
  const canvas = document.createElement("canvas");
  canvas.width = W * ratio; canvas.height = H * ratio;
  const c = canvas.getContext("2d")!;
  c.scale(ratio, ratio);
  c.translate(W / 2, H / 2 - 0.5);
  if (left) c.scale(-1, 1);
  c.lineWidth = 1.7; c.strokeStyle = "#fff"; c.fillStyle = color;
  rounded(c, -12, -6.5, 24, 12.5, 3.2); c.fill(); c.stroke();
  c.fillStyle = "rgba(255,255,255,.92)";
  for (let i = 0; i < 4; i++) c.fillRect(-9.2 + i * 4.5, -4.4, 3.4, 3.3);
  c.fillRect(8.4, -4.4, 2.6, 5.6);
  c.fillStyle = "rgba(0,0,0,.28)"; c.fillRect(-12, 2.2, 24, 1.6);
  c.fillStyle = "#1b1f27";
  for (const x of [-6.4, 6.4]) { c.beginPath(); c.arc(x, 6, 2.2, 0, 6.3); c.fill(); c.lineWidth = 0.8; c.stroke(); }
  return c.getImageData(0, 0, canvas.width, canvas.height);
}

function rounded(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath(); c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
