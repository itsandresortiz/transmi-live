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

/** Aplica las correcciones a los recorridos leídos del GTFS (no toca nada si la parada ya está o no existe). */
export function applyStopPatches(dto: NetworkDto, patches: readonly StopPatch[] = STOP_PATCHES): void {
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
