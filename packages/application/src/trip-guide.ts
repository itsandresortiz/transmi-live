import type { GeoPoint } from "@transmi/domain";
import { hav } from "./eta";
import type { Itinerary, RideLeg, StopRef } from "./planner";
import { upcomingAtStop } from "./queries";
import { arrivalAtIndex } from "./eta";
import type { TransitState } from "./transit-state";

/** Guía paso a paso de un viaje de «Cómo llegar»: en qué paso va la persona, qué hacer ahora y qué avisos programar
 *  («ya casi llega tu bus», «prepárate para bajar», «bájate aquí y camina hasta…», «toma el siguiente en el vagón…»).
 *  Es lógica pura: la app le pasa la ubicación (si la hay) y la hora; con la app en segundo plano los avisos salen a la hora estimada. */
export type GuidePhase = "walk" | "wait" | "ride" | "done";
export interface GuideState { leg: number; phase: GuidePhase }
export interface GuideAlert { id: string; leg: number; kind: "go" | "board" | "ready" | "off"; at: number; title: string; body: string }
export interface GuideStep { leg: number; kind: "walk" | "ride"; start: number; end: number; title: string; detail: string }
/** Cómo nombrar una parada («Calle 100, vagón 2»): lo decide la app, que conoce vagones y plataformas. */
export type PlaceText = (stop: StopRef) => string;

const NEAR_STOP_M = 70;        // llegó caminando a la parada
const LEFT_STOP_M = 250;       // se alejó de la parada donde esperaba: ya va en el bus
const NEAR_ALIGHT_M = 160;     // el bus está llegando a donde se baja
const GRACE_S = 300;           // con ubicación, si pasa esto de la hora prevista sin detectar el cambio, se avanza igual

const mins = (s: number) => Math.max(1, Math.round(s / 60));
const dist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace(".", ",")} km` : `${Math.max(10, Math.round(m / 10) * 10)} m`);
const bus = (l: RideLeg) => `${l.shortName}${l.headsign ? ` hacia ${l.headsign}` : ""}`;
const stopsText = (n: number) => `${n} ${n === 1 ? "parada" : "paradas"}`;

/** Hora de inicio y fin de cada tramo (s). Un tramo en bus empieza cuando se llega a esperar y termina al bajarse. */
export function legTimes(it: Itinerary): { start: number; end: number }[] {
  let t = it.departAt;
  return it.legs.map((l) => { const start = t; t = l.kind === "walk" ? t + l.seconds : l.arriveAt; return { start, end: t }; });
}

function enter(it: Itinerary, i: number): GuideState {
  const l = it.legs[i];
  return l ? { leg: i, phase: l.kind === "walk" ? "walk" : "wait" } : { leg: it.legs.length, phase: "done" };
}
export const startGuide = (it: Itinerary): GuideState => enter(it, 0);

/** Avanza la guía. Con ubicación reciente (`here`) manda dónde está la persona; sin ella, la hora prevista (`shift` = atraso o adelanto medido, s). */
export function advanceGuide(it: Itinerary, prev: GuideState, here: GeoPoint | null, nowSec: number, shift = 0): GuideState {
  const times = legTimes(it);
  let s = prev;
  for (let guard = 0; guard < it.legs.length * 2 + 2; guard++) {
    const l = it.legs[s.leg];
    if (!l || s.phase === "done") return { leg: it.legs.length, phase: "done" };
    const late = (t: number) => nowSec >= t + shift + (here ? GRACE_S : 0);
    let next: GuideState | null = null;
    if (l.kind === "walk") {
      if ((here && hav(here, l.to) <= NEAR_STOP_M) || late(times[s.leg]!.end)) next = enter(it, s.leg + 1);
    } else if (s.phase === "wait") {
      if (here && hav(here, l.alight.position) <= NEAR_ALIGHT_M && hav(here, l.board.position) > NEAR_ALIGHT_M) next = enter(it, s.leg + 1);
      else if ((here && hav(here, l.board.position) > LEFT_STOP_M && nowSec >= l.departAt + shift - 120) || late(l.departAt + 30)) next = { leg: s.leg, phase: "ride" };
    } else if ((here && hav(here, l.alight.position) <= NEAR_ALIGHT_M) || late(l.arriveAt)) next = enter(it, s.leg + 1);
    if (!next) return s;
    s = next;
  }
  return s;
}

/** Los pasos del viaje, para listarlos. */
export function guideSteps(it: Itinerary, place: PlaceText): GuideStep[] {
  const times = legTimes(it);
  return it.legs.map((l, i) => {
    const next = it.legs[i + 1];
    if (l.kind === "walk") return { leg: i, kind: "walk", ...times[i]!, title: `Camina ${mins(l.seconds)} min hasta ${next?.kind === "ride" ? place(next.board) : l.toName}`, detail: dist(l.meters) };
    return { leg: i, kind: "ride", ...times[i]!, title: `Toma el ${bus(l)}`, detail: `Sube en ${place(l.board)} · ${stopsText(l.stops)} · baja en ${place(l.alight)}` };
  });
}

/** Qué sigue después de bajarse en el tramo `i` (para decirlo en el mismo aviso). */
function after(it: Itinerary, i: number, place: PlaceText): string {
  const a = it.legs[i + 1], b = it.legs[i + 2];
  if (!a) return "Llegaste a tu destino.";
  if (a.kind === "ride") return `Ahora toma el ${bus(a)} en ${place(a.board)}.`;
  if (b?.kind === "ride") return `Camina ${mins(a.seconds)} min hasta ${place(b.board)} y toma el ${bus(b)}.`;
  return `Camina ${mins(a.seconds)} min (${dist(a.meters)}) hasta tu destino.`;
}

/** Qué hacer ahora mismo. */
export function guideNow(it: Itinerary, s: GuideState, place: PlaceText): { title: string; body: string } {
  const l = it.legs[s.leg], next = it.legs[s.leg + 1];
  if (!l || s.phase === "done") return { title: "Llegaste", body: "Fin del viaje." };
  if (l.kind === "walk") return next?.kind === "ride"
    ? { title: `Camina hasta ${place(next.board)}`, body: `${mins(l.seconds)} min (${dist(l.meters)}). Allí tomas el ${bus(next)}.` }
    : { title: "Camina hasta tu destino", body: `${mins(l.seconds)} min (${dist(l.meters)}).` };
  if (s.phase === "wait") return { title: `Espera el ${bus(l)}`, body: `Súbete en ${place(l.board)}. Te bajas en ${place(l.alight)} (${stopsText(l.stops)}).` };
  return { title: `Vas en el ${l.shortName}`, body: `Bájate en ${place(l.alight)}. ${after(it, s.leg, place)}` };
}

/** Avisos del viaje con su hora prevista (s). La app les suma el atraso medido y descarta los de tramos ya hechos. */
export function guideAlerts(it: Itinerary, place: PlaceText): GuideAlert[] {
  const out: GuideAlert[] = [];
  const first = it.legs[0], second = it.legs[1];
  if (first?.kind === "walk" && second?.kind === "ride")
    out.push({ id: "g0-go", leg: 0, kind: "go", at: it.departAt, title: "Hora de salir", body: `Camina ${mins(first.seconds)} min hasta ${place(second.board)} para tomar el ${bus(second)}.` });
  it.legs.forEach((l, i) => {
    if (l.kind !== "ride") return;
    out.push({ id: `g${i}-board`, leg: i, kind: "board", at: l.departAt - 120, title: `Ya casi llega el ${l.shortName}`, body: `Súbete en ${place(l.board)}${l.headsign ? `, hacia ${l.headsign}` : ""}.` });
    out.push({ id: `g${i}-ready`, leg: i, kind: "ready", at: l.arriveAt - Math.min(120, Math.max(45, l.rideSeconds / 3)), title: "Prepárate para bajar", body: `Ya casi llegas a ${place(l.alight)}.` });
    out.push({ id: `g${i}-off`, leg: i, kind: "off", at: l.arriveAt - 15, title: `Bájate aquí: ${place(l.alight)}`, body: after(it, i, place) });
  });
  return out;
}

/** Los avisos que todavía aplican según el paso en que va la persona, ya corridos por el atraso medido. */
export function pendingAlerts(it: Itinerary, s: GuideState, place: PlaceText, shift = 0): GuideAlert[] {
  return guideAlerts(it, place)
    .filter((a) => a.leg > s.leg || (a.leg === s.leg && !(s.phase === "ride" && a.kind === "board") && a.kind !== "go"))
    .map((a) => ({ ...a, at: a.at + shift }));
}

/* ---------- el bus real de cada tramo (para corregir las horas con datos en vivo) ---------- */

/** Qué bus real corresponde a un tramo. Esperando: el próximo de esa ruta que viene hacia la parada donde se sube.
 *  A bordo: el de esa ruta más cercano a la persona (si hay ubicación y está a menos de 200 m). `keep` es el que ya se venía siguiendo: se conserva mientras siga sirviendo. */
export function busForLeg(state: TransitState, leg: RideLeg, phase: GuidePhase, here: GeoPoint | null, nowSec: number, keep?: string): string | undefined {
  const serves = (id: string | undefined, stopId: string): boolean => {
    const v = id ? state.fleet.get(id) : undefined, seq = v ? state.sequenceForDisplay(v) : undefined;
    return !!v && !!seq && v.routeId === leg.routeId && seq.shape.stopIds.indexOf(stopId, Math.max(0, seq.index)) >= 0;
  };
  if (phase === "ride") {
    if (serves(keep, leg.alight.id)) return keep;
    if (!here) return undefined;
    let best: string | undefined, bestM = 200;
    for (const v of state.fleet.values()) { if (v.routeId !== leg.routeId) continue; const m = hav(here, v.position); if (m < bestM && serves(v.id, leg.alight.id)) { best = v.id; bestM = m; } }
    return best;
  }
  if (phase !== "wait") return undefined;
  if (serves(keep, leg.board.id)) return keep;
  if (serves(leg.busId, leg.board.id)) return leg.busId;
  const coming = upcomingAtStop(state, leg.board.id, nowSec, 3).filter((u) => u.route.id === leg.routeId).flatMap((u) => u.buses).sort((a, b) => a.etaAt - b.etaAt);
  return coming.find((b) => b.etaAt >= nowSec - 30)?.vehicle.id;
}

/** Cuánto se corre el plan según ese bus: su hora real a la parada donde se sube (esperando) o donde se baja (a bordo), menos la prevista. `null` si no se puede calcular. */
export function liveShift(state: TransitState, leg: RideLeg, phase: GuidePhase, busId: string | undefined, nowMs: number): number | null {
  const v = busId ? state.fleet.get(busId) : undefined, seq = v ? state.sequenceForDisplay(v) : undefined;
  if (!v || !seq || (phase !== "wait" && phase !== "ride")) return null;
  const ti = seq.shape.stopIds.indexOf(phase === "ride" ? leg.alight.id : leg.board.id, Math.max(0, seq.index));
  if (ti < 0) return null;
  const eta = arrivalAtIndex(state, v, seq.shape, seq.index, ti, nowMs);
  return eta > 0 ? Math.round(eta - (phase === "ride" ? leg.arriveAt : leg.departAt)) : null;
}
