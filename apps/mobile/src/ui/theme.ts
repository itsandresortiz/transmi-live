import { useColorScheme } from "react-native";
import type { SystemType } from "@transmi/domain";

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

export function useColors() {
  const dark = useColorScheme() === "dark";
  return {
    dark,
    bg: dark ? "#000000" : "#f4f4f6",
    card: dark ? "#1c1c1e" : "#ffffff",
    cardAlt: dark ? "#2c2c2e" : "#ececf0",
    text: dark ? "#ffffff" : "#0b0b0d",
    muted: dark ? "#9a9aa2" : "#6c6c72",
    line: dark ? "#2c2c2e" : "#e4e4e9",
    accent: "#e11d2e",
    onAccent: "#ffffff",
    ink: dark ? "#ffffff" : "#0b0b0d",       // botón oscuro en claro, claro en oscuro (como la referencia)
    onInk: dark ? "#0b0b0d" : "#ffffff",
    shadow: dark ? "transparent" : "#1b1b2a",
  };
}
