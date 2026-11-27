import { describe, expect, it } from "vitest";
import {
  TransitState, directionBuses, directionOfBus, isRouteSaved, pickDirection, routeDirections, savedRouteFamilies, toggleSavedRoute,
} from "@transmi/application";
import { TransitNetwork, type GeoPoint } from "@transmi/domain";

const p = (lat: number): GeoPoint => ({ lat, lon: -74.07 });
/** El 7 troncal publicado con un código por sentido (sin destino: el GTFS de la troncal no lo trae), el 7 zonal aparte
 *  y el 18-3 con los dos sentidos en un solo código (con destino) y una variante corta hacia el mismo sitio. */
function state(): TransitState {
  const st = new TransitState(), net = new TransitNetwork();
  net.routes.set("14047", { id: "14047", shortName: "7", longName: "Polo", system: "troncal" });
  net.routes.set("14048", { id: "14048", shortName: "7", longName: "Portal Suba", system: "troncal" });
  net.routes.set("13906", { id: "13906", shortName: "7", longName: "zonal", system: "zonal" });
  net.routes.set("500", { id: "500", shortName: "18-3", longName: "Suba - Centro", system: "zonal" });
  net.stops.set("PS", { id: "PS", code: "PS", name: "Portal Suba T1", position: p(4.74) });
  net.stops.set("M", { id: "M", code: "M", name: "Mitad", position: p(4.70) });
  net.stops.set("PO", { id: "PO", code: "PO", name: "Polo B - 2", position: p(4.66) });
  net.shapes.set("14047", [{ routeId: "14047", direction: "0", headsign: "", points: [p(4.74), p(4.70), p(4.66)], stopIds: ["PS", "M", "PO"] }]);
  net.shapes.set("14048", [{ routeId: "14048", direction: "0", headsign: "", points: [p(4.66), p(4.70), p(4.74)], stopIds: ["PO", "M", "PS"] }]);
  net.shapes.set("500", [
    { routeId: "500", direction: "0", headsign: "Centro", points: [p(4.74), p(4.66)], stopIds: ["PS", "M", "PO"] },
    { routeId: "500", direction: "1", headsign: "Suba", points: [p(4.66), p(4.74)], stopIds: ["PO", "M", "PS"] },
    { routeId: "500", direction: "2", headsign: "Centro ", points: [p(4.70), p(4.66)], stopIds: ["M", "PO"] },
  ]);
  st.setNetwork(net);
  return st;
}

describe("una ficha por ruta con sus sentidos", () => {
  it("junta los dos códigos del 7 troncal y nombra cada sentido por su última parada (sin vagón)", () => {
    const st = state();
    const a = routeDirections(st, "14047"), b = routeDirections(st, "14048");
    expect(a.map((d) => d.label)).toEqual(["Hacia Polo", "Hacia Portal Suba"]);
    expect(b.map((d) => d.key)).toEqual(a.map((d) => d.key));          // el orden no depende del código con que se abrió
    expect(a.map((d) => d.routeId)).toEqual(["14047", "14048"]);
    expect(routeDirections(st, "13906")).toHaveLength(0);               // el 7 zonal es otra ruta (y aquí no tiene recorrido)
  });
  it("usa el destino publicado y junta la variante corta con su sentido (se muestra el recorrido más largo)", () => {
    const d = routeDirections(state(), "500");
    expect(d.map((x) => x.label)).toEqual(["Hacia Centro", "Hacia Suba"]);
    expect(d[0]!.shapes).toHaveLength(2);
    expect(d[0]!.shape.stopIds).toEqual(["PS", "M", "PO"]);
  });
  it("elige primero el sentido pedido (desde una parada o un enlace), si no el del código, si no el primero", () => {
    const st = state(), d = routeDirections(st, "14047");
    expect(pickDirection(d, { routeId: "14048" })?.label).toBe("Hacia Portal Suba");
    expect(pickDirection(d, { key: "14047:0", routeId: "14048" })?.label).toBe("Hacia Polo");
    expect(pickDirection(d, { routeId: "zzz" })?.label).toBe("Hacia Polo");
    const e = routeDirections(st, "500");
    expect(pickDirection(e, { routeId: "500", direction: "1" })?.label).toBe("Hacia Suba");
    expect(pickDirection(e, { routeId: "500", direction: "2" })?.label).toBe("Hacia Centro");     // la variante corta cae en su sentido
  });
  it("cada bus de la familia sale en su sentido, con la próxima parada", () => {
    const st = state();
    st.applyPositions([
      { id: "a", routeId: "14047", lastStopId: "PS", position: p(4.73), reportedAt: 1000 },
      { id: "b", routeId: "14048", lastStopId: "PO", position: p(4.67), reportedAt: 1000 },
    ], 1_000_000);
    const d = routeDirections(st, "14048");
    const [polo, suba] = d;
    expect(directionBuses(st, polo!, 1_000_000).map((x) => [x.vehicle.id, x.nextStopId])).toEqual([["a", "M"]]);
    expect(directionBuses(st, suba!, 1_000_000).map((x) => [x.vehicle.id, x.nextStopId])).toEqual([["b", "M"]]);
    expect(directionOfBus(st, d, st.fleet.get("b")!)?.label).toBe("Hacia Portal Suba");
  });
});


describe("favoritos: una ruta guardada vale para sus dos sentidos", () => {
  it("un favorito viejo de un sentido marca la ruta como guardada en los dos", () => {
    const st = state();
    expect(isRouteSaved(st, ["14048"], "14047")).toBe(true);
    expect(isRouteSaved(st, ["14048"], "13906")).toBe(false);           // el zonal es otra ruta
  });
  it("quitar la ruta borra todos sus códigos; guardarla guarda uno", () => {
    const st = state();
    expect(toggleSavedRoute(st, ["14047", "500", "14048"], "14048")).toEqual(["500"]);
    expect(toggleSavedRoute(st, ["500"], "14048")).toEqual(["14048", "500"]);
  });
  it("si quedaron guardados los dos sentidos, la ruta sale una sola vez; sin red no se pierde nada", () => {
    expect(savedRouteFamilies(state(), ["14047", "500", "14048", "13906"])).toEqual(["14047", "500", "13906"]);
    expect(savedRouteFamilies(new TransitState(), ["14047", "14048"])).toEqual(["14047", "14048"]);
  });
});
