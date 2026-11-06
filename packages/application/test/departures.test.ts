import { describe, expect, it } from "vitest";
import { Departures } from "@transmi/application";

const data = { v: 1, routes: { R1: {
  "0": { stops: ["A", "B", "C"], off: [0, 300, 720], wk: [18000, 600, 600] },     // salidas 05:00, 05:10, 05:20
  "1": { stops: ["C", "B", "A"], off: [0, 420, 720], wk: [25200] },
} } };

describe("horas de paso programadas", () => {
  const d = new Departures(); d.load(data);
  it("da las próximas horas de paso por una parada", () => {
    const r = d.nextAt("B", "wk", 5 * 3600 + 8 * 60, 2);       // 05:08
    const r0 = r.find((x) => x.direction === "0")!;
    expect(r0.times).toEqual([18000 + 300 + 600, 18000 + 300 + 1200]);   // 05:15 y 05:25
  });
  it("no ofrece horas pasadas ni de tipos de día sin servicio", () => {
    expect(d.nextAt("B", "wk", 8 * 3600).filter((x) => x.direction === "0")).toEqual([]);
    expect(d.nextAt("B", "sa", 5 * 3600)).toEqual([]);
  });
  it("la última parada del recorrido no tiene salidas", () => {
    expect(d.nextAt("C", "wk", 5 * 3600).filter((x) => x.direction === "0")).toEqual([]);
  });
  it("calcula la frecuencia alrededor de una hora", () => {
    expect(d.headwayAt("R1", "wk", 5 * 3600 + 600)).toBe(600);
    expect(d.headwayAt("R1", "sa", 5 * 3600)).toBeUndefined();
  });
});
