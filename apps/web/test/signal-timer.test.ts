import { describe, expect, it } from "vitest";
import { summarize } from "../src/ui/SignalTimer";

describe("cronómetro de semáforos", () => {
  it("calcula el ciclo y cuánto dura cada color", () => {
    const t0 = 1_800_000_000_000, marks: { t: number; c: "g" | "y" | "r" }[] = [];
    // ciclo fijo de 90 s: 45 verde, 3 amarillo, 42 rojo
    for (let k = 0; k < 4; k++) { const b = t0 + k * 90_000; marks.push({ t: b, c: "g" }, { t: b + 45_000, c: "y" }, { t: b + 48_000, c: "r" }); }
    const s = summarize(marks);
    expect(s.text).toBe("Ciclo de 90 s (3 vueltas): verde 45 s, amarillo 3 s, rojo 42 s. Se repite igual: parece de tiempo fijo.");
    expect(summarize(marks.slice(0, 3)).text).toMatch(/^Marca al menos dos veces/);
  });
  it("con el amarillo antes del verde (como en Colombia): medidas reales del dueño, Cra. 102B Bis × Calle 145", () => {
    const raw: [string, "g" | "y" | "r"][] = [["2026-11-17T07:34:38.884Z", "y"], ["2026-11-17T07:34:41.243Z", "r"], ["2026-11-17T07:35:14.586Z", "y"], ["2026-11-17T07:35:16.403Z", "g"], ["2026-11-17T07:36:09.333Z", "y"], ["2026-11-17T07:36:11.166Z", "r"], ["2026-11-17T07:36:44.420Z", "y"], ["2026-11-17T07:36:46.344Z", "g"], ["2026-11-17T07:37:38.652Z", "y"], ["2026-11-17T07:37:41.472Z", "r"]];
    const s = summarize(raw.map(([t, c]) => ({ t: Date.parse(t), c })));
    expect(s.text).toBe("Ciclo de 90 s (2 vueltas): verde 53 s, amarillo 2 s, rojo 33 s, amarillo antes del verde 2 s. Se repite igual: parece de tiempo fijo.");
  });
});

import { signalModel, signalNow } from "../src/ui/SignalTimer";
describe("semáforo en vivo (predicción)", () => {
  it("con las medidas reales predice el color de cada momento", () => {
    const raw: [string, "g" | "y" | "r"][] = [["2026-11-17T07:34:38.884Z", "y"], ["2026-11-17T07:34:41.243Z", "r"], ["2026-11-17T07:35:14.586Z", "y"], ["2026-11-17T07:35:16.403Z", "g"], ["2026-11-17T07:36:09.333Z", "y"], ["2026-11-17T07:36:11.166Z", "r"], ["2026-11-17T07:36:44.420Z", "y"], ["2026-11-17T07:36:46.344Z", "g"], ["2026-11-17T07:37:38.652Z", "y"], ["2026-11-17T07:37:41.472Z", "r"]];
    const m = signalModel(raw.map(([t, c]) => ({ t: Date.parse(t), c })))!;
    expect(Math.round(m.cycle / 1000)).toBe(90);
    const at = (iso: string) => signalNow(m, Date.parse(iso)).c;
    expect(at("2026-11-17T07:37:50Z")).toBe("r");      // recién se puso rojo
    expect(at("2026-11-17T07:38:15.8Z")).toBe("y");    // amarillo antes del verde
    expect(at("2026-11-17T07:38:40Z")).toBe("g");
    // diez vueltas después sigue cuadrando: rojo a los ~900 s del último rojo medido
    expect(at("2026-11-17T07:52:45Z")).toBe("r");
  });
});

import { lastSession } from "../src/ui/SignalTimer";
describe("varias mediciones del mismo semáforo", () => {
  it("usa la última (pueden ser planes distintos)", () => {
    const t = 1_800_000_000_000;
    const marks = [{ t, c: "r" as const }, { t: t + 30_000, c: "g" as const }, { t: t + 3_600_000, c: "r" as const }, { t: t + 3_640_000, c: "g" as const }];
    expect(lastSession(marks)).toHaveLength(2);
    expect(lastSession(marks.slice(0, 2))).toHaveLength(2);
  });
});

describe("segunda medición del dueño (07:51–07:56)", () => {
  const raw: [string, "g" | "y" | "r"][] = [["2026-11-17T07:34:38.884Z","y"],["2026-11-17T07:34:41.243Z","r"],["2026-11-17T07:35:14.586Z","y"],["2026-11-17T07:35:16.403Z","g"],["2026-11-17T07:36:09.333Z","y"],["2026-11-17T07:36:11.166Z","r"],["2026-11-17T07:36:44.420Z","y"],["2026-11-17T07:36:46.344Z","g"],["2026-11-17T07:37:38.652Z","y"],["2026-11-17T07:37:41.472Z","r"],["2026-11-17T07:51:31.266Z","r"],["2026-11-17T07:51:44.587Z","y"],["2026-11-17T07:51:46.504Z","g"],["2026-11-17T07:52:38.835Z","y"],["2026-11-17T07:52:40.854Z","r"],["2026-11-17T07:52:42.002Z","r"],["2026-11-17T07:53:14.524Z","y"],["2026-11-17T07:53:16.508Z","g"],["2026-11-17T07:54:10.566Z","y"],["2026-11-17T07:54:12.266Z","r"],["2026-11-17T07:54:44.673Z","y"],["2026-11-17T07:54:46.632Z","g"],["2026-11-17T07:55:39.756Z","y"],["2026-11-17T07:55:41.814Z","r"],["2026-11-17T07:56:14.647Z","y"],["2026-11-17T07:56:16.506Z","g"]];
  const marks = raw.map(([t, c]) => ({ t: Date.parse(t), c }));
  it("separa las mediciones, ignora el doble toque y dice que se repite igual", () => {
    const s = summarize(lastSession(marks));
    expect(s.text).toMatch(/^Ciclo de 90 s .*verde 53 s, amarillo 2 s, rojo 33 s, amarillo antes del verde 2 s\. Se repite igual/);
  });
  it("afina el ciclo con las dos mediciones: 14 vueltas de 90,0 s", () => {
    const m = signalModel(marks)!;
    expect(Math.abs(m.cycle - 90_007)).toBeLessThan(150);
  });
});
