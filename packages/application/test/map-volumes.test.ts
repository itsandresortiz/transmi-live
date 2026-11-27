import { describe, expect, it } from "vitest";
import { BUS_DIMENSIONS, busVolumes, mixHex, signalVolumes, stationVolumes } from "../src/map-volumes";

const M_LAT = 110_540, M_LON = 111_320 * Math.cos((4.6 * Math.PI) / 180);
/** Extensión de un conjunto de anillos en metros (este-oeste y norte-sur). */
function extent(rings: number[][][]) {
  const pts = rings.flat();
  const xs = pts.map((p) => p[0]! * M_LON), ys = pts.map((p) => p[1]! * M_LAT);
  return { ew: Math.max(...xs) - Math.min(...xs), ns: Math.max(...ys) - Math.min(...ys) };
}

describe("busVolumes", () => {
  it("arma un padrón de ~12 × 2,55 m orientado según el rumbo, con el color del sistema", () => {
    const parts = busVolumes([{ id: "a", lon: -74.07, lat: 4.6, heading: 0, color: "#e11d2e" }]).features;
    expect(parts.every((f) => f.properties.id === "a")).toBe(true);
    const body = parts.find((f) => f.properties.c === "#e11d2e")!;
    expect(body.properties.b).toBeCloseTo(0.35); expect(body.properties.h).toBeCloseTo(1.3);
    const e = extent([body.geometry.coordinates[0]!]);
    expect(e.ns).toBeCloseTo(BUS_DIMENSIONS.std, 1); expect(e.ew).toBeCloseTo(BUS_DIMENSIONS.width, 1);
    // hacia el este: el largo queda de este a oeste
    const east = busVolumes([{ id: "a", lon: -74.07, lat: 4.6, heading: 90, color: "#e11d2e" }]).features.find((f) => f.properties.c === "#e11d2e")!;
    const e2 = extent([east.geometry.coordinates[0]!]);
    expect(e2.ew).toBeCloseTo(BUS_DIMENSIONS.std, 1); expect(e2.ns).toBeCloseTo(BUS_DIMENSIONS.width, 1);
    // el parabrisas va adelante (al norte del centro)
    const glass = parts.filter((f) => f.properties.b > 0.9 && f.properties.b < 1).map((f) => f.geometry.coordinates[0]!.map((p) => p[1]!));
    expect(glass).toHaveLength(1);
    expect(Math.min(...glass[0]!)).toBeGreaterThan(4.6);
    expect(Math.max(...parts.map((f) => f.properties.h))).toBeLessThanOrEqual(3.4);
  });
  it("el articulado de la troncal mide ~18 m y lleva fuelle oscuro", () => {
    const fc = busVolumes([{ id: "t", lon: -74.07, lat: 4.6, heading: 0, color: "#e11d2e", long: true }]);
    const bodies = fc.features.filter((f) => f.properties.c === "#e11d2e");
    expect(bodies).toHaveLength(2);
    const e = extent(bodies.map((f) => f.geometry.coordinates[0]!));
    expect(e.ns).toBeCloseTo(BUS_DIMENSIONS.front + BUS_DIMENSIONS.gap + BUS_DIMENSIONS.rear, 1);
    expect(fc.features.some((f) => f.properties.c === "#1b1f27" && f.properties.b === 0.5)).toBe(true);
  });
  it("un bus con dato viejo se destiñe y uno sin posición no se dibuja", () => {
    const fc = busVolumes([{ id: "v", lon: -74.07, lat: 4.6, heading: null, color: "#e11d2e", stale: true }, { id: "x", lon: NaN, lat: 4.6, heading: 0, color: "#000000" }]);
    expect(fc.features.length).toBeGreaterThan(0);
    expect(fc.features.every((f) => f.properties.id === "v")).toBe(true);
    expect(fc.features.some((f) => f.properties.c === "#e11d2e")).toBe(false);
  });
  it("arma 300 buses rápido", () => {
    const buses = Array.from({ length: 300 }, (_, i) => ({ id: String(i), lon: -74.07 + i * 1e-4, lat: 4.6, heading: i, color: "#2563eb", long: i % 3 === 0 }));
    busVolumes(buses);
    const t0 = performance.now();
    for (let k = 0; k < 10; k++) busVolumes(buses);
    const ms = (performance.now() - t0) / 10;
    console.log(`busVolumes: 300 buses en ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(30);
  });
});

describe("signalVolumes y mixHex", () => {
  it("poste y caja sin color para el público; tapa de color solo si se pide", () => {
    const pub = signalVolumes([{ lon: -74.07, lat: 4.6 }]);
    expect(pub.features).toHaveLength(2);
    expect(Math.max(...pub.features.map((f) => f.properties.h))).toBeCloseTo(5.3);
    expect(pub.features.map((f) => f.properties.c)).toEqual(["#3a3f47", "#1e2127"]);
    expect(signalVolumes([{ lon: -74.07, lat: 4.6, color: "#2fbf71" }]).features.some((f) => f.properties.c === "#2fbf71")).toBe(true);
  });
  it("mezcla colores", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#fff", "#000000", 0)).toBe("#ffffff");
    expect(mixHex("rojo", "#000000", 0.5)).toBe("rojo");
  });
});

describe("stationVolumes", () => {
  it("plataforma, vidrio translúcido y techo del color de la línea", () => {
    const sq = { type: "Polygon" as const, coordinates: [[[-74.07, 4.6], [-74.0699, 4.6], [-74.0699, 4.6001], [-74.07, 4.6001], [-74.07, 4.6]]] };
    const fc = (props: Record<string, unknown>) => ({ type: "FeatureCollection" as const, features: [{ type: "Feature" as const, properties: props, geometry: sq }] });
    const out = stationVolumes({ bases: fc({ all: "a,b" }), capsules: fc({ ids: "a", l: "B" }), links: { type: "FeatureCollection", features: [] } }, (l) => (l === "B" ? "#00a650" : "#999999"));
    const by = (b: number) => out.features.find((f) => f.properties.b === b)!.properties;
    expect(by(0)).toMatchObject({ h: 0.25 });
    expect(by(0.25)).toMatchObject({ h: 0.9 });
    expect(by(0.9)).toMatchObject({ h: 5.1, g: 1 });
    expect(by(5.1)).toMatchObject({ c: "#00a650", h: 5.7 });
    expect(by(5.1).g).toBeUndefined();
  });
});

