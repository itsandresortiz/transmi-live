import { describe, expect, it } from "vitest";
import { redTimes, signalReport, wilsonLow } from "../src";

describe("informe por cruce semafórico", () => {
  it("ordena por espera con margen: pocos datos no salen primero", () => {
    const r = signalReport({
      "-74.1,4.7|wk|1|N": { n: 400, still: 200, slow: 300, sumV: 800 },
      "-74.1,4.7|wk|2|S": { n: 100, still: 10, slow: 30, sumV: 500 },
      "-74.2,4.6|wk|1|E": { n: 320, still: 96, slow: 150, sumV: 1600 },
      "-74.3,4.5|wk|1|E": { n: 10, still: 10, slow: 10, sumV: 0 },           // muy pocas pasadas: fuera
      "-74.4,4.5|wk|1": { n: 900, still: 800, slow: 900, sumV: 10 },          // clave vieja sin dirección: fuera
    }, 80, 300);
    expect(r.crossings.map((c) => `${c.lon}`)).toEqual(["-74.1", "-74.2"]);
    const a = r.crossings[0]!;
    expect(a.n).toBe(500);
    expect(a.share).toBe(0.42);
    expect(a.kmh).toBe(9.4);                         // 1300 / 500 m/s × 3,6
    expect(a.worst).toMatchObject({ day: "wk", bucket: 1, dir: "N", share: 0.5 });
    expect(r.observations).toBe(830);
  });
  it("límite bajo de Wilson", () => {
    expect(wilsonLow(5, 10)).toBeGreaterThan(0.2);
    expect(wilsonLow(5, 10)).toBeLessThan(0.5);
    expect(wilsonLow(500, 1000)).toBeGreaterThan(wilsonLow(5, 10));
    expect(wilsonLow(0, 0)).toBe(0);
  });
  it("horas del rojo dentro de una hora", () => {
    expect(redTimes(120, 35, 7)).toEqual(["7:00:35", "7:02:35", "7:04:35"]);
    expect(redTimes(90, 80, 17, 2)).toEqual(["17:01:20", "17:02:50"]);
  });
  it("incluye la huella de un cruce de tiempo fijo", () => {
    const h = Array.from({ length: 24 }, (_, i) => (i >= 12 && i < 19 ? 30 : 2));
    const r = signalReport({
      "-74.1,4.7|wk|2|N": { n: 600, still: h.reduce((s, x) => s + x, 0), slow: 400, sumV: 1200, p120: h, p90: new Array(18).fill(14) },
      "-74.2,4.7|wk|2|N": { n: 600, still: 240, slow: 400, sumV: 1200, p120: new Array(24).fill(10), p90: new Array(18).fill(13) },
    });
    const c = r.crossings.find((x) => x.lon === -74.1)!;
    expect(c.prints[0]).toMatchObject({ cycle: 120, redStart: 60, dir: "N", bucket: 2 });
  });
});
