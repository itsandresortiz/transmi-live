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
/** Línea de la troncal (letra) de cada corredor, para pintar estaciones y portales con su color. */
const LINE_OF_CORRIDOR: Record<string, string> = {
  "carrera 10": "L", "americas": "F", "nqs sur": "G", "calle 26": "K", "eje ambiental": "J", "caracas sur": "H",
  "cable aéreo": "CA", "autopista norte": "B", "suba": "C", "nqs central": "E", "calle 80": "D", "caracas": "A", "carrera 7": "M",
};
export const lineOfCorridor = (name: string): string => LINE_OF_CORRIDOR[name.trim().toLowerCase()] ?? "X";

export function troncalLines(t: Troncal[]) {
  return fc<LineString>(t.map((x) => ({
    type: "Feature", properties: { name: x.n, l: x.l.trim() }, geometry: { type: "LineString", coordinates: x.p.map(([lat, lon]) => [lon, lat]) },
  })));
}
export function estacionPoints(e: Estacion[]) {
  return fc<Point>(e.map((x, i) => ({
    type: "Feature", id: i, properties: { name: x[2], place: x[3], troncal: x[4], l: lineOfCorridor(x[4]), portal: /^(portal|terminal)\b/i.test(x[2]) }, geometry: { type: "Point", coordinates: [x[1], x[0]] },
  })));
}

/** Clase de vía: 0 residencial · 1 sin clasificar · 2 terciaria · 3 secundaria · 4 primaria · 5 troncal. */
