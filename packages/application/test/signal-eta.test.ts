import { describe, expect, it } from "vitest";
import { TransitNetwork } from "@transmi/domain";
import { TransitState, arrivalAtIndex, busesConfirm } from "../src";

// Ruta recta hacia el este; semáforo medido a mitad de camino entre las paradas A (0 m) y B (1.000 m)
const LAT = 4.7, LON0 = -74.1, M = 1 / (111_000 * Math.cos((4.7 * Math.PI) / 180));
const at = (m: number) => ({ lat: LAT, lon: LON0 + m * M });
const NOW = 2_000_000_000;      // s
// ciclo de 100 s desde NOW−1000: verde 50, amarillo 2, rojo 46, amarillo 2
const iso = (s: number) => new Date(s * 1000).toISOString();
const marks: [string, string][] = [];
for (let k = 0; k < 4; k++) { const b = NOW - 1000 + k * 100; marks.push([iso(b), "verde"], [iso(b + 50), "amarillo"], [iso(b + 52), "rojo"], [iso(b + 98), "amarillo"]); }
const sig = at(500);
const measured = { mediciones: [{ semaforo: { lat: sig.lat, lon: sig.lon, titulo: "prueba" }, marcas: marks }] };
const key = `${sig.lat.toFixed(6)},${sig.lon.toFixed(6)}`;
const good = { semaforos: { [key]: { axes: [{ axis: "EO", n: 300, inverse: false }], stopped: { n: 60, red: 45, chance: 0.42 }, goes: { n: 20, ok: 16, chance: 0.4 } } } };

function world() {
  const net = new TransitNetwork();
  net.routes.set("R", { id: "R", shortName: "R", longName: "R", system: "zonal" });
  net.stops.set("A", { id: "A", code: "A", name: "A", position: at(0) });
  net.stops.set("B", { id: "B", code: "B", name: "B", position: at(1000) });
  net.shapes.set("R", [{ routeId: "R", direction: "0", headsign: "B", points: [at(0), at(1000)], stopIds: ["A", "B"] }]);
  const s = new TransitState();
  s.setNetwork(net);
  return s;
}
function eta(learning: unknown, reportAt: number) {
  const s = world();
  s.signalWaits.load(measured, learning);
  s.applyPositions([{ id: "b", routeId: "R", reportedAt: reportAt, position: at(10), lastStopId: "A" }], reportAt * 1000);
  const v = s.fleet.get("b")!, shape = s.network.shapes.get("R")![0]!;
  return { n: s.signalWaits.size, t: arrivalAtIndex(s, v, shape, 0, 1, reportAt * 1000) };
}

describe("espera en semáforos confirmados por los buses", () => {
  it("sin confirmación de los buses no cambia nada", () => {
    const weak = { semaforos: { [key]: { ...good.semaforos[key], stopped: { n: 60, red: 20, chance: 0.42 } } } };
    expect(busesConfirm(weak.semaforos[key])).toBe(false);
    expect(eta(weak, NOW).n).toBe(0);
  });
  it("confirmado: si el bus llega en rojo, espera; si llega en verde, no", () => {
    expect(eta(good, NOW).n).toBe(1);
    const base = (r: number) => eta({}, r).t - r;
    // el bus tarda ~T en llegar; se busca un reporte que lo haga cruzar el semáforo en rojo y otro en verde
    let red = -1, green = -1;
    for (let r = NOW; r < NOW + 100; r++) {
      const d = eta(good, r).t - r - base(r);
      if (d > 5 && red < 0) red = r;
      if (Math.abs(d) < 0.01 && green < 0) green = r;
    }
    expect(red).toBeGreaterThan(0);
    expect(green).toBeGreaterThan(0);
    expect(eta(good, red).t - red - base(red)).toBeLessThanOrEqual(48.5);
  });
});
