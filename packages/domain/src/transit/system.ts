/** Sistema de transporte al que pertenece una ruta o un bus. */
export type SystemType = "troncal" | "dual" | "alimentador" | "zonal" | "otro";

export const SYSTEM_LABEL: Record<SystemType, string> = {
  troncal: "Troncal",
  dual: "Dual",
  alimentador: "Alimentador",
  zonal: "Zonal",
  otro: "Otros",
};
export const SYSTEMS: SystemType[] = ["troncal", "dual", "alimentador", "zonal"];

export interface RouteDescriptor {
  shortName: string;
  longName: string;
  description?: string;
  agencyId?: string;
  routeType?: string;
}

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Clasifica una ruta del GTFS por su nombre y descripción. */
export function classifyRoute(r: RouteDescriptor): SystemType {
  const sn = r.shortName.trim().toUpperCase();
  const txt = strip([r.longName, r.description ?? "", r.agencyId ?? ""].join(" "));
  if (/alimentador/.test(txt) || /^\d{1,2}-\d{1,2}$/.test(sn)) return "alimentador";
  if (/\bdual\b/.test(txt)) return "dual";
  if (/troncal|transmilenio/.test(txt) || /^[A-M]\d{2}$/.test(sn)) return "troncal";
  if (r.routeType === "3" || /^[A-Z]{0,2}\d{1,3}[A-Z]?$/.test(sn) || /sitp|zonal/.test(txt)) return "zonal";
  return "otro";
}

/** Cuando todavía no hay GTFS, el sistema se deduce del propio reporte del bus:
 *  los viajes `TTBD…` circulan por las troncales y las placas internas `Z##-####` son del SITP zonal. */
export function inferSystemFromReport(r: { tripId?: string; label?: string; id?: string }): SystemType {
  if ((r.tripId ?? "").startsWith("TTBD")) return "troncal";
  if (/^Z\d/.test(r.label ?? r.id ?? "")) return "zonal";
  return "otro";
}
