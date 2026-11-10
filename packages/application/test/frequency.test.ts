import { describe, expect, it } from "vitest";
import { frequencyText } from "@transmi/application";

const NOW = 1_000_000, m = (x: number) => NOW + x * 60;
describe("cada cuánto está pasando una ruta ahora", () => {
  it("con varios buses dice el intervalo típico", () => expect(frequencyText([m(2), m(6), m(10)], NOW)).toBe("Ahora pasa cada ~4 min."));
  it("avisa del hueco cuando el próximo tarda mucho más que el ritmo de los que vienen", () => expect(frequencyText([m(15), m(18), m(21)], NOW)).toBe("Hay un hueco: el próximo tarda ~15 min; después pasan cada ~3 min."));
  it("avisa si el único bus que viene está lejos", () => expect(frequencyText([m(20)], NOW)).toBe("Hay un hueco: el próximo tarda ~20 min y no viene otro cerca."));
  it("con un solo bus cercano no dice nada (no se puede saber el ritmo)", () => expect(frequencyText([m(3)], NOW)).toBeUndefined());
  it("buses pegados", () => expect(frequencyText([m(2), m(2.5), m(3)], NOW)).toBe("Ahora vienen varios seguidos."));
  it("ignora los que ya pasaron", () => expect(frequencyText([m(-5), m(2), m(8)], NOW)).toBe("Ahora pasa cada ~6 min."));
});
