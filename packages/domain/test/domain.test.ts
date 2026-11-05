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
    // el mismo número puede ser troncal o zonal: manda el color oficial del GTFS
    expect(classifyRoute({ shortName: "7", longName: "Portal suba", routeType: "3", routeColor: "ff0000" })).toBe("troncal");
    expect(classifyRoute({ shortName: "7", longName: "Consuelo || Palmitas", routeType: "3", routeColor: "0000ff" })).toBe("zonal");
    expect(classifyRoute({ shortName: "M86-K86", longName: "x", routeColor: "00ff00" })).toBe("dual");
    expect(classifyRoute({ shortName: "8-1", longName: "x", routeColor: "00ff00" })).toBe("alimentador");
    expect(classifyRoute({ shortName: "CABLE", longName: "Tunal", routeType: "6", routeColor: "e30613" })).toBe("otro");
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
  it("avanza desde el primer segundo, sin esperar", () => {
    const v = moving();
    const p = predictPosition(v, 1030 + 10);                  // 10 s de antigüedad
    expect(distanceMeters(v.world, p)).toBeGreaterThan(20);   // ≈ 5 m/s × 10 s × 0,5
    expect(distanceMeters(v.world, p)).toBeLessThan(30);
    expect(motionSeconds(0)).toBe(0);
  });
  it("avanza menos de lo que dice la velocidad medida (los buses frenan y esperan)", () => {
    const v = moving();
    const p = predictPosition(v, 1030 + 40);
    expect(distanceMeters(v.world, p)).toBeLessThan(5 * 40);
    expect(distanceMeters(v.world, p)).toBeGreaterThan(5 * 40 * 0.4);
  });
  it("se detiene en el tope de 90 s", () => {
    const v = moving();
    const p = predictPosition(v, 1030 + 1000);
    expect(distanceMeters(v.world, p)).toBeLessThan(5 * 90 + 5);
  });
});

describe("avisos", () => {
  it("redacta la descripción para el usuario", () => {
    const text = describeAlert({
      id: 1, headline: "TM7 U DISTRI S1", effect: "detour", routeIds: [], stopIds: [],
      description: "Novedad en la operacion en linea HF615\\416A11_Br. Las Acacias\\064A09_Br. Villa del Río",
    });
    expect(text).toBe("La ruta HF615 se desvía entre Br. Las Acacias y Br. Villa del Río.");
  });
});

import { RoadPath, lockToRoute } from "../src";
describe("RoadPath", () => {
  // una calle en «L»: 1 km al este y luego 1 km al norte
  const L = new RoadPath([{ lat: 4.65, lon: -74.1 }, { lat: 4.65, lon: -74.0910 }, { lat: 4.6590, lon: -74.0910 }]);
  it("avanza por la esquina y no en línea recta", () => {
    const start = L.pointAt(900), after = L.pointAt(1300);
    expect(after.y).toBeLessThan(start.y);            // sube (norte = y menor)
    expect(Math.abs(after.x - L.pointAt(1000).x)).toBeLessThan(1e-6);
  });
  it("encuentra el trazado cercano en el sentido del bus", () => {
    const p = L.pointAt(500);
    expect(lockToRoute([L], p, { ux: 1, uy: 0 })).not.toBeNull();
    expect(lockToRoute([L], p, { ux: -1, uy: 0 })).toBeNull();
    expect(lockToRoute([L], { x: p.x, y: p.y + 0.001 }, { ux: 1, uy: 0 })).toBeNull(); // muy lejos
  });
});

import { parseStopName, stopLabelText } from "../src";
describe("nombres de paradas de la troncal", () => {
  it("la letra es el vagón (A = 1, B = 2, C = 3…)", () => {
    expect(parseStopName("La Campiña A - 2")).toEqual({ title: "La Campiña", wagon: 1 });
    expect(parseStopName("Campiña C - 1 ó 5")).toEqual({ title: "Campiña", wagon: 3 });
    expect(parseStopName("Rionegro B - 4")).toEqual({ title: "Rionegro", wagon: 2 });
    expect(parseStopName("Toberín E - 1")).toEqual({ title: "Toberín", wagon: 5 });
    expect(parseStopName("Toberín A - 4 ó 6-nw")).toEqual({ title: "Toberín", wagon: 1 });
    expect(parseStopName("Danubio  A - 2 ó 5")).toEqual({ title: "Danubio", wagon: 1 });
    expect(parseStopName("Cra. 90 A - 2 ó 5")).toEqual({ title: "Cra. 90", wagon: 1 });
    expect(stopLabelText(parseStopName("Calle 187 B - 4 ó 6"))).toBe("Calle 187 · vagón 2");
  });
  it("reconoce las plataformas de los portales", () => {
    expect(parseStopName("Portal Norte T1")).toEqual({ title: "Portal Norte", platform: "T1" });
    expect(parseStopName("Portal 80 T-2")).toEqual({ title: "Portal 80", platform: "T2" });
    expect(parseStopName("PORTAL 20 DE JULIO T3")).toEqual({ title: "PORTAL 20 DE JULIO", platform: "T3" });
    expect(parseStopName("Portal Usme T4D")).toEqual({ title: "Portal Usme", platform: "T4D" });
    expect(parseStopName("Portal Tunal T6.")).toEqual({ title: "Portal Tunal", platform: "T6" });
    expect(parseStopName("Portal Américas T2 A")).toEqual({ title: "Portal Américas", platform: "T2A" });
    expect(parseStopName("Banderas T7")).toEqual({ title: "Banderas", platform: "T7" });
    expect(parseStopName("Patio Bonito B - 4 ó 6.")).toEqual({ title: "Patio Bonito", wagon: 2 });
  });
  it("deja intactas las paradas comunes y las zonales", () => {
    expect(parseStopName("Br. El Tunal")).toEqual({ title: "Br. El Tunal" });
    expect(parseStopName("Cra. 19 A - 2", false)).toEqual({ title: "Cra. 19 A - 2" });
    expect(parseStopName("AK 30 - CL 72")).toEqual({ title: "AK 30 - CL 72" });
  });
});

import { TRUNK_LINES, trunkLetterOf } from "../src";
describe("líneas de la troncal", () => {
  it("la letra de la ruta es su línea", () => {
    expect(trunkLetterOf("B10")).toBe("B");
    expect(trunkLetterOf("h17")).toBe("H");
    expect(trunkLetterOf("M86-K86")).toBe("M");
    expect(trunkLetterOf("7")).toBeNull();
    expect(trunkLetterOf("HB608")).toBeNull();
    expect(trunkLetterOf("6-5")).toBeNull();
    expect(Object.keys(TRUNK_LINES)).toHaveLength(15);
  });
});

import { alertTitle, alertValidity, describeAlert as describe2, isAlertActive } from "../src";
describe("avisos legibles y vigentes", () => {
  const base = { id: 1, headline: "", description: "", effect: "detour" as const, routeIds: [], stopIds: [] };
  it("traduce los códigos internos a un motivo", () => {
    expect(alertTitle({ ...base, headline: "EMCONTRAVIACR20ACONCL72A" })).toBe("Emergencia en la vía");
    expect(alertTitle({ ...base, headline: "PMTCIERRE1MAYOCONCRA11" })).toBe("Cierre de vía");
    expect(alertTitle({ ...base, headline: "EMCAMBIODESENTIDOVIALVLTA" })).toBe("Cambio de sentido vial");
    expect(alertTitle({ ...base, headline: "**TP-73 GAITAN FIJO**" })).toBe("Plan de tránsito");
    expect(alertTitle({ ...base, headline: "xyz" })).toBe("Novedad en el recorrido");
  });
  it("describe el desvío con palabras", () => {
    expect(describe2({ ...base, description: "Novedad en la operacion en linea T06\\313A00_Br. San Felipe\\678A00_Br. Colombia" })).toBe("La ruta T06 se desvía entre Br. San Felipe y Br. Colombia.");
  });
  it("solo muestra los vigentes", () => {
    const now = 1_800_000_000;
    expect(isAlertActive({ ...base, startsAt: now - 10, endsAt: now + 10 }, now)).toBe(true);
    expect(isAlertActive({ ...base, endsAt: now - 1 }, now)).toBe(false);
    expect(isAlertActive({ ...base, startsAt: now + 7200 }, now)).toBe(false);
    expect(isAlertActive(base, now)).toBe(true);
  });
  it("muestra el periodo en hora de Bogotá", () => {
    expect(alertValidity({ ...base, startsAt: Date.UTC(2026, 10, 5, 12) / 1000, endsAt: Date.UTC(2026, 10, 25, 12) / 1000 })).toMatch(/^Desde el 5 de nov.* · hasta el 25 de nov/);
  });
});
