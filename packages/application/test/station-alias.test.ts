import { describe, expect, it } from "vitest";
import { TransitState, searchStopGroups, trunkStations } from "@transmi/application";
import { TransitNetwork } from "@transmi/domain";

/** Una estación troncal con vagones «Calle 53 A - 2», y una parada nueva sin rutas con el nombre completo pegada a ella. */
function world(extraName = "Calle 53 - Universidad Manuela Beltrán", extraLat = 4.6379, extraCode = "") {
  const st = new TransitState(), net = new TransitNetwork();
  net.routes.set("R", { id: "R", shortName: "H15", longName: "Ruta", system: "troncal" });
  net.stops.set("a", { id: "a", code: "", name: "Calle 53 A - 2", position: { lat: 4.6375, lon: -74.0667 } });
  net.stops.set("b", { id: "b", code: "", name: "Calle 53 A - 4", position: { lat: 4.6380, lon: -74.0667 } });
  net.stops.set("x", { id: "x", code: extraCode, name: extraName, position: { lat: extraLat, lon: -74.06672 } });
  net.shapes.set("R", [{ routeId: "R", direction: "0", headsign: "x", points: [{ lat: 4.637, lon: -74.0667 }, { lat: 4.638, lon: -74.0667 }], stopIds: ["a", "b"] }]);
  st.setNetwork(net);
  return st;
}
describe("nombre nuevo de una estación", () => {
  it("la parada nueva sin rutas da su nombre a la estación y se encuentra al buscarla", () => {
    const st = world();
    expect(searchStopGroups(st, "manuela beltran").map((g) => g.title)).toEqual(["Calle 53 - Universidad Manuela Beltrán"]);
    expect(trunkStations(st).map((s) => s.title)).toEqual(["Calle 53 - Universidad Manuela Beltrán"]);
  });
  it("el nombre anterior (otra parada sin rutas en el mismo lugar) también encuentra la estación", () => {
    const st = world("Marly", 4.63752);
    expect(searchStopGroups(st, "marly").map((g) => g.title)).toEqual(["Calle 53"]);
  });
  it("una parada sin rutas que no empieza por el nombre de la estación no se mezcla", () => {
    const st = world("Br. Otra cosa cerca", 4.6379, "123A00_TM");
    expect(searchStopGroups(st, "otra cosa")).toEqual([]);
    expect(trunkStations(st)[0]!.title).toBe("Calle 53");
  });
  it("si queda lejos no se usa", () => {
    expect(searchStopGroups(world("Calle 53 - Universidad Manuela Beltrán", 4.6420), "manuela")).toEqual([]);
  });
});
