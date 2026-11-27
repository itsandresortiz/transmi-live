import { describe, expect, it } from "vitest";
import { separateBuses } from "../src";

const M = 1 / 110_540;
describe("buses que no se montan uno encima del otro", () => {
  it("dos buses en fila que se pisan: el de atrás queda justo detrás", () => {
    // los dos hacia el norte, el de atrás a 5 m (deberían estar a ≥ 13 m entre centros)
    const r = separateBuses([{ id: "a", lon: -74.07, lat: 4.6 + 5 * M, angle: 0 }, { id: "b", lon: -74.07, lat: 4.6, angle: 0 }]);
    expect(r.has("a")).toBe(false);
    const gap = (4.6 + 5 * M - r.get("b")!.lat) / M;
    expect(gap).toBeGreaterThanOrEqual(12.9);
  });
  it("en sentidos contrarios o en carriles distintos no se tocan", () => {
    expect(separateBuses([{ id: "a", lon: -74.07, lat: 4.6, angle: 0 }, { id: "b", lon: -74.07, lat: 4.6 + 3 * M, angle: 180 }]).size).toBe(0);
    const side = 4 / (111_320 * Math.cos((4.6 * Math.PI) / 180));
    expect(separateBuses([{ id: "a", lon: -74.07, lat: 4.6, angle: 0 }, { id: "b", lon: -74.07 + side, lat: 4.6, angle: 0 }]).size).toBe(0);
  });
  it("un articulado necesita más espacio", () => {
    const r = separateBuses([{ id: "a", lon: -74.07, lat: 4.6 + 14 * M, angle: 0, long: true }, { id: "b", lon: -74.07, lat: 4.6, angle: 0, long: true }]);
    expect((4.6 + 14 * M - r.get("b")!.lat) / M).toBeGreaterThanOrEqual(19.2);
  });
});
