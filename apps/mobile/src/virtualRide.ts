import type { RouteShape } from "@transmi/domain";
import { Vehicle } from "@transmi/domain";
import { transit } from "./composition-root";
import { nowMs } from "./clock";
import { rideSnapOf } from "./rideSnap";

/** Viaje en un bus que NO aparece en los datos de TransMilenio (su GPS no está reportando): se sigue con el GPS del teléfono sobre el
 *  recorrido de la ruta. Se identifica como `gps:RUTA:RECORRIDO:PARADA` (la parada desde la que se viene). Así el resto de la app
 *  (la pantalla del viaje, los avisos, el mapa) lo trata como cualquier bus. */
export const isVirtualRide = (id: string | null | undefined): id is string => !!id && id.startsWith("gps:");
export const virtualRideId = (routeId: string, shapeIndex: number, fromIndex: number) => `gps:${routeId}:${shapeIndex}:${fromIndex}`;

export function virtualParts(id: string): { routeId: string; shape: RouteShape; fromIndex: number } | null {
  const [, routeId, si, fi] = id.split(":");
  const shape = routeId ? transit.network.shapes.get(routeId)?.[Number(si)] : undefined;
  return routeId && shape ? { routeId, shape, fromIndex: Math.max(0, Math.min(shape.stopIds.length - 1, Number(fi) || 0)) } : null;
}

/** La última parada que se sabe que pasaste en cada viaje con GPS (en memoria, mientras la app esté abierta). */
const reached = new Map<string, number>();
/** Dónde va el viaje: la última parada que ya pasaste (por el GPS si lo confirma; si no, la parada desde la que vienes). */
export function virtualSequence(id: string, at = nowMs()): { shape: RouteShape; index: number } | undefined {
  const p = virtualParts(id);
  if (!p) return undefined;
  const snap = rideSnapOf(id, at);
  // sin lectura reciente del GPS se queda en la última parada que pasaste (antes volvía a la de subida y los tiempos saltaban)
  const before = Math.max(p.fromIndex, reached.get(id) ?? 0);
  const index = snap && snap.shape === p.shape ? Math.max(before, Math.min(p.shape.stopIds.length - 1, snap.nextIndex - 1)) : before;
  if (reached.size > 20) reached.clear();
  reached.set(id, index);
  return { shape: p.shape, index };
}

let cache: { key: string; v: Vehicle } | null = null;
/** Un «bus» armado con tu posición (o la de la parada desde la que vienes): reportado ahora mismo, así los cálculos de llegada parten de ahí. */
export function virtualVehicle(id: string, at = nowMs()): Vehicle | undefined {
  const p = virtualParts(id), seq = virtualSequence(id, at);
  if (!p || !seq) return undefined;
  const snap = rideSnapOf(id, at);
  const lastStopId = seq.shape.stopIds[seq.index]!;
  const position = snap && snap.shape === p.shape ? snap.pos : transit.stopById(lastStopId)?.position;
  if (!position) return undefined;
  const key = `${id}|${lastStopId}|${position.lat.toFixed(6)},${position.lon.toFixed(6)}`;
  if (cache?.key === key) { cache.v.reportedAt = at / 1000; return cache.v; }
  const v = new Vehicle({ id, routeId: p.routeId, reportedAt: at / 1000, position, lastStopId }, at);
  v.system = transit.routeById(p.routeId)?.system ?? "otro";
  if (snap) v.bearing = snap.heading;
  cache = { key, v };
  return v;
}

/** El bus del viaje: uno de los datos de TransMilenio o, si es un viaje con GPS, el armado con tu posición. */
export const rideVehicle = (id: string, at = nowMs()): Vehicle | undefined => (isVirtualRide(id) ? virtualVehicle(id, at) : transit.fleet.get(id));
/** Dónde va el bus del viaje sobre su recorrido. */
export const rideSequence = (v: Vehicle): { shape: RouteShape; index: number } | undefined => (isVirtualRide(v.id) ? virtualSequence(v.id) : transit.sequenceForDisplay(v));

/** Viajes con GPS que ya encontraron su bus en los datos: viaje con GPS → bus real (para que la pantalla del viaje pase al bus real). */
const linked = new Map<string, string>();
export const linkRide = (virtualId: string, busId: string): void => { linked.set(virtualId, busId); };
/** El bus real con el que se enlazó este viaje con GPS (si ya se encontró). */
export const linkedBusOf = (virtualId: string): string | undefined => linked.get(virtualId);
/** ¿Este bus vino de enlazar un viaje con GPS? */
export const wasLinked = (busId: string): boolean => [...linked.values()].includes(busId);
