import { type RideCheck, type RideSnap, rideShownArrival, shapeStops } from "@transmi/application";
import { type RouteShape, type Stop, type Vehicle, bearingDegrees, toGeo } from "@transmi/domain";
import { transit } from "./composition-root";
import { nowMs as clockMs } from "./clock";
import { rideSequence } from "./virtualRide";

/** Mientras vas en un bus («Voy en este bus»), su posición sale de TU teléfono, no del reporte de TransMilenio (que llega ~1 min tarde):
 *  aquí se guarda dónde vas sobre el recorrido. La ubicación no sale del teléfono ni se guarda: vive solo en memoria mientras dura el viaje. */
interface Snap { busId: string; shape: RouteShape; lastIndex: number; prev: { s: number; at: number } | null; cur: { s: number; at: number }; info: RideSnap; track: { s: number; at: number }[] }
/** Ventana con la que se mide el ritmo de tu bus (semáforos y trancones incluidos). */
const PACE_WINDOW_MS = 10 * 60_000;
/** Cuánto sigue valiendo la última ubicación sin lecturas nuevas. Quieto en un semáforo el teléfono casi no da lecturas: antes, a los 20 s
 *  se soltaba y un viaje sin bus en los datos volvía a la parada de subida (los tiempos saltaban). En un viaje con GPS tú eres el bus:
 *  vale 10 min; con un bus de los datos, 3 min (luego se vuelve a lo que reporta TransMilenio). */
const keepMs = (busId: string) => (busId.startsWith("gps:") ? 10 * 60_000 : 3 * 60_000);
let snap: Snap | null = null;
/** El último resultado de comparar el teléfono con el bus (lo usa el vigilante del viaje para preguntar si vas en otro bus). */
let lastCheck: { busId: string; check: RideCheck; at: number } | null = null;

/** Una lectura nueva: si va en el bus se actualiza la posición; si no, se suelta (se vuelve al dato de TransMilenio). */
export function setRideCheck(busId: string, shape: RouteShape, lastIndex: number, check: RideCheck, atMs: number): void {
  lastCheck = { busId, check, at: atMs };
  if (check.kind !== "on") { if (check.kind !== "unknown") snap = null; return; }
  const same = snap && snap.busId === busId && snap.shape === shape;
  // el bus no retrocede: un salto del GPS hacia atrás de pocos metros no lo hace ir en reversa
  const s = same && check.snap.s < snap!.cur.s && snap!.cur.s - check.snap.s < 60 ? snap!.cur.s : check.snap.s;
  const track = (same ? snap!.track : []).filter((p) => atMs - p.at <= PACE_WINDOW_MS);
  track.push({ s, at: atMs });
  snap = { busId, shape, lastIndex, prev: same ? snap!.cur : null, cur: { s, at: atMs }, info: { ...check.snap, s }, track };
}
export function clearRideSnap(): void { snap = null; lastCheck = null; }
export function rideCheckOf(busId: string): { check: RideCheck; at: number } | null { return lastCheck && lastCheck.busId === busId ? lastCheck : null; }

/** Lo que se sabe de dónde vas, si es reciente (ver `keepMs`). */
export function rideSnapOf(busId: string, nowMs = clockMs()): (RideSnap & { shape: RouteShape; lastIndex: number }) | null {
  if (!snap || snap.busId !== busId || nowMs - snap.cur.at > keepMs(busId)) return null;
  // el ritmo se mide desde la lectura más vieja de la ventana (la cuenta incluye el rato que llevas quieto sin lecturas nuevas)
  const first = snap.track.find((p) => nowMs - p.at <= PACE_WINDOW_MS);
  return { ...snap.info, pace: first, shape: snap.shape, lastIndex: snap.lastIndex };
}

/** Dónde dibujar el bus en este instante: entre dos lecturas del GPS avanza a la velocidad que llevaba (hasta 3 s), para que se mueva fluido. */
/** Dónde se dibujó por última vez el bus en el que vas (metros sobre su recorrido), para que avance suave y sin volver atrás. */
let drawn: { busId: string; shape: unknown; s: number; at: number } | null = null;
export function snappedPosition(busId: string, nowMs = clockMs()): { lat: number; lon: number; heading: number } | null {
  if (!snap || snap.busId !== busId || nowMs - snap.cur.at > keepMs(busId)) return null;
  const ss = shapeStops(transit, snap.shape);
  if (!ss) return null;
  let s = snap.cur.s;
  if (snap.prev && snap.cur.at > snap.prev.at) {
    const speed = Math.min(20, Math.max(0, (snap.cur.s - snap.prev.s) / ((snap.cur.at - snap.prev.at) / 1000)));
    s += speed * Math.min(3, Math.max(0, (nowMs - snap.cur.at) / 1000));
  }
  // el bus dibujado se acerca a esa posición poco a poco y NUNCA retrocede (regla de todos los buses del mapa): si la lectura llega atrás,
  // espera ahí. Solo se reinicia con un salto de más de 300 m (otro recorrido). Antes iba directo: entre lecturas se adelantaba con la
  // velocidad y, si la lectura nueva llegaba unos metros atrás, brincaba hacia atrás varias veces por segundo y se veía parpadear
  const d = drawn && drawn.busId === busId && drawn.shape === snap.shape && Math.abs(s - drawn.s) < 300 ? drawn : null;
  if (d && s <= d.s) s = d.s;
  else if (d) s = d.s + (s - d.s) * (1 - Math.exp(-Math.max(0, nowMs - d.at) / 600));
  drawn = { busId, shape: snap.shape, s, at: nowMs };
  const here = ss.path.pointAt(s), ahead = ss.path.pointAt(s + 15), g = toGeo(here);
  return { lat: g.lat, lon: g.lon, heading: bearingDegrees(here, ahead) };
}

/** La próxima parada del bus en el que vas, contada desde tu ubicación (o `undefined` si el GPS no lo confirma ahora). */
export function rideNextStop(v: Vehicle, nowMs = clockMs()): { stopId: string; stop: Stop | undefined; arrivalAt: number } | undefined {
  const mine = rideSnapOf(v.id, nowMs);
  const seq = mine ? rideSequence(v) : undefined;
  if (!mine || !seq || seq.shape !== mine.shape) return undefined;
  const stopId = seq.shape.stopIds[mine.nextIndex];
  if (!stopId) return undefined;
  return { stopId, stop: transit.stopById(stopId), arrivalAt: rideShownArrival(transit, v, seq.shape, seq.index, mine, mine.nextIndex, nowMs) };      // para mostrar: la cuenta no sube de golpe
}
