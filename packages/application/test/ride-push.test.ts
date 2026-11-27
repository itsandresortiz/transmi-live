import { describe, expect, it } from "vitest";
import { TransitNetwork, type VehicleReport } from "@transmi/domain";
import { TransitState, dedupeSharedRides, parseSharedRides, planRidePush, rideActivityChanged, type PushRide } from "../src";

// Una ruta recta hacia el norte: paradas cada ~1 km (A … F)
const LAT0 = 4.70, LON = -74.08, M = 1 / 111_000;
const at = (meters: number) => ({ lat: LAT0 + meters * M, lon: LON });
const STOPS = ["A", "B", "C", "D", "E", "F"];
function world() {
  const net = new TransitNetwork();
  net.routes.set("7", { id: "7", shortName: "7", longName: "Polo", system: "troncal" });
  STOPS.forEach((id, i) => net.stops.set(id, { id, code: id, name: id, position: at(i * 1000) }));
  net.shapes.set("7", [{ routeId: "7", direction: "0", headsign: "Polo", points: STOPS.map((_, i) => at(i * 1000)), stopIds: STOPS }]);
  const s = new TransitState();
  s.setNetwork(net);
  return s;
}
const NOW = 2_000_000;
function withBus(meters: number, lastStop: string, age = 10) {
  const s = world();
  const r: VehicleReport = { id: "bus", routeId: "7", reportedAt: NOW - age, position: at(meters), lastStopId: lastStop };
  s.applyPositions([r], NOW * 1000);
  return s;
}
const ride = (sent: Record<string, number> = {}): PushRide => ({ busId: "bus", alightId: "F", total: 5, route: "7", color: "#e11d2e", stop: "Calle F", sent });

describe("avisos del viaje desde el servidor", () => {
  it("lejos de la parada: no avisa nada todavía y arma la actividad en vivo", () => {
    const p = planRidePush(withBus(100, "A"), ride(), NOW * 1000);
    expect(p.kind).toBe("going");
    if (p.kind !== "going") return;
    expect(p.left).toBe(5);
    expect(p.alerts).toEqual([]);
    expect(p.activity).toMatchObject({ title: "Vas en el 7", untilLabel: "Te bajas en", step: 0, steps: 5, link: "transmilive:///ride/bus" });
    expect(p.eta).toBeGreaterThan(NOW);
  });
  it("a 3 paradas, «Faltan 3 paradas»; y no se repite si ya salió", () => {
    const s = withBus(2050, "C");
    const p = planRidePush(s, ride(), NOW * 1000);
    expect(p.kind === "going" && p.alerts.map((a) => a.id)).toEqual(["ride-3"]);
    const q = planRidePush(s, ride({ "ride-3": NOW }), NOW * 1000);
    expect(q.kind === "going" && q.alerts).toEqual([]);
  });
  it("a una parada: «Prepárate para bajar» (sin «Faltan 3», que ya no aplica)", () => {
    const p = planRidePush(withBus(4050, "E"), ride(), NOW * 1000);
    expect(p.kind).toBe("going");
    if (p.kind !== "going") return;
    expect(p.alerts.map((a) => a.id)).toContain("ride-1");
    expect(p.alerts.map((a) => a.id)).not.toContain("ride-3");
    expect(p.markSent).toContain("ride-3");
    expect(p.alerts.find((a) => a.id === "ride-1")?.body).toBe("La siguiente parada es Calle F.");
  });
  it("el bus ya llegó a la parada: «Bájate aquí» (si no salió) y el viaje termina", () => {
    const p = planRidePush(withBus(5000, "F"), ride({ "ride-1": NOW - 60 }), NOW * 1000);
    expect(p.kind).toBe("done");
    expect(p.kind === "done" && p.alerts.map((a) => a.id)).toEqual(["ride-0"]);
  });
  it("sin el bus en los datos: espera", () => {
    expect(planRidePush(world(), ride(), NOW * 1000).kind).toBe("missing");
  });
  it("la actividad en vivo se actualiza solo si cambia algo que se note", () => {
    expect(rideActivityChanged(null, 3, 100)).toBe(true);
    expect(rideActivityChanged({ left: 3, eta: 100 }, 3, 120)).toBe(false);
    expect(rideActivityChanged({ left: 3, eta: 100 }, 3, 140)).toBe(true);
    expect(rideActivityChanged({ left: 3, eta: 100 }, 2, 100)).toBe(true);
  });
});

describe("posiciones compartidas (anónimas)", () => {
  it("lee solo lo bien formado y nunca toma un viaje con GPS como número de bus", () => {
    const l = parseSharedRides({ items: [{ r: "7", k: 0, m: 100, t: NOW, b: "gps:7:0:1" }, { r: "7", k: -1, m: 1, t: NOW }, { r: 7 }, { r: "7", k: 0, m: 9, t: NOW, b: "bus", v: 5 }] });
    expect(l).toHaveLength(2);
    expect(l[0]!.busId).toBeNull();
    expect(l[1]).toMatchObject({ busId: "bus", speed: 5 });
  });
  it("junta varias posiciones del mismo bus y quita las viejas", () => {
    const l = dedupeSharedRides([
      { routeId: "7", shape: 0, meters: 1000, at: NOW - 40, speed: 10 },
      { routeId: "7", shape: 0, meters: 1400, at: NOW - 5, speed: 10 },     // el mismo bus 35 s después
      { routeId: "7", shape: 0, meters: 3000, at: NOW - 5 },                // otro bus más adelante
      { routeId: "7", shape: 0, meters: 3000, at: NOW - 120 },              // vieja
    ], NOW);
    expect(l.map((r) => r.meters).sort()).toEqual([1400, 3000]);
  });
  it("dibuja un bus de los datos donde va quien lo comparte, y los que TransMilenio no reporta aparte", () => {
    const s = withBus(1000, "B", 60);
    s.sharedRides.set([{ routeId: "7", shape: 0, meters: 1500, at: NOW - 2, speed: 0, busId: "bus" }, { routeId: "7", shape: 0, meters: 4000, at: NOW - 2 }], NOW);
    const p = s.sharedRides.positionOf(s, "bus", NOW);
    expect(p).not.toBeNull();
    expect(Math.abs((p!.lat - LAT0) / M - 1500)).toBeLessThan(5);
    const extra = s.sharedRides.extras(s, NOW);
    expect(extra).toHaveLength(1);
    expect(Math.abs((extra[0]!.lat - LAT0) / M - 4000)).toBeLessThan(20);      // metros del trazado (Mercator): ~0,3 % de diferencia
    // pasado un minuto ya no vale
    expect(s.sharedRides.positionOf(s, "bus", NOW + 70)).toBeNull();
  });
});
