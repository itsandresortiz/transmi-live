import { describe, expect, it } from "vitest";
import { TransitState } from "@transmi/application";
import type { VehicleReport } from "@transmi/domain";

const rep = (id: string, t: number): VehicleReport => ({ id, routeId: "100", reportedAt: t, position: { lat: 4.65, lon: -74.07 } });

describe("buses sin reportar (feed congelado)", () => {
  it("no incorpora reportes viejos y los saca aunque no lleguen lotes nuevos", () => {
    const s = new TransitState();
    const now = 100_000 * 1000;
    s.applyPositions([rep("fresco", 100_000 - 30), rep("viejo", 100_000 - 3 * 3600)], now);
    expect(s.fleet.size).toBe(1);
    s.dropStale(now + 20 * 60_000);       // pasan 20 min sin lotes nuevos
    expect(s.fleet.size).toBe(0);
  });
});
