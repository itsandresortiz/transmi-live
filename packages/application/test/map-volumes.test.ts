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
    expect(body.properties.b).toBeCloseTo(0.3); expect(body.properties.h).toBeCloseTo(1.3);
    const e = extent([body.geometry.coordinates[0]!]);
    expect(e.ns).toBeCloseTo(BUS_DIMENSIONS.std, 1); expect(e.ew).toBeCloseTo(BUS_DIMENSIONS.width, 1);
    // hacia el este: el largo queda de este a oeste
    const east = busVolumes([{ id: "a", lon: -74.07, lat: 4.6, heading: 90, color: "#e11d2e" }]).features.find((f) => f.properties.c === "#e11d2e")!;
    const e2 = extent([east.geometry.coordinates[0]!]);
    expect(e2.ew).toBeCloseTo(BUS_DIMENSIONS.std, 1); expect(e2.ns).toBeCloseTo(BUS_DIMENSIONS.width, 1);
    // el parabrisas va adelante (al norte del centro)
    const glass = parts.filter((f) => f.properties.b > 1 && f.properties.b < 1.1).map((f) => f.geometry.coordinates[0]!.map((p) => p[1]!));
    expect(glass).toHaveLength(1);
    expect(Math.min(...glass[0]!)).toBeGreaterThan(4.6);
    expect(Math.max(...parts.map((f) => f.properties.h))).toBeLessThanOrEqual(3.4);
    // las ruedas asoman a los lados de la carrocería (si quedan metidas debajo no se ven)
    const wheels = parts.filter((f) => f.properties.b === 0);
    expect(wheels.length).toBe(4);
    expect(extent(wheels.map((w) => w.geometry.coordinates[0]!)).ew).toBeGreaterThan(BUS_DIMENSIONS.width + 0.15);
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
    // con tantos en pantalla van sin el detalle fino (ver BUS_3D_DETAIL_MAX): así es como se llama de verdad
    busVolumes(buses, { detail: false });
    const t0 = performance.now();
    for (let k = 0; k < 10; k++) busVolumes(buses, { detail: false });
    const ms = (performance.now() - t0) / 10;
    console.log(`busVolumes: 300 buses en ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(60);
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
  it("plataforma, vidrio translúcido, franja y borde del techo del color de la línea, cubierta gris", () => {
    // un vagón de ~30 × 9 m (alargado hacia el este)
    const kx = 111_320 * Math.cos((4.6 * Math.PI) / 180), ky = 110_540;
    const R = (x: number, y: number) => [-74.07 + x / kx, 4.6 + y / ky];
    const cap = { type: "Polygon" as const, coordinates: [[R(0, 0), R(30, 0), R(30, 9), R(0, 9), R(0, 0)]] };
    const fc = (props: Record<string, unknown>) => ({ type: "FeatureCollection" as const, features: [{ type: "Feature" as const, properties: props, geometry: cap }] });
    const out = stationVolumes({ bases: fc({ all: "a,b" }), capsules: fc({ ids: "a", l: "B" }), links: { type: "FeatureCollection", features: [] } }, (l) => (l === "B" ? "#00a650" : "#999999"));
    const ps = out.features.map((f) => f.properties);
    expect(ps.some((p) => p.b === 0)).toBe(false);                                    // sin la base ovalada
    expect(ps.find((p) => p.b === 0.25)).toMatchObject({ h: 0.9 });                   // plataforma
    expect(ps.filter((p) => p.g === 1).length).toBe(4);                                // vidrio en lados y puntas
    expect(ps.filter((p) => p.g === 1).every((p) => p.b === 0.9)).toBe(true);
    const green = ps.filter((p) => p.c === "#00a650");
    expect(green.some((p) => p.b > 2 && p.h < 4)).toBe(true);                          // franja a la altura de las puertas
    expect(green.some((p) => p.h > 5)).toBe(true);                                     // borde del techo
    expect(ps.some((p) => p.b === 5 && p.c !== "#00a650")).toBe(true);                 // cubierta gris
    expect(ps.filter((p) => p.b === 0.9 && p.h === 5 && !p.g).length).toBeGreaterThanOrEqual(8);      // postes
  });
  it("el pasillo entre vagones es un pasadizo gris sin techo ni vidrio", () => {
    const kx = 111_320 * Math.cos((4.6 * Math.PI) / 180), ky = 110_540;
    const R = (x: number, y: number) => [-74.07 + x / kx, 4.6 + y / ky];
    const link = { type: "Polygon" as const, coordinates: [[R(0, 0), R(20, 0), R(20, 4.5), R(0, 4.5), R(0, 0)]] };
    const out = stationVolumes({ bases: { type: "FeatureCollection", features: [] }, capsules: { type: "FeatureCollection", features: [] }, links: { type: "FeatureCollection", features: [{ type: "Feature", properties: { all: "a", l: "B" }, geometry: link }] } }, () => "#00a650");
    const ps = out.features.map((f) => f.properties);
    expect(ps.length).toBe(3);                                         // piso y dos barandas
    expect(ps.every((p) => p.h <= 2.1 && !p.g && p.c !== "#00a650")).toBe(true);
  });
});
