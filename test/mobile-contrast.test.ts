import { describe, expect, it } from "vitest";
import { DARK, HIGH_DARK, HIGH_LIGHT, LIGHT, type Palette } from "../apps/mobile/src/ui/palette";

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const lum = ([r, g, b]: [number, number, number]) => { const f = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a: string, b: string) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/** WCAG 2.2: 4,5 para texto; 7 en la paleta de alto contraste (AAA). */
const rules: [keyof Palette, keyof Palette][] = [
  ["text", "bg"], ["text", "card"], ["muted", "bg"], ["muted", "card"], ["muted", "cardAlt"],
  ["accent", "bg"], ["accent", "card"], ["onAccent", "accent"], ["onInk", "ink"],
];
describe("contraste de la app nativa", () => {
  for (const [name, p, min] of [["claro", LIGHT, 4.5], ["oscuro", DARK, 4.5], ["alto contraste claro", HIGH_LIGHT, 4.5], ["alto contraste oscuro", HIGH_DARK, 4.5]] as const) {
    it(`la paleta ${name} cumple ${min}:1`, () => {
      const bad = rules.map(([fg, bg]) => ({ fg, bg, v: ratio(p[fg], p[bg]) })).filter((r) => r.v < min).map((r) => `${r.fg} sobre ${r.bg}: ${r.v.toFixed(2)}`);
      expect(bad).toEqual([]);
    });
  }
  it("el alto contraste llega a AAA (7:1) en el texto principal", () => {
    expect(ratio(HIGH_LIGHT.text, HIGH_LIGHT.bg)).toBeGreaterThanOrEqual(7);
    expect(ratio(HIGH_DARK.text, HIGH_DARK.bg)).toBeGreaterThanOrEqual(7);
    expect(ratio(HIGH_LIGHT.muted, HIGH_LIGHT.card)).toBeGreaterThanOrEqual(7);
    expect(ratio(HIGH_DARK.muted, HIGH_DARK.bg)).toBeGreaterThanOrEqual(7);
  });
});
