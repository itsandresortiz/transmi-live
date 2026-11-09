/** Los colores de la app, sin nada de React Native, para poder medir su contraste con una prueba automática. */
export interface Palette {
  bg: string; card: string; cardAlt: string; text: string; muted: string; line: string; accent: string; onAccent: string; ink: string; onInk: string; shadow: string;
}

export const LIGHT: Palette = { bg: "#f4f4f6", card: "#ffffff", cardAlt: "#ececf0", text: "#0b0b0d", muted: "#5c5c63", line: "#e4e4e9", accent: "#d4162a", onAccent: "#ffffff", ink: "#0b0b0d", onInk: "#ffffff", shadow: "#1b1b2a" };
export const DARK: Palette = { bg: "#000000", card: "#1c1c1e", cardAlt: "#2c2c2e", text: "#ffffff", muted: "#a1a1a8", line: "#2c2c2e", accent: "#ff4d5e", onAccent: "#000000", ink: "#ffffff", onInk: "#0b0b0d", shadow: "transparent" };
/** «Más contraste» del teléfono: negro y blanco puros, sin grises apagados. */
export const HIGH_LIGHT: Palette = { ...LIGHT, bg: "#ffffff", cardAlt: "#e8e8ec", text: "#000000", muted: "#2b2b30", line: "#6b6b72", accent: "#b00f20" };
export const HIGH_DARK: Palette = { ...DARK, text: "#ffffff", muted: "#e4e4e8", line: "#9a9aa2", accent: "#ff7380", cardAlt: "#262628" };
