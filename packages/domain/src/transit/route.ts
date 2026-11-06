import type { SystemType } from "./system";

export type RouteId = string;

export interface Route {
  readonly id: RouteId;
  readonly shortName: string;
  readonly longName: string;
  readonly system: SystemType;
  /** Ruta creada solo a partir de los reportes de buses, mientras no se conoce su nombre. */
  readonly provisional?: boolean;
}


/** Expande las abreviaturas de direcciones del GTFS: «CLL134 KR 7» → «Calle 134 con Cra. 7», «AK 45» → «Av. Carrera 45». */
export function prettyPlace(raw: string): string {
  let t = raw.replace(/\s+/g, " ").trim();
  if (!t) return t;
  const allCaps = t === t.toUpperCase() && /[A-ZÁÉÍÓÚÑ]{4,}/.test(t);
  t = t
    .replace(/\bCALLE\s*(\d)/gi, "Calle $1").replace(/\bCARRERA\s*(\d)/gi, "Carrera $1")
    .replace(/\bAK\.?\s*(\d)/gi, "Av. Carrera $1").replace(/\bAC\.?\s*(\d)/gi, "Av. Calle $1")
    .replace(/\bAV\.?\s+(?=CL|CLL|KR|CR|CRA|AK|AC|\d)/gi, "Av. ")
    .replace(/\bCLL?\.?\s*(\d)/gi, "Calle $1").replace(/\b(?:KR|CRA?)\.?\s*(\d)/gi, "Cra. $1")
    .replace(/\bDG\.?\s*(\d)/gi, "Diagonal $1").replace(/\bTV\.?\s*(\d)/gi, "Transversal $1")
    .replace(/\bEst\.?(?=\s)/g, "Est.");
  // «Calle 134 Cra. 7» → «Calle 134 con Cra. 7»
  t = t.replace(/((?:Av\. )?(?:Calle|Cra\.|Carrera|Diagonal|Transversal) \d+[A-Za-z]?(?: (?:Bis|BIS|Sur|SUR))?)\s+((?:Av\. )?(?:Calle|Cra\.|Carrera|Diagonal|Transversal) \d)/g, "$1 con $2");
  if (allCaps) t = t.toLowerCase().replace(/(^|[\s.(/-])([a-záéíóúñ])/g, (_, a: string, c: string) => a + c.toUpperCase()).replace(/\b(De|Del|La|Las|Los|El|Y|Con|En)\b/g, (w) => w.toLowerCase()).replace(/^./, (c) => c.toUpperCase()).replace(/\bNqs\b/g, "NQS");
  return t;
}

/** Nombre oficial de la ruta tal como viene del GTFS (solo con los espacios arreglados), para mostrarlo siempre disponible. */
export const routeOfficialName = (r: Route): string => r.longName.replace(/\s+/g, " ").replace(/\s*\|\|\s*/g, " || ").trim();

/** Título legible de una ruta: «A ⇄ B» sin los códigos internos y con las direcciones escritas completas.
 *  El nombre oficial no se pierde: sigue en `routeOfficialName` y se muestra en el detalle de la ruta. */
export function routeTitle(r: Route): string {
  if (r.provisional) return `Ruta ${r.id}`;
  const parts = r.longName
    .split("||")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => prettyPlace(x.replace(/^[A-Z]{1,3}\d{1,3}[A-Z]?\s+/, "")));
  const uniq = parts.filter((x, i) => parts.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i);
  return uniq.length > 1 ? uniq.join(" ⇄ ") : uniq[0] ?? "";
}
