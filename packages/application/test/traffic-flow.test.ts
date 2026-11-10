import { describe, expect, it } from "vitest";
import { flowDash, flowDashAt } from "@transmi/application";

describe("rayitas del tráfico", () => {
  it("el patrón siempre suma un ciclo completo (raya 1,5 + hueco 4,5) y no tiene valores negativos", () => {
    for (let ph = -3; ph < 14; ph += 0.37) { const d = flowDash(ph); expect(d.every((x) => x >= 0)).toBe(true); expect(d.reduce((a, b) => a + b, 0)).toBeCloseTo(6, 1); }
  });
  it("donde fluye, las rayas avanzan más rápido que en el trancón", () => {
    const moved = (band: number) => JSON.stringify(flowDashAt(band, 0)) !== JSON.stringify(flowDashAt(band, 120));
    expect(moved(3)).toBe(true);
    expect(flowDashAt(0, 0)).not.toEqual(flowDashAt(0, 4000));
  });
});
