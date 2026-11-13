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

import { spreadArrivals } from "@transmi/application";
describe("llegadas repartidas para el widget", () => {
  it("conserva las más próximas y luego una cada cierto tiempo, para que duren hasta el siguiente refresco", () => {
    const every30s = Array.from({ length: 100 }, (_, i) => ({ t: 1000 + i * 30 }));      // parada con mucho movimiento: un bus cada 30 s
    const kept = spreadArrivals(every30s);
    expect(kept.slice(0, 4).map((a) => a.t)).toEqual([1000, 1030, 1060, 1090]);          // las 4 más próximas, tal cual
    expect(kept.length).toBe(16);
    expect(kept[kept.length - 1]!.t - 1000).toBeGreaterThan(25 * 60);                    // cubre más de 25 min (antes: 8 buses = 3,5 min)
    expect(spreadArrivals([{ t: 5 }, { t: 9000 }])).toHaveLength(2);                     // con pocos buses no quita ninguno
  });
});
