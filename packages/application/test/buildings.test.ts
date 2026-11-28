import { describe, expect, it } from "vitest";
import { buildingCellKey, buildingHeights, buildingVolumes, decodeBuildingCell, encodeBuildingCell } from "../src/buildings";

describe("edificios de Catastro", () => {
  it("base y techo a partir de pisos, piso de arranque y último piso", () => {
    expect(buildingHeights({ ConNPisos: 1, ConAltura: 0, ConElevaci: 1 })).toEqual({ b: 0, h: 3 });
    expect(buildingHeights({ ConNPisos: 5, ConAltura: 0, ConElevaci: 5 })).toEqual({ b: 0, h: 15 });
    expect(buildingHeights({ ConNPisos: 2, ConAltura: 1, ConElevaci: 2 })).toEqual({ b: 3, h: 6 });      // pieza sobre el primer piso
    expect(buildingHeights({ ConNPisos: 0, ConAltura: -1, ConElevaci: 1 })).toEqual({ b: 0, h: 3 });     // con sótano: se ve lo de arriba
    expect(buildingHeights({ ConNPisos: 3, ConAltura: 0, ConElevaci: 0 })).toEqual({ b: 0, h: 9 });      // sin último piso: por los pisos
    expect(buildingHeights({ ConNPisos: 200, ConAltura: 0, ConElevaci: 200 })).toBeNull();
  });
  it("una celda se codifica y decodifica sin perder más de unos centímetros", () => {
    const ring: [number, number][] = [[-74.063365, 4.658293], [-74.063359, 4.658292], [-74.063365, 4.658259], [-74.063371, 4.65826]];
    const key = buildingCellKey(ring[0]![0], ring[0]![1]);
    const back = decodeBuildingCell(JSON.parse(JSON.stringify(encodeBuildingCell(key, [{ ring, b: 3, h: 15 }]))));
    expect(back).toHaveLength(1);
    expect(back[0]!.b).toBe(3); expect(back[0]!.h).toBe(15);
    for (let i = 0; i < ring.length; i++) { expect(back[0]!.ring[i]![0]).toBeCloseTo(ring[i]![0], 6); expect(back[0]!.ring[i]![1]).toBeCloseTo(ring[i]![1], 6); }
    expect(decodeBuildingCell({ v: 2 })).toEqual([]);
  });
  it("volúmenes cerrados, con tope y los más cercanos primero", () => {
    const sq = (x: number): [number, number][] => [[x, 4.6], [x + 0.0001, 4.6], [x + 0.0001, 4.6001], [x, 4.6001]];
    const list = [0, 1, 2, 3].map((i) => ({ ring: sq(-74.07 + i * 0.001), b: 0, h: 3 * (i + 1) }));
    const fc = buildingVolumes(list, { center: { lon: -74.07, lat: 4.6 }, max: 2 });
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0]!.properties.h).toBe(3);
    const r = fc.features[0]!.geometry.coordinates[0]!;
    expect(r[0]).toEqual(r[r.length - 1]);
  });
});
