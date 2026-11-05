import type { ServiceMark } from "@transmi/application";

/** «10:45 p. m.» a partir de segundos desde la medianoche (el horario puede pasar de 24 h). */
export function clockOfDay(seconds: number): string {
  const h = Math.floor(seconds / 3600) % 24, m = Math.floor((seconds % 3600) / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "a. m." : "p. m."}`;
}

/** Marca de «último servicio»: el viaje programado más tarde del día de esa ruta. */
export function LastBadge({ mark, long = false }: { mark: ServiceMark | undefined; long?: boolean }) {
  if (!mark?.isLast) return null;
  return <span className="lastbadge" title={`Último viaje programado del día (salida programada a las ${clockOfDay(mark.startSeconds)})`}>{long ? "Último servicio de la ruta" : "Último servicio"}</span>;
}
