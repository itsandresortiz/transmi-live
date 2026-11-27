import type { Feature, FeatureCollection, Polygon } from "geojson";

/** Buses en 3D (vista 3D del mapa, de cerca): cada bus se arma con cajas (`fill-extrusion`) en metros reales, giradas según su rumbo.
 *  Lo usan la web y la app con una sola capa `fill-extrusion` que lee la altura (`h`), la base (`b`) y el color (`c`) de cada pieza:
 *  así no hacen falta capas propias ni modelos, y se ve igual en los dos. Mismo diseño que el bus de arriba (`busTop.ts`): carrocería del
 *  color del sistema, vidrios oscuros, techo más claro y, en la troncal, dos cuerpos unidos por un fuelle negro. */

/** Desde este zoom se ven los buses con volumen (más lejos, el dibujo plano de siempre: a 12 m de largo un bus con volumen se pierde). */
export const BUS_3D_MIN_ZOOM = 16.5;

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
const Z = { wheelTop: 0.75, bodyBase: 0.35, belt: 1.3, windshieldBase: 0.95, roofBase: 2.45, roofTop: 3.05, acTop: 3.35 } as const;
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

/** Arma las piezas de todos los buses. `dark`: apariencia oscura (vidrios un poco más claros para que se distingan del fondo). */
export function busVolumes(buses: readonly BusVolumeInput[], opts: { dark?: boolean } = {}): FeatureCollection<Polygon, BusVolumeProps> {
  const features: Feature<Polygon, BusVolumeProps>[] = [];
  const glass = opts.dark ? "#2a3340" : "#1c2430";
  for (const bus of buses) {
    if (!Number.isFinite(bus.lon) || !Number.isFinite(bus.lat)) continue;
    const deg = bus.heading != null && Number.isFinite(bus.heading) ? bus.heading : bus.left ? 270 : 90;
    const r = (deg * Math.PI) / 180, fe = Math.sin(r), fn = Math.cos(r);          // hacia adelante (este, norte)
    const kx = 1 / (111_320 * Math.cos((bus.lat * Math.PI) / 180)), ky = 1 / 110_540;
    const box = (along: number, across: number, len: number, w: number, ch: number, c: string, b: number, h: number) =>
      features.push(boxFeature(bus.id, bus.lon, bus.lat, kx, ky, fe, fn, along, across, len, w, ch, c, b, h));
    const color = bus.stale ? mixHex(bus.color, opts.dark ? "#3a3d44" : "#c9ccd2", 0.6) : bus.color;
    const roof = mixHex(color, "#ffffff", 0.18), ac = mixHex(color, "#ffffff", 0.32);
    const W = BUS_DIMENSIONS.width;
    /** Un cuerpo: ruedas, carrocería, franja de vidrios (un poco hundida), techo y, si es el de adelante, parabrisas y aire acondicionado. */
    const body = (center: number, len: number, front: boolean, axles: number[]) => {
      // ruedas: debajo de la carrocería, asomadas a cada lado (el bus «flota» 35 cm sobre ellas)
      for (const a of axles) for (const side of [-1, 1]) box(center + a, side * (W / 2 - 0.2), 1.0, 0.34, 0, WHEEL, 0, Z.wheelTop);
      box(center, 0, len, W, 0.45, color, Z.bodyBase, Z.belt);
      box(center, 0, len - 0.1, W - 0.1, 0.4, glass, Z.belt, Z.roofBase);      // franja de vidrios, un poco hundida
      box(center, 0, len, W, 0.45, roof, Z.roofBase, Z.roofTop);
      if (front) {
        box(center + len / 2 - 0.1, 0, 0.26, W - 0.5, 0, glass, Z.windshieldBase, Z.roofBase - 0.05);      // parabrisas: baja más que los vidrios de los lados
        box(center - len * 0.08, 0, Math.min(2.6, len * 0.25), 1.4, 0.3, ac, Z.roofTop, Z.acTop);         // aire acondicionado en el techo
      }
    };
    if (!bus.long) {
      const L = BUS_DIMENSIONS.std;
      body(0, L, true, [L / 2 - 2.6, -L / 2 + 3.1]);
    } else {
      const { front: F, gap: G, rear: R } = BUS_DIMENSIONS, L = F + G + R;
      const fc = L / 2 - F / 2, rc = -L / 2 + R / 2, gc = L / 2 - F - G / 2;
      body(fc, F, true, [F / 2 - 2.5, -F / 2 + 2.2]);
      box(gc, 0, G + 0.3, W - 0.35, 0, BELLOWS, 0.5, Z.roofBase + 0.45);      // fuelle
      body(rc, R, false, [-R / 2 + 2.2]);
    }
  }
  return { type: "FeatureCollection", features };
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

/** Estaciones de la troncal en 3D, sobrias y con el mismo dibujo del mapa plano: la base es una plataforma baja (~0,9 m), cada vagón un
 *  cuerpo de vidrio claro (va en una capa translúcida: `g = 1`) con el techo del color de su línea, y el pasillo un vidrio más bajo con el
 *  techo del mismo color, aclarado. `colorOf` da el color de cada línea (A, B, C…) según la apariencia. */
export function stationVolumes(
  g: { bases: FeatureCollection<Polygon>; capsules: FeatureCollection<Polygon>; links: FeatureCollection<Polygon> },
  colorOf: (line: string) => string, opts: { dark?: boolean } = {},
): FeatureCollection<Polygon, BusVolumeProps> {
  const features: Feature<Polygon, BusVolumeProps>[] = [];
  const platform = opts.dark ? "#3b3f48" : "#cfd5de", glass = opts.dark ? "#8fa3b8" : "#cfe0ee";
  const add = (geometry: Polygon, id: string, c: string, b: number, h: number, glassy = false) =>
    features.push({ type: "Feature", properties: glassy ? { id, c, b, h, g: 1 } : { id, c, b, h }, geometry });
  for (const f of g.bases.features) add(f.geometry, String(f.properties?.all ?? ""), platform, 0, 0.9);
  // el pasillo: vidrio más bajo y techo del color de la línea, aclarado (los vagones, más altos, llevan el color pleno)
  for (const f of g.links.features) {
    const id = String(f.properties?.all ?? ""), line = String(f.properties?.l ?? "");
    add(f.geometry, id, glass, 0.9, 3.0, true);
    add(f.geometry, id, mixHex(colorOf(line), opts.dark ? "#000000" : "#ffffff", 0.35), 3.0, 3.3);
  }
  for (const f of g.capsules.features) {
    const id = String(f.properties?.ids ?? ""), line = String(f.properties?.l ?? "");
    add(f.geometry, id, glass, 0.9, 3.4, true);
    add(f.geometry, id, colorOf(line), 3.4, 3.95);      // techo con la franja del color de la línea
  }
  return { type: "FeatureCollection", features };
}
