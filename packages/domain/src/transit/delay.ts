/** Puntualidad de un bus respecto a su horario. */
export type DelayKind = "unknown" | "onTime" | "late" | "early";

export interface Delay {
  readonly kind: DelayKind;
  /** Minutos redondeados (siempre positivo). */
  readonly minutes: number;
  /** Gravedad para colorear: más de 10 min de retraso es «grave». */
  readonly severe: boolean;
  readonly seconds: number | null;
}

const MAX_CREDIBLE_SECONDS = 7200;

/** Un retraso de más de 2 horas es un dato viejo del feed y se trata como desconocido. */
export function delayFromSeconds(seconds: number | null | undefined): Delay {
  if (seconds == null || !Number.isFinite(seconds) || Math.abs(seconds) > MAX_CREDIBLE_SECONDS) {
    return { kind: "unknown", minutes: 0, severe: false, seconds: null };
  }
  const minutes = Math.round(Math.abs(seconds) / 60);
  if (minutes < 2) return { kind: "onTime", minutes: 0, severe: false, seconds };
  return seconds > 0
    ? { kind: "late", minutes, severe: seconds > 600, seconds }
    : { kind: "early", minutes, severe: false, seconds };
}

export function delayLabel(d: Delay): string {
  switch (d.kind) {
    case "unknown": return "Sin dato";
    case "onTime": return "A tiempo";
    case "late": return `${d.minutes} min tarde`;
    case "early": return `${d.minutes} min antes`;
  }
}
