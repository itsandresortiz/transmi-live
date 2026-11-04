/** Geometría compartida. Las posiciones se llevan a "coordenadas de mundo" (Mercator normalizado 0..1)
 *  para poder sumar vectores de movimiento sin trigonometría en cada cuadro. */
export interface GeoPoint { readonly lat: number; readonly lon: number }
export interface WorldPoint { readonly x: number; readonly y: number }

/** Metros por unidad de mundo, a la latitud de Bogotá (el error dentro de la ciudad es despreciable). */
export const METERS_PER_WORLD_UNIT = 40075016.686 * Math.cos((4.65 * Math.PI) / 180);

export function toWorld(p: GeoPoint): WorldPoint {
  return {
    x: (p.lon + 180) / 360,
    y: 0.5 - Math.log(Math.tan(Math.PI / 4 + (p.lat * Math.PI) / 360)) / (2 * Math.PI),
  };
}

export function toGeo(w: WorldPoint): GeoPoint {
  return {
    lon: w.x * 360 - 180,
    lat: ((2 * Math.atan(Math.exp((0.5 - w.y) * 2 * Math.PI)) - Math.PI / 2) * 180) / Math.PI,
  };
}

export function distanceMeters(a: WorldPoint, b: WorldPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y) * METERS_PER_WORLD_UNIT;
}

/** Rumbo en grados (0 = norte, 90 = este). */
export function bearingDegrees(from: WorldPoint, to: WorldPoint): number {
  return ((Math.atan2(to.x - from.x, -(to.y - from.y)) * 180) / Math.PI + 360) % 360;
}

export function isInside(p: GeoPoint, sw: GeoPoint, ne: GeoPoint): boolean {
  return p.lat >= sw.lat && p.lat <= ne.lat && p.lon >= sw.lon && p.lon <= ne.lon;
}
