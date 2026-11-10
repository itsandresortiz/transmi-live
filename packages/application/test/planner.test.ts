import { describe, expect, it } from "vitest";
import { TransitNetwork, type Route, type RouteShape, type Stop } from "@transmi/domain";
import { TransitState, planTrip, sortItineraries, type Itinerary } from "@transmi/application";

/** Red de juguete en una línea de 0,002° (~220 m) entre paradas:
 *    A0 A1 A2 A3 A4 A5 A6 A7 A8      ruta «X1» (troncal) de A0 a A8
 *                   B0 B1 B2 B3      ruta «Z2» (zonal) de B0 (junto a A4) a B3 (lejos)
 *    C0 … C8                         ruta «Y9» paralela, mucho más lenta de usar (más lejos) */
const lat = 4.65, lon0 = -74.1;
const st = (id: string, name: string, dLon: number, dLat = 0): Stop => ({ id, code: id, name, position: { lat: lat + dLat, lon: lon0 + dLon } });
function world() {
  const net = new TransitNetwork();
  const stops: Stop[] = [];
  for (let i = 0; i <= 8; i++) stops.push(st(`A${i}`, `Estacion A${i}`, i * 0.004));
  for (let i = 0; i <= 3; i++) stops.push(st(`B${i}`, `Barrio B${i}`, 4 * 0.004 + 0.0004 + i * 0.004, 0.0004 + i * 0.004));
  for (const s of stops) net.stops.set(s.id, s);
  const route = (id: string, shortName: string, system: Route["system"]): Route => ({ id, shortName, longName: shortName, system });
  const add = (r: Route, ids: string[], headsign: string) => {
    net.routes.set(r.id, r);
    const shape: RouteShape = { routeId: r.id, direction: "0", headsign, points: ids.map((i) => net.stops.get(i)!.position), stopIds: ids };
    net.shapes.set(r.id, [shape]);
  };
  add(route("1", "X1", "troncal"), Array.from({ length: 9 }, (_, i) => `A${i}`), "Fin A");
  add(route("2", "Z2", "zonal"), Array.from({ length: 4 }, (_, i) => `B${i}`), "Fin B");
  const s = new TransitState();
  s.setNetwork(net);
  return s;
}
const at = (i: number, dLat = 0) => ({ name: "p", position: { lat: lat + dLat, lon: lon0 + i * 0.004 } });

describe("planificador de viajes", () => {
  const now = Date.parse("2026-03-04T17:00:00Z");
  it("un solo bus: camina, viaja y camina", () => {
    const r = planTrip(world(), at(0, 0.0003), at(6, 0.0003), { nowMs: now });
    expect(r.length).toBeGreaterThan(0);
    const best = r[0]!;
    expect(best.transfers).toBe(0);
    const rides = best.legs.filter((l) => l.kind === "ride");
    expect(rides).toHaveLength(1);
    expect(rides[0]).toMatchObject({ shortName: "X1", stops: 6 });
    expect((rides[0] as { between: unknown[] }).between).toHaveLength(5);          // las paradas intermedias
    expect(best.seconds).toBeGreaterThan(6 * 45);                  // al menos el tiempo de las 6 paradas
    expect(best.seconds).toBeLessThan(3600);
    expect(best.tags).toContain("Más rápida");
  });
  it("combina dos rutas con un trasbordo", () => {
    const r = planTrip(world(), at(0, 0.0003), { name: "d", position: { lat: lat + 0.0004 + 3 * 0.004, lon: lon0 + 4 * 0.004 + 0.0004 + 3 * 0.004 } }, { nowMs: now });
    const best = r.find((x) => x.transfers === 1);
    expect(best).toBeTruthy();
    const names = best!.legs.filter((l) => l.kind === "ride").map((l) => (l as { shortName: string }).shortName);
    expect(names).toEqual(["X1", "Z2"]);
    expect(best!.waitSeconds).toBeGreaterThan(0);
  });
  it("no ofrece nada si no hay paradas cerca del origen", () => {
    expect(planTrip(world(), { name: "lejos", position: { lat: 5.5, lon: -74.5 } }, at(3), { nowMs: now })).toEqual([]);
  });
  it("destino cercano: ofrece ir a pie", () => {
    const r = planTrip(world(), at(1, 0.0002), at(1, 0.0012), { nowMs: now });
    expect(r.some((x) => x.legs.every((l) => l.kind === "walk"))).toBe(true);
  });
});

describe("orden de las opciones", () => {
  const mk = (arriveAt: number, transfers: number, walkMeters: number): Itinerary => ({ legs: [], departAt: 0, arriveAt, seconds: arriveAt, walkMeters, walkSeconds: 0, waitSeconds: 0, transfers, live: false, tags: [] });
  const a = mk(1000, 1, 300), b = mk(1500, 0, 900), c = mk(1200, 0, 400), d = mk(1100, 2, 100);
  it("«mejor» pone primero las que no tienen trasbordos, aunque lleguen después", () => {
    expect(sortItineraries([a, b, c, d], "mejor")).toEqual([c, b, a, d]);
  });
  it("«más rápida» ordena por llegada y «menos caminata» por metros", () => {
    expect(sortItineraries([a, b, c, d], "rapida")).toEqual([a, d, c, b]);
    expect(sortItineraries([a, b, c, d], "caminata")).toEqual([d, a, c, b]);
  });
});

describe("elegir con qué viajar", () => {
  const now = Date.parse("2026-03-04T17:00:00Z");
  const far = { name: "d", position: { lat: lat + 0.0004 + 3 * 0.004, lon: lon0 + 4 * 0.004 + 0.0004 + 3 * 0.004 } };      // solo se llega con X1 (troncal) + Z2 (zonal)
  const systemsOf = (r: Itinerary[]) => new Set(r.flatMap((it) => it.legs.flatMap((l) => (l.kind === "ride" ? [l.system] : []))));
  it("sin elegir, combina troncal y zonal", () => {
    expect([...systemsOf(planTrip(world(), at(0, 0.0003), far, { nowMs: now }))].sort()).toEqual(["troncal", "zonal"]);
  });
  it("si solo se permite la troncal, ninguna opción usa el zonal (y viceversa)", () => {
    const troncal = planTrip(world(), at(0, 0.0003), at(6, 0.0003), { nowMs: now, systems: ["troncal", "dual"] });
    expect(troncal.length).toBeGreaterThan(0);
    expect([...systemsOf(troncal)]).toEqual(["troncal"]);
    expect(systemsOf(planTrip(world(), at(0, 0.0003), far, { nowMs: now, systems: ["zonal"] })).has("troncal")).toBe(false);
    expect(systemsOf(planTrip(world(), at(0, 0.0003), at(6, 0.0003), { nowMs: now, systems: ["zonal"] })).has("troncal")).toBe(false);
  });
});

describe("subir en la parada más cercana", () => {
  const now = Date.parse("2026-03-04T17:00:00Z");
  it("quien está claramente más cerca de una parada anterior de la misma ruta sube ahí, no en la siguiente", () => {
    // a 35 % del camino entre A0 y A1 (≈155 m de A0, ≈285 m de A1)
    const r = planTrip(world(), at(0.35, 0.0003), at(6, 0.0003), { nowMs: now });
    const ride = r[0]!.legs.find((l) => l.kind === "ride") as { board: { id: string }; departAt: number; arriveAt: number; rideSeconds: number };
    expect(ride.board.id).toBe("A0");
    expect(ride.arriveAt - ride.departAt).toBe(ride.rideSeconds);
    expect(r[0]!.arriveAt).toBeGreaterThanOrEqual(ride.arriveAt);
  });
  it("quien ya está al lado de la parada siguiente sube en esa", () => {
    const r = planTrip(world(), at(0.95, 0.0003), at(6, 0.0003), { nowMs: now });
    expect((r[0]!.legs.find((l) => l.kind === "ride") as { board: { id: string } }).board.id).toBe("A1");
  });
});
