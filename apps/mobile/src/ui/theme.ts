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
/** Letra ancha de los títulos grandes («¿A dónde vamos hoy?», el nombre de una parada): le da carácter propio a la app. Es Archivo Expanded ExtraBold
 *  (licencia abierta OFL, en `assets/fonts/`), incluida en la app con el plugin `expo-font` de `app.json`; se nombra por su nombre interno. La web usa la misma. */
export const WIDE = "TMWide-ExtraBold";
export const type = {
  hero: { fontFamily: WIDE, fontSize: 34, lineHeight: 38, letterSpacing: -0.6 },
  largeTitle: { fontFamily: WIDE, fontSize: 27, lineHeight: 32, letterSpacing: -0.4 },
  /** Números grandes (cuenta regresiva): letra del sistema, que tiene cifras de ancho fijo. */
  number: { fontSize: 38, fontWeight: "800", letterSpacing: -1 },
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

/** Colores de lo que va encima del mapa (controles de vidrio): el mapa es claro u oscuro según la apariencia, y el texto se le opone. */
export function useOnMap(): { dark: boolean; ink: string; sub: string; accent: string } {
  const dark = useColorScheme() === "dark";
  return dark ? { dark, ink: "#f4f4f5", sub: "#b4b4bb", accent: "#ff6b78" } : { dark, ink: "#111114", sub: "#5c5c63", accent: "#d4162a" };
}
