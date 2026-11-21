import type { TransitState } from "./transit-state";

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
