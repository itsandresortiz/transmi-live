import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeTreeCell } from "@transmi/application";
import { fromCensus, fromOsm, meters, writeCells } from "../tools/arboles";

/** Muestra con la forma de la respuesta de OpenStreetMap (Overpass) y del censo, para probar la herramienta sin red. */
const OSM = [
  { type: "node", id: 1, lat: 4.6581, lon: -74.0934, tags: { natural: "tree", height: "12 m", diameter_crown: "8" } },
  { type: "node", id: 2, lat: 4.6702, lon: -74.0521, tags: { natural: "tree", height: "alto" } },
  { type: "node", id: 3, lat: 4.6703, lon: -74.0522 },
];
const CSV = "OBJECTID;Latitud;Longitud;Altura_Total;Diametro_Copa\n1;4,65812;-74,09341;10,5;6\n2;4.6101;-74.0701;;\n3;x;y;1;1\n";

describe("tools/arboles", () => {
  it("lee alturas y copas de OpenStreetMap", () => {
    expect(meters("12 m")).toBe(12); expect(meters("350 cm")).toBe(3.5); expect(meters("alto")).toBeNull();
    const t = fromOsm(OSM);
    expect(t).toHaveLength(3);
    expect(t[0]).toMatchObject({ h: 12, crown: 8, real: true });
    expect(t[1]!.h).toBeUndefined();
  });
  it("lee el censo en CSV (con ; y comas decimales) y en GeoJSON", () => {
    const c = fromCensus(CSV);
    expect(c).toHaveLength(2);
    expect(c[0]).toMatchObject({ lat: 4.65812, lon: -74.09341, h: 10.5, crown: 6 });
    const g = fromCensus(JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [-74.1, 4.6] }, properties: { altura: 7 } }] }));
    expect(g).toEqual([{ lon: -74.1, lat: 4.6, real: true, h: 7 }]);
  });
  it("escribe una celda por zona y un índice con cuántos hay", () => {
    const dir = mkdtempSync(join(tmpdir(), "arboles-"));
    const { total, cells } = writeCells(dir, [...fromOsm(OSM), { lon: -80, lat: 0 }], ["prueba"]);
    expect(total).toBe(3); expect(cells).toBe(2);
    const files = readdirSync(dir).sort();
    expect(files).toEqual(["arb_-7406_467.json", "arb_-7410_465.json", "arboles-indice.json"]);
    const idx = JSON.parse(readFileSync(join(dir, "arboles-indice.json"), "utf8")) as { n: Record<string, number> };
    expect(idx.n).toEqual({ "-7410_465": 1, "-7406_467": 2 });
    const back = decodeTreeCell(JSON.parse(readFileSync(join(dir, "arb_-7410_465.json"), "utf8")));
    expect(back[0]!.h).toBe(12);
  });
});
