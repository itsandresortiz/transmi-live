import { describe, expect, it } from "vitest";
import { TransitState, nearestStops } from "@transmi/application";
import { TransitNetwork } from "@transmi/domain";

/** El GTFS trae, en medio de cada estación o portal, un registro «de la estación» sin código ni rutas (p. ej. «Portal Suba» dentro del portal).
 *  No es un lugar donde pare un bus: no debe ofrecerse como parada cercana. */
describe("registros de estación sin rutas", () => {
  const st = new TransitState(), net = new TransitNetwork();
  net.routes.set("R", { id: "R", shortName: "T55", longName: "x", system: "zonal" });
  net.stops.set("3000", { id: "3000", code: "", name: "Portal Suba", position: { lat: 4.74699, lon: -74.09425 } });                 // adentro, sin rutas
  net.stops.set("55063", { id: "55063", code: "586A03_TM", name: "Portal Suba", position: { lat: 4.74788, lon: -74.09536 } });      // el paradero de afuera
  net.stops.set("55060", { id: "55060", code: "579A03_TM", name: "C.C. Plaza Imperial", position: { lat: 4.74806, lon: -74.09554 } });
  net.shapes.set("R", [{ routeId: "R", direction: "0", headsign: "x", points: [{ lat: 4.74788, lon: -74.09536 }, { lat: 4.74806, lon: -74.09554 }], stopIds: ["55063", "55060"] }]);
  st.setNetwork(net);

  it("«cerca de mí» ofrece el paradero real y no el registro de adentro, aunque ese quede más cerca", () => {
    const near = nearestStops(st, { lat: 4.747, lon: -74.0943 }, 6, 1200).map((n) => n.stop.id);
    expect(near).toContain("55063");
    expect(near).not.toContain("3000");
  });
});
