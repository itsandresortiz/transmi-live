import type { ServiceAlert } from "@transmi/domain";
import type { NetworkDto } from "./parse";

/** Correcciones puntuales al GTFS de TransMilenio cuando va por detrás de lo que opera en la calle.
 *  Cada una se aplica solo si el recorrido trae la parada de referencia y todavía no trae la que se agrega: cuando TransMilenio
 *  publique el dato corregido, la corrección deja de hacer algo sola. */
export interface StopPatch {
  /** Por qué existe (lo que se vio en la calle o en la app oficial). */
  why: string;
  /** Nombre corto de la ruta (p. ej. «H15»). */
  route: string;
  /** Parada que ya está en el recorrido y sirve de referencia. */
  anchor: string;
  /** Parada que falta. */
  add: string;
  /** Va justo antes o justo después de la referencia. */
  where: "before" | "after";
}

export const STOP_PATCHES: readonly StopPatch[] = [
  // La app oficial lista la H15 como «Calle 57 (vagón A) → Calle 53 - Universidad Manuela Beltrán (vagón A) → Av. 39»; el GTFS la trae sin Calle 57.
  { why: "H15 para en Calle 57 antes de la nueva estación Calle 53 - Universidad Manuela Beltrán", route: "H15", anchor: "74430", add: "74109", where: "before" },
];

/** Nombres de paradas que el GTFS trae mal escritos o confusos (por id). Las estaciones de TransMiCable vienen como «Cable portal tunal» y
 *  «Mirador del Paraiso»; la del Portal Tunal se llama así para no confundirla con las plataformas de buses del mismo portal. */
export const STOP_NAMES: Readonly<Record<string, string>> = {
  cable_tunal: "Portal Tunal · TransMiCable",
  cable_jpablo: "Juan Pablo II",
  cable_manitas: "Manitas",
  cable_paraiso: "Mirador del Paraíso",
};

/** Aplica las correcciones a los recorridos leídos del GTFS (no toca nada si la parada ya está o no existe). */
export function applyStopPatches(dto: NetworkDto, patches: readonly StopPatch[] = STOP_PATCHES): void {
  for (const s of dto.stops) { const n = STOP_NAMES[s.id]; if (n) s.name = n; }
  const known = new Set(dto.stops.map((s) => s.id));
  for (const p of patches) {
    if (!known.has(p.add)) continue;
    const ids = new Set(dto.routes.filter((r) => r.shortName === p.route).map((r) => r.id));
    for (const sh of dto.shapes) {
      if (!ids.has(sh.routeId) || sh.stopIds.includes(p.add)) continue;
      const i = sh.stopIds.indexOf(p.anchor);
      if (i < 0) continue;
      sh.stopIds.splice(p.where === "before" ? i : i + 1, 0, p.add);
    }
  }
}

/** Cambio temporal anunciado por TransMilenio (cierre de un vagón por obras, una ruta que para en otra estación unos días).
 *  Solo vale entre `from` y `to` (fechas de Bogotá, ambas incluidas); fuera de esas fechas no hace nada, así que no hay que acordarse
 *  de borrarlo. Como el GTFS no trae estos cierres y los avisos en vivo tampoco, sin esto «Cómo llegar» mandaría a la gente a un
 *  vagón cerrado. Se aplica al armar la red: en el workflow «GTFS diario» (así les llega también a las apps ya publicadas) y en cada
 *  apertura de la web y de la app. */
export interface TempStopChange {
  /** Lo que anunció TransMilenio y cuándo. */
  why: string;
  /** Nombre corto de la ruta (p. ej. «A60»). */
  route: string;
  /** Parada (vagón y sentido) que deja de atender. */
  stop: string;
  /** Si para en otra estación en su lugar, la parada nueva (va en el mismo puesto del recorrido). Sin esto, la ruta solo se salta la parada. */
  replaceWith?: string;
  /** Primer y último día (AAAA-MM-DD, hora de Bogotá). */
  from: string;
  to: string;
}

const SABANA_2026_11 = "Cierre temporal del vagón 1 de De La Sabana, sentido occidente-oriente (obras en la vía), del 17 al 23 de noviembre de 2026";
const ZONA_IND_2026_11 = "Cierre temporal del vagón 2 de Zona Industrial, sentido occidente-oriente (obras en la vía), del 17 al 23 de noviembre de 2026";
export const TEMP_STOP_CHANGES: readonly TempStopChange[] = [
  // De La Sabana A - 2 ó 5 (61650) → San Façon - Cra. 22 B - 2 ó 5 (61705, «vagón 2 de San Facón»); la J23 ya para ahí y solo se salta De La Sabana
  { why: SABANA_2026_11, route: "A60", stop: "61650", replaceWith: "61705", from: "2026-11-17", to: "2026-11-23" },
  { why: SABANA_2026_11, route: "C19", stop: "61650", replaceWith: "61705", from: "2026-11-17", to: "2026-11-23" },
  { why: SABANA_2026_11, route: "J23", stop: "61650", from: "2026-11-17", to: "2026-11-23" },
  // Zona Industrial B - 2 ó 5 (61718) → CDS - Cra. 32 B - 2 ó 5 (61641, «vagón 2 de CDS Carrera 32»); la B28 ya para en CDS y solo se salta Zona Industrial
  { why: ZONA_IND_2026_11, route: "E32", stop: "61718", replaceWith: "61641", from: "2026-11-17", to: "2026-11-23" },
  { why: ZONA_IND_2026_11, route: "B28", stop: "61718", from: "2026-11-17", to: "2026-11-23" },
];

/** Fecha de Bogotá (AAAA-MM-DD) de una hora en milisegundos. */
export const bogotaDate = (ms: number): string => new Date(ms - 5 * 3600_000).toISOString().slice(0, 10);

/** Aplica los cambios temporales vigentes hoy. Repetirlo no cambia nada (la parada cerrada ya no está). */
export function applyTempStopChanges(dto: NetworkDto, nowMs = Date.now(), changes: readonly TempStopChange[] = TEMP_STOP_CHANGES): TempStopChange[] {
  const today = bogotaDate(nowMs), known = new Set(dto.stops.map((s) => s.id)), used: TempStopChange[] = [];
  for (const c of changes) {
    if (today < c.from || today > c.to) continue;
    const ids = new Set(dto.routes.filter((r) => r.shortName === c.route).map((r) => r.id));
    for (const sh of dto.shapes) {
      if (!ids.has(sh.routeId)) continue;
      const i = sh.stopIds.indexOf(c.stop);
      if (i < 0) continue;
      const swap = c.replaceWith && known.has(c.replaceWith) && sh.stopIds[i - 1] !== c.replaceWith && sh.stopIds[i + 1] !== c.replaceWith;
      if (swap) sh.stopIds[i] = c.replaceWith!; else sh.stopIds.splice(i, 1);
      used.push(c);
    }
  }
  return used;
}

/** Lo que se le dice a la gente de cada cierre temporal (aparece en «Avisos», en la estación y en las rutas afectadas). */
export interface TempNotice { title: string; text: string; routes: string[]; stops: string[]; from: string; to: string }
export const TEMP_NOTICES: readonly TempNotice[] = [
  {
    title: "De La Sabana: vagón 1 cerrado hacia el oriente",
    text: "Del 17 al 23 de noviembre el vagón 1 de De La Sabana está cerrado en sentido occidente-oriente por obras en la vía. Las rutas A60 y C19 paran en el vagón 2 de San Facón - Cra. 22. La J23 no para en De La Sabana.",
    routes: ["A60", "C19", "J23"], stops: ["61650", "61705"], from: "2026-11-17", to: "2026-11-23",
  },
  {
    title: "Zona Industrial: vagón 2 cerrado hacia el oriente",
    text: "Del 17 al 23 de noviembre el vagón 2 de Zona Industrial está cerrado en sentido occidente-oriente por obras en la vía. La ruta E32 para en el vagón 2 de CDS - Carrera 32. La B28 no para en Zona Industrial.",
    routes: ["E32", "B28"], stops: ["61718", "61641"], from: "2026-11-17", to: "2026-11-23",
  },
];

/** Los avisos de los cierres vigentes hoy, con las rutas de la red (`routeIdsOf` da los ids de un nombre corto). */
export function tempNoticeAlerts(nowMs: number, routeIdsOf: (shortName: string) => string[], notices: readonly TempNotice[] = TEMP_NOTICES): ServiceAlert[] {
  const today = bogotaDate(nowMs);
  const day = (d: string, end: boolean) => Date.parse(`${d}T${end ? "23:59:59" : "00:00:00"}-05:00`) / 1000;
  return notices.filter((n) => today >= n.from && today <= n.to).map((n, i) => ({
    id: -1 - i, headline: n.title, description: "", effect: "modified" as const, title: n.title, text: n.text,
    routeIds: n.routes.flatMap(routeIdsOf), stopIds: n.stops, startsAt: day(n.from, false), endsAt: day(n.to, true),
  }));
}
