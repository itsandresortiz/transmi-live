import { describe, expect, it } from "vitest";
import { footprintModel, footprintOf, signalFootprints, signalNow } from "../src";

const flat = new Array(24).fill(100);
describe("huella de un semáforo no medido", () => {
  it("las detenciones amontonadas en un tramo de la vuelta dan el rojo y una huella fuerte", () => {
    // 120 s: rojo entre 60 y 95 s (casillas 12–18)
    const h = Array.from({ length: 24 }, (_, i) => (i >= 12 && i < 19 ? 12 : 1));
    const fp = footprintOf(h, flat, 120)!;
    expect(fp[0]).toBe(120);
    expect(fp[1]).toBe(60);
    expect(fp[2]).toBeGreaterThanOrEqual(30);
    expect(fp[2]).toBeLessThanOrEqual(40);
    expect(fp[3]).toBeGreaterThan(6);
    const m = footprintModel(fp);
    expect(signalNow(m, 1_800_000_070_000).c).toBe("r");      // 1.800.000.070 s: 70 s dentro de la vuelta
    expect(signalNow(m, 1_800_000_020_000).c).toBe("g");
  });
  it("detenciones parejas (sin semáforo de tiempo fijo): no hay huella", () => {
    const h = Array.from({ length: 24 }, (_, i) => 5 + (i % 2));
    expect(signalFootprints({ "-74.1,4.7|wk|2|N": { still: 120, p120: h, p90: new Array(18).fill(7) } }, 6)).toEqual({});
  });
  it("pocas detenciones: no se concluye", () => {
    expect(footprintOf([0, 0, 9, 9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], flat, 120)).toBeNull();
  });
});
