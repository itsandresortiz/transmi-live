import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { BUS_DIMENSIONS } from "@transmi/application";

/** Geometría de los buses modelados (vista 3D de la web), armada con three.js sin archivos externos: carrocería con aristas
 *  redondeadas (perfil de lado extruido con bisel, con los guardabarros recortados), parabrisas inclinado, ventanas oscuras con marcos,
 *  puertas, techo más claro con el aire acondicionado, ruedas redondas con rin, faros, pilotos, parachoques, espejos, letrero de ruta y
 *  una sombra de contacto. Ejes: X a la derecha del bus, Y hacia adelante, Z arriba; en metros, con el centro del bus en el suelo.
 *  Cada pieza va en un grupo: `body` (color del sistema), `roof` (techo y aire, el color aclarado), `fixed` (colores propios por vértice)
 *  y `shade` (sombra, negro con opacidad por vértice). */

/* ---------- medidas (m) ---------- */
const W = BUS_DIMENSIONS.width;
/** Bajo de la carrocería, alto del techo, cintura (donde empiezan las ventanas) y alto de las ventanas. */
const Z_BOTTOM = 0.32, Z_ROOF = 2.95, Z_BELT = 1.28, Z_WIN_TOP = 2.48;
/** Ruedas: 1 m de diámetro, 32 cm de ancho; guardabarros algo más grande que la rueda. */
const WHEEL_R = 0.5, WHEEL_W = 0.32, ARCH_R = 0.6;
/** Redondeo de todas las aristas de la carrocería. */
const BEVEL = 0.09;
/** Frente: hasta dónde es vertical (parachoques y faros) y cuánto se echa atrás el parabrisas al subir. */
const NOSE_V = 1.0, NOSE_BACK = 0.32, NOSE_TOP = 2.5;

/** Colores fijos (sRGB). */
const GLASS = "#1d2530", GLASS_DOOR = "#141a22", TIRE = "#17191d", RIM = "#c3c8cf", HUB = "#6d737c", TRIM = "#202328",
  WELL = "#0e0f12", HEAD = "#fff4d6", TAIL = "#d0202c", SIGN = "#ffb21e", MIRROR = "#1a1c20", BELLOWS_A = "#2a2d33", BELLOWS_B = "#17191c";

export type Group = "body" | "roof" | "fixed" | "shade";
export const GROUPS: Group[] = ["body", "roof", "fixed", "shade"];
export type Parts = Record<Group, THREE.BufferGeometry[]>;

/** Pasa una geometría al formato común (sin índices ni coordenadas de textura) con un color por vértice. */
function tint(g: THREE.BufferGeometry, hex: string | number): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(ng.attributes)) if (k !== "position" && k !== "normal") ng.deleteAttribute(k);
  const c = typeof hex === "number" ? new THREE.Color(hex, hex, hex) : new THREE.Color(hex);
  const n = ng.getAttribute("position").count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  ng.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return ng;
}
const at = (g: THREE.BufferGeometry, x: number, y: number, z: number) => g.translate(x, y, z);
/** Caja con las aristas redondeadas `r` (ancho X, largo Y, alto Z), centrada en (x, y, z). */
const rbox = (w: number, l: number, h: number, r: number, x: number, y: number, z: number) =>
  at(new RoundedBoxGeometry(w, l, h, 2, Math.min(r, w / 2 - 1e-3, l / 2 - 1e-3, h / 2 - 1e-3)), x, y, z);
const box = (w: number, l: number, h: number, x: number, y: number, z: number) => at(new THREE.BoxGeometry(w, l, h), x, y, z);
/** Cilindro con el eje a lo ancho del bus (X). */
const wheelCyl = (r: number, w: number, seg: number, x: number, y: number, z: number) =>
  at(new THREE.CylinderGeometry(r, r, w, seg).rotateZ(Math.PI / 2), x, y, z);

/** Un cuerpo de bus de `a0` (cola) a `a1` (nariz), en metros a lo largo (Y adelante, X a la derecha, Z arriba).
 *  `nose`/`tail`: si ese extremo es la nariz o la cola de verdad (si no, es la unión con el fuelle: plano).
 *  `doors`: tramos [desde, hasta] a lo largo con puerta, y de qué lado (1 derecha, −1 izquierda). */
function busBody(p: Parts, a0: number, a1: number, o: { nose: boolean; tail: boolean; axles: number[]; doors: [number, number][]; doorSide: 1 | -1; windowsFrom?: number; windowsTo?: number }) {
  const b = BEVEL, H = W / 2;
  // perfil de lado (u = a lo largo, v = alto), achicado en el redondeo (el borde redondeado lo vuelve a agrandar)
  const s = new THREE.Shape();
  const u0 = a0 + b, u1 = a1 - b, v0 = Z_BOTTOM + b, v1 = Z_ROOF - b;
  const rTail = o.tail ? 0.5 : 0.06, rBottom = o.tail ? 0.14 : 0.05, rNoseBottom = 0.16;
  s.moveTo(u0 + rBottom, v0);
  // bajo de la carrocería con los guardabarros (arcos sobre cada rueda)
  const ra = ARCH_R + b, dv = WHEEL_R - v0, alpha = Math.asin(Math.min(0.99, dv / ra));
  // (el arco empieza donde llega la línea: un punto repetido descuadra el redondeo de las aristas)
  for (const ax of [...o.axles].sort((x, y) => x - y)) s.absarc(ax, WHEEL_R, ra, Math.PI + alpha, -alpha, true);
  if (o.nose) {
    s.lineTo(u1 - rNoseBottom, v0);
    s.quadraticCurveTo(u1, v0, u1, v0 + rNoseBottom);
    s.lineTo(u1, NOSE_V);
    s.lineTo(u1 - NOSE_BACK, NOSE_TOP);                                           // parabrisas inclinado
    s.quadraticCurveTo(u1 - NOSE_BACK - 0.06, v1, u1 - NOSE_BACK - 0.55, v1);     // y su curva hacia el techo
  } else {
    s.lineTo(u1 - 0.05, v0); s.quadraticCurveTo(u1, v0, u1, v0 + 0.05);
    s.lineTo(u1, v1 - 0.06); s.quadraticCurveTo(u1, v1, u1 - 0.06, v1);
  }
  s.lineTo(u0 + rTail, v1);
  s.quadraticCurveTo(u0, v1, u0, v1 - rTail);
  s.lineTo(u0, v0 + rBottom);
  s.quadraticCurveTo(u0, v0, u0 + rBottom, v0);
  const ext = new THREE.ExtrudeGeometry(s, { depth: W - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 5 });
  // (u, v, w) → (X = w − ancho/2, Y = u, Z = v): rotación propia (sin espejo)
  ext.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, -(H - b), 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
  p.body.push(tint(ext, 1));

  // ruedas: llanta, rin claro y centro; detrás, el hueco oscuro del guardabarros (si no, se vería a través del bus)
  for (const ax of o.axles) {
    p.fixed.push(tint(box(W - 0.66, 2 * ARCH_R + 0.1, 0.85, 0, ax, Z_BOTTOM + 0.42), WELL));
    for (const sd of [-1, 1]) {
      const x = sd * (H - WHEEL_W / 2 - 0.01);
      p.fixed.push(tint(wheelCyl(WHEEL_R, WHEEL_W, 24, x, ax, WHEEL_R), TIRE));
      p.fixed.push(tint(wheelCyl(0.31, 0.03, 20, x + sd * (WHEEL_W / 2), ax, WHEEL_R), RIM));
      p.fixed.push(tint(wheelCyl(0.12, 0.05, 10, x + sd * (WHEEL_W / 2 + 0.012), ax, WHEEL_R), HUB));
    }
  }

  // ventanas de los lados: paños oscuros con marcos (la carrocería se ve entre paño y paño), y las puertas hasta abajo
  const wFrom = o.windowsFrom ?? a0 + (o.tail ? 0.55 : 0.25), wTo = o.windowsTo ?? a1 - (o.nose ? 0.75 : 0.25);
  const winH = Z_WIN_TOP - Z_BELT, winZ = (Z_WIN_TOP + Z_BELT) / 2;
  for (const sd of [-1, 1] as const) {
    const x = sd * (H + 0.004);
    const doors = sd === o.doorSide ? o.doors : [];
    // tramos sin puerta, partidos en paños de ~1,4 m con marcos de 14 cm
    const spans: [number, number][] = [];
    let cur = wFrom;
    for (const [d0, d1] of [...doors].sort((p1, p2) => p1[0] - p2[0])) { if (d0 - 0.14 > cur) spans.push([cur, d0 - 0.14]); cur = Math.max(cur, d1 + 0.14); }
    if (wTo > cur) spans.push([cur, wTo]);
    for (const [s0, s1] of spans) {
      const n = Math.max(1, Math.round((s1 - s0) / 1.45)), len = (s1 - s0 - (n - 1) * 0.14) / n;
      for (let i = 0; i < n; i++) {
        const c = s0 + i * (len + 0.14) + len / 2;
        p.fixed.push(tint(box(0.03, len, winH, x, c, winZ), GLASS));
      }
    }
    for (const [d0, d1] of doors) {
      const half = (d1 - d0 - 0.05) / 2, dz0 = Z_BOTTOM + 0.16, dh = Z_WIN_TOP - dz0;
      for (const c of [d0 + half / 2, d1 - half / 2]) p.fixed.push(tint(box(0.035, half, dh, x, c, dz0 + dh / 2), GLASS_DOOR));
    }
  }

  if (o.nose) {
    // parabrisas: sigue la inclinación del frente
    const zA = NOSE_V + 0.08, zB = NOSE_TOP - 0.12, tilt = Math.atan2(NOSE_BACK, NOSE_TOP - NOSE_V);
    const len = (zB - zA) / Math.cos(tilt), yMid = a1 - NOSE_BACK * ((zA + zB) / 2 - NOSE_V) / (NOSE_TOP - NOSE_V) + 0.01;
    const ws = new THREE.BoxGeometry(W - 0.26, 0.03, len).rotateX(tilt);
    p.fixed.push(tint(at(ws, 0, yMid, (zA + zB) / 2), GLASS));
    // letrero de ruta (luz ámbar) arriba del parabrisas
    const sz = NOSE_TOP + 0.13, sy = a1 - NOSE_BACK - 0.02;
    p.fixed.push(tint(at(new THREE.BoxGeometry(1.35, 0.03, 0.17).rotateX(tilt), 0, sy + 0.025, sz), SIGN));
    p.fixed.push(tint(at(new THREE.BoxGeometry(W - 0.5, 0.03, 0.26).rotateX(tilt), 0, sy + 0.015, sz), GLASS));
    // faros, parachoques y espejos
    for (const sd of [-1, 1]) {
      p.fixed.push(tint(box(0.42, 0.06, 0.17, sd * (H - 0.38), a1 + 0.004, 0.78), HEAD));
      p.fixed.push(tint(box(0.07, 0.07, 0.36, sd * (H + 0.06), a1 - 0.22, 2.05), MIRROR));
      p.fixed.push(tint(box(0.12, 0.1, 0.42, sd * (H + 0.07), a1 - 0.2, 1.72), MIRROR));
    }
    p.fixed.push(tint(rbox(W - 0.04, 0.2, 0.3, 0.06, 0, a1 - 0.06, Z_BOTTOM + 0.15), TRIM));
  }
  if (o.tail) {
    p.fixed.push(tint(box(W - 0.5, 0.03, 0.85, 0, a0 - 0.004, 1.95), GLASS));        // vidrio de atrás
    for (const sd of [-1, 1]) p.fixed.push(tint(box(0.2, 0.06, 0.48, sd * (H - 0.2), a0 - 0.004, 0.95), TAIL));
    p.fixed.push(tint(rbox(W - 0.04, 0.2, 0.3, 0.06, 0, a0 + 0.06, Z_BOTTOM + 0.15), TRIM));
  }
  // techo más claro: una placa apenas levantada y más angosta que la carrocería
  const r0 = a0 + (o.tail ? 0.45 : 0.15), r1 = a1 - (o.nose ? NOSE_BACK + 0.55 : 0.15);
  p.roof.push(tint(rbox(W - 0.34, r1 - r0, 0.12, 0.05, 0, (r0 + r1) / 2, Z_ROOF - 0.03), 0.94));
}

/** Sombra de contacto: dos rectángulos redondeados sobre el suelo, uno más amplio y tenue (borde suave) y otro del tamaño del bus. */
function groundShade(p: Parts, len: number) {
  for (const [pad, k] of [[0.8, 0.1], [0.2, 0.16]] as const) {
    const w = W + pad, l = len + pad, r = Math.min(0.6, w / 2), sh = new THREE.Shape();
    sh.moveTo(-w / 2 + r, -l / 2); sh.lineTo(w / 2 - r, -l / 2); sh.quadraticCurveTo(w / 2, -l / 2, w / 2, -l / 2 + r);
    sh.lineTo(w / 2, l / 2 - r); sh.quadraticCurveTo(w / 2, l / 2, w / 2 - r, l / 2); sh.lineTo(-w / 2 + r, l / 2);
    sh.quadraticCurveTo(-w / 2, l / 2, -w / 2, l / 2 - r); sh.lineTo(-w / 2, -l / 2 + r); sh.quadraticCurveTo(-w / 2, -l / 2, -w / 2 + r, -l / 2);
    // negro con la opacidad en el color de cada vértice (los dos se suman: centro más oscuro, borde suave)
    const g = at(new THREE.ShapeGeometry(sh, 4), 0, 0, 0.04).toNonIndexed();
    g.deleteAttribute("uv");
    const n = g.getAttribute("position").count, arr = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) arr[i * 4 + 3] = k;
    g.setAttribute("color", new THREE.BufferAttribute(arr, 4));
    p.shade.push(g);
  }
}

/** Aire acondicionado sobre el techo. */
const roofUnit = (p: Parts, y: number) => {
  p.roof.push(tint(rbox(1.85, 2.7, 0.34, 0.12, 0, y, Z_ROOF + 0.17), 1));
  p.fixed.push(tint(box(1.1, 1.5, 0.02, 0, y, Z_ROOF + 0.345), "#6f7680"));      // rejilla
};

/** Padrón (alimentador, zonal, dual): ~12 × 2,55 m, puertas a la derecha. */
export function standardBus(): Parts {
  const p: Parts = { body: [], roof: [], fixed: [], shade: [] }, L = BUS_DIMENSIONS.std;
  groundShade(p, L);
  busBody(p, -L / 2, L / 2, { nose: true, tail: true, axles: [L / 2 - 2.75, -L / 2 + 3.2], doorSide: 1, doors: [[L / 2 - 1.55, L / 2 - 0.45], [-0.7, 0.55]] });
  roofUnit(p, -L * 0.1);
  return p;
}
/** Articulado de la troncal: ~18,3 m (11,2 + fuelle 0,9 + 6,2), puertas altas a la izquierda (las estaciones están al lado izquierdo). */
export function articulatedBus(): Parts {
  const p: Parts = { body: [], roof: [], fixed: [], shade: [] };
  const { front: F, gap: G, rear: R } = BUS_DIMENSIONS, L = F + G + R, f0 = L / 2 - F, r1 = -L / 2 + R;
  groundShade(p, L);
  busBody(p, f0, L / 2, { nose: true, tail: false, axles: [L / 2 - 2.75, f0 + 1.9], doorSide: -1, doors: [[L / 2 - 1.6, L / 2 - 0.45], [f0 + 4.6, f0 + 5.95]] });
  busBody(p, -L / 2, r1, { nose: false, tail: true, axles: [-L / 2 + 1.9], doorSide: -1, doors: [[r1 - 2.2, r1 - 0.85]] });
  // fuelle de acordeón: pliegues alternados (claros y oscuros) sobre un núcleo oscuro
  const mid = (f0 + r1) / 2, n = 9;
  p.fixed.push(tint(box(W - 0.32, G + 0.2, Z_ROOF - 0.6, 0, mid, (Z_ROOF + 0.45) / 2), BELLOWS_B));
  for (let i = 0; i < n; i++) {
    const y = r1 + 0.04 + ((G - 0.08) * (i + 0.5)) / n, big = i % 2 === 0;
    p.fixed.push(tint(box(big ? W - 0.1 : W - 0.22, 0.05, big ? Z_ROOF - 0.52 : Z_ROOF - 0.64, 0, y, (Z_ROOF + 0.48) / 2), big ? BELLOWS_A : BELLOWS_B));
  }
  roofUnit(p, f0 + F * 0.42);
  return p;
}

