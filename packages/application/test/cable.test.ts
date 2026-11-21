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
