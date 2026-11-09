/** «10:45 p. m.» a partir de segundos desde la medianoche (el horario puede pasar de 24 h). */
export function clockOfDay(seconds: number): string {
  const h = Math.floor(seconds / 3600) % 24, m = Math.floor((seconds % 3600) / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "a. m." : "p. m."}`;
}
export const liveDown = (fleetSize: number): boolean => fleetSize < 50;
