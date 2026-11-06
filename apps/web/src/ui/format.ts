import { type Delay, delayLabel } from "@transmi/domain";

export const clock = (sec: number) => new Date(sec * 1000).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
export function ago(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}
export const delayClass = (d: Delay) => (d.kind === "late" ? (d.severe ? "bad" : "warn") : d.kind === "onTime" ? "ok" : d.kind === "early" ? "early" : "");
export const delayText = (d: Delay) => (d.kind === "unknown" ? "Sin dato" : delayLabel(d));
export function untilText(arrivalAt: number | undefined, nowSec: number): string {
  if (arrivalAt == null) return "—";
  const s = Math.round(arrivalAt - nowSec);
  return s <= 0 ? "llegando" : s < 3600 ? `en ${ago(s)}` : clock(arrivalAt);
}

/** «llegando», «45 s», «3 min 20 s». */
export function etaText(at: number, nowSec: number): string {
  const s = Math.round(at - nowSec);
  return s <= 15 ? "llegando" : s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}
export const stopsAwayText = (n: number) => (n <= 1 ? "su próxima parada" : `a ${n - 1} ${n - 1 === 1 ? "parada" : "paradas"}`);

/** Versión corta para espacios chicos: «45 s», «9 min», «3 h». */
export function agoShort(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h`;
}
