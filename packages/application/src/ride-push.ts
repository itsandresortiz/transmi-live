import type { Vehicle } from "@transmi/domain";
import { arrivalAtIndex } from "./eta";
import type { TransitState } from "./transit-state";

/**
 * Avisos del viaje calculados en un servidor (función de Supabase `avisos-viaje`), para que «Prepárate para bajar», «Bájate aquí» y la
 * actividad en vivo se corrijan aunque la app esté cerrada. Es la MISMA cuenta que hace la app abierta (`RideWatcher`): se comparte aquí
 * para que el servidor y el teléfono digan lo mismo. El servidor no conoce el GPS de la persona: cuenta desde el último reporte del bus.
 */

/** Un viaje no dura más que esto: el servidor lo borra solo (también lo hace la app con lo guardado). */
export const RIDE_PUSH_MAX_MS = 3 * 3600_000;
/** Si el bus deja de reportar este tiempo, el servidor da el viaje por terminado. */
export const RIDE_PUSH_GONE_MS = 10 * 60_000;

/** Lo que muestra la actividad en vivo (pantalla de bloqueo / isla dinámica) y la notificación fija de Android. Igual a `TripActivityState`
 *  de `modules/tripactivity` y a `ContentState` en Swift. */
export interface RideActivityState { title: string; detail: string; badge: string; color: string; until: number; untilLabel: string; step: number; steps: number; arrive: number; link: string }

/** Los tres avisos del viaje (mismos identificadores que los avisos locales de la app). */
export type RidePushAlertId = "ride-3" | "ride-1" | "ride-0";
export interface RidePushAlert { id: RidePushAlertId; title: string; body: string }

/** Un viaje registrado: con qué bus, dónde se baja y los textos que ya conoce la app (nombre de la ruta, color, nombre de la parada). */
export interface PushRide {
  busId: string; alightId: string;
  /** Paradas que faltaban al marcar la bajada (para la barra de avance). */
  total: number;
  route: string; color: string; stop: string;
  /** Avisos ya enviados o ya sonados en el teléfono (id → segundos): no se repiten. */
  sent: Readonly<Record<string, number>>;
}

/** Texto y estado de la actividad en vivo mientras vas hacia tu parada. Lo usan la app y el servidor. */
export function rideActivityState(r: { busId: string; route: string; color: string; stop: string; total: number }, left: number, eta: number): RideActivityState {
  const total = Math.max(r.total, left, 1);
  return {
    title: `Vas en el ${r.route || "bus"}`,
    detail: left === 1 ? `La siguiente parada es la tuya: ${r.stop}.` : `Te bajas en ${r.stop}. Faltan ${left} paradas.`,
    badge: r.route, color: r.color, until: eta, untilLabel: "Te bajas en",
    step: total - left, steps: total, arrive: eta, link: `transmilive:///ride/${r.busId}`,
  };
}

/** Textos de cada aviso (los mismos de los avisos locales). */
export function rideAlertText(id: RidePushAlertId, stop: string): RidePushAlert {
  if (id === "ride-3") return { id, title: "Faltan 3 paradas", body: `Te bajas en ${stop}.` };
  if (id === "ride-1") return { id, title: "Prepárate para bajar", body: `La siguiente parada es ${stop}.` };
  return { id, title: "Bájate aquí", body: `Estás llegando a ${stop}.` };
}

export type RidePushPlan =
  /** El bus no aparece en los datos (o aún no hay datos): no se hace nada en esta vuelta. */
  | { kind: "missing" }
  /** Ya pasó tu parada, o el bus va por otro recorrido: el viaje terminó. `alerts` puede traer un «Bájate aquí» que no alcanzó a salir. */
  | { kind: "done"; alerts: RidePushAlert[]; markSent: RidePushAlertId[] }
  | { kind: "going"; left: number; eta: number; alerts: RidePushAlert[]; markSent: RidePushAlertId[]; activity: RideActivityState };

/**
 * Qué avisar en esta vuelta del servidor. `tickS` = cada cuánto se vuelve a calcular: un aviso sale si su hora cae antes de la mitad de la
 * vuelta siguiente (así suena a lo sumo ~`tickS/2` antes o después de lo ideal). Un aviso que ya no tiene sentido (p. ej. «Faltan 3 paradas»
 * con 2) no sale, pero se marca para no volver a mirarlo.
 */
export function planRidePush(state: TransitState, ride: PushRide, nowMs: number, tickS = 25): RidePushPlan {
  const v: Vehicle | undefined = state.fleet.get(ride.busId);
  const seq = v ? state.sequenceForDisplay(v) : undefined;
  if (!v || !seq) return { kind: "missing" };
  const ti = seq.shape.stopIds.indexOf(ride.alightId, Math.max(0, seq.index));
  const now = nowMs / 1000, half = tickS / 2;
  const alerts: RidePushAlert[] = [], markSent: RidePushAlertId[] = [];
  const due = (id: RidePushAlertId, send: boolean) => {
    if (ride.sent[id] != null) return;
    markSent.push(id);
    if (send) alerts.push(rideAlertText(id, ride.stop));
  };
  if (ti < 0) {
    // ya pasó la parada (o el bus no va hacia ella): si el «Bájate aquí» no salió, sale ya (tarde es mejor que nunca) y el viaje termina
    due("ride-3", false); due("ride-1", false); due("ride-0", ride.sent["ride-1"] != null);
    return { kind: "done", alerts, markSent };
  }
  const left = ti - seq.index;
  const at = (j: number) => arrivalAtIndex(state, v, seq.shape, seq.index, j, nowMs);
  const eta = at(ti);
  if (left < 3) due("ride-3", false); else if (at(ti - 3) <= now + half) due("ride-3", true);
  if (left < 1) due("ride-1", false); else if (left === 1 || at(ti - 1) <= now + half) due("ride-1", true);
  if (left <= 0 || eta - 20 <= now + half) due("ride-0", true);
  if (left <= 0) return { kind: "done", alerts, markSent };
  return { kind: "going", left, eta, alerts, markSent, activity: rideActivityState({ ...ride, total: ride.total }, left, eta) };
}

/** ¿Vale la pena mandar una actualización de la actividad en vivo? Solo si cambió la parada que falta o la hora se movió ≥30 s
 *  (cada envío gasta batería y Apple limita cuántos acepta por hora). */
export function rideActivityChanged(prev: { left: number; eta: number } | null | undefined, left: number, eta: number): boolean {
  return !prev || prev.left !== left || Math.abs(prev.eta - eta) >= 30;
}
