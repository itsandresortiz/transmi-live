import { describe, expect, it } from "vitest";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FeedDecodeError, decodeAlerts, decodePositions, decodeTripUpdates, sniffFeed } from "@transmi/infrastructure";

const load = (n: string) =>
  new Uint8Array(gunzipSync(readFileSync(fileURLToPath(new URL(`./fixtures/${n}.pb.gz`, import.meta.url)))));

describe("lectura de lotes reales de TransMilenio", () => {
  const positions = load("positions.a");
  it("reconoce el tipo de cada archivo", () => {
    expect(sniffFeed(positions)).toBe("positions");
    expect(sniffFeed(load("tripupdates"))).toBe("tripupdates");
    expect(sniffFeed(load("alerts"))).toBe("alerts");
  });
  it("lee miles de buses con posición dentro de Bogotá", () => {
    const list = decodePositions(positions);
    expect(list.length).toBeGreaterThan(5000);
    const inBogota = list.filter((v) => v.position.lat > 4.4 && v.position.lat < 4.9 && v.position.lon > -74.3 && v.position.lon < -73.9);
    expect(inBogota.length / list.length).toBeGreaterThan(0.99);
    const first = list[0]!;
    expect(first.id).toBeTruthy();
    expect(first.routeId).toMatch(/^\d+$/);
    expect(first.reportedAt).toBeGreaterThan(1_700_000_000);
  });
  it("todos los buses de un lote comparten la hora del lote", () => {
    const times = new Set(decodePositions(positions).map((v) => v.reportedAt));
    expect(times.size).toBe(1);
  });
  it("dos lotes seguidos traen avance de los buses", () => {
    const a = new Map(decodePositions(positions).map((v) => [v.id, v]));
    const b = decodePositions(load("positions.b"));
    expect(b[0]!.reportedAt).toBeGreaterThan([...a.values()][0]!.reportedAt);
    let moved = 0, both = 0;
    for (const v of b) {
      const p = a.get(v.id);
      if (!p) continue;
      both++;
      if (Math.abs(p.position.lat - v.position.lat) + Math.abs(p.position.lon - v.position.lon) > 3e-5) moved++;
    }
    expect(both).toBeGreaterThan(5000);
    expect(moved / both).toBeGreaterThan(0.3);
  });
  it("lee retrasos con signo (adelantados incluidos)", () => {
    const updates = decodeTripUpdates(load("tripupdates"));
    expect(updates.length).toBeGreaterThan(3000);
    const delays = updates.map((u) => u.delaySeconds).filter((d): d is number => d != null);
    expect(delays.some((d) => d < 0)).toBe(true);
    expect(delays.some((d) => d > 0)).toBe(true);
    expect(updates.find((u) => u.nextStop)?.nextStop?.stopId).toBeTruthy();
  });
  it("lee los avisos con sus rutas y paradas", () => {
    const alerts = decodeAlerts(load("alerts"));
    expect(alerts.length).toBeGreaterThan(100);
    expect(alerts.some((a) => a.routeIds.length > 0 && a.stopIds.length > 0)).toBe(true);
    expect(alerts.every((a) => typeof a.effect === "string")).toBe(true);
  });
  it("rechaza un lote cortado en lugar de leer datos falsos", () => {
    const cut = positions.subarray(0, Math.floor(positions.length * 0.45) + 3);
    expect(() => decodePositions(cut)).toThrow(FeedDecodeError);
  });
});
