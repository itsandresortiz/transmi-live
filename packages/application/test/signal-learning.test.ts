import { describe, expect, it } from "vitest";
import { learnFromBuses, type BusGo, type BusNearSignal, type SignalModel } from "../src";

// semáforo de 120 s: rojo 40 s desde el ancla, amarillo 2, verde 76, amarillo 2
const model: SignalModel = { cycle: 120_000, anchor: 0, segs: [{ c: "r", d: 40_000 }, { c: "y", d: 2000 }, { c: "g", d: 76_000 }, { c: "y", d: 2000 }] };
const red = (t: number) => ((t % 120) + 120) % 120 < 40;
/** Buses de norte a sur que obedecen al semáforo corrido `shift` s y buses de oriente a occidente que obedecen al contrario. */
function buses(shift = 0, n = 200): BusNearSignal[] {
  const out: BusNearSignal[] = [];
  for (let i = 0; i < n; i++) {
    const t = 1_800_000_000 + i * 37;
    out.push({ t, still: red(t - shift), h: i % 2 ? "N" : "S" });
    if (i % 3 === 0) out.push({ t, still: !red(t - shift), h: "E" });
  }
  return out;
}

describe("los semáforos medidos y los buses aprenden unos de otros", () => {
  it("si el ciclo medido está bien, encaja y se sostiene; aprende que el eje cruzado va al revés", () => {
    const L = learnFromBuses(model, false, buses());
    expect(L.agree!).toBeGreaterThan(0.9);
    expect(L.shift!.s).toBe(0);
    expect(L.axes.find((a) => a.axis === "NS")!.inverse).toBe(false);
    expect(L.axes.find((a) => a.axis === "EO")!.inverse).toBe(true);
    expect(L.text).toMatch(/se sostiene/);
  });
  it("si el semáforo se corrió 30 s, los buses lo dicen", () => {
    const L = learnFromBuses(model, false, buses(30));
    expect(Math.abs(L.shift!.s - 30)).toBeLessThanOrEqual(2);
    expect(L.text).toMatch(/corrido \+(28|30|32) s/);
  });
  it("los arranques tras el verde predicho cuentan más que el azar", () => {
    // arrancan entre 2 y 18 s después del verde (t = 42 de cada vuelta), con reportes cada 20 s
    const goes: BusGo[] = Array.from({ length: 20 }, (_, i) => { const g = 1_800_000_040 + i * 120 + 2; return { a: g - 8, b: g + 12, h: "N" as const }; });
    const L = learnFromBuses(model, false, buses(), goes);
    expect(L.goes.ok).toBe(20);
    expect(L.goes.chance).toBeLessThan(0.3);
  });
  it("con pocos reportes no concluye nada", () => {
    expect(learnFromBuses(model, false, buses(0, 5)).text).toMatch(/todavía no dicen nada/);
  });
});

import { signalInfo, signalPoints, type SignalRow } from "../src";
describe("semáforos que no están en la lista oficial (OpenStreetMap)", () => {
  // los dos del retorno en U frente al Portal Suba
  const row: SignalRow = [-74.09522, 4.74597, "", "", "", 2, 0, 0, 0, 0, "OSM", [[-74.0952, 4.745977, "c"], [-74.095241, 4.745959, "c"]]];
  it("se dibujan los dos y dicen de dónde salen", () => {
    expect(signalPoints([row])).toHaveLength(2);
    expect(signalInfo(row).text).toMatch(/^2 semáforos que no aparecen en la lista oficial/);
  });
});
