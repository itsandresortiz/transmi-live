import type { TransitState } from "./transit-state";
import { shapeStops } from "./eta";
import { bearingDegrees, toGeo } from "@transmi/domain";

/** TransMiCable (Tunal ↔ Mirador del Paraíso). Sus cabinas NO reportan posición: TransMilenio no manda datos en vivo del cable (revisado
 *  el 2026-11-21, con el cable funcionando: 0 cabinas en el lote). Lo que se sabe sale del horario oficial (GTFS, frequencies.txt):
 *  una cabina cada 10–16 s, de 4:30 a. m. a 10:15 p. m. (domingos y festivos de 5:30 a. m. a 9:15 p. m.). Siempre se dice «según horario». */
export interface CableInfo { open: boolean; /** Segundos entre cabinas ahora (si está abierto). */ every: number | null; text: string }

const hhmm = (secs: number) => {
  const s = ((secs % 86_400) + 86_400) % 86_400, h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "a. m." : "p. m."}`;
};

/** Qué decir de una ruta de TransMiCable ahora: abierto con cada cuánto pasan las cabinas y hasta qué hora, o cerrado y cuándo abre. */
export function cableInfo(state: TransitState, routeId: string, nowMs: number): CableInfo | null {
  const day = state.serviceEnds.dayAt(nowMs);
  const f = state.departures.frequencyOf(routeId, day.type, day.secs);
  if (!f) return null;
  if (f.every != null && day.secs < f.closes) return { open: true, every: f.every, text: `Cabinas cada ${f.every} s · hasta las ${hhmm(f.closes)} (según horario)` };
  if (day.secs < f.opens) return { open: false, every: null, text: `Cerrado · abre a las ${hhmm(f.opens)} (según horario)` };
  // ya cerró: abre mañana (el tipo de día de mañana puede ser otro: domingo o festivo abre más tarde)
  const next = state.departures.frequencyOf(routeId, state.serviceEnds.dayAt(nowMs + (86_400 - day.secs + 6 * 3600) * 1000).type, 0) ?? f;
  return { open: false, every: null, text: `Cerrado · abre mañana a las ${hhmm(next.opens)} (según horario)` };
}

/** Una cabina SIMULADA: dónde debería ir según el horario oficial (sale una cada 10–16 s del Portal Tunal, sube al Mirador y vuelve). No es
 *  su posición real: TransMilenio no la envía. Se dibuja más suave que los buses y al tocarla lo dice. */
export interface SimulatedCabin { id: string; lat: number; lon: number; bearing: number; /** Índice en el recorrido de la última estación por la que pasó. */ lastIndex: number }
/** Segundos que una cabina se queda en cada estación (abre puertas sin detener el cable: va muy despacio). */
const CABIN_DWELL_S = 20;

/** Las cabinas que según el horario van por el cable en `nowMs` (vacío si está cerrado o no hay horario). */
export function simulatedCabins(state: TransitState, routeId: string, nowMs: number): SimulatedCabin[] {
  const shape = state.network.shapes.get(routeId)?.[0], sched = state.departures.scheduleOf(routeId);
  if (!shape || !sched || sched.stops.length < 2) return [];
  const ss = shapeStops(state, shape);
  if (!ss || ss.s.length !== sched.off.length) return [];
  const total = sched.off[sched.off.length - 1]!;
  if (!(total > 0)) return [];
  const day = state.serviceEnds.dayAt(nowMs);
  const windows = state.departures.windowsOf(routeId, day.type);
  const out: SimulatedCabin[] = [];
  for (const [a, b, hw] of windows) {
    // salidas de esta ventana que todavía van por el cable: entre `ahora − vuelta` y `ahora`
    const first = Math.max(a, Math.ceil((day.secs - total - a) / hw) * hw + a);
    for (let t0 = first; t0 < b && t0 <= day.secs; t0 += hw) {
      const e = day.secs - t0;
      if (e < 0 || e >= total) continue;
      let j = 0;
      while (j < sched.off.length - 2 && sched.off[j + 1]! <= e) j++;
      const seg = sched.off[j + 1]! - sched.off[j]!, into = e - sched.off[j]!;
      const f = into <= CABIN_DWELL_S || seg <= CABIN_DWELL_S ? 0 : Math.min(1, (into - CABIN_DWELL_S) / (seg - CABIN_DWELL_S));
      const sAt = ss.s[j]! + f * (ss.s[j + 1]! - ss.s[j]!);
      const here = ss.path.pointAt(sAt), ahead = ss.path.pointAt(Math.min(sAt + 10, ss.s[ss.s.length - 1]!));
      const g = toGeo(here);
      out.push({ id: `cabina-${Math.round(t0)}`, lat: g.lat, lon: g.lon, bearing: bearingDegrees(here, ahead), lastIndex: j });
    }
  }
  return out;
}
