import { transit } from "../composition-root";

/** La fuente en vivo no está enviando buses (los que se ven, si hay, son muy pocos): no se debe confundir con «no hay servicio». */
export const liveDown = (): boolean => transit.fleet.size < 50;

export const LIVE_DOWN_TITLE = "Sin datos en vivo por ahora";
export const LIVE_DOWN_TEXT = "TransMilenio no está enviando la ubicación de los buses. Eso no significa que no haya servicio: te mostramos lo que dice el horario programado.";
