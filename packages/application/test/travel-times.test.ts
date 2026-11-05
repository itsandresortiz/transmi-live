import { describe, expect, it } from "vitest";
import { DEFAULT_SECONDS_PER_STOP, TransitState, TravelTimes, daypartOf, estimateTravelSeconds } from "@transmi/application";
import { TransitNetwork, type VehicleReport } from "@transmi/domain";

const stops = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"];
function world(): TransitState {
  const st = new TransitState();
  const net = new TransitNetwork();
  net.routes.set("R", { id: "R", shortName: "R1", longName: "Ruta", system: "zonal" });
  stops.forEach((id, i) => net.stops.set(id, { id, code: id, name: id, position: { lat: 4.6 + i * 0.001, lon: -74.07 } }));
  net.shapes.set("R", [{ routeId: "R", direction: "0", headsign: "x", points: [], stopIds: stops }]);
  st.setNetwork(net);
  return st;
}
const report = (t: number, next: string): VehicleReport => ({ id: "bus1", routeId: "R", tripId: "T", lastStopId: next, reportedAt: t, position: { lat: 4.6, lon: -74.07 } });

describe("tiempos aprendidos", () => {
  it("aprende cuánto tarda una ruta por parada y lo usa", () => {
    const st = world();
    const t0 = Date.UTC(2026, 10, 4, 18, 0) / 1000;   // 13:00 en Bogotá: franja «valle»
    expect(daypartOf(t0 * 1000)).toBe("valle");
    // el bus tarda 90 s entre paradas (más que los 50 s típicos de un zonal)
    stops.forEach((s, i) => st.applyPositions([report(t0 + i * 90, s)], (t0 + i * 90) * 1000));
    expect(st.travelTimes.secondsPerStop("R", "zonal", t0 * 1000)).toBeGreaterThan(80);   // 10 tramos medidos: ya se usa lo aprendido
    expect(world().travelTimes.secondsPerStop("R", "zonal", t0 * 1000)).toBe(DEFAULT_SECONDS_PER_STOP.zonal);   // sin datos: el típico
    const learned = new TravelTimes();
    // varios buses recorriendo la ruta
    const s3 = world();
    for (let b = 0; b < 3; b++) for (let i = 0; i < stops.length; i++) {
      const t = t0 + i * 90;
      s3.applyPositions([{ ...report(t, stops[i]!), id: `bus${b}` }], t * 1000);
    }
    expect(s3.travelTimes.secondsPerStop("R", "zonal", t0 * 1000)).toBeGreaterThan(80);
    expect(s3.travelTimes.secondsPerStop("R", "zonal", t0 * 1000)).toBeLessThan(100);
    // y se usa en los cálculos de llegada
    const v = s3.fleet.get("bus0")!;
    const est = estimateTravelSeconds(s3, v, stops, 0, 3, t0 * 1000);
    expect(est).toBeGreaterThan(3 * 80);
    // se guarda y se recupera
    learned.load(JSON.parse(JSON.stringify(s3.travelTimes.toJSON())));
    expect(learned.secondsPerStop("R", "zonal", t0 * 1000)).toBe(s3.travelTimes.secondsPerStop("R", "zonal", t0 * 1000));
  });
  it("ignora saltos que no son paradas consecutivas o tardan demasiado", () => {
    const st = world();
    const t0 = 1_700_000_000;
    [["a", 0], ["b", 60], ["e", 120], ["f", 1000]].forEach(([s, dt]) => st.applyPositions([report(t0 + (dt as number), s as string)], (t0 + (dt as number)) * 1000));
    expect(st.travelTimes.samples).toBe(0);
  });
});
