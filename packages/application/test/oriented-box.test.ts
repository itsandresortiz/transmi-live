import { expect, it } from "vitest";
import { orientedBox } from "../src/map-volumes";
it("caja de una forma ancha y de una alargada", () => {
  const kx = 111_320 * Math.cos((4.6 * Math.PI) / 180), ky = 110_540, R = (x: number, y: number) => [-74.07 + x / kx, 4.6 + y / ky];
  for (const [L, W] of [[100, 45], [30, 4.8], [20, 19]]) {
    const b = orientedBox({ type: "Polygon", coordinates: [[R(0, 0), R(L, 0), R(L, W), R(0, W), R(0, 0)]] })!;
    expect(b.len).toBeCloseTo(Math.max(L, W), 1); expect(b.w).toBeCloseTo(Math.min(L, W), 1);
    expect(Math.abs(L >= W ? b.fe : b.fn)).toBeCloseTo(1, 3);
    expect((b.lon - -74.07) * kx).toBeCloseTo(L / 2, 1); expect((b.lat - 4.6) * ky).toBeCloseTo(W / 2, 1);
  }
});
