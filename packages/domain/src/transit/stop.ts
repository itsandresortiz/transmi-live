import type { GeoPoint } from "../shared/geo";

export type StopId = string;
export interface Stop {
  readonly id: StopId;
  readonly code: string;
  readonly name: string;
  readonly position: GeoPoint;
}

/** Lo que dice el nombre de una parada de la troncal: la estación o portal y, si es el caso, el vagón o la plataforma. */
export interface StopLabel {
  /** Nombre limpio de la estación o portal, sin letras ni números técnicos. */
  title: string;
  /** Número del vagón (A = 1, B = 2, C = 3…) cuando es una estación de la troncal. */
  wagon?: number;
  /** Plataforma de un portal («T1», «T4D»…). */
  platform?: string;
}

const WAGON_RE = /^(.*?)\s+([A-F])\s*-\s*\d(?:\s*ó\s*\d)?(?:-[a-z]+)?\.?\s*$/i;
const PLATFORM_RE = /^(.*?)\s+T-?\s?(\d+[A-Z]?)(?:\s+([A-Z]))?\.?\s*$/i;
const tidy = (s: string) => s.replace(/\s+/g, " ").trim();

/** Interpreta el nombre de una parada del GTFS de TransMilenio. En las estaciones la **letra** es el vagón
 *  (A = vagón 1, B = vagón 2…): se comprobó con rutas conocidas; los números («2 ó 5», «4») cambian entre sentidos y no son el vagón.
 *  `trunk` evita confundir con paradas zonales cuyo nombre se parezca. */
export function parseStopName(name: string, trunk = true): StopLabel {
  const n = tidy(name);
  const p = trunk ? PLATFORM_RE.exec(n) : null;
  if (p && p[1]) return { title: tidy(p[1]), platform: `T${p[2]!.toUpperCase()}${(p[3] ?? "").toUpperCase()}` };
  const w = trunk ? WAGON_RE.exec(n) : null;
  if (w) return { title: tidy(w[1]!), wagon: w[2]!.toUpperCase().charCodeAt(0) - 64 };
  return { title: n };
}

/** «Toberín · vagón 2», «Portal Norte · T1» o solo el nombre. */
export function stopLabelText(l: StopLabel): string {
  return l.wagon ? `${l.title} · vagón ${l.wagon}` : l.platform ? `${l.title} · ${l.platform}` : l.title;
}
