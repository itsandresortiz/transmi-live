import { describe, expect, it } from "vitest";
import { PASSING_LANE_M, separateBuses, shiftBus } from "../src";

const M = 1 / 110_540;
describe("buses que no se montan uno encima del otro", () => {
  it("el que viene alcanzando se cambia de carril y lo adelanta (troncal por la derecha, calle por la izquierda)", () => {
    const trunk = separateBuses([{ id: "a", lon: -74.07, lat: 4.6 + 5 * M, angle: 0, trunk: true }, { id: "b", lon: -74.07, lat: 4.6, angle: 0, trunk: true }]);
    expect(trunk.has("a")).toBe(false);
    expect(trunk.get("b")).toEqual({ side: PASSING_LANE_M, back: 0 });
    const street = separateBuses([{ id: "a", lon: -74.07, lat: 4.6 + 5 * M, angle: 0 }, { id: "b", lon: -74.07, lat: 4.6, angle: 0 }]);
    expect(street.get("b")!.side).toBe(-PASSING_LANE_M);
    // hacia el norte, «a la derecha» es al este
    const p = shiftBus(-74.07, 4.6, 0, PASSING_LANE_M, 0);
    expect(p.lon).toBeGreaterThan(-74.07);
  });
  it("si el carril de al lado está ocupado, adelanta por el otro lado; nunca se le deja atrás", () => {
    const kx = 111_320 * Math.cos((4.6 * Math.PI) / 180), side = PASSING_LANE_M / kx;
    const r = separateBuses([
      { id: "a", lon: -74.07, lat: 4.6 + 5 * M, angle: 0 }, { id: "b", lon: -74.07, lat: 4.6, angle: 0 },
      { id: "c", lon: -74.07 - side, lat: 4.6, angle: 0 },
    ]);
    expect(r.get("b")).toEqual({ side: PASSING_LANE_M, back: 0 });
    for (const v of r.values()) expect(v.back).toBe(0);
  });
  it("en sentidos contrarios o en carriles distintos no se tocan", () => {
    expect(separateBuses([{ id: "a", lon: -74.07, lat: 4.6, angle: 0 }, { id: "b", lon: -74.07, lat: 4.6 + 3 * M, angle: 180 }]).size).toBe(0);
    const side = 4 / (111_320 * Math.cos((4.6 * Math.PI) / 180));
    expect(separateBuses([{ id: "a", lon: -74.07, lat: 4.6, angle: 0 }, { id: "b", lon: -74.07 + side, lat: 4.6, angle: 0 }]).size).toBe(0);
  });
});
