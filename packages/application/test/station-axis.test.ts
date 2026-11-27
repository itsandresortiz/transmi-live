import { describe, expect, it } from "vitest";
import { toWorld } from "@transmi/domain";
import { stopsAxis } from "../src/station-geometry";

const deg = (a: { ux: number; uy: number }, b: { ux: number; uy: number }) => (Math.acos(Math.min(1, Math.abs(a.ux * b.ux + a.uy * b.uy))) * 180) / Math.PI;

describe("eje de la estación: la fila de paradas manda en las cabeceras", () => {
  // Universidades (cabecera de la K): paradas en fila hacia el nororiente; los recorridos que arrancan ahí van hacia el sur
  const univ = [[4.60435, -74.06754], [4.6046, -74.0673], [4.60489, -74.06721], [4.60518, -74.06697]].map(([lat, lon]) => toWorld({ lat: lat!, lon: lon! }));
  const first = univ[0]!, last = univ[3]!, len = Math.hypot(last.x - first.x, last.y - first.y);
  const stopsDir = { ux: (last.x - first.x) / len, uy: (last.y - first.y) / len };
  it("si los recorridos salen atravesados, se usa la fila de paradas", () => {
    const southbound = { ux: 0, uy: 1 };
    expect(deg(stopsAxis(univ, southbound), stopsDir)).toBeLessThan(6);
  });
  it("si los recorridos van con la fila, se dejan", () => {
    const close = { ux: stopsDir.ux * Math.cos(0.1) - stopsDir.uy * Math.sin(0.1), uy: stopsDir.ux * Math.sin(0.1) + stopsDir.uy * Math.cos(0.1) };
    expect(stopsAxis(univ, close)).toEqual(close);
  });
  it("paradas juntas o dispersas no cambian nada", () => {
    const shapes = { ux: 1, uy: 0 };
    expect(stopsAxis([univ[0]!, univ[1]!], shapes)).toEqual(shapes);      // 36 m: muy corta
    const spread = [toWorld({ lat: 4.6, lon: -74.07 }), toWorld({ lat: 4.6003, lon: -74.0705 }), toWorld({ lat: 4.6006, lon: -74.07 })];
    expect(stopsAxis(spread, shapes)).toEqual(shapes);      // no es una fila
  });
});
