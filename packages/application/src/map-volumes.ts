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
export const STATION_3D_MIN_ZOOM = 15.6;

/** Estaciones de la troncal en 3D, sobrias y con el mismo dibujo del mapa plano: la base apenas se levanta, cada vagón y el pasillo tienen su plataforma (~0,9 m), cada vagón un
 *  cuerpo de vidrio claro (va en una capa translúcida: `g = 1`) con el techo del color de su línea, y el pasillo un vidrio más bajo con el
 *  techo del mismo color, aclarado. `colorOf` da el color de cada línea (A, B, C…) según la apariencia. */
export function stationVolumes(
  g: { bases: FeatureCollection<Polygon>; capsules: FeatureCollection<Polygon>; links: FeatureCollection<Polygon> },
  colorOf: (line: string) => string, opts: { dark?: boolean } = {},
): FeatureCollection<Polygon, BusVolumeProps> {
  const features: Feature<Polygon, BusVolumeProps>[] = [];
  const base = opts.dark ? "#2e3139" : "#d9dde3", platform = opts.dark ? "#4a4f5a" : "#b9c0ca", glass = opts.dark ? "#8fb0cf" : "#b9d6ec";
  const add = (geometry: Polygon, id: string, c: string, b: number, h: number, glassy = false) =>
    features.push({ type: "Feature", properties: glassy ? { id, c, b, h, g: 1 } : { id, c, b, h }, geometry });
  // la base (el contorno de toda la estación, más ancho que los vagones) apenas se levanta: si fuera de 0,9 m taparía la estación entera
  for (const f of g.bases.features) add(f.geometry, String(f.properties?.all ?? ""), base, 0, 0.25);
  // el pasillo: vidrio más bajo y techo del color de la línea, aclarado (los vagones, más altos, llevan el color pleno)
  for (const f of g.links.features) {
    const id = String(f.properties?.all ?? ""), line = String(f.properties?.l ?? "");
    add(f.geometry, id, platform, 0.25, 0.9);
    add(f.geometry, id, glass, 0.9, 4.6, true);
    add(f.geometry, id, mixHex(colorOf(line), opts.dark ? "#000000" : "#ffffff", 0.35), 4.6, 5.0);
  }
  for (const f of g.capsules.features) {
    const id = String(f.properties?.ids ?? ""), line = String(f.properties?.l ?? "");
    add(f.geometry, id, platform, 0.25, 0.9);      // plataforma del vagón
    // el techo va a 5,1–5,7 m: OpenStreetMap trae la cubierta de muchas estaciones como un edificio de 5 m (no se puede separar de los
    // demás edificios: viene fundido con ellos) y así el techo del color de la línea queda encima y se reconoce la estación
    add(f.geometry, id, glass, 0.9, 5.1, true);
    add(f.geometry, id, colorOf(line), 5.1, 5.7);      // techo con la franja del color de la línea
  }
  return { type: "FeatureCollection", features };
}

/** Filtro de los edificios en 3D (capa `building` de OpenMapTiles): fuera las piezas que OpenStreetMap marca como «no levantar» y los
 *  techos bajos que flotan (marquesinas, puentes peatonales y los techos de las estaciones de TransMilenio, que si no taparían la
 *  estación que dibujamos nosotros). */
export const BUILDINGS_3D_FILTER = ["all",
  ["!=", ["get", "hide_3d"], true],
  ["!", ["all", [">", ["coalesce", ["get", "render_min_height"], 0], 0], ["<", ["coalesce", ["get", "render_height"], 0], 12]]],
] as const;

