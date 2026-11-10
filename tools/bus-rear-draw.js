// Bus visto desde atrás y arriba (3/4), para la escena de «Voy en este bus» de la app: cara trasera con ventana y luces, y el techo alejándose en perspectiva.
// Lienzo 120 × (long ? 250 : 190). JavaScript simple porque se ejecuta dentro de un navegador (tools/bus-sprites.ts).
function shade(hex, k) { const n = parseInt(hex.slice(1), 16), f = (v) => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k))); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; }
function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function quad(c, x0, x1, y0, x2, x3, y1, r) { // trapecio: arriba (x0..x1 en y0), abajo (x2..x3 en y1)
  c.beginPath(); c.moveTo(x0 + r, y0); c.lineTo(x1 - r, y0); c.quadraticCurveTo(x1, y0, x1 + (x3 - x1) * 0.06, y0 + r); c.lineTo(x3, y1); c.lineTo(x2, y1); c.lineTo(x0 - (x0 - x2) * 0.06, y0 + r); c.quadraticCurveTo(x0, y0, x0 + r, y0); c.closePath(); }
function drawRearBus(c, color, long) {
  const H = long ? 250 : 190, faceH = 62, faceY = H - faceH - 12, x0 = 12, x1 = 108;   // cara trasera
  const at = (t) => ({ l: x0 + 20 * t, r: x1 - 20 * t, y: faceY - (faceY - 14) * t });   // techo: t=0 atrás, t=1 al frente (más angosto y arriba)
  // sombra en el piso
  c.save(); c.fillStyle = "rgba(0,0,0,.28)"; c.filter = "blur(5px)"; c.beginPath(); c.ellipse(60, H - 10, 54, 9, 0, 0, 6.3); c.fill(); c.restore();
  const roof = (ta, tb) => { const a = at(ta), b = at(tb);
    const g = c.createLinearGradient(0, b.y, 0, a.y); g.addColorStop(0, shade(color, 0.34)); g.addColorStop(1, shade(color, 0.12));
    c.fillStyle = g; quad(c, b.l, b.r, b.y, a.l, a.r, a.y, 7); c.fill();
    // costados del techo: un filo más oscuro que da volumen
    c.strokeStyle = shade(color, -0.25); c.lineWidth = 1.6; c.beginPath(); c.moveTo(a.l, a.y); c.lineTo(b.l, b.y + 6); c.moveTo(a.r, a.y); c.lineTo(b.r, b.y + 6); c.stroke();
    // equipos del techo (aire y claraboyas)
    for (const t of [0.22, 0.5, 0.78]) { const m = at(ta + (tb - ta) * t), w = (m.r - m.l) * 0.42, h = 9 * (1 - 0.35 * (ta + (tb - ta) * t)); c.fillStyle = "rgba(255,255,255,.22)"; rr(c, 60 - w / 2, m.y - h / 2, w, h, 2.5); c.fill(); c.fillStyle = "rgba(0,0,0,.14)"; rr(c, 60 - w / 2 + 2, m.y - h / 2 + 2, w - 4, h - 4, 1.5); c.fill(); }
  };
  if (long) { roof(0.52, 1); const a = at(0.46), b = at(0.52); c.fillStyle = "#1b1f27"; quad(c, b.l + 2, b.r - 2, b.y, a.l + 2, a.r - 2, a.y, 1); c.fill(); c.strokeStyle = "rgba(255,255,255,.3)"; c.lineWidth = 0.8; for (const t of [0.475, 0.49, 0.505]) { const m = at(t); c.beginPath(); c.moveTo(m.l + 4, m.y); c.lineTo(m.r - 4, m.y); c.stroke(); } roof(0, 0.46); }
  else roof(0, 1);
  // cara trasera
  const g = c.createLinearGradient(0, faceY, 0, faceY + faceH); g.addColorStop(0, shade(color, -0.04)); g.addColorStop(1, shade(color, -0.3));
  c.fillStyle = g; rr(c, x0, faceY, x1 - x0, faceH, 9); c.fill();
  c.fillStyle = shade(color, 0.3); rr(c, x0 + 3, faceY, x1 - x0 - 6, 3, 1.5); c.fill();                       // filo de luz arriba
  c.fillStyle = "#141922"; rr(c, x0 + 9, faceY + 8, x1 - x0 - 18, 24, 5); c.fill();                           // ventana trasera
  c.fillStyle = "rgba(255,255,255,.16)"; c.beginPath(); c.moveTo(x0 + 16, faceY + 10); c.lineTo(x0 + 40, faceY + 10); c.lineTo(x0 + 26, faceY + 30); c.lineTo(x0 + 12, faceY + 30); c.closePath(); c.fill();   // reflejo
  c.fillStyle = "#ff5a4d"; rr(c, x0 + 6, faceY + 38, 16, 7, 2.5); c.fill(); rr(c, x1 - 22, faceY + 38, 16, 7, 2.5); c.fill();   // luces
  c.fillStyle = "#ffd27a"; rr(c, x0 + 24, faceY + 39, 7, 5, 2); c.fill(); rr(c, x1 - 31, faceY + 39, 7, 5, 2); c.fill();
  c.fillStyle = "rgba(255,255,255,.9)"; rr(c, 49, faceY + 38, 22, 8, 2); c.fill();                           // placa
  c.fillStyle = "#12161d"; rr(c, x0 + 2, faceY + faceH - 11, x1 - x0 - 4, 11, 4); c.fill();                  // parachoques
  c.fillStyle = "#0b0d11"; rr(c, x0 + 6, faceY + faceH - 3, 20, 9, 3); c.fill(); rr(c, x1 - 26, faceY + faceH - 3, 20, 9, 3); c.fill();   // llantas
}
if (typeof module !== "undefined") module.exports = { drawRearBus };
