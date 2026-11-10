import { describe, expect, it } from "vitest";
import { applyStopPatches, type StopPatch } from "../src/gtfs/patches";
import type { NetworkDto } from "../src/gtfs/parse";

const patch: StopPatch = { why: "prueba", route: "H15", anchor: "B", add: "X", where: "before" };
const dto = (stopIds: string[], stops = ["A", "B", "C", "X"]): NetworkDto => ({
  routes: [{ id: "1", shortName: "H15", longName: "", description: "", routeType: "", agencyId: "", color: "" }, { id: "2", shortName: "H20", longName: "", description: "", routeType: "", agencyId: "", color: "" }],
  stops: stops.map((id) => ({ id, code: "", name: id, lat: 4.6, lon: -74 })), headsigns: {},
  shapes: [{ routeId: "1", direction: "0", headsign: "", pts: [], stopIds }, { routeId: "2", direction: "0", headsign: "", pts: [], stopIds: [...stopIds] }],
});

describe("correcciones al GTFS", () => {
  it("agrega la parada que falta solo en la ruta indicada", () => {
    const d = dto(["A", "B", "C"]);
    applyStopPatches(d, [patch]);
    expect(d.shapes[0]!.stopIds).toEqual(["A", "X", "B", "C"]);
    expect(d.shapes[1]!.stopIds).toEqual(["A", "B", "C"]);      // la H20 no se toca
  });
  it("no hace nada si TransMilenio ya la trae, si falta la referencia o si la parada no existe", () => {
    const a = dto(["A", "X", "B"]); applyStopPatches(a, [patch]); expect(a.shapes[0]!.stopIds).toEqual(["A", "X", "B"]);
    const b = dto(["A", "C"]); applyStopPatches(b, [patch]); expect(b.shapes[0]!.stopIds).toEqual(["A", "C"]);
    const c = dto(["A", "B"], ["A", "B"]); applyStopPatches(c, [patch]); expect(c.shapes[0]!.stopIds).toEqual(["A", "B"]);
  });
  it("dos aplicaciones seguidas dan lo mismo que una", () => {
    const d = dto(["A", "B"]); applyStopPatches(d, [patch]); applyStopPatches(d, [patch]);
    expect(d.shapes[0]!.stopIds).toEqual(["A", "X", "B"]);
  });
});
