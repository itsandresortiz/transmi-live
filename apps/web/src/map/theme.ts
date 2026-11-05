import type { SystemType } from "@transmi/domain";

export type Scheme = "light" | "dark";

export interface MapTheme {
  mapbg: string; land: string; landLine: string; road: string; roadMajor: string;
  /** Calles al estilo de los mapas modernos: relleno por jerarquía y borde. */
  roads: { minor: string; tertiary: string; secondary: string; primary: string; trunk: string; casing: string; casingMajor: string };
  label: string; labelStrong: string; halo: string; troncal: string; surface: string;
  /** Estaciones de la troncal: base, borde, vagón y borde del vagón. */
  stationBase: string; stationEdge: string; stationLink: string; capsule: string; capsuleEdge: string;
  system: Record<SystemType, string>;
  delay: { ok: string; warn: string; bad: string; early: string; none: string };
}

export const LIGHT: MapTheme = {
  mapbg: "#eef0f3", land: "#f7f8fa", landLine: "#c9ced6", road: "#dfe2e7", roadMajor: "#bcc3ce",
  roads: { minor: "#e4e8ef", tertiary: "#dbe0e9", secondary: "#d2d9e4", primary: "#c8d0dd", trunk: "#bec7d6", casing: "#b4bece", casingMajor: "#a3aebf" },
  label: "#6c6c70", labelStrong: "#1c1c1e", halo: "#eef0f3", troncal: "#e11d2e", surface: "#ffffff",
  stationBase: "#dde2ea", stationEdge: "#a9b2c1", stationLink: "#c4ccd9", capsule: "#ffffff", capsuleEdge: "#6f7a8d",
  system: { troncal: "#e11d2e", dual: "#8a45d6", alimentador: "#12945f", zonal: "#1f6fd1", otro: "#8e8e93" },
  delay: { ok: "#12945f", warn: "#d97706", bad: "#e11d2e", early: "#1f6fd1", none: "#8e8e93" },
};
export const DARK: MapTheme = {
  mapbg: "#090c12", land: "#0e141d", landLine: "#2a3850", road: "#1a2231", roadMajor: "#2f405b",
  roads: { minor: "#1a2331", tertiary: "#212c3e", secondary: "#283550", primary: "#2f3e5b", trunk: "#364765", casing: "#3a4a68", casingMajor: "#4a5c80" },
  label: "#a1a1a8", labelStrong: "#f5f5f7", halo: "#090c12", troncal: "#ff5a66", surface: "#1c1c1e",
  stationBase: "#242c3b", stationEdge: "#4a566e", stationLink: "#3d4a66", capsule: "#36425c", capsuleEdge: "#a3afc8",
  system: { troncal: "#ff5a66", dual: "#b88af2", alimentador: "#34d197", zonal: "#5aa2ff", otro: "#9a9aa5" },
  delay: { ok: "#34d197", warn: "#fbbf24", bad: "#ff5a66", early: "#5aa2ff", none: "#9a9aa5" },
};

export const themeOf = (s: Scheme): MapTheme => (s === "dark" ? DARK : LIGHT);
export const currentScheme = (): Scheme =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
