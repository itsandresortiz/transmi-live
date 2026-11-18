import { describe, expect, it } from "vitest";
import { summarize } from "@transmi/application";
import { signalModelAt, signalSessions } from "@transmi/application";

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

import { signalModel, signalNow } from "@transmi/application";
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

import { lastSession } from "@transmi/application";
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

describe("medición del mediodía del dueño (plan de 120 s)", () => {
  it("encuentra el ciclo de 120 s y dice qué marcas se corrieron", () => {
    const raw: [string, "g" | "y" | "r"][] = [["2026-11-17T17:18:02.057Z","g"],["2026-11-17T17:18:22.825Z","y"],["2026-11-17T17:18:23.866Z","r"],["2026-11-17T17:19:18.496Z","y"],["2026-11-17T17:19:19.713Z","g"],["2026-11-17T17:20:21.420Z","y"],["2026-11-17T17:20:23.703Z","r"],["2026-11-17T17:21:11.327Z","y"],["2026-11-17T17:21:13.154Z","g"],["2026-11-17T17:23:21.170Z","g"],["2026-11-17T17:24:30.953Z","r"],["2026-11-17T17:25:11.589Z","y"],["2026-11-17T17:25:13.522Z","g"],["2026-11-17T17:26:21.230Z","y"],["2026-11-17T17:26:23.497Z","r"],["2026-11-17T17:27:11.503Z","y"],["2026-11-17T17:27:13.395Z","g"]];
    const s = summarize(lastSession(raw.map(([t, c]) => ({ t: Date.parse(t), c }))));
    expect(s.text).toMatch(/^Ciclo de 120 s .*verde 68 s, amarillo 2 s, rojo 48 s, amarillo antes del verde 2 s\. 6 de 8 cambios caen justo en un ciclo fijo; 2 se corrieron hasta 7 s/);
  });
});

import { measuredSignals, signalNow as now2, signalModel as model2 } from "@transmi/application";
import { readFileSync } from "node:fs";
describe("semáforos medidos guardados en el proyecto", () => {
  it("el del otro lado usa los tiempos del primero y cambia al mismo tiempo", () => {
    const list = measuredSignals(JSON.parse(readFileSync("tools/data/mediciones-semaforos.json", "utf8")));
    expect(list.length).toBeGreaterThanOrEqual(4);
    const [a, b] = list.map((x) => model2(x.marks)!);
    // el del otro lado usa el mismo modelo que el primero (el plan más reciente medido, sea cual sea)
    expect(b!.cycle).toBe(a!.cycle);
    for (let k = 0; k < 200; k += 7) { const t = Date.now() + k * 1000; expect(now2(b!, t).c).toBe(now2(a!, t).c); }
  });
});

import { opposite } from "@transmi/application";
describe("semáforo de TransMilenio alterno", () => {
  it("está en verde cuando los de carros están en rojo, y al revés", () => {
    const list = measuredSignals(JSON.parse(readFileSync("tools/data/mediciones-semaforos.json", "utf8")));
    const tms = list.filter((x) => x.tm), tm = tms[0]!, cars = model2(list[0]!.marks)!;
    expect(tms).toHaveLength(2);
    expect(tms.every((x) => x.inverse)).toBe(true);
    expect(tm.inverse).toBe(true);
    const m = model2(tm.marks)!;
    for (let k = 0; k < 120; k += 3) {
      const t = Date.parse("2026-11-17T17:42:00Z") + k * 1000, c = now2(cars, t).c, o = opposite(m, t);
      if (c === "r") expect(o).toBe("g");
      if (c === "g") expect(o).toBe("r");
    }
  });
});

describe("cruce coordinado (1 p. m.): rojos fijos cada 120 s, verde variable", () => {
  it("da 120 s y dice que el rojo cae siempre igual", () => {
    const l = measuredSignals(JSON.parse(readFileSync("tools/data/mediciones-semaforos.json", "utf8")));
    // la medición de la 1 p. m. del 17 (17:57–18:17 UTC)
    const s = signalSessions(l[0]!.marks).find((x) => x.marks[0]!.t >= Date.parse("2026-11-17T17:50:00Z") && x.marks[0]!.t < Date.parse("2026-11-17T18:30:00Z"))!;
    expect(summarize(s.marks).text).toMatch(/^Ciclo de 120 s .*El rojo empieza siempre en el mismo punto del ciclo/);      // las duraciones cambian con cada vuelta nueva que se guarda
    expect(model2(s.marks)!.cycle).toBe(120_000);
  });
});

describe("un plan por hora del día", () => {
  const l = measuredSignals(JSON.parse(readFileSync("tools/data/mediciones-semaforos.json", "utf8")));
  it("de madrugada 90 s, a la 1 p. m. 120 s, y a las 7 a. m. (sin medidas cerca) nada", () => {
    expect(signalModelAt(l[0]!.marks, Date.parse("2026-11-20T07:31:00Z"))!.cycle).toBe(90_000);
    expect(signalModelAt(l[0]!.marks, Date.parse("2026-11-20T18:15:00Z"))!.cycle).toBe(120_000);
    expect(signalModelAt(l[0]!.marks, Date.parse("2026-11-20T12:00:00Z"))).toBeNull();
  });
  it("el plan de madrugada del 17 predice el rojo del 18 a la misma hora (±1 s)", () => {
    const only17 = l[0]!.marks.filter((m) => m.t < Date.parse("2026-11-17T12:00:00Z"));
    const red = Date.parse("2026-11-18T07:30:11.531Z");
    const m = signalModelAt(only17, red)!;
    expect(signalNow(m, red - 1500).c).not.toBe("r");
    expect(signalNow(m, red + 1500).c).toBe("r");
  });
});

describe("el semáforo aprende juntando las mediciones del mismo plan", () => {
  const l = measuredSignals(JSON.parse(readFileSync("tools/data/mediciones-semaforos.json", "utf8")));
  it("las dos madrugadas (17 y 18) forman un solo plan de 90 s que acierta los rojos de ambas", () => {
    const m = signalModelAt(l[0]!.marks, Date.parse("2026-11-20T07:31:00Z"))!;
    expect(m.cycle).toBe(90_000);
    for (const red of ["2026-11-17T07:36:11.166Z", "2026-11-17T07:54:12.266Z", "2026-11-18T07:30:11.531Z", "2026-11-18T07:33:11.688Z"]) {
      const t = Date.parse(red);
      expect(now2(m, t + 1200).c).toBe("r");
      expect(now2(m, t - 2500).c).not.toBe("r");
    }
  });
});
