import { describe, expect, it } from "vitest";
import { TransitState, cableInfo } from "../src";

// horario de TransMiCable como lo trae el GTFS (frequencies.txt): entre semana 4:30 a. m.–10:15 p. m., domingos 5:30 a. m.–9:15 p. m.
const st = new TransitState();
st.setDepartures({ v: 2, routes: { C_1: { cable_tunal: { stops: ["cable_tunal", "cable_paraiso"], off: [0, 669], wk: [16200], su: [19800],
  freq: { wk: [[16200, 18900, 16], [18900, 26100, 10], [26100, 80100, 16]], sa: [[16200, 80100, 16]], su: [[19800, 76500, 16]] } } } } });
st.setServiceEnds({ v: 2, routes: {}, dates: {} });
const at = (iso: string) => Date.parse(iso);

describe("TransMiCable (según horario, sin datos en vivo)", () => {
  it("abierto: cada cuánto pasan las cabinas y hasta qué hora", () => {
    expect(cableInfo(st, "C_1", at("2026-11-23T12:00:00Z"))!.text).toBe("Cabinas cada 10 s · hasta las 10:15 p. m. (según horario)");      // lunes 7 a. m.
    expect(cableInfo(st, "C_1", at("2026-11-23T20:00:00Z"))!.text).toBe("Cabinas cada 16 s · hasta las 10:15 p. m. (según horario)");      // lunes 3 p. m.
  });
  it("cerrado: cuándo abre (el domingo abre más tarde)", () => {
    expect(cableInfo(st, "C_1", at("2026-11-23T09:00:00Z"))!.text).toBe("Cerrado · abre a las 4:30 a. m. (según horario)");               // lunes 4 a. m.
    expect(cableInfo(st, "C_1", at("2026-11-22T04:00:00Z"))!.text).toBe("Cerrado · abre mañana a las 5:30 a. m. (según horario)");       // sábado 11 p. m. → domingo
  });
  it("una ruta que no va por frecuencia no es cable", () => { expect(cableInfo(st, "X", at("2026-11-23T12:00:00Z"))).toBeNull(); });
});

import { simulatedCabins } from "../src";
import { TransitNetwork } from "@transmi/domain";
describe("cabinas simuladas según el horario", () => {
  it("salen cada N s, avanzan por el cable y desaparecen al cerrar", () => {
    const s2 = new TransitState(), net = new TransitNetwork();
    const pts = [{ lat: 4.5692, lon: -74.1397 }, { lat: 4.5501, lon: -74.1589 }, { lat: 4.5692, lon: -74.1397 }];
    net.routes.set("C_1", { id: "C_1", shortName: "CABLE", longName: "", system: "cable" } as never);
    net.stops.set("a", { id: "a", code: "", name: "Tunal", position: pts[0]! }); net.stops.set("b", { id: "b", code: "", name: "Mirador", position: pts[1]! });
    net.shapes.set("C_1", [{ routeId: "C_1", direction: "0", headsign: "", points: pts, stopIds: ["a", "b", "a"] }]);
    s2.setNetwork(net);
    s2.setDepartures({ v: 2, routes: { C_1: { a: { stops: ["a", "b", "a"], off: [0, 600, 1200], wk: [16200], freq: { wk: [[16200, 80100, 16]] } } } } });
    s2.setServiceEnds({ v: 2, routes: {}, dates: {} });
    const noon = simulatedCabins(s2, "C_1", Date.parse("2026-11-23T17:00:00Z"));      // lunes mediodía: vuelta de 1200 s / 16 s ≈ 75 cabinas
    expect(noon.length).toBeGreaterThanOrEqual(74); expect(noon.length).toBeLessThanOrEqual(76);
    expect(simulatedCabins(s2, "C_1", Date.parse("2026-11-24T05:00:00Z"))).toHaveLength(0);      // medianoche: cerrado
    const early = simulatedCabins(s2, "C_1", Date.parse("2026-11-23T09:30:30Z"));       // 4:30:30 a. m.: recién abre, solo unas pocas
    expect(early.length).toBeGreaterThan(0); expect(early.length).toBeLessThanOrEqual(2);
  });
});
