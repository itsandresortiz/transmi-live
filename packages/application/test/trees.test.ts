import { describe, expect, it } from "vitest";
import type { Polygon } from "geojson";
import { clampBounds, decodeTreeCell, encodeTreeCell, greenKeep, hash01, mergeTrees, plantTrees, thinTrees, treeCellKey, treeCellsIn, treeShape, treeVolumes } from "../src/trees";

const M_LAT = 110_540, M_LON = 111_320 * Math.cos((4.65 * Math.PI) / 180);
/** Un cuadrado de `side` m con esquina suroeste en (lon, lat). */
function square(lon: number, lat: number, side: number): Polygon {
  const dx = side / M_LON, dy = side / M_LAT;
  return { type: "Polygon", coordinates: [[[lon, lat], [lon + dx, lat], [lon + dx, lat + dy], [lon, lat + dy], [lon, lat]]] };
}
const B = { west: -74.11, south: 4.64, east: -74.08, north: 4.67 };

describe("hash01", () => {
  it("es estable y se reparte en [0, 1)", () => {
    expect(hash01(5, 7, 1)).toBe(hash01(5, 7, 1));
    const xs = Array.from({ length: 2000 }, (_, i) => hash01(i, i * 3 + 1, 2));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0); expect(Math.max(...xs)).toBeLessThan(1);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.45); expect(mean).toBeLessThan(0.55);
  });
});

describe("parques grandes: menos árboles y en grupos; árboles de verdad aligerados", () => {
  it("un parque de 1 km² lleva muchos menos árboles por hectárea que uno de 1 ha", () => {
    const small = plantTrees({ areas: [{ geometry: square(-74.1, 4.65, 100), keep: 0.5 }], bounds: B });
    const big = plantTrees({ areas: [{ geometry: square(-74.1, 4.65, 1000), keep: 0.5 }], bounds: { west: -74.11, south: 4.64, east: -74.08, north: 4.67 } });
    const perHaSmall = small.length / 1, perHaBig = big.length / 100;
    expect(perHaBig).toBeLessThan(perHaSmall / 3);
    expect(big.length).toBeGreaterThan(200);
  });
  it("los árboles de verdad muy juntos se dibujan de a uno cada ~9 m", () => {
    const dense = Array.from({ length: 100 }, (_, i) => ({ lon: -74.1 + (i % 10) * 2.5e-5, lat: 4.65 + Math.floor(i / 10) * 2.5e-5 }));      // cada ~2,8 m
    const out = thinTrees(dense);
    expect(out.length).toBeLessThan(25);
    expect(out.length).toBeGreaterThan(4);
  });
});

describe("plantTrees", () => {
  const park = square(-74.1, 4.65, 200);          // 4 ha
  it("siembra con la densidad pedida, siempre en los mismos sitios y dentro del parque", () => {
    const a = plantTrees({ areas: [{ geometry: park, keep: 0.5 }], bounds: B });
    // 200 × 200 m a 10 m = 400 puntos; con 0,5 → ~200, y por ser de 4 ha (el doble del tamaño de densidad plena) × √½ → ~140, en grupos
    expect(a.length).toBeGreaterThan(90); expect(a.length).toBeLessThan(190);
    const b = plantTrees({ areas: [{ geometry: park, keep: 0.5 }], bounds: B });
    expect(b).toEqual(a);
    const ring = park.coordinates[0]!;
    for (const t of a) { expect(t.lon).toBeGreaterThanOrEqual(ring[0]![0]!); expect(t.lon).toBeLessThanOrEqual(ring[1]![0]!); }
    // los árboles no cambian si el recuadro de la pantalla se mueve (cuadrícula fija del mundo)
    const moved = plantTrees({ areas: [{ geometry: park, keep: 0.5 }], bounds: { ...B, west: -74.0995 } });
    const key = (t: { lon: number; lat: number }) => `${t.lon.toFixed(7)},${t.lat.toFixed(7)}`;
    const all = new Set(a.map(key));
    expect(moved.length).toBeGreaterThan(0);
    expect(moved.every((t) => all.has(key(t)))).toBe(true);
  });
  it("no pone árboles sobre senderos, canchas ni en los huecos del polígono", () => {
    const lat = 4.65 + 100 / M_LAT;
    const path = { type: "LineString" as const, coordinates: [[-74.101, lat], [-74.097, lat]] };
    const pitch = square(-74.1, 4.65, 60);
    const holed: Polygon = { type: "Polygon", coordinates: [park.coordinates[0]!, square(-74.1 + 140 / M_LON, 4.65 + 140 / M_LAT, 40).coordinates[0]!.slice().reverse()] };
    const t = plantTrees({ areas: [{ geometry: holed, keep: 1 }], avoidLines: [path], avoidAreas: [pitch], bounds: B, clear: 3 });
    expect(t.length).toBeGreaterThan(200);
    for (const p of t) {
      expect(Math.abs((p.lat - lat) * M_LAT)).toBeGreaterThanOrEqual(3);
      const x = (p.lon + 74.1) * M_LON, y = (p.lat - 4.65) * M_LAT;
      expect(x < 60 && y < 60).toBe(false);
      expect(x > 140 && x < 180 && y > 140 && y < 180).toBe(false);
    }
  });
  it("respeta el tope y se queda con los más cercanos al centro", () => {
    const c = { lon: -74.1 + 50 / M_LON, lat: 4.65 + 50 / M_LAT };
    const t = plantTrees({ areas: [{ geometry: park, keep: 1 }], bounds: B, max: 30, center: c });
    expect(t).toHaveLength(30);
    for (const p of t) expect(Math.hypot((p.lon - c.lon) * M_LON, (p.lat - c.lat) * M_LAT)).toBeLessThan(40);
  });
});

describe("celdas de árboles", () => {
  it("codifica y decodifica una celda sin perder más de unos centímetros", () => {
    const trees = [{ lon: -74.0934567, lat: 4.6581234, h: 12.3, crown: 8.1 }, { lon: -74.0911111, lat: 4.6599999 }];
    const key = treeCellKey(trees[0]!.lon, trees[0]!.lat);
    expect(key).toBe("-7410_465");
    expect(treeCellKey(trees[1]!.lon, trees[1]!.lat)).toBe(key);
    const back = decodeTreeCell(JSON.parse(JSON.stringify(encodeTreeCell(key, trees))));
    expect(back).toHaveLength(2);
    expect(Math.abs(back[0]!.lon - trees[0]!.lon) * M_LON).toBeLessThan(0.2);
    expect(back[0]!.h).toBeCloseTo(12.3); expect(back[0]!.crown).toBeCloseTo(8.1);
    expect(back[1]!.h).toBeUndefined(); expect(back[1]!.real).toBe(true);
    expect(decodeTreeCell({ v: 2 })).toEqual([]);
  });
  it("lista las celdas de la pantalla, la del centro primero", () => {
    const cells = treeCellsIn({ west: -74.105, south: 4.645, east: -74.085, north: 4.665 });
    expect(cells).toHaveLength(9);
    expect(cells[0]).toBe("-7410_465");
    expect(treeCellsIn({ west: -74.2, south: 4.5, east: -74.0, north: 4.7 }, 25)).toHaveLength(25);
  });
  it("junta árboles de verdad y sembrados sin repetir", () => {
    const real = [{ lon: -74.1, lat: 4.65, real: true }];
    const planted = [{ lon: -74.1 + 2 / M_LON, lat: 4.65 }, { lon: -74.1 + 30 / M_LON, lat: 4.65 }];
    expect(mergeTrees(real, planted)).toHaveLength(2);
  });
  it("recorta el recuadro a un radio alrededor del centro", () => {
    const b = clampBounds({ west: -75, south: 4, east: -73, north: 5 }, { lon: -74.1, lat: 4.65 }, 500);
    expect((b.east - b.west) * M_LON).toBeCloseTo(1000, -1);
  });
});

describe("forma y volúmenes", () => {
  it("copa de nube sobre el tronco, con tamaños según el dato", () => {
    const s = treeShape({ lon: -74.1, lat: 4.65 });
    expect(s.blobs.length).toBeGreaterThanOrEqual(4);
    expect(s.trunkH).toBeGreaterThan(1); expect(s.trunkH).toBeLessThan(s.blobs[0]!.z);
    const big = treeShape({ lon: -74.1, lat: 4.65, h: 18, crown: 12 });
    expect(big.blobs[0]!.r).toBeCloseTo(6); expect(big.blobs[0]!.z + big.blobs[0]!.r).toBeCloseTo(18, 0);
  });
  it("arma tronco café y rebanadas de copa (menos piezas sin detalle)", () => {
    const t = [{ lon: -74.1, lat: 4.65 }];
    const full = treeVolumes(t).features, lite = treeVolumes(t, { detail: false }).features;
    expect(lite).toHaveLength(4);
    expect(full.length).toBeGreaterThan(10);
    expect(full[0]!.properties.b).toBe(0);
    for (const f of full) { expect(f.properties.h).toBeGreaterThan(f.properties.b); expect(f.geometry.coordinates[0]!.length).toBeGreaterThan(6); }
    expect(treeVolumes(t, { dark: true }).features[1]!.properties.c).not.toBe(full[1]!.properties.c);
  });
  it("siembra más en bosques que en prados y nada en jardineras", () => {
    expect(greenKeep({ class: "wood", subclass: "forest" })!).toBeGreaterThan(greenKeep({ class: "grass", subclass: "park" })!);
    expect(greenKeep({ class: "grass", subclass: "park" })!).toBeGreaterThan(greenKeep({ class: "grass", subclass: "grass" })!);
    expect(greenKeep({ class: "grass", subclass: "flowerbed" })).toBeNull();
    expect(greenKeep({ class: "sand" })).toBeNull();
  });
});
