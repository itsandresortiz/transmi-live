import { describe, expect, it } from "vitest";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TransitState, kpis, listVehicles, searchRoutes } from "@transmi/application";
import { decodeAlerts, decodePositions, decodeTripUpdates } from "@transmi/infrastructure";
import { distanceMeters, predictPosition } from "@transmi/domain";

const fx = (n: string) => new Uint8Array(gunzipSync(readFileSync(fileURLToPath(new URL(`../packages/infrastructure/test/fixtures/${n}.pb.gz`, import.meta.url)))));

describe("de los archivos reales al estado de la aplicación", () => {
  const state = new TransitState();
  const a = decodePositions(fx("positions.a")), b = decodePositions(fx("positions.b"));
  state.applyTripUpdates(decodeTripUpdates(fx("tripupdates")));
  state.applyAlerts(decodeAlerts(fx("alerts")));
  state.applyPositions(a, 1_000);
  // los dos lotes reales están a 20 s; se separan a 30 s para alcanzar la base mínima de velocidad (28 s)
  state.applyPositions(b.map((r) => ({ ...r, reportedAt: r.reportedAt + 10 })), 2_000);

  it("carga la flota completa y calcula las cifras", () => {
    const k = kpis(state);
    expect(k.vehicles).toBeGreaterThan(6000);
    expect(k.routes).toBeGreaterThan(500);
    expect(k.alerts).toBeGreaterThan(100);
    expect(k.late).toBeGreaterThan(0);
  });
  it("reparte los buses entre los sistemas", () => {
    const by: Record<string, number> = {};
    for (const v of state.fleet.values()) by[v.system] = (by[v.system] ?? 0) + 1;
    expect(by["zonal"]).toBeGreaterThan(3000);
    expect(by["troncal"]).toBeGreaterThan(300);
  });
  it("lista las rutas con más buses primero y encuentra un bus por placa", () => {
    const routes = searchRoutes(state);
    expect(routes.length).toBeGreaterThan(500);
    const plate = [...state.fleet.values()].find((v) => v.plate)!.plate!;
    expect(listVehicles(state, { query: plate.slice(0, 5) }).some((v) => v.plate === plate)).toBe(true);
  });
  it("la predicción mueve los buses que llevan velocidad, nunca al revés de su rumbo", () => {
    let checked = 0;
    for (const v of state.fleet.values()) {
      if (!v.velocity || v.velocity.speedMps < 1) continue;
      const p = predictPosition(v, v.reportedAt + 60);
      const d = distanceMeters(v.world, p);
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThanOrEqual(v.velocity.speedMps * 45 + 1);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
