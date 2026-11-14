import { describe, expect, it } from "vitest";
import { TransitNetwork, type VehicleReport } from "@transmi/domain";
import { TransitState, checkOnShape, checkRide, guessMyBus, rideArrival } from "../src";

// Una ruta recta hacia el norte por la Av. Suba: paradas cada ~1 km
const LAT0 = 4.70, LON = -74.08, M = 1 / 111_000;
const at = (meters: number, side = 0) => ({ lat: LAT0 + meters * M, lon: LON + side * M });
function world() {
  const net = new TransitNetwork();
  net.routes.set("7", { id: "7", shortName: "7", longName: "Polo", system: "troncal" });
  const stops = ["A", "B", "C", "D", "E"];
  stops.forEach((id, i) => net.stops.set(id, { id, code: id, name: id, position: at(i * 1000) }));
  net.shapes.set("7", [{ routeId: "7", direction: "0", headsign: "Polo", points: [at(0), at(1000), at(2000), at(3000), at(4000)], stopIds: stops }]);
  const s = new TransitState();
  s.setNetwork(net);
  return s;
}
const NOW = 2_000_000;      // segundos
function withBus(posMeters: number, age = 60, lastStop = "B") {
  const s = world();
  const r: VehicleReport = { id: "bus", routeId: "7", reportedAt: NOW - age, position: at(posMeters), lastStopId: lastStop };
  s.applyPositions([r], NOW * 1000);
  const v = s.fleet.get("bus")!, shape = s.network.shapes.get("7")![0]!;
  return { s, v, shape, last: shape.stopIds.indexOf(lastStop) };
}
const fix = (meters: number, speed = 8, side = 0) => ({ ...at(meters, side), at: NOW * 1000 - 1000, accuracy: 10, speed });

describe("ir en el bus: el teléfono y el bus", () => {
  it("va en el bus (un poco por delante del reporte viejo): se pega el bus a la persona", () => {
    const { s, v, shape, last } = withBus(1200, 60);
    const r = checkRide(s, v, shape, last, fix(1600), NOW * 1000);
    expect(r.kind).toBe("on");
    if (r.kind !== "on") return;
    expect(Math.abs(r.snap.s - 1600)).toBeLessThan(20);
    expect(shape.stopIds[r.snap.nextIndex]).toBe("C");
    expect(Math.abs(r.snap.toNext - 400)).toBeLessThan(20);
    // la llegada a C sale de la distancia que le falta a la persona, no del reporte de hace un minuto
    expect(Math.abs(rideArrival(s, v, shape, last, r.snap, 2, NOW * 1000) - NOW - 50)).toBeLessThan(5);
    expect(rideArrival(s, v, shape, last, r.snap, 3, NOW * 1000)).toBeGreaterThan(rideArrival(s, v, shape, last, r.snap, 2, NOW * 1000));
  });
  it("lejos de la vía y en movimiento: ya no va en este bus", () => {
    const { s, v, shape, last } = withBus(1200);
    expect(checkRide(s, v, shape, last, fix(1600, 8, 400), NOW * 1000).kind).toBe("off-route");
  });
  it("sobre la vía pero muy lejos de donde puede ir el bus: otro bus", () => {
    const { s, v, shape, last } = withBus(1200, 30);
    expect(checkRide(s, v, shape, last, fix(3500), NOW * 1000)).toMatchObject({ kind: "apart" });
    expect(checkRide(s, v, shape, last, fix(500), NOW * 1000)).toMatchObject({ kind: "apart" });     // detrás: el bus ya pasó por ahí
  });
  it("quieta en una parada más adelante (esperándolo): no se compara ni se pega", () => {
    const { s, v, shape, last } = withBus(1200, 30);
    expect(checkRide(s, v, shape, last, fix(3000, 0), NOW * 1000).kind).toBe("unknown");
  });
  it("GPS impreciso o viejo: no se decide nada", () => {
    const { s, v, shape, last } = withBus(1200);
    expect(checkRide(s, v, shape, last, { ...fix(1600), accuracy: 200 }, NOW * 1000).kind).toBe("unknown");
    expect(checkRide(s, v, shape, last, { ...fix(1600), at: NOW * 1000 - 60_000 }, NOW * 1000).kind).toBe("unknown");
    expect(checkRide(s, v, shape, last, null, NOW * 1000).kind).toBe("unknown");
  });
});

describe("¿en qué bus vas?", () => {
  it("sin bus en los datos: te sigue sobre el recorrido con tu GPS", () => {
    const s = world(), shape = s.network.shapes.get("7")![0]!;
    const r = checkOnShape(s, shape, 1, fix(2300), NOW * 1000);
    expect(r.kind).toBe("on");
    if (r.kind === "on") expect(shape.stopIds[r.snap.nextIndex]).toBe("D");
    expect(checkOnShape(s, shape, 1, fix(2300, 8, 500), NOW * 1000).kind).toBe("off-route");
  });
  it("propone el bus que va por tu vía, en tu sentido y donde puede estar; y las rutas que pasan por ahí", () => {
    const { s } = withBus(1200, 60);
    const prev = { ...at(1500), at: NOW * 1000 - 5000, accuracy: 10, speed: 8 }, now = fix(1540);
    const g = guessMyBus(s, now, prev, NOW * 1000);
    expect(g.moving).toBe(true);
    expect(g.buses.map((b) => b.vehicle.id)).toEqual(["bus"]);
    expect(g.routes.map((r) => r.route.shortName)).toEqual(["7"]);
    expect(g.routes[0]!.fromIndex).toBe(1);
    // yendo en sentido contrario, ni el bus ni la ruta cuadran
    const back = guessMyBus(s, { ...fix(1500), at: NOW * 1000 }, { ...at(1540), at: NOW * 1000 - 5000, accuracy: 10, speed: 8 }, NOW * 1000);
    expect(back.buses).toEqual([]);
    expect(back.routes).toEqual([]);
  });
});
