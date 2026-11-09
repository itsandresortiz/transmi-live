import { useColorScheme } from "react-native";
import type { SystemType } from "@transmi/domain";
import { useAccessibility } from "@/accessibility";
import { DARK, HIGH_DARK, HIGH_LIGHT, LIGHT } from "./palette";

export const SYSTEM_COLOR: Record<SystemType, string> = {
  troncal: "#e11d2e", dual: "#8b5cf6", alimentador: "#16a34a", zonal: "#2563eb", otro: "#64748b",
};

/** Espacios, esquinas y letras: todo sale de aquí, nada de números sueltos en las pantallas. */
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40 } as const;
export const radius = { sm: 12, md: 16, lg: 22, xl: 30, pill: 999 } as const;
export const type = {
  hero: { fontSize: 38, fontWeight: "800", letterSpacing: -1 },
  largeTitle: { fontSize: 32, fontWeight: "800", letterSpacing: -0.6 },
  title: { fontSize: 22, fontWeight: "700", letterSpacing: -0.3 },
  headline: { fontSize: 17, fontWeight: "600" },
  body: { fontSize: 16, fontWeight: "400" },
  caption: { fontSize: 13, fontWeight: "500" },
  eyebrow: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6 },
} as const;

/** Colores del tema claro u oscuro, o la paleta de alto contraste si el teléfono tiene «Más contraste». */
export function useColors() {
  const dark = useColorScheme() === "dark";
  const { moreContrast } = useAccessibility();
  const p = dark ? (moreContrast ? HIGH_DARK : DARK) : moreContrast ? HIGH_LIGHT : LIGHT;
  return { dark, moreContrast, ...p };
}
