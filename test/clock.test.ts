import { describe, expect, it } from "vitest";
import { clockOffsetMs, updateClockOffset } from "../apps/web/src/clock";

describe("reloj de la app", () => {
  it("usa la diferencia con el servidor cuando es pequeña", () => {
    updateClockOffset(1500); updateClockOffset(1500); updateClockOffset(1500);
    expect(clockOffsetMs()).toBe(1500);
  });
  it("ignora una diferencia de horas (datos congelados) y conserva la última buena", () => {
    updateClockOffset(-4 * 3600_000);
    updateClockOffset(-5 * 3600_000);
    expect(clockOffsetMs()).toBe(1500);
  });
});
