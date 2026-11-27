import { describe, expect, it } from "vitest";
import { TransitState, prepareNetworkInSlices, shapeStops } from "@transmi/application";
import { TransitNetwork, type VehicleReport } from "@transmi/domain";

const M = 111_320, lat = (m: number) => 4.65 + m / 110_540, lon = (m: number) => -74.1 + m / M;
function world(routes = 30): TransitState {
  const st = new TransitState(), net = new TransitNetwork();
  for (let r = 0; r < routes; r++) {
    const id = `R${r}`, y = r * 300;
    net.routes.set(id, { id, shortName: id, longName: id, system: "zonal" });
    const stopIds: string[] = [];
    for (let k = 0; k < 6; k++) { const sid = `${id}-${k}`; stopIds.push(sid); net.stops.set(sid, { id: sid, code: sid, name: sid, position: { lat: lat(y - 5), lon: lon(k * 400 + 50) } }); }
    net.shapes.set(id, [{ routeId: id, direction: "0", headsign: "", points: Array.from({ length: 30 }, (_, i) => ({ lat: lat(y), lon: lon(i * 100) })), stopIds }]);
  }
  st.setNetwork(net);
  return st;
}

describe("preparar la red de a poco", () => {
  it("calcula lo mismo que el cálculo de siempre, en varios trozos", () => {
    const st = world(), queue: (() => void)[] = [];
    let t = 0;
    prepareNetworkInSlices(st, (f) => queue.push(f), 3, () => (t += 1));      // reloj falso: cada consulta avanza 1 ms
    let slices = 0;
    while (queue.length) { queue.shift()!(); slices++; }
    expect(slices).toBeGreaterThan(3);
    const fresh = world();
    for (const [rid, shapes] of st.network.shapes) expect(shapeStops(st, shapes[0]!)!.s).toEqual(shapeStops(fresh, fresh.network.shapes.get(rid)![0]!)!.s);
  });

  it("deja de trabajar si llega otra red o si se detiene", () => {
    const st = world(), queue: (() => void)[] = [];
    let calls = 0;
    const stop = prepareNetworkInSlices(st, (f) => queue.push(f), 1, () => (calls++, 0));
    queue.shift()!();
    stop();
    queue.splice(0).forEach((f) => f());
    expect(queue.length).toBe(0);
    const st2 = world(), q2: (() => void)[] = [];
    prepareNetworkInSlices(st2, (f) => q2.push(f), 1, () => 0);
    st2.setNetwork(new TransitNetwork());
    q2.splice(0).forEach((f) => f());
    expect(q2.length).toBe(0);
  });
});

describe("buses por ruta", () => {
  it("se vuelven a contar cuando cambia la flota", () => {
    const st = world(2);
    const rep = (id: string, routeId: string, at: number): VehicleReport => ({ id, routeId, reportedAt: at, position: { lat: lat(0), lon: lon(100) } });
    st.applyPositions([rep("a", "R0", 1000), rep("b", "R0", 1000), rep("c", "R1", 1000)], 1000_000);
    expect(st.busesOnRoute("R0")).toBe(2);
    st.applyPositions([rep("a", "R1", 1030), rep("b", "R0", 1030), rep("c", "R1", 1030)], 1030_000);
    expect(st.busesOnRoute("R0")).toBe(1);
    expect(st.busesOnRoute("R1")).toBe(2);
  });
});
