import { describe, expect, it } from "vitest";
import { TransitNetwork } from "@transmi/domain";
import { HopProfile, TransitState, arrivalAtIndex, buildHopProfile, rawArrival, rideShownArrival, shownArrival } from "../src";

// ruta recta hacia el NORTE: paradas cada 1.000 m
const LAT0 = 4.70, LON = -74.08, M = 1 / 111_000;
const at = (m: number) => ({ lat: LAT0 + m * M, lon: LON });
const TUE_8AM = Date.parse("2026-11-17T08:00:00-05:00");      // martes, pico de la mañana (franja 1)
function world() {
  const net = new TransitNetwork();
  net.routes.set("R", { id: "R", shortName: "539", longName: "", system: "zonal" });
  ["A", "B", "C", "D"].forEach((id, i) => net.stops.set(id, { id, code: id, name: id, position: at(i * 1000) }));
  net.shapes.set("R", [{ routeId: "R", direction: "0", headsign: "", points: [at(0), at(3000)], stopIds: ["A", "B", "C", "D"] }]);
  const s = new TransitState(); s.setNetwork(net); return s;
}
const r = { "R|0": { "wk|1": [100, 50, 100, 50, 100, 50] } };

describe("corrección aparte para la próxima parada", () => {
  it("la próxima parada y las demás llevan su propia corrección; las apps viejas siguen con `extra`", () => {
    const h = new HopProfile();
    h.load({ v: 1, updated: "", extra: 15, split: { next: [1, 20, 3, 4, 5], later: [0, -5, 0, 0, 0] }, r });
    expect(h.extraAt(TUE_8AM, 1)).toBe(20);
    expect(h.extraAt(TUE_8AM, 2)).toBe(-5);
    expect(h.extraAt(TUE_8AM, 3)).toBe(-5);
    expect(h.extraAt(Date.parse("2026-11-17T12:00:00-05:00"), 1)).toBe(3);       // valle
    // mal formado: se ignora y queda lo de siempre
    h.load({ v: 1, updated: "", extra: 15, split: { next: [1, 2], later: [0, 0, 0, 0, 0] }, r });
    expect(h.extraAt(TUE_8AM, 1)).toBe(15);
    h.load({ v: 1, updated: "", extra: 15, split: { next: [1, 2, 3, 4, 999], later: [0, 0, 0, 0, 0] }, r });
    expect(h.extraAt(TUE_8AM, 2)).toBe(15);
    // lo publicado lleva `extra` (apps viejas) y `split` (las nuevas)
    const p = buildHopProfile({}, () => 4, "x", 3, true, 0, 15, null, { next: [9, 9, 9, 9, 9], later: [1, 1, 1, 1, 1] });
    expect(p.extra).toBe(15);
    expect(p.split).toEqual({ next: [9, 9, 9, 9, 9], later: [1, 1, 1, 1, 1] });
    expect("split" in buildHopProfile({}, () => 4, "x", 3, true, 0, 15, null, null)).toBe(false);
  });
  it("la llegada suma la corrección según cuántas paradas faltan", () => {
    const s = world();
    s.applyPositions([{ id: "bus", routeId: "R", reportedAt: TUE_8AM / 1000, position: at(100), lastStopId: "A" }], TUE_8AM);
    const v = s.fleet.get("bus")!, shape = s.network.shapes.get("R")![0]!;
    s.hopProfile.load({ v: 1, updated: "", extra: 0, r });
    const b1 = rawArrival(s, v, shape, 0, 1, TUE_8AM).eta, b2 = rawArrival(s, v, shape, 0, 2, TUE_8AM).eta;
    s.hopProfile.load({ v: 1, updated: "", extra: 0, split: { next: [0, 25, 0, 0, 0], later: [0, 5, 0, 0, 0] }, r });
    expect(rawArrival(s, v, shape, 0, 1, TUE_8AM).eta).toBeCloseTo(b1 + 25);
    expect(rawArrival(s, v, shape, 0, 2, TUE_8AM).eta).toBeCloseTo(b2 + 5);
  });
});

describe("huellas de semáforos en las llegadas", () => {
  const sig = at(500), ll = `${sig.lon},${sig.lat}`;
  // rojo de 60 s en una vuelta de 120 s
  const prints = (key: string) => ({ use: true, s: { [`${ll}|${key}`]: [120, 0, 60, 9, 200] } });
  /** La espera más larga que suma la huella a la llegada a B, probando reportes durante una vuelta entera. */
  function maxWait(data: unknown, t0: number) {
    let max = 0;
    for (let k = 0; k < 120; k += 3) {
      const t = t0 + k * 1000, base = world(), withFp = world();
      withFp.signalWaits.loadFootprints(data);
      for (const s of [base, withFp]) s.applyPositions([{ id: "bus", routeId: "R", reportedAt: t / 1000, position: at(10), lastStopId: "A" }], t);
      const eta = (s: TransitState) => rawArrival(s, s.fleet.get("bus")!, s.network.shapes.get("R")![0]!, 0, 1, t).eta;
      max = Math.max(max, eta(withFp) - eta(base));
    }
    return max;
  }
  it("cuentan aunque no haya ningún semáforo medido confirmado, y solo en el sentido del bus", () => {
    expect(maxWait(prints("wk|1|N"), TUE_8AM)).toBeGreaterThan(30);       // el bus va hacia el norte
    expect(maxWait(prints("wk|1|S"), TUE_8AM)).toBe(0);
    expect(maxWait({ ...prints("wk|1|N"), use: false }, TUE_8AM)).toBe(0);  // apagadas desde el archivo
  });
  it("usan el día de Bogotá (un sábado a las 9 p. m. ya es domingo en UTC)", () => {
    const sat9pm = Date.parse("2026-11-21T21:00:00-05:00");
    expect(maxWait(prints("sa|4|N"), sat9pm)).toBeGreaterThan(30);
    expect(maxWait(prints("su|4|N"), sat9pm)).toBe(0);
  });
});

describe("la cuenta que no sube, fuera de las listas de parada", () => {
  it("la próxima parada de la ficha del bus se detiene si el bus queda algo más atrás; el movimiento usa la hora tal cual", () => {
    const s = world(), t1 = TUE_8AM, t2 = t1 + 5000;
    s.applyPositions([{ id: "bus", routeId: "R", reportedAt: t1 / 1000, position: at(600), lastStopId: "A" }], t1);
    const first = s.nextStopOf(s.fleet.get("bus")!, t1)!;
    expect(first.stopId).toBe("B");
    // el GPS salta 150 m hacia atrás: el cálculo nuevo dice que llega más tarde
    s.applyPositions([{ id: "bus", routeId: "R", reportedAt: t2 / 1000, position: at(450), lastStopId: "A" }], t2);
    const v = s.fleet.get("bus")!, shape = s.network.shapes.get("R")![0]!;
    const raw = arrivalAtIndex(s, v, shape, 0, 1, t2);
    expect(raw - t2 / 1000).toBeGreaterThan(first.arrivalAt! - t1 / 1000 + 1);     // sin detener, la cuenta subiría
    const held = s.nextStopOf(v, t2)!.arrivalAt!;
    expect(held - t2 / 1000).toBeCloseTo(first.arrivalAt! - t1 / 1000, 5);         // se queda en el mismo número
    expect(s.nextStopOf(v, t2, false)!.arrivalAt).toBeCloseTo(raw, 5);
    // la ficha de la ruta y la lista de la parada dicen lo mismo para ese bus
    expect(shownArrival(s, v, shape, 0, 1, t2)).toBeCloseTo(held, 5);
  });
  it("«Voy en este bus» tiene su propia memoria: no la frena lo que se mostró en las paradas", () => {
    const s = world(), t1 = TUE_8AM;
    s.applyPositions([{ id: "bus", routeId: "R", reportedAt: t1 / 1000, position: at(600), lastStopId: "A" }], t1);
    const v = s.fleet.get("bus")!, shape = s.network.shapes.get("R")![0]!;
    const shown = shownArrival(s, v, shape, 0, 1, t1);
    s.etaHold.smooth("bus", "B", shown - 30, t1 / 1000);      // la lista de la parada mostró algo distinto
    expect(rideShownArrival(s, v, shape, 0, null, 1, t1)).toBeCloseTo(arrivalAtIndex(s, v, shape, 0, 1, t1), 5);
  });
});
