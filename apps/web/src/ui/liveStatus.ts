import { liveLevel } from "@transmi/application";
import { transit } from "../composition-root";
import { nowMs } from "../clock";

/** La fuente en vivo no está enviando buses (los que se ven, si hay, son muy pocos): no se debe confundir con «no hay servicio». */
export const liveDown = (): boolean => liveLevel(transit, nowMs()) === "none";

export const LIVE_DOWN_TITLE = "Sin datos en vivo por ahora";
export const LIVE_DOWN_TEXT = "TransMilenio no está enviando la ubicación de los buses. Eso no significa que no haya servicio: te mostramos lo que dice el horario programado.";
