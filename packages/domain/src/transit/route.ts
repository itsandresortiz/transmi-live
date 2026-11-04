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

/** Título legible de una ruta: «A ⇄ B» sin los códigos internos. */
export function routeTitle(r: Route): string {
  if (r.provisional) return `Ruta ${r.id}`;
  const parts = r.longName
    .split("||")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => x.replace(/^[A-Z]{1,3}\d{1,3}[A-Z]?\s+/, ""));
  return parts.length > 1 ? parts.join("  ⇄  ") : parts[0] ?? "";
}
