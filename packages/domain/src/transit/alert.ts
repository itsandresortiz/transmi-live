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

/** «Novedad en la operacion en linea HF615\416A11_Br. X\064A09_Br. Y» → «Línea HF615: Br. X → Br. Y». */
export function describeAlert(a: ServiceAlert): string {
  const d = a.description;
  if (!d) return a.headline;
  const parts = d.split("\\");
  if (parts.length < 2) return d.replace(/^Novedad en la operacion en linea\s*/i, "");
  const line = parts[0]!.replace(/^.*\s/, "");
  const rest = parts.slice(1).map((x) => x.replace(/^\w+?_/, ""));
  return `Línea ${line}: ${rest.join(" → ")}`;
}

/** Los avisos más graves primero. */
export function alertSeverity(e: AlertEffect): number {
  return { noService: 0, reduced: 1, delays: 2, detour: 3, modified: 4, stopMoved: 5, additional: 6, other: 7 }[e];
}
