import { describe, expect, it } from "vitest";
import { TransitState, arrivalAtIndex } from "@transmi/application";
import { TransitNetwork, type VehicleReport } from "@transmi/domain";

const M_PER_DEG = 111_320 * Math.cos((4.65 * Math.PI) / 180);
const lonAt = (m: number) => -74.1 + m / M_PER_DEG;
const ids = ["S0", "S1", "S2", "S3"];
function world(): { st: TransitState; shape: ReturnType<TransitNetwork["shapesOf"]>[number] } {
  const st = new TransitState(), net = new TransitNetwork();
  net.routes.set("R", { id: "R", shortName: "R1", longName: "Ruta", system: "troncal" });
  ids.forEach((id, i) => net.stops.set(id, { id, code: id, name: id, position: { lat: 4.65, lon: lonAt(i * 600) } }));
  net.shapes.set("R", [{ routeId: "R", direction: "0", headsign: "x", points: Array.from({ length: 31 }, (_, i) => ({ lat: 4.65, lon: lonAt(i * 60) })), stopIds: ids }]);
  st.setNetwork(net);
  return { st, shape: net.shapes.get("R")![0]! };
}
const rep = (id: string, meters: number): VehicleReport => ({ id, routeId: "R", tripId: id, lastStopId: "S0", reportedAt: 1000, position: { lat: 4.65, lon: lonAt(meters) } });

describe("hora de llegada con la posición del bus", () => {
  it("un bus que ya recorrió casi todo el tramo llega antes que uno recién salido de la parada", () => {
    const { st, shape } = world();
    st.applyPositions([rep("recien", 40), rep("casi", 540)], 1_000_000);       // misma última parada (S0), distinta posición
    const a = arrivalAtIndex(st, st.fleet.get("recien")!, shape, 0, 1, 995_000);
    const b = arrivalAtIndex(st, st.fleet.get("casi")!, shape, 0, 1, 995_000);
    expect(b).toBeLessThan(a - 20);
    expect(a - 1000).toBeGreaterThan(40);       // al recién salido le falta casi todo el tramo
    expect(b - 1000).toBeLessThan(25);          // al otro, unos segundos
  });
  it("cuenta los tramos que faltan después del siguiente", () => {
    const { st, shape } = world();
    st.applyPositions([rep("b", 300)], 1_000_000);
    const v = st.fleet.get("b")!;
    const t1 = arrivalAtIndex(st, v, shape, 0, 1, 995_000), t3 = arrivalAtIndex(st, v, shape, 0, 3, 995_000);
    expect(t3 - t1).toBeGreaterThan(100);       // dos tramos más (≈ 2 × 70 s)
  });
  it("si el bus está lejos de su trazado usa la hora a la que llegó a su última parada", () => {
    const { st, shape } = world();
    st.applyPositions([{ ...rep("lejos", 300), position: { lat: 4.6536, lon: lonAt(300) } }], 1_000_000);   // 400 m al norte de la calle
    const t = arrivalAtIndex(st, st.fleet.get("lejos")!, shape, 0, 1, 995_000);
    expect(t - 1000).toBeGreaterThan(60);      // tramo entero (no se puede saber cuánto avanzó)
  });
});
