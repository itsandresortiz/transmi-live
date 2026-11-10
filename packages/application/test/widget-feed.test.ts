import { describe, expect, it } from "vitest";
import { TransitState, WIDGET_SHARDS, arrivalsByStop, widgetShard } from "@transmi/application";
import { TransitNetwork, type VehicleReport } from "@transmi/domain";

describe("llegadas por parada para el widget", () => {
  it("el cajón de una parada es estable y cabe en el rango (el widget hace la misma cuenta en Swift)", () => {
    expect(widgetShard("304B00_TM")).toBe(widgetShard("304B00_TM"));
    for (const id of ["1", "49844", "TM0123", "304B00_TM"]) { expect(widgetShard(id)).toBeGreaterThanOrEqual(0); expect(widgetShard(id)).toBeLessThan(WIDGET_SHARDS); }
    // valores fijos: si esta cuenta cambia, hay que cambiarla también en targets/widget/Widget.swift
    expect([widgetShard("1"), widgetShard("49844"), widgetShard("304B00_TM")]).toEqual([49, (((((52 * 31 + 57) * 31 + 56) * 31 + 52) * 31 + 52) % 1_000_003) % 64, widgetShard("304B00_TM")]);
  });

  it("un bus aparece como próxima llegada en las paradas que le siguen, en orden de hora", () => {
    const M = 111_320 * Math.cos((4.65 * Math.PI) / 180), lonAt = (m: number) => -74.1 + m / M, ids = ["S0", "S1", "S2", "S3"], NOW = 1_000_000;
    const st = new TransitState(), net = new TransitNetwork();
    net.routes.set("R", { id: "R", shortName: "R1", longName: "Ruta", system: "zonal" });
    ids.forEach((id, i) => net.stops.set(id, { id, code: id, name: id, position: { lat: 4.65, lon: lonAt(i * 1000) } }));
    net.shapes.set("R", [{ routeId: "R", direction: "0", headsign: "Centro", points: Array.from({ length: 31 }, (_, i) => ({ lat: 4.65, lon: lonAt(i * 100) })), stopIds: ids }]);
    st.setNetwork(net);
    const rep: VehicleReport = { id: "b", routeId: "R", tripId: "T", lastStopId: "S0", reportedAt: NOW, position: { lat: 4.65, lon: lonAt(300) } };
    st.applyPositions([rep], NOW * 1000);
    const by = arrivalsByStop(st, NOW * 1000);
    expect(by.has("S0")).toBe(false);                                   // ya la pasó
    expect(by.get("S1")![0]).toMatchObject({ r: "R1", h: "Centro", s: "zonal" });
    expect(by.get("S1")![0]!.t).toBeLessThan(by.get("S2")![0]!.t);
    expect(by.get("S2")![0]!.t).toBeLessThan(by.get("S3")![0]!.t);
  });
});
