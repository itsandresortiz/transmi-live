import { describe, expect, it } from "vitest";
import {
  Fleet, Vehicle, classifyRoute, delayFromSeconds, delayLabel, describeAlert, distanceMeters,
  inferSystemFromReport, motionSeconds, predictPosition, routeTitle, toGeo, toWorld, type VehicleReport,
} from "@transmi/domain";

const report = (over: Partial<VehicleReport> = {}): VehicleReport => ({
  id: "bus1", routeId: "R1", position: { lat: 4.65, lon: -74.07 }, reportedAt: 1000, ...over,
});
/** Desplaza una posición `m` metros hacia el norte. */
const north = (p: { lat: number; lon: number }, m: number) => ({ lat: p.lat + m / 111_320, lon: p.lon });

describe("geo", () => {
  it("convierte ida y vuelta sin perder precisión", () => {
    const p = { lat: 4.6533, lon: -74.0836 };
    const q = toGeo(toWorld(p));
    expect(q.lat).toBeCloseTo(p.lat, 9);
    expect(q.lon).toBeCloseTo(p.lon, 9);
  });
  it("mide distancias en metros", () => {
    const a = toWorld({ lat: 4.65, lon: -74.07 });
    const b = toWorld(north({ lat: 4.65, lon: -74.07 }, 500));
    expect(distanceMeters(a, b)).toBeGreaterThan(495);
    expect(distanceMeters(a, b)).toBeLessThan(505);
  });
});

describe("retraso", () => {
  it("clasifica a tiempo, tarde y adelantado", () => {
    expect(delayFromSeconds(30).kind).toBe("onTime");
    expect(delayFromSeconds(5 * 60)).toMatchObject({ kind: "late", minutes: 5, severe: false });
    expect(delayFromSeconds(12 * 60).severe).toBe(true);
    expect(delayFromSeconds(-4 * 60)).toMatchObject({ kind: "early", minutes: 4 });
  });
  it("trata un dato de más de 2 horas como desconocido", () => {
    expect(delayFromSeconds(7201).kind).toBe("unknown");
    expect(delayFromSeconds(null).kind).toBe("unknown");
  });
  it("redacta la etiqueta para el usuario", () => {
    expect(delayLabel(delayFromSeconds(0))).toBe("A tiempo");
    expect(delayLabel(delayFromSeconds(300))).toBe("5 min tarde");
    expect(delayLabel(delayFromSeconds(-300))).toBe("5 min antes");
  });
});

describe("sistema de transporte", () => {
  it("clasifica rutas del GTFS", () => {
    expect(classifyRoute({ shortName: "6-4", longName: "Portal Suba" })).toBe("alimentador");
    expect(classifyRoute({ shortName: "B12", longName: "Calle 80" })).toBe("troncal");
    expect(classifyRoute({ shortName: "M81", longName: "Servicio dual" })).toBe("dual");
    expect(classifyRoute({ shortName: "ML82", longName: "X || Y", routeType: "3" })).toBe("zonal");
  });
  it("deduce el sistema desde el reporte cuando no hay GTFS", () => {
    expect(inferSystemFromReport({ tripId: "TTBD20874.10.12820" })).toBe("troncal");
    expect(inferSystemFromReport({ label: "Z70-4831" })).toBe("zonal");
    expect(inferSystemFromReport({ label: "E0008", tripId: "CE28C0036" })).toBe("otro");
  });
  it("da un título legible a las rutas", () => {
    const t = routeTitle({ id: "1", shortName: "ML82", longName: "M82 CLL134 KR 7 || L82 Portal 20 de Julio", system: "zonal" });
    expect(t).toBe("CLL134 KR 7  ⇄  Portal 20 de Julio");
    expect(routeTitle({ id: "13833", shortName: "13833", longName: "", system: "otro", provisional: true })).toBe("Ruta 13833");
  });
});

describe("bus y velocidad", () => {
  it("mide la velocidad con una base de al menos 28 s", () => {
    const v = new Vehicle(report({ reportedAt: 1000 }), 0);
    // 100 m en 20 s: la base es corta, todavía no hay velocidad
    v.apply(report({ reportedAt: 1020, position: north(v.position, 100) }), 1);
    expect(v.velocity).toBeNull();
    // 200 m en 40 s: base suficiente
    v.apply(report({ reportedAt: 1040, position: north(v.position, 100) }), 2);
    expect(v.velocity!.speedMps).toBeGreaterThan(4.8);
    expect(v.velocity!.speedMps).toBeLessThan(5.2);
    expect(v.bearing).toBeCloseTo(0, 0);
  });
  it("un bus quieto queda con velocidad cero", () => {
    const v = new Vehicle(report({ reportedAt: 1000 }), 0);
    v.apply(report({ reportedAt: 1030 }), 1);
    expect(v.velocity!.speedMps).toBe(0);
  });
  it("ignora un reporte repetido y reinicia ante un salto imposible", () => {
    const v = new Vehicle(report({ reportedAt: 1000 }), 0);
    expect(v.apply(report({ reportedAt: 1000 }), 1)).toBe(false);
    v.apply(report({ reportedAt: 1030, position: north(v.position, 5000) }), 2);
    expect(v.velocity).toBeNull();
  });
});

describe("flota", () => {
  it("conserva un bus ausente durante 90 s y luego lo retira", () => {
    const f = new Fleet();
    f.ingest([report({ id: "a" }), report({ id: "b" })], 0);
    f.ingest([report({ id: "a", reportedAt: 1020 })], 60_000);
    expect(f.size).toBe(2);
    f.ingest([report({ id: "a", reportedAt: 1040 })], 100_000);
    expect(f.size).toBe(1);
    expect(f.get("b")).toBeUndefined();
  });
  it("avisa de los buses nuevos", () => {
    const f = new Fleet();
    const nuevos: string[] = [];
    f.ingest([report({ id: "x" })], 0, (v) => nuevos.push(v.id));
    f.ingest([report({ id: "x", reportedAt: 1030 })], 1, (v) => nuevos.push(v.id));
    expect(nuevos).toEqual(["x"]);
  });
});

describe("predicción", () => {
  const moving = () => {
    const v = new Vehicle(report({ reportedAt: 1000 }), 0);
    v.apply(report({ reportedAt: 1030, position: north(v.position, 150) }), 1); // 5 m/s
    return v;
  };
  it("no inventa movimiento mientras el dato es fresco", () => {
    const v = moving();
    expect(predictPosition(v, 1030 + 10)).toEqual(v.world);
    expect(motionSeconds(10)).toBe(0);
  });
  it("avanza con la velocidad medida cuando el dato envejece", () => {
    const v = moving();
    const p = predictPosition(v, 1030 + 45); // 45 s de antigüedad -> 30 s de movimiento
    expect(distanceMeters(v.world, p)).toBeGreaterThan(145);
    expect(distanceMeters(v.world, p)).toBeLessThan(155);
  });
  it("se detiene en el tope de 75 s de movimiento", () => {
    const v = moving();
    const p = predictPosition(v, 1030 + 1000);
    expect(distanceMeters(v.world, p)).toBeLessThan(5 * 75 + 5);
  });
});

describe("avisos", () => {
  it("redacta la descripción para el usuario", () => {
    const text = describeAlert({
      id: 1, headline: "TM7 U DISTRI S1", effect: "detour", routeIds: [], stopIds: [],
      description: "Novedad en la operacion en linea HF615\\416A11_Br. Las Acacias\\064A09_Br. Villa del Río",
    });
    expect(text).toBe("Línea HF615: Br. Las Acacias → Br. Villa del Río");
  });
});
