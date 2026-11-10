import { describe, expect, it } from "vitest";
import { TransitState } from "@transmi/application";
import { TransitNetwork, type VehicleReport } from "@transmi/domain";

const M = 111_320 * Math.cos((4.65 * Math.PI) / 180);
const lonAt = (m: number) => -74.1 + m / M;
const ids = ["S0", "S1", "S2", "S3", "S4"];
function world(): TransitState {
  const st = new TransitState(), net = new TransitNetwork();
  net.routes.set("R", { id: "R", shortName: "R1", longName: "Ruta", system: "troncal" });
  ids.forEach((id, i) => net.stops.set(id, { id, code: id, name: id, position: { lat: 4.65, lon: lonAt(i * 1000) } }));
  net.shapes.set("R", [{ routeId: "R", direction: "0", headsign: "x", points: Array.from({ length: 41 }, (_, i) => ({ lat: 4.65, lon: lonAt(i * 100) })), stopIds: ids }]);
  st.setNetwork(net);
  return st;
}
const rep = (lastStopId: string | undefined, meters: number): VehicleReport => ({ id: "b", routeId: "R", tripId: "T", lastStopId, reportedAt: 1000, position: { lat: 4.65, lon: lonAt(meters) } });

describe("última parada informada que no concuerda con dónde va el bus", () => {
  it("si el bus va a 3 km de su «última parada», se usa la que de verdad pasó", () => {
    const st = world();
    st.applyPositions([rep("S0", 3300)], 1_000_000);      // dice S0, pero va pasando S3
    expect(st.fleet.get("b")!.lastStopId).toBe("S3");
    expect(st.nextStopOf(st.fleet.get("b")!, 1_000_000)?.stopId).toBe("S4");
  });
  it("si concuerda, se deja la informada", () => {
    const st = world();
    st.applyPositions([rep("S1", 1300)], 1_000_000);
    expect(st.fleet.get("b")!.lastStopId).toBe("S1");
  });
  it("sin parada informada no se inventa una", () => {
    const st = world();
    st.applyPositions([rep(undefined, 1300)], 1_000_000);
    expect(st.fleet.get("b")!.lastStopId).toBeUndefined();
  });
  it("también corrige cuando la red llega después de los buses", () => {
    const st = new TransitState();
    st.applyPositions([rep("S0", 3300)], 1_000_000);
    const w = world(); st.setNetwork(w.network);
    expect(st.fleet.get("b")!.lastStopId).toBe("S3");
  });
});
