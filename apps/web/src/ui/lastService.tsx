import type { ServiceMark } from "@transmi/application";
import { transit } from "../composition-root";

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

/** Marca de «primer servicio»: el primer viaje programado del día de esa ruta. */
export function FirstBadge({ mark }: { mark: ServiceMark | undefined }) {
  if (!mark?.isFirst || mark.isLast) return null;
  return <span className="lastbadge first" title={`Primer viaje programado del día (salida programada a las ${clockOfDay(mark.startSeconds)})`}>Primer servicio</span>;
}

/** Aviso de que la ruta ya terminó por hoy (o todavía no empieza), según el horario programado. */
export function RouteStatusNote({ routeId, nowMs, label }: { routeId: string; nowMs: number; label?: string }) {
  const st = transit.routeStatus(routeId, nowMs);
  if (!st || st.state === "running") return null;
  return (
    <div className="lastnote" role="status">
      {st.state === "ended"
        ? <><b>{label ? `${label}: ya` : "Ya"} no hay más buses hoy.</b><br />El último salió a las {clockOfDay(st.lastStart)} y ya no queda ninguno en la calle.</>
        : <><b>{label ? `${label}: aún` : "Aún"} no empieza el servicio.</b><br />El primer bus sale a las {clockOfDay(st.firstStart)}.</>}
    </div>
  );
}
