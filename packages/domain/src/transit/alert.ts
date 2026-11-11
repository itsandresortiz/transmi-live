export type AlertEffect =
  | "noService" | "reduced" | "delays" | "detour" | "additional" | "modified" | "stopMoved" | "other";

/** Códigos numéricos del estándar GTFS-realtime. */
export const ALERT_EFFECT_BY_CODE: Record<number, AlertEffect> = {
  1: "noService", 2: "reduced", 3: "delays", 4: "detour", 5: "additional", 6: "modified", 9: "stopMoved",
};

export const ALERT_EFFECT_LABEL: Record<AlertEffect, string> = {
  noService: "Sin servicio", reduced: "Servicio reducido", delays: "Demoras", detour: "Desvío",
  additional: "Servicio adicional", modified: "Modificado", stopMoved: "Parada movida", other: "Aviso",
};

export interface ServiceAlert {
  readonly id: number;
  readonly headline: string;
  readonly description: string;
  readonly effect: AlertEffect;
  readonly routeIds: readonly string[];
  readonly stopIds: readonly string[];
  readonly startsAt?: number;
  readonly endsAt?: number;
}

/** «Novedad en la operacion en linea HF615\416A11_Br. X\064A09_Br. Y» → «La ruta HF615 se desvía entre Br. X y Br. Y». */
/** `routeName` traduce el número interno de la ruta (así la nombra TransMilenio desde nov. 2026: «10772») al nombre que conoce la gente («T21»). */
export function describeAlert(a: ServiceAlert, routeName?: (id: string) => string | undefined): string {
  const d = a.description;
  if (!d) return a.headline;
  const parts = d.split("\\");
  if (parts.length < 2) return d.replace(/^Novedad en la operacion en linea\s*/i, "");
  const code = parts[0]!.replace(/^.*\s/, ""), line = routeName?.(code) ?? code;
  const places = parts.slice(1).map((x) => x.replace(/^\w+?_/, "").replace(/^TM_/, "").trim()).filter(Boolean);
  const verb = a.effect === "noService" ? "no presta servicio" : a.effect === "detour" ? "se desvía" : a.effect === "delays" ? "va con demoras" : a.effect === "reduced" ? "tiene servicio reducido" : a.effect === "additional" ? "tiene servicio adicional" : "tiene cambios";
  if (places.length === 2) return `La ruta ${line} ${verb} entre ${places[0]} y ${places[1]}.`;
  if (places.length === 1) return `La ruta ${line} ${verb} cerca de ${places[0]}.`;
  return `La ruta ${line} ${verb}: pasa por ${places.join(" → ")}.`;
}

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
const MOTIVOS: [RegExp, string][] = [
  [/CAMBIO\s*DE\s*SENTIDO/, "Cambio de sentido vial"],
  [/REVERSIBLE/, "Carril reversible"],
  [/CIERRE/, "Cierre de vía"],
  [/OBRA/, "Obras en la vía"],
  [/MANIFESTACION|MARCHA|PROTESTA|BLOQUEO/, "Manifestación o bloqueo"],
  [/ACCIDENTE|SINIESTRO/, "Accidente"],
  [/DESVIO|DESV\b/, "Desvío"],
  [/MALLA\s*VIAL/, "Obras en la malla vial"],
  [/PMT|PLAN\s*DE\s*MANEJO/, "Plan de manejo de tránsito"],
  [/^\W*EM[A-Z]/, "Emergencia en la vía"],
  [/^\W*TP[\s-]*\d/, "Plan de tránsito"],
  [/CABECERA|SALIDA|LLEGADA/, "Cambio en la cabecera de la ruta"],
];
/** Título legible: los avisos llegan con códigos internos («EMCONTRAVIACR20ACONCL72A», «PMTCIERRE1MAYOCONCRA11»); se deduce el motivo. */
export function alertTitle(a: ServiceAlert): string {
  const h = strip(a.headline);
  for (const [re, label] of MOTIVOS) if (re.test(h)) return label;
  return "Novedad en el recorrido";
}
/** El código original del aviso, por si alguien quiere consultarlo. */
export function alertReference(a: ServiceAlert): string {
  return a.headline.replace(/[*⚠️]+/g, "").replace(/\s+/g, " ").trim();
}

/** Desde noviembre de 2026 TransMilenio publica casi todos los avisos con un periodo de apenas unos segundos (empieza y termina en el mismo
 *  instante): esa hora no es una vigencia, es el momento en que se reportó la novedad. Tomada al pie de la letra, todos los avisos salían
 *  «vencidos» y la app no mostraba ninguno. */
const INSTANT_S = 300;
/** Cuánto tiempo se sigue mostrando una novedad reportada «en un instante» (mientras TransMilenio la siga publicando). */
export const REPORT_WINDOW_S = 6 * 3600;
export function isReportedAlert(a: ServiceAlert): boolean {
  return a.startsAt != null && a.endsAt != null && a.endsAt - a.startsAt < INSTANT_S;
}

/** ¿El aviso está vigente en `nowSec`? Los vencidos y los que aún no empiezan no se muestran. Una novedad reportada en un instante se muestra
 *  durante las horas siguientes al reporte. */
export function isAlertActive(a: ServiceAlert, nowSec: number): boolean {
  if (a.startsAt != null && a.startsAt > nowSec + 3600) return false;
  if (isReportedAlert(a)) return nowSec - a.endsAt! < REPORT_WINDOW_S;
  if (a.endsAt != null && a.endsAt < nowSec) return false;
  return true;
}

/** «Desde el 5 nov. · hasta el 25 nov.» (hora de Bogotá). Si la fecha no es de este año se agrega el año, para que no se confunda. */
export function alertValidity(a: ServiceAlert, nowSec: number = Date.now() / 1000): string {
  const year = (t: number) => Number(new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: "America/Bogota" }).format(new Date(t * 1000)));
  const thisYear = year(nowSec);
  const f = (t: number) => new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", ...(year(t) !== thisYear ? { year: "numeric" } : {}), timeZone: "America/Bogota" }).format(new Date(t * 1000)).replace(/\.$/, "");
  // una novedad reportada en un instante no tiene «desde… hasta»: se dice cuándo se reportó, para que nadie la tome por algo de ahora mismo
  if (isReportedAlert(a)) {
    const hour = new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Bogota" }).format(new Date(a.startsAt! * 1000));
    const day = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date(t * 1000));
    return day(a.startsAt!) === day(nowSec) ? `Reportado hoy a las ${hour}` : `Reportado el ${f(a.startsAt!)} a las ${hour}`;
  }
  const parts: string[] = [];
  if (a.startsAt != null) parts.push(`Desde el ${f(a.startsAt)}`);
  if (a.endsAt != null) parts.push(`hasta el ${f(a.endsAt)}`);
  return parts.join(" · ");
}

/** Los avisos más graves primero. */
export function alertSeverity(e: AlertEffect): number {
  return { noService: 0, reduced: 1, delays: 2, detour: 3, modified: 4, stopMoved: 5, additional: 6, other: 7 }[e];
}
