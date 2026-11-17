import { describe, expect, it } from "vitest";
import { summarize } from "../src/ui/SignalTimer";

describe("cronómetro de semáforos", () => {
  it("calcula el ciclo y cuánto dura cada color", () => {
    const t0 = 1_800_000_000_000, marks: { t: number; c: "g" | "y" | "r" }[] = [];
    // ciclo fijo de 90 s: 45 verde, 3 amarillo, 42 rojo
    for (let k = 0; k < 4; k++) { const b = t0 + k * 90_000; marks.push({ t: b, c: "g" }, { t: b + 45_000, c: "y" }, { t: b + 48_000, c: "r" }); }
    const s = summarize(marks);
    expect(s.text).toBe("Ciclo de 90 s (3 vueltas): verde 45 s, amarillo 3 s, rojo 42 s. Se repite igual: parece de tiempo fijo.");
    expect(summarize(marks.slice(0, 3)).text).toMatch(/^Marca al menos 3 cambios/);
  });
});
