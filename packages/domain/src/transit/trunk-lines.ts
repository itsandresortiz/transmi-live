/** Líneas de la troncal de TransMilenio: la letra del nombre de una ruta troncal (B10, H17, K23…) es su línea. Colores del plano oficial. */
export interface TrunkLine { name: string; light: string; dark: string }

export const TRUNK_LINES: Record<string, TrunkLine> = {
  A: { name: "Caracas Centro", light: "#23398f", dark: "#6c86ff" },
  B: { name: "Norte", light: "#6fae1c", dark: "#8fd33a" },
  C: { name: "Suba", light: "#f2b300", dark: "#ffc933" },
  D: { name: "Calle 80", light: "#7b4fb4", dark: "#a98ae6" },
  E: { name: "NQS Central", light: "#9c6420", dark: "#d18f45" },
  F: { name: "Américas", light: "#e0191d", dark: "#ff5a5e" },
  G: { name: "NQS Sur", light: "#1b83dc", dark: "#4aa8ff" },
  H: { name: "Caracas Sur", light: "#f47f1f", dark: "#ffa04d" },
  J: { name: "Eje Ambiental", light: "#e08aa4", dark: "#f2a6bd" },
  K: { name: "Calle 26", light: "#bb9c6c", dark: "#d8bd8e" },
  L: { name: "Carrera 10", light: "#00978f", dark: "#2fd0c6" },
  M: { name: "Carrera 7", light: "#2fb7a6", dark: "#62dccd" },
  P: { name: "Avenida 68", light: "#a01f8a", dark: "#d065bb" },
  S: { name: "Soacha", light: "#3fa5ee", dark: "#7cc4ff" },
  Z: { name: "Av. Ciudad de Cali", light: "#b5121b", dark: "#f0676f" },
};

/** Línea de una ruta troncal o dual por su nombre («B10» → «B», «M86-K86» → «M»), o `null` si no la tiene. */
export function trunkLetterOf(shortName: string): string | null {
  const m = /^([A-Z])\d{2}(?:-[A-Z]\d{2})?$/.exec(shortName.trim().toUpperCase());
  return m && TRUNK_LINES[m[1]!] ? m[1]! : null;
}
