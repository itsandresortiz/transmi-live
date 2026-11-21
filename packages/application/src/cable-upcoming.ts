/** Líneas de TransMiCable que todavía NO funcionan (en obra): se dibujan en tono tenue con «Próximamente», nunca como servicio. No están en
 *  el GTFS de TransMilenio; el recorrido y las estaciones salen de OpenStreetMap (© colaboradores de OpenStreetMap, ODbL; `tools/osm-cable.ts`,
 *  2026-11-21, vía 1161227799 «construction=yes»). OpenStreetMap también marca en obra Potosí–Portal Sur, pero el dueño confirmó que sus
 *  obras no han empezado (2026-11-21): no va aquí. Cuando TransMilenio la agregue al GTFS, se quita de aquí y sale sola como el otro cable. */
export interface UpcomingCable { name: string; note: string; line: readonly [number, number][]; stations: readonly { name: string; lon: number; lat: number }[] }

export const UPCOMING_CABLES: readonly UpcomingCable[] = [
  {
    name: "TransMiCable San Cristóbal",
    note: "En construcción · próximamente en operación",
    line: [[-74.095393, 4.566085], [-74.09537, 4.56583], [-74.095266, 4.564672], [-74.095165, 4.563552], [-74.095061, 4.562392], [-74.094956, 4.561232], [-74.094768, 4.559458], [-74.094527, 4.5569], [-74.094384, 4.555388], [-74.094289, 4.554377], [-74.094095, 4.552328], [-74.093948, 4.550768], [-74.093637, 4.550542], [-74.0934, 4.55037], [-74.092492, 4.549711], [-74.091179, 4.548758], [-74.089978, 4.547886], [-74.08984, 4.547786], [-74.088797, 4.547029], [-74.087018, 4.545738], [-74.086271, 4.545196], [-74.085542, 4.544667], [-74.085316, 4.544503], [-74.084947, 4.544235]],
    stations: [
      { name: "20 de Julio", lat: 4.566101, lon: -74.095309 },
      { name: "La Victoria", lat: 4.550766, lon: -74.09387 },
      { name: "Altamira", lat: 4.544435, lon: -74.08505 },
    ],
  },
];

/** Las líneas en obra como GeoJSON (línea y estaciones), para la web y la app. */
export function upcomingCablesGeo(): { lines: { type: "FeatureCollection"; features: { type: "Feature"; properties: { name: string; note: string }; geometry: { type: "LineString"; coordinates: [number, number][] } }[] }; stations: { type: "FeatureCollection"; features: { type: "Feature"; properties: { name: string; line: string; note: string; rot: number }; geometry: { type: "Point"; coordinates: [number, number] } }[] } } {
  const lines = UPCOMING_CABLES.map((c) => ({ type: "Feature" as const, properties: { name: c.name, note: c.note }, geometry: { type: "LineString" as const, coordinates: c.line.map((p) => [p[0], p[1]] as [number, number]) } }));
  const stations = UPCOMING_CABLES.flatMap((c) => {
    const a = c.line[0]!, b = c.line[c.line.length - 1]!;
    const rot = (Math.atan2((b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180), b[1] - a[1]) * 180) / Math.PI;
    return c.stations.map((s) => ({ type: "Feature" as const, properties: { name: s.name, line: c.name, note: c.note, rot }, geometry: { type: "Point" as const, coordinates: [s.lon, s.lat] as [number, number] } }));
  });
  return { lines: { type: "FeatureCollection", features: lines }, stations: { type: "FeatureCollection", features: stations } };
}
