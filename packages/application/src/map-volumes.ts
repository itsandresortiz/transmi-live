import type { Feature, FeatureCollection, Polygon } from "geojson";

/** Buses en 3D (vista 3D del mapa, de cerca): cada bus se arma con cajas (`fill-extrusion`) en metros reales, giradas según su rumbo.
 *  Lo usan la web y la app con una sola capa `fill-extrusion` que lee la altura (`h`), la base (`b`) y el color (`c`) de cada pieza:
 *  así no hacen falta capas propias ni modelos, y se ve igual en los dos. Mismo diseño que el bus de arriba (`busTop.ts`): carrocería del
 *  color del sistema, vidrios oscuros, techo más claro y, en la troncal, dos cuerpos unidos por un fuelle negro. */

/** Desde este zoom se ven los buses con volumen (más lejos, el dibujo plano de siempre: a 12 m de largo un bus con volumen se pierde). */
export const BUS_3D_MIN_ZOOM = 16.5;
/** Hasta cuántos buses en pantalla se dibujan con todo el detalle (ruedas redondas con rin, techo en tres capas: ~40–65 piezas por bus).
 *  Con más, van con menos piezas (~20–30) para no cargar el teléfono. */
export const BUS_3D_DETAIL_MAX = 14;

export interface BusVolumeInput {
  id: string;
  lon: number;
  lat: number;
  /** Rumbo en grados desde el norte, en sentido del reloj; `null` si no se sabe (se pone de lado, como el dibujo plano). */
  heading: number | null;
  /** Sin rumbo: hacia dónde se pone de lado (true = oeste). */
  left?: boolean;
  /** Color del sistema (o de la puntualidad). */
  color: string;
  /** Articulado de la troncal (dos cuerpos y fuelle). */
  long?: boolean;
  /** Dato viejo: el bus se ve desteñido (la opacidad de `fill-extrusion` no puede cambiar por bus). */
  stale?: boolean;
}
export interface BusVolumeProps { id: string; /** color */ c: string; /** base (m) */ b: number; /** altura (m) */ h: number; /** 1 = vidrio (va en una capa translúcida aparte) */ g?: number }

/** Medidas en metros. Padrón (alimentador, zonal, dual): ~12 × 2,55 m. Articulado de la troncal: ~18,3 m (11,2 + fuelle 0,9 + 6,2). */
export const BUS_DIMENSIONS = { width: 2.55, std: 12, front: 11.2, gap: 0.9, rear: 6.2 } as const;
/** Alturas (m). La carrocería va baja (30 cm del suelo, como un bus de verdad). */
const Z = { bodyBase: 0.3, belt: 1.3, windshieldBase: 1.05, glassTop: 2.3, roof1: 2.6, roof2: 2.82, roofTop: 2.95, acTop: 3.2 } as const;
/** Ruedas: 1 m de diámetro, asoman 10 cm a cada lado. Una pieza de `fill-extrusion` solo tiene paredes verticales, así que el círculo de
 *  la rueda se arma con rebanadas a distintas alturas, cada una del largo de la cuerda del círculo a esa altura (redonda vista de lado). */
const WHEEL_OUT = 0.1, WHEEL_W = 0.4, WHEEL_R = 0.5, HUB = "#9aa1ab";
const chord = (y: number) => 2 * Math.sqrt(Math.max(0, WHEEL_R * WHEEL_R - (y - WHEEL_R) ** 2));
const WHEEL_SLICES_FULL: [number, number][] = [[0, 0.08], [0.08, 0.2], [0.2, 0.36], [0.36, 0.64], [0.64, 0.8], [0.8, 0.92], [0.92, 1]];
const WHEEL_SLICES_LITE: [number, number][] = [[0, 0.18], [0.18, 0.82], [0.82, 1]];
/** Desde este zoom tiene sentido la vista 3D (medio nivel antes de que salgan los edificios): más lejos no se ve volumen y el botón «3D»
 *  no se ofrece. */
export const VIEW_3D_MIN_ZOOM = 14.5;
const WHEEL = "#1b1f27", BELLOWS = "#1b1f27";

/** Mezcla dos colores #rrggbb (t = 0 da `a`, t = 1 da `b`). */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseHex(a), pb = parseHex(b);
  if (!pa || !pb) return a;
  const ch = (i: number) => Math.round(pa[i]! + (pb[i]! - pa[i]!) * t).toString(16).padStart(2, "0");
  return `#${ch(0)}${ch(1)}${ch(2)}`;
}
function parseHex(h: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(h.trim());
  if (!m) return null;
  const s = m[1]!.length === 3 ? m[1]!.split("").map((x) => x + x).join("") : m[1]!;
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

/** Arma las piezas de todos los buses. `dark`: apariencia oscura (vidrios un poco más claros para que se distingan del fondo).
 *  `detail` (por defecto sí): ruedas redondas con rin y techo en tres capas; sin él, menos piezas por bus (para cuando hay muchos en pantalla).
 *
 *  El bus no es una caja: la nariz y la cola van redondeadas vistas desde arriba, el techo se curva (tres capas cada vez más angostas), el
 *  frente se inclina hacia atrás al subir (parabrisas), lleva parachoques oscuros y las ruedas son redondas con su rin. */
export function busVolumes(buses: readonly BusVolumeInput[], opts: { dark?: boolean; detail?: boolean } = {}): FeatureCollection<Polygon, BusVolumeProps> {
  const features: Feature<Polygon, BusVolumeProps>[] = [];
  const glass = opts.dark ? "#2a3340" : "#1c2430", detail = opts.detail !== false;
  const slices = detail ? WHEEL_SLICES_FULL : WHEEL_SLICES_LITE;
  for (const bus of buses) {
    if (!Number.isFinite(bus.lon) || !Number.isFinite(bus.lat)) continue;
    const deg = bus.heading != null && Number.isFinite(bus.heading) ? bus.heading : bus.left ? 270 : 90;
    const r = (deg * Math.PI) / 180, fe = Math.sin(r), fn = Math.cos(r);          // hacia adelante (este, norte)
    const kx = 1 / (111_320 * Math.cos((bus.lat * Math.PI) / 180)), ky = 1 / 110_540;
    const put = (pts: [number, number][], c: string, b: number, h: number) => features.push(ringFeature(bus.id, bus.lon, bus.lat, kx, ky, fe, fn, pts, c, b, h));
    const color = bus.stale ? mixHex(bus.color, opts.dark ? "#3a3d44" : "#c9ccd2", 0.6) : bus.color;
    const roof = mixHex(color, "#ffffff", 0.2), ac = mixHex(color, "#ffffff", 0.36), bumper = mixHex(color, "#000000", 0.4);
    const W = BUS_DIMENSIONS.width, H = W / 2;
    /** Un cuerpo de `a0` (cola) a `a1` (nariz), con cada extremo redondeado `rB` / `rF` m visto desde arriba. */
    const body = (a0: number, a1: number, rF: number, rB: number, nose: boolean, tail: boolean, axles: number[]) => {
      // ruedas: rebanadas del círculo (se dibujan antes: la carrocería tapa su parte de adentro) y el rin al centro
      for (const ax of axles) for (const side of [-1, 1]) {
        const x = side * (H + WHEEL_OUT - WHEEL_W / 2);
        for (const [y0, y1] of slices) { const len = chord((y0 + y1) / 2); put(rect(ax - len / 2, ax + len / 2, x - WHEEL_W / 2, x + WHEEL_W / 2), WHEEL, y0, y1); }
        if (detail) put(rect(ax - 0.19, ax + 0.19, x + side * 0.16 - 0.06, x + side * 0.16 + 0.06), HUB, 0.33, 0.67);
      }
      const f = nose ? 1 : 0, t = tail ? 1 : 0;      // cuánto se echan atrás las capas de arriba en cada extremo (solo en nariz y cola de verdad)
      put(pill(a0, a1, H, rF, rB), color, Z.bodyBase, Z.belt);                                                            // carrocería
      put(pill(a0 + 0.04 * t, a1 - 0.14 * f, H - 0.05, rF, rB), glass, Z.belt, Z.glassTop);                                // vidrios, un poco hundidos
      put(pill(a0 + 0.1 * t, a1 - 0.34 * f, H, rF, rB), roof, Z.glassTop, Z.roof1);                                        // techo: tres capas que se
      put(pill(a0 + 0.22 * t, a1 - 0.6 * f, H - 0.14, rF, rB), roof, Z.roof1, Z.roof2);                                    // angostan (borde curvo) y se
      if (detail) put(pill(a0 + 0.4 * t, a1 - 0.9 * f, H - 0.34, Math.max(0.2, rF - 0.2), Math.max(0.2, rB - 0.2)), roof, Z.roof2, Z.roofTop);   // echan atrás (frente inclinado)
      if (nose) {
        put(pill(a1 - 0.5, a1 + 0.03, H - 0.22, Math.max(0.2, rF - 0.15), 0.05), glass, Z.windshieldBase, Z.belt + 0.01);  // parabrisas: baja más que los vidrios de los lados
        put(pill(a1 - 0.4, a1 + 0.025, H - 0.03, rF, 0.05), bumper, Z.bodyBase, 0.5);                              // parachoques
      }
      if (tail) put(pill(a0 - 0.025, a0 + 0.4, H - 0.03, 0.05, rB), bumper, Z.bodyBase, 0.5);
    };
    if (!bus.long) {
      const L = BUS_DIMENSIONS.std;
      body(-L / 2, L / 2, 0.8, 0.5, true, true, [L / 2 - 2.6, -L / 2 + 3.1]);
      put(pill(-L * 0.08 - 1.3, -L * 0.08 + 1.3, 0.7, 0.3, 0.3), ac, Z.roofTop - (detail ? 0 : 0.13), Z.acTop);            // aire acondicionado
    } else {
      const { front: F, gap: G, rear: R } = BUS_DIMENSIONS, L = F + G + R;
      const f0 = L / 2 - F, r1 = -L / 2 + R;
      body(f0, L / 2, 0.8, 0.12, true, false, [L / 2 - 2.5, f0 + 2.2]);
      put(rect(r1 - 0.15, f0 + 0.15, -(H - 0.18), H - 0.18), BELLOWS, 0.5, Z.roof1 + 0.2);                                   // fuelle
      body(-L / 2, r1, 0.12, 0.5, false, true, [-L / 2 + 2.2]);
      put(pill(f0 + F * 0.42 - 1.3, f0 + F * 0.42 + 1.3, 0.7, 0.3, 0.3), ac, Z.roofTop - (detail ? 0 : 0.13), Z.acTop);
    }
  }
  return { type: "FeatureCollection", features };
}

/** Rectángulo en (adelante, derecha). */
const rect = (a0: number, a1: number, x0: number, x1: number): [number, number][] => [[a1, x0], [a1, x1], [a0, x1], [a0, x0]];
/** Rectángulo de `a0` a `a1` y medio ancho `h`, con las esquinas de adelante redondeadas `rF` m y las de atrás `rB` m (3 tramos por esquina). */
function pill(a0: number, a1: number, h: number, rF: number, rB: number): [number, number][] {
  const lim = Math.min(h, (a1 - a0) / 2), f = Math.min(rF, lim), b = Math.min(rB, lim), out: [number, number][] = [];
  const arc = (ca: number, cx: number, rad: number, from: number) => { for (let i = 0; i <= 3; i++) { const t = ((from + i * 30) * Math.PI) / 180; out.push([ca + rad * Math.cos(t), cx + rad * Math.sin(t)]); } };
  arc(a1 - f, -h + f, f, -90);      // adelante-izquierda → nariz
  arc(a1 - f, h - f, f, 0);         // nariz → adelante-derecha
  arc(a0 + b, h - b, b, 90);        // atrás-derecha
  arc(a0 + b, -h + b, b, 180);      // atrás-izquierda
  return out;
}
/** Una pieza con la forma `pts` (en metros: adelante, derecha) alrededor de (lon, lat). (fe, fn) es el vector «adelante» en (este, norte);
 *  la derecha de la marcha es (fn, −fe). Siete decimales (~1 cm) bastan y aligeran los datos. */
function ringFeature(id: string, lon: number, lat: number, kx: number, ky: number, fe: number, fn: number, pts: [number, number][], c: string, b: number, h: number): Feature<Polygon, BusVolumeProps> {
  const r7 = (v: number) => Math.round(v * 1e7) / 1e7;
  const ring = pts.map(([al, rt]) => [r7(lon + (al * fe + rt * fn) * kx), r7(lat + (al * fn - rt * fe) * ky)] as [number, number]);
  ring.push(ring[0]!);
  return { type: "Feature", properties: { id, c, b, h }, geometry: { type: "Polygon", coordinates: [ring] } };
}

/** Una caja como polígono: centro a `along` m hacia adelante y `across` m a la derecha de (lon, lat), `len` de largo y `w` de ancho, con
 *  las esquinas achaflanadas `ch` m (el bus redondeado de arriba). (fe, fn) es el vector «adelante» en (este, norte). */
function boxFeature(id: string, lon: number, lat: number, kx: number, ky: number, fe: number, fn: number,
  along: number, across: number, len: number, w: number, ch: number, c: string, b: number, h: number): Feature<Polygon, BusVolumeProps> {
  const a0 = along - len / 2, a1 = along + len / 2, x0 = across - w / 2, x1 = across + w / 2, k = Math.min(ch, len / 3, w / 3);
  const pts: [number, number][] = k > 0
    ? [[a1, x0 + k], [a1, x1 - k], [a1 - k, x1], [a0 + k, x1], [a0, x1 - k], [a0, x0 + k], [a0 + k, x0], [a1 - k, x0]]
    : [[a1, x0], [a1, x1], [a0, x1], [a0, x0]];
  // (adelante, derecha) → (este, norte): la derecha de la marcha es (fn, -fe). Siete decimales (~1 cm) bastan y aligeran los datos.
  const r6 = (v: number) => Math.round(v * 1e7) / 1e7;
  const ring = pts.map(([al, rt]) => [r6(lon + (al * fe + rt * fn) * kx), r6(lat + (al * fn - rt * fe) * ky)] as [number, number]);
  ring.push(ring[0]!);
  return { type: "Feature", properties: { id, c, b, h }, geometry: { type: "Polygon", coordinates: [ring] } };
}

/** Desde este zoom se ven los semáforos con volumen (hay muchos: más lejos sigue el ícono plano). */
export const SIGNAL_3D_MIN_ZOOM = 16;
export interface SignalVolumeInput { lon: number; lat: number; /** Solo en el modo de pruebas: el color estimado de ahora (la tapa de la caja). Al público, nunca. */ color?: string | null }
const POLE = "#3a3f47", HEAD = "#1e2127", SIGNAL_TOP = 5.3;

/** Semáforos en 3D: un poste delgado oscuro y arriba la caja negra, sin luces de color (decisión del proyecto: el color en vivo no se
 *  muestra al público). En el modo de pruebas la tapa de la caja puede llevar el color estimado. */
export function signalVolumes(points: readonly SignalVolumeInput[]): FeatureCollection<Polygon, BusVolumeProps> {
  const features: Feature<Polygon, BusVolumeProps>[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.lon) || !Number.isFinite(p.lat)) continue;
    const kx = 1 / (111_320 * Math.cos((p.lat * Math.PI) / 180)), ky = 1 / 110_540;
    // algo más grueso que uno real (~0,2 m) para que se vea desde el aire
    features.push(boxFeature("", p.lon, p.lat, kx, ky, 0, 1, 0, 0, 0.45, 0.45, 0, POLE, 0, SIGNAL_TOP - 0.2));
    features.push(boxFeature("", p.lon, p.lat, kx, ky, 0, 1, 0, 0, 0.9, 0.9, 0, HEAD, 3.6, p.color ? SIGNAL_TOP - 0.2 : SIGNAL_TOP));
    if (p.color) features.push(boxFeature("", p.lon, p.lat, kx, ky, 0, 1, 0, 0, 0.9, 0.9, 0, p.color, SIGNAL_TOP - 0.2, SIGNAL_TOP));
  }
  return { type: "FeatureCollection", features };
}

/** Desde este zoom se levantan las estaciones de la troncal (las mismas formas planas de `buildStationGeometry`). */
export const STATION_3D_MIN_ZOOM = 15;      // como los edificios: la estación plana se pintaba encima de ellos entre el 15 y el 15,6

/** Estaciones de la troncal en 3D, con la arquitectura de las de TransMilenio: plataforma elevada (~0,9 m) de concreto, cerramiento de
 *  vidrio a los lados (va en una capa translúcida: `g = 1`), estructura de acero gris con postes y una cubierta plana gris que sobresale
 *  un poco, con el color de su línea en una franja a la altura de las puertas y en el borde de la cubierta. Solo los vagones tienen
 *  techo: el pasillo que los une es un pasadizo gris descubierto con barandas bajas. `colorOf` da el color de cada línea (A, B, C…) según la apariencia.
 *  Las piezas son cajas de 4 lados (no cápsulas redondeadas): más parecidas a las reales y livianas para el mapa. */
export function stationVolumes(
  g: { bases: FeatureCollection<Polygon>; capsules: FeatureCollection<Polygon>; links: FeatureCollection<Polygon> },
  colorOf: (line: string) => string, opts: { dark?: boolean } = {},
): FeatureCollection<Polygon, BusVolumeProps> {
  const features: Feature<Polygon, BusVolumeProps>[] = [];
  const dark = !!opts.dark;
  const C = {
    platform: dark ? "#555a64" : "#c3c8cf",      // concreto
    steel: dark ? "#8a919c" : "#9aa1ab",        // estructura y postes
    roof: dark ? "#6b717c" : "#e6e8eb",         // cubierta
    glass: dark ? "#8fb0cf" : "#b9d6ec",
  };
  // sin la base ovalada (el contorno de toda la estación): en 3D sobraba (pedido del dueño). La del mapa plano sigue ahí, invisible, para tocarla
  // alturas: la cubierta va a 5,0–5,3 m porque OpenStreetMap trae la cubierta de muchas estaciones como un edificio de 5 m (fundido con
  // los demás edificios): así la nuestra queda encima y se reconoce
  const PLAT = 0.9, GLASS = 3.3, BAND0 = 2.75, BAND1 = 3.25, ROOF0 = 5.0, ROOF1 = 5.3;
  const build = (poly: Polygon, id: string, line: string) => {
    const ob = orientedBox(poly);
    if (!ob) return;
    const { lon, lat, fe, fn, len, w } = ob;
    const kx = 1 / (111_320 * Math.cos((lat * Math.PI) / 180)), ky = 1 / 110_540;
    const box = (along: number, across: number, l: number, ww: number, c: string, b: number, h: number, glassy = false) => {
      const f = boxFeature(id, lon, lat, kx, ky, fe, fn, along, across, l, ww, 0, c, b, h);
      if (glassy) f.properties.g = 1;
      features.push(f);
    };
    box(0, 0, len, w, C.platform, 0.25, PLAT);                                            // plataforma
    // cerramiento de vidrio a los dos lados y en las puntas (paneles delgados, se ve el interior)
    for (const side of [-1, 1]) box(0, side * (w / 2 - 0.15), len, 0.3, C.glass, PLAT, GLASS, true);
    for (const end of [-1, 1]) box(end * (len / 2 - 0.15), 0, 0.3, w - 0.6, C.glass, PLAT, GLASS, true);
    // postes de la estructura: a cada lado, en las puntas y cada ~7,5 m
    {
      const n = Math.max(1, Math.round(len / 7.5));
      for (let i = 0; i <= n; i++) {
        const a = -len / 2 + 0.3 + ((len - 0.6) * i) / n;
        for (const side of [-1, 1]) box(a, side * (w / 2 - 0.2), 0.4, 0.4, C.steel, PLAT, ROOF0);
      }
    }
    const col = colorOf(line);
    // franja horizontal del color de la línea alrededor del vagón, a la altura de lo alto de las puertas (como en las estaciones reales):
    // un poco más gruesa que el vidrio para que se vea por fuera
    for (const side of [-1, 1]) box(0, side * (w / 2 - 0.15), len + 0.04, 0.4, col, BAND0, BAND1);
    for (const end of [-1, 1]) box(end * (len / 2 - 0.15), 0, 0.4, w - 0.2, col, BAND0, BAND1);
    // cubierta plana que sobresale ~0,7 m a cada lado, con la franja del color de la línea en los bordes largos
    box(0, 0, len + 1.2, w + 1.4, C.roof, ROOF0, ROOF1);
    for (const side of [-1, 1]) box(0, side * (w / 2 + 0.45), len + 1.2, 0.5, col, ROOF0 - 0.1, ROOF1 + 0.05);
  };
  // el pasillo entre vagones: pasadizo gris descubierto (sin techo, sin vidrio ni color de línea), con barandas bajas a los lados
  for (const f of g.links.features) {
    const ob = orientedBox(f.geometry), id = String(f.properties?.all ?? "");
    if (!ob) continue;
    const kx = 1 / (111_320 * Math.cos((ob.lat * Math.PI) / 180)), ky = 1 / 110_540;
    features.push(boxFeature(id, ob.lon, ob.lat, kx, ky, ob.fe, ob.fn, 0, 0, ob.len, ob.w, 0, C.platform, 0.25, PLAT));
    for (const side of [-1, 1]) features.push(boxFeature(id, ob.lon, ob.lat, kx, ky, ob.fe, ob.fn, 0, side * (ob.w / 2 - 0.08), ob.len, 0.12, 0, C.steel, PLAT, PLAT + 1.1));
  }
  for (const f of g.capsules.features) build(f.geometry, String(f.properties?.ids ?? ""), String(f.properties?.l ?? ""));
  return { type: "FeatureCollection", features };
}

/** La caja que contiene una forma alargada (vagón o pasillo): centro, dirección del lado largo (este, norte) y medidas en metros. */
export function orientedBox(poly: Polygon): { lon: number; lat: number; fe: number; fn: number; len: number; w: number } | null {
  const ring = poly.coordinates[0];
  if (!ring || ring.length < 4) return null;
  const lat0 = ring[0]![1]!, lon0 = ring[0]![0]!, kx = 111_320 * Math.cos((lat0 * Math.PI) / 180), ky = 110_540;
  const pts = ring.slice(0, -1).map(([x, y]) => [(x! - lon0) * kx, (y! - lat0) * ky] as const);
  let a = 0, b = 0, far = -1;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) { const d = (pts[i]![0] - pts[j]![0]) ** 2 + (pts[i]![1] - pts[j]![1]) ** 2; if (d > far) { far = d; a = i; b = j; } }
  const L = Math.sqrt(far);
  if (!(L > 0.5)) return null;
  const fe = (pts[b]![0] - pts[a]![0]) / L, fn = (pts[b]![1] - pts[a]![1]) / L;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [x, y] of pts) { const u = x * fe + y * fn, v = x * fn - y * fe; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2, cx = cu * fe + cv * fn, cy = cu * fn - cv * fe;
  return { lon: lon0 + cx / kx, lat: lat0 + cy / ky, fe, fn, len: u1 - u0, w: v1 - v0 };
}

/** Filtro de los edificios en 3D (capa `building` de OpenMapTiles): fuera las piezas que OpenStreetMap marca como «no levantar» y los
 *  techos bajos que flotan (marquesinas, puentes peatonales y los techos de las estaciones de TransMilenio, que si no taparían la
 *  estación que dibujamos nosotros). */
export const BUILDINGS_3D_FILTER = ["all",
  ["!=", ["get", "hide_3d"], true],
  ["!", ["all", [">", ["coalesce", ["get", "render_min_height"], 0], 0], ["<", ["coalesce", ["get", "render_height"], 0], 12]]],
] as const;

