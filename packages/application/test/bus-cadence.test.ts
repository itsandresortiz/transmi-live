import { describe, expect, it } from "vitest";
import { cadenceMs } from "@transmi/application";

describe("cadencia del movimiento de los buses en el mapa de la app", () => {
  it("de cerca y con pocos buses se mueven fluidos (≈15 veces por segundo)", () => expect(cadenceMs(16, 20)).toBeLessThanOrEqual(70));
  it("con muchos buses o de lejos se espacia para no gastar batería", () => {
    expect(cadenceMs(16, 500)).toBeGreaterThanOrEqual(250);
    expect(cadenceMs(11, 20)).toBeGreaterThanOrEqual(700);
    expect(cadenceMs(13.6, 100)).toBeLessThan(cadenceMs(13.6, 400));
  });
});
