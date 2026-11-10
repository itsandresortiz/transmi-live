// Bus en 3D para la escena de «Voy en este bus» de la app. No se dibuja «a ojo»: es una caja real (ancho, largo y alto) proyectada con LA MISMA cámara
// que usa la vía en apps/mobile/src/ui/RideScene.tsx (perspectiva 600, suelo inclinado 56° sobre su borde inferior), así el techo, la cara trasera
// y el costado visible (el izquierdo: el bus va por el carril derecho) cuadran exactamente con la calle.
// JavaScript simple porque se ejecuta dentro de un navegador (tools/bus-sprites.ts). Devuelve además dónde poner la imagen en la escena.
const CAM = { d: 600, tilt: (56 * Math.PI) / 180 };
/** Punto del mundo → pantalla. xg: metros de pantalla a lo ancho desde el centro de la vía; s: distancia sobre el suelo desde el borde inferior; h: altura sobre el suelo.
 *  Devuelve x desde el centro de la escena e y hacia ARRIBA desde el borde inferior de la escena. */
function project(xg, s, h) {
  const y = s * Math.cos(CAM.tilt) + h * Math.sin(CAM.tilt), z = -s * Math.sin(CAM.tilt) + h * Math.cos(CAM.tilt), k = CAM.d / (CAM.d - z);
  return { x: xg * k, y: y * k };
}
function shade(hex, k) { const n = parseInt(hex.slice(1), 16), f = (v) => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k))); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; }

const BUS = { cx: 50, w: 66, h: 78, s0: 46 };          // centro del carril derecho, ancho, alto y dónde queda la cola (unidades del suelo de la escena)
const BOXES = { s: [{ a: 0, b: 250 }], l: [{ a: 0, b: 176 }, { a: 190, b: 420 }] };      // corto: un cuerpo; articulado: dos con el fuelle entre ellos

/** Dibuja el bus en un lienzo ya escalado (R px por unidad de pantalla) y trasladado; `P` convierte un punto del mundo en coordenadas del lienzo. */
function paintBus(c, color, long, P) {
  const x0 = BUS.cx - BUS.w / 2, x1 = BUS.cx + BUS.w / 2, H = BUS.h;
  const poly = (pts, fill) => { c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath(); c.fillStyle = fill; c.fill(); c.lineJoin = "round"; c.lineWidth = 1.2; c.strokeStyle = fill; c.stroke(); };
  const grad = (a, b, ca, cb) => { const g = c.createLinearGradient(a.x, a.y, b.x, b.y); g.addColorStop(0, ca); g.addColorStop(1, cb); return g; };
  const boxes = BOXES[long ? "l" : "s"].map((b) => ({ a: BUS.s0 + b.a, b: BUS.s0 + b.b }));
  const tail = boxes[0].a, nose = boxes[boxes.length - 1].b;

  // sombra en el piso (un poco más grande que el bus)
  c.save(); c.filter = "blur(4px)"; poly([P(x0 - 6, tail - 10, 0), P(x1 + 8, tail - 10, 0), P(x1 + 8, nose + 6, 0), P(x0 - 6, nose + 6, 0)], "rgba(0,0,0,.42)"); c.restore();

  for (let i = boxes.length - 1; i >= 0; i--) {                        // de lejos a cerca
    const { a, b } = boxes[i];
    if (i < boxes.length - 1) {                                        // fuelle hacia el cuerpo de adelante
      const g0 = b, g1 = boxes[i + 1].a;
      poly([P(x0 + 3, g0, 4), P(x0 + 3, g1, 4), P(x0 + 3, g1, H - 3), P(x0 + 3, g0, H - 3)], "#14171d");
      poly([P(x0 + 3, g0, H - 3), P(x1 - 3, g0, H - 3), P(x1 - 3, g1, H - 3), P(x0 + 3, g1, H - 3)], "#20242c");
    }
    // costado izquierdo (el que se ve): más oscuro, con la franja de ventanas, puertas y llantas
    poly([P(x0, a, 0), P(x0, b, 0), P(x0, b, H), P(x0, a, H)], grad(P(x0, a, H), P(x0, a, 0), shade(color, -0.34), shade(color, -0.52)));
    poly([P(x0, a + 6, H * 0.5), P(x0, b - 6, H * 0.5), P(x0, b - 6, H * 0.84), P(x0, a + 6, H * 0.84)], "rgba(14,18,26,.92)");
    const n = Math.max(2, Math.round((b - a) / 44));
    for (let k = 1; k < n; k++) { const s = a + ((b - a) * k) / n; poly([P(x0, s - 1.2, H * 0.5), P(x0, s + 1.2, H * 0.5), P(x0, s + 1.2, H * 0.84), P(x0, s - 1.2, H * 0.84)], shade(color, -0.45)); }
    for (const t of [0.2, 0.8]) { const s = a + (b - a) * t; poly([P(x0, s - 13, 0), P(x0, s + 13, 0), P(x0, s + 13, 15), P(x0, s + 8, 22), P(x0, s - 8, 22), P(x0, s - 13, 15)], "#0c0e12"); }
    // techo: lo más claro, con un bisel y los equipos de aire
    poly([P(x0, a, H), P(x1, a, H), P(x1, b, H), P(x0, b, H)], grad(P(BUS.cx, b, H), P(BUS.cx, a, H), shade(color, 0.3), shade(color, 0.1)));
    poly([P(x0 + 5, a + 5, H + 0.5), P(x1 - 5, a + 5, H + 0.5), P(x1 - 5, b - 5, H + 0.5), P(x0 + 5, b - 5, H + 0.5)], "rgba(255,255,255,.1)");
    const units = Math.max(1, Math.round((b - a) / 90));
    for (let k = 0; k < units; k++) {
      const s = a + ((b - a) * (k + 0.5)) / units, u0 = BUS.cx - 17, u1 = BUS.cx + 17, l = 26, hh = 7;
      poly([P(u0, s - l, H), P(u0, s + l, H), P(u0, s + l, H + hh), P(u0, s - l, H + hh)], shade(color, -0.12));               // costado del equipo
      poly([P(u0, s - l, H), P(u1, s - l, H), P(u1, s - l, H + hh), P(u0, s - l, H + hh)], shade(color, 0.02));                // cara trasera del equipo
      poly([P(u0, s - l, H + hh), P(u1, s - l, H + hh), P(u1, s + l, H + hh), P(u0, s + l, H + hh)], shade(color, 0.42));      // tapa
      poly([P(u0 + 5, s - l + 6, H + hh + 0.3), P(u1 - 5, s - l + 6, H + hh + 0.3), P(u1 - 5, s + l - 6, H + hh + 0.3), P(u0 + 5, s + l - 6, H + hh + 0.3)], "rgba(0,0,0,.16)");
    }
  }
  // cara trasera (la más cercana): ventana, luces, placa y parachoques
  const a = tail, R = (x, h) => P(x, a, h);
  poly([R(x0, 0), R(x1, 0), R(x1, H), R(x0, H)], grad(R(BUS.cx, H), R(BUS.cx, 0), shade(color, -0.06), shade(color, -0.3)));
  poly([R(x0 + 2, H - 3), R(x1 - 2, H - 3), R(x1 - 2, H), R(x0 + 2, H)], shade(color, 0.28));                                   // filo de luz bajo el techo
  poly([R(x0 + 7, H * 0.48), R(x1 - 7, H * 0.48), R(x1 - 7, H * 0.86), R(x0 + 7, H * 0.86)], "#121720");                        // ventana trasera
  poly([R(x0 + 12, H * 0.5), R(x0 + 26, H * 0.5), R(x0 + 38, H * 0.84), R(x0 + 24, H * 0.84)], "rgba(255,255,255,.14)");        // reflejo
  for (const sx of [x0 + 4, x1 - 15]) poly([R(sx, H * 0.28), R(sx + 11, H * 0.28), R(sx + 11, H * 0.38), R(sx, H * 0.38)], "#ff5a4d");
  for (const sx of [x0 + 17, x1 - 22]) poly([R(sx, H * 0.29), R(sx + 5, H * 0.29), R(sx + 5, H * 0.37), R(sx, H * 0.37)], "#ffd27a");
  poly([R(BUS.cx - 9, H * 0.27), R(BUS.cx + 9, H * 0.27), R(BUS.cx + 9, H * 0.39), R(BUS.cx - 9, H * 0.39)], "rgba(255,255,255,.92)");   // placa
  poly([R(x0 + 1, 3), R(x1 - 1, 3), R(x1 - 1, H * 0.2), R(x0 + 1, H * 0.2)], "#12161d");                                        // parachoques
  for (const sx of [x0 + 3, x1 - 17]) poly([R(sx, 0), R(sx + 14, 0), R(sx + 14, 10), R(sx, 10)], "#090b0e");                    // llantas traseras
}

/** Caja que encierra al bus en pantalla (con margen para la sombra): x desde el centro de la escena, y hacia arriba desde su borde inferior. */
function busBounds(long) {
  const x0 = BUS.cx - BUS.w / 2 - 12, x1 = BUS.cx + BUS.w / 2 + 14, boxes = BOXES[long ? "l" : "s"], tail = BUS.s0 - 16, nose = BUS.s0 + boxes[boxes.length - 1].b + 10;
  const pts = []; for (const x of [x0, x1]) for (const s of [tail, nose]) for (const h of [0, BUS.h + 10]) pts.push(project(x, s, h));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { left: Math.floor(Math.min(...xs)), right: Math.ceil(Math.max(...xs)), bottom: Math.floor(Math.min(...ys)), top: Math.ceil(Math.max(...ys)), nose: BUS.s0 + boxes[boxes.length - 1].b };
}
/** Pinta el bus en un lienzo del tamaño justo y devuelve la imagen (PNG en base64) y dónde ponerla. */
function renderBus(canvas, color, long, R) {
  const b = busBounds(long), w = b.right - b.left, h = b.top - b.bottom;
  canvas.width = Math.round(w * R); canvas.height = Math.round(h * R);
  const c = canvas.getContext("2d"); c.clearRect(0, 0, canvas.width, canvas.height); c.scale(R, R);
  paintBus(c, color, long, (xg, s, hh) => { const p = project(xg, s, hh); return { x: p.x - b.left, y: b.top - p.y }; });
  return { png: canvas.toDataURL("image/png"), meta: { left: b.left, bottom: b.bottom, width: w, height: h, nose: b.nose } };
}
if (typeof module !== "undefined") module.exports = { renderBus, busBounds, project };
