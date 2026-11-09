import type { Leg, RideLeg, WalkLeg } from "@transmi/application";

export const mins = (s: number) => Math.max(1, Math.round(s / 60));
export function durText(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 1) return "menos de 1 min";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, "0")} min` : `${h} h`;
}
export const hm = (sec: number) => new Date(sec * 1000).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit", timeZone: "America/Bogota" });
export const meters = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace(".", ",")} km` : `${Math.round(m / 10) * 10} m`);
export const transfersText = (n: number) => (n <= 0 ? "Sin trasbordos" : n === 1 ? "1 trasbordo" : `${n} trasbordos`);
export const isRide = (l: Leg): l is RideLeg => l.kind === "ride";
export const isWalk = (l: Leg): l is WalkLeg => l.kind === "walk";
