import { describe, expect, it } from "vitest";
import { TransitNetwork, type VehicleReport } from "@transmi/domain";
import { TransitState, busForGpsRide, checkOnShape, checkRide, guessMyBus, rideArrival } from "../src";

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
    // tramo troncal de 1 km = 29 s de parada + 1.000 m a 12 m/s ≈ 112 s; quedan 400 m (40 %) ≈ 45 s
    expect(Math.abs(rideArrival(s, v, shape, last, r.snap, 2, NOW * 1000) - NOW - 45)).toBeLessThan(5);
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

describe("tiempos del viaje con tu ubicación", () => {
  // paradas a 0, 200, 400 y 2.400 m: dos tramos cortos y uno largo
  function uneven() {
    const net = new TransitNetwork();
    net.routes.set("Z", { id: "Z", shortName: "Z", longName: "Z", system: "zonal" });
    const ms = [0, 200, 400, 2400], ids = ["P0", "P1", "P2", "P3"];
    ids.forEach((id, i) => net.stops.set(id, { id, code: id, name: id, position: at(ms[i]!) }));
    net.shapes.set("Z", [{ routeId: "Z", direction: "0", headsign: "Z", points: ms.map((m) => at(m)), stopIds: ids }]);
    const s = new TransitState();
    s.setNetwork(net);
    s.applyPositions([{ id: "z", routeId: "Z", reportedAt: NOW, position: at(0), lastStopId: "P0" }], NOW * 1000);
    return { s, v: s.fleet.get("z")!, shape: s.network.shapes.get("Z")![0]! };
  }
  it("cada tramo pesa según su distancia real", () => {
    const { s, v, shape } = uneven();
    const r = checkOnShape(s, shape, 0, { ...at(0), at: NOW * 1000, accuracy: 5, speed: 8 }, NOW * 1000);
    if (r.kind !== "on") throw new Error(r.kind);
    const t = [1, 2, 3].map((j) => rideArrival(s, v, shape, 0, r.snap, j, NOW * 1000) - NOW);
    const short = t[1]! - t[0]!, long = t[2]! - t[1]!;
    expect(long).toBeGreaterThan(short * 3);           // 2 km tardan mucho más que 200 m
    expect(Math.abs(short - (23 + 200 / 8))).toBeLessThan(3);
  });
  it("si tu bus va más lento que el modelo, lo que falta se alarga", () => {
    const { s, v, shape } = uneven();
    const r = checkOnShape(s, shape, 0, { ...at(400), at: NOW * 1000, accuracy: 5, speed: 8 }, NOW * 1000);
    if (r.kind !== "on") throw new Error(r.kind);
    const normal = rideArrival(s, v, shape, 0, r.snap, 3, NOW * 1000) - NOW;
    // 400 m en 10 min: muy lento (el modelo dice ~1,6 min) → hasta 1,8 veces
    const slow = rideArrival(s, v, shape, 0, { ...r.snap, pace: { s: 0, at: NOW * 1000 - 600_000 } }, 3, NOW * 1000) - NOW;
    expect(slow / normal).toBeGreaterThan(1.7);
    // con poco medido (30 s) no cambia nada
    expect(rideArrival(s, v, shape, 0, { ...r.snap, pace: { s: 300, at: NOW * 1000 - 30_000 } }, 3, NOW * 1000) - NOW).toBeCloseTo(normal, 5);
  });
});

describe("viaje con GPS que encuentra su bus", () => {
  it("un bus de la ruta reporta justo donde vas (con su minuto de atraso): es el tuyo", () => {
    const { s, shape } = withBus(1600, 60);          // reportó hace 60 s en 1.600 m; tú vas en ~2.000 m
    expect(busForGpsRide(s, shape, 2000, NOW * 1000)?.vehicle.id).toBe("bus");
  });
  it("lejos, muy por delante o con reporte viejo: no se enlaza", () => {
    expect(busForGpsRide(withBus(500, 30).s, withBus(500, 30).shape, 2500, NOW * 1000)).toBeNull();     // 2 km atrás
    expect(busForGpsRide(withBus(2600, 30).s, withBus(2600, 30).shape, 2000, NOW * 1000)).toBeNull();   // te lleva 600 m
    expect(busForGpsRide(withBus(1900, 400).s, withBus(1900, 400).shape, 2000, NOW * 1000)).toBeNull(); // reporte de hace 6 min
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
