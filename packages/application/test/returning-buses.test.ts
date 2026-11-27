import { describe, expect, it } from "vitest";
import { TransitState, TURNAROUND_S, upcomingAtStop } from "@transmi/application";
import { TransitNetwork, type VehicleReport } from "@transmi/domain";

/** Una troncal de ida (H72: A0→A4, hacia el oriente) y su regreso con otra letra (B72: B0→B4, hacia el occidente) por la calle de al lado.
 *  B4 queda en la misma cabecera que A0. Un bus que termina la B72 sale de nuevo como H72 (así lo hacen en la calle). */
const M = 111_320 * Math.cos((4.65 * Math.PI) / 180);
const lonAt = (m: number) => -74.1 + m / M;
const line = (lat: number, from: number, to: number) => Array.from({ length: 41 }, (_, i) => ({ lat, lon: lonAt(from + ((to - from) * i) / 40) }));
const NOW = 1000;
function world(extra?: (net: TransitNetwork) => void): TransitState {
  const st = new TransitState(), net = new TransitNetwork();
  net.routes.set("H", { id: "H", shortName: "H72", longName: "Ida", system: "troncal" });
  net.routes.set("B", { id: "B", shortName: "B72", longName: "Regreso", system: "troncal" });
  const A = [0, 1, 2, 3, 4].map((i) => `A${i}`), B = [0, 1, 2, 3, 4].map((i) => `B${i}`);
  A.forEach((id, i) => net.stops.set(id, { id, code: id, name: id, position: { lat: 4.65, lon: lonAt(i * 1000) } }));
  B.forEach((id, i) => net.stops.set(id, { id, code: id, name: id, position: { lat: 4.6502, lon: lonAt(4000 - i * 1000) } }));
  net.shapes.set("H", [{ routeId: "H", direction: "0", headsign: "Oriente", points: line(4.65, 0, 4000), stopIds: A }]);
  net.shapes.set("B", [{ routeId: "B", direction: "0", headsign: "Occidente", points: line(4.6502, 4000, 0), stopIds: B }]);
  extra?.(net);
  st.setNetwork(net);
  return st;
}
const bus = (id: string, routeId: string, lastStopId: string, lat: number, meters: number): VehicleReport => ({ id, routeId, tripId: "T", lastStopId, reportedAt: NOW, position: { lat, lon: lonAt(meters) } });

describe("buses que vienen del otro sentido (dan la vuelta en la cabecera)", () => {
  it("en la primera parada de la H72 aparece el bus que va terminando la B72, después de su vuelta", () => {
    const st = world();
    st.applyPositions([bus("b1", "B", "B2", 4.6502, 1900)], NOW * 1000);
    const up = upcomingAtStop(st, "A0", NOW);
    expect(up).toHaveLength(1);
    const b = up[0]!.buses[0]!;
    expect(b.vehicle.id).toBe("b1");
    expect(b.turnsAt).toBe("B4");
    expect(b.stopsAway).toBe(2);
    expect(b.etaAt).toBeGreaterThan(NOW + TURNAROUND_S);
  });
  it("en la segunda parada suma el primer tramo de la H72", () => {
    const st = world();
    st.applyPositions([bus("b1", "B", "B2", 4.6502, 1900)], NOW * 1000);
    const a0 = upcomingAtStop(st, "A0", NOW)[0]!.buses[0]!.etaAt, a1 = upcomingAtStop(st, "A1", NOW)[0]!.buses[0]!;
    expect(a1.etaAt).toBeGreaterThan(a0);
    expect(a1.stopsAway).toBe(3);
  });
  it("si ya vienen buses de la misma ruta, esos van primero y el del otro sentido completa la lista", () => {
    const st = world();
    st.applyPositions([bus("h1", "H", "A1", 4.65, 1100), bus("b1", "B", "B1", 4.6502, 2900)], NOW * 1000);
    const ids = upcomingAtStop(st, "A3", NOW)[0]!.buses.map((b) => b.vehicle.id);
    expect(ids).toEqual(["h1", "b1"]);
  });
  it("una ruta de otro número que termina en la misma cabecera no cuenta", () => {
    const st = world((net) => {
      net.routes.set("X", { id: "X", shortName: "B99", longName: "Otra", system: "troncal" });
      net.shapes.set("X", [{ routeId: "X", direction: "0", headsign: "x", points: line(4.6502, 4000, 0), stopIds: ["B0", "B1", "B2", "B3", "B4"] }]);
    });
    st.applyPositions([bus("x1", "X", "B2", 4.6502, 1900)], NOW * 1000);
    expect(upcomingAtStop(st, "A0", NOW)).toHaveLength(0);
  });
  it("un bus de regreso que ya llegó al final no se cuenta dos veces ni se inventa", () => {
    const st = world();
    st.applyPositions([bus("b1", "B", "B4", 4.6502, 0)], NOW * 1000);
    expect(upcomingAtStop(st, "A1", NOW)).toHaveLength(0);
  });
});
