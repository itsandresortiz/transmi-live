import { isOffline, liveDownText, liveLevel } from "@transmi/application";
import { transit } from "./composition-root";
import { nowMs } from "./clock";
/** «10:45 p. m.» a partir de segundos desde la medianoche (el horario puede pasar de 24 h). */
export function clockOfDay(seconds: number): string {
  const h = Math.floor(seconds / 3600) % 24, m = Math.floor((seconds % 3600) / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "a. m." : "p. m."}`;
}
/** No está llegando nada reciente de los buses. Pocos buses con dato fresco (madrugada) NO cuenta como caída. */
export const liveDown = (): boolean => liveLevel(transit, nowMs()) === "none" || isOffline(transit, nowMs());      // sin conexión tampoco hay datos en vivo, aunque aún queden buses viejos por quitar

/** Qué decir cuando no llegan buses: de noche, que el servicio ya terminó; de día, que no hay datos en vivo. */
export const downText = () => liveDownText(nowMs(), isOffline(transit, nowMs()));
