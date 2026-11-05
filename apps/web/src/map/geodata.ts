/** Datos geográficos incluidos en la app (cargados bajo demanda para no frenar la primera pantalla). */
import type { Feature, FeatureCollection, LineString, Point, Polygon } from "geojson";

type Fc<G, P = Record<string, unknown>> = FeatureCollection<G & (Point | LineString | Polygon), P>;

export interface Localidad { n: string; c: [number, number]; r: [number, number][][] }
export interface Troncal { n: string; l: string; p: [number, number][] }
export type Estacion = [lat: number, lon: number, name: string, place: string, troncal: string];

export const loadLocalidades = async () => (await import("../data/localidades.json")).default as unknown as Localidad[];
export const loadTroncales = async () => (await import("../data/troncales.json")).default as unknown as Troncal[];
export const loadEstaciones = async () => (await import("../data/estaciones.json")).default as unknown as Estacion[];

const fc = <G extends Point | LineString | Polygon>(features: Feature<G>[]): FeatureCollection<G> => ({ type: "FeatureCollection", features });

export function localidadPolygons(l: Localidad[]) {
  return fc<Polygon>(l.map((x) => ({
    type: "Feature", properties: { name: x.n },
    geometry: { type: "Polygon", coordinates: x.r.map((ring) => ring.map(([lat, lon]) => [lon, lat])) },
  })));
}
export function localidadLabels(l: Localidad[]) {
  return fc<Point>(l.filter((x) => x.n !== "Sumapaz").map((x) => ({
    type: "Feature", properties: { name: x.n.toUpperCase() }, geometry: { type: "Point", coordinates: [x.c[1], x.c[0]] },
  })));
}
export function troncalLines(t: Troncal[]) {
  return fc<LineString>(t.map((x) => ({
    type: "Feature", properties: { name: x.n }, geometry: { type: "LineString", coordinates: x.p.map(([lat, lon]) => [lon, lat]) },
  })));
}
export function estacionPoints(e: Estacion[]) {
  return fc<Point>(e.map((x, i) => ({
    type: "Feature", id: i, properties: { name: x[2], place: x[3], troncal: x[4] }, geometry: { type: "Point", coordinates: [x[1], x[0]] },
  })));
}

/** Clase de vía: 0 residencial · 1 sin clasificar · 2 terciaria · 3 secundaria · 4 primaria · 5 troncal. */
const ROAD_ORDER = ["residential", "unclassified", "tertiary", "secondary", "primary", "trunk"];
/** Suaviza una línea cortando sus esquinas (Chaikin): los datos vienen con ~10 m de precisión y, con calles anchas, se verían quebradas. */
function smooth(coords: [number, number][], iterations: number): [number, number][] {
  let pts = coords;
  for (let it = 0; it < iterations && pts.length > 2; it++) {
    const out: [number, number][] = [pts[0]!];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!, b = pts[i + 1]!;
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    out.push(pts[pts.length - 1]!);
    pts = out;
  }
  return pts;
}

export async function loadRoads(): Promise<FeatureCollection<LineString>> {
  const raw = (await import("../data/roads.json")).default as unknown as Record<string, number[][]>;
  const features: Feature<LineString>[] = [];
  ROAD_ORDER.forEach((k, c) => {
    for (const e of raw[k] ?? []) {
      let a = e[0]!, b = e[1]!; // latitud y longitud ×1e4, luego diferencias
      const coords: [number, number][] = [[b / 1e4, a / 1e4]];
      for (let i = 2; i < e.length; i += 2) { a += e[i]!; b += e[i + 1]!; coords.push([b / 1e4, a / 1e4]); }
      features.push({ type: "Feature", properties: { c }, geometry: { type: "LineString", coordinates: smooth(coords, c >= 2 ? 2 : 1) } });
    }
  });
  return fc<LineString>(features);
}

/** Nombres de calles: un punto por tramo, con su rotación. Clase 0 troncal … 4 residencial. */
export async function loadStreetLabels(): Promise<FeatureCollection<Point>> {
  const raw = (await import("../data/streets.json")).default as unknown as { n: string[]; a: [number, number, number, number, number][] };
  return fc<Point>(raw.a.map(([c, lat, lon, ang, n]) => ({
    type: "Feature", properties: { c, a: ang, n: raw.n[n]! }, geometry: { type: "Point", coordinates: [lon / 1e5, lat / 1e5] },
  })));
}
