import { describe, expect, it } from "vitest";
import { TransitState, liveLevel } from "@transmi/application";
import type { VehicleReport } from "@transmi/domain";

const NOW = 1_000_000;
const buses = (n: number, at: number): VehicleReport[] => Array.from({ length: n }, (_, i) => ({ id: "b" + i, routeId: "R", tripId: "T", reportedAt: at, position: { lat: 4.65, lon: -74.1 + i * 0.001 } }));
const withBuses = (n: number, at: number) => { const st = new TransitState(); st.applyPositions(buses(n, at), at); return st; };

describe("qué se dice sobre los datos en vivo", () => {
  it("muchos buses con dato reciente: en vivo", () => expect(liveLevel(withBuses(80, NOW - 60), NOW * 1000)).toBe("live"));
  it("de madrugada reportan pocos buses pero el dato es reciente: sigue siendo en vivo, no «sin datos»", () => expect(liveLevel(withBuses(7, NOW - 60), NOW * 1000)).toBe("few"));
  it("muchos buses pero el último dato es viejo: con retraso", () => expect(liveLevel(withBuses(80, NOW - 400), NOW * 1000)).toBe("late"));
  it("pocos buses y además viejos: sin datos", () => expect(liveLevel(withBuses(7, NOW - 400), NOW * 1000)).toBe("none"));
  it("sin ningún bus: sin datos", () => expect(liveLevel(new TransitState(), NOW * 1000)).toBe("none"));
});
