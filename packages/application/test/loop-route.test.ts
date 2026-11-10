import { describe, expect, it } from "vitest";
import { TransitState, shapeStops } from "@transmi/application";
import { RoadPath, TransitNetwork, toWorld, type VehicleReport } from "@transmi/domain";

/** Ruta de ida y vuelta por la misma calle (como los alimentadores): va 2 km al oriente y regresa por la otra calzada, 12 m al norte.
 *  Paradas de ida I0…I2 en la calzada sur y de vuelta V0…V2 en la calzada norte, casi enfrentadas. */
const M = 111_320 * Math.cos((4.65 * Math.PI) / 180), lon = (m: number) => -74.1 + m / M, lat = (m: number) => 4.65 + m / 110_540;
const points = [...Array.from({ length: 21 }, (_, i) => ({ lat: lat(0), lon: lon(i * 100) })), ...Array.from({ length: 21 }, (_, i) => ({ lat: lat(12), lon: lon(2000 - i * 100) }))];
const stops: [string, number, number][] = [["I0", 200, -4], ["I1", 1000, -4], ["I2", 1800, -4], ["V0", 1750, 16], ["V1", 950, 16], ["V2", 150, 16]];
function world(): TransitState {
  const st = new TransitState(), net = new TransitNetwork();
  net.routes.set("R", { id: "R", shortName: "1-1", longName: "Circular", system: "alimentador" });
  for (const [id, x, y] of stops) net.stops.set(id, { id, code: id, name: id, position: { lat: lat(y), lon: lon(x) } });
  net.shapes.set("R", [{ routeId: "R", direction: "0", headsign: "x", points, stopIds: stops.map((s) => s[0]) }]);
  st.setNetwork(net);
  return st;
}
const T = 1_000_000;
const rep = (id: string, x: number, y: number, lastStopId: string | undefined, at = T): VehicleReport => ({ id, routeId: "R", tripId: "T", lastStopId, reportedAt: at, position: { lat: lat(y), lon: lon(x) } });

describe("rutas de ida y vuelta por la misma calle", () => {
  it("las paradas se ubican en orden sobre el recorrido: las de vuelta quedan en la pasada de regreso, no encima de las de ida", () => {
    const st = world(), info = shapeStops(st, st.network.shapes.get("R")![0]!)!;
    expect(info.s.map((x) => Math.round(x / 50) * 50)).toEqual([200, 1000, 1800, 2250, 3050, 3850]);
  });

  it("la primera parada no se confunde con la pasada de regreso aunque esa quede más cerca", () => {
    const path = new RoadPath(points);
    // un punto a 8 m de la calzada norte (regreso) y a 4 m... de la sur: de cerca gana la primera pasada
    expect(Math.round(path.projectAfter(toWorld({ lat: lat(9), lon: lon(300) }), 0, 120)!.s)).toBe(300);
    // lo mismo, sabiendo que viene después de la mitad: es la pasada de regreso
    expect(Math.round(path.projectAfter(toWorld({ lat: lat(9), lon: lon(300) }), 2100, 120)!.s / 10) * 10).toBe(3710);
  });

  it("un bus que va de regreso se ubica en la pasada de regreso (su próxima parada es de las de vuelta)", () => {
    const st = world();
    st.applyPositions([rep("b", 1500, 11, "I0", T - 30)], (T - 30) * 1000);
    st.applyPositions([rep("b", 1300, 11, "I0")], T * 1000);          // avanza hacia el occidente: va de regreso
    const v = st.fleet.get("b")!;
    expect(st.nextStopOf(v, T * 1000)?.stopId).toBe("V1");
  });

  it("si el bus anda lejos de su recorrido, la parada informada no se cree: queda sin próxima parada en vez de anunciar una a kilómetros", () => {
    const st = world();
    st.applyPositions([rep("lejos", 1000, 5000, "I1")], T * 1000);    // 5 km al norte de su ruta
    const v = st.fleet.get("lejos")!;
    expect(v.lastStopId).toBeUndefined();
    expect(st.sequenceForDisplay(v)).toBeUndefined();
  });
});
