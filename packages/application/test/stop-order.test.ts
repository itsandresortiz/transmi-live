import { describe, expect, it } from "vitest";
import { STOP_ORDER_STRONG, StopOrderObserver, applyLearnedStopFixes, emptyStopOrderStats, learnStopFixes, mergeStopSteps, type StopSteps } from "@transmi/application";
import { TransitNetwork, type VehicleReport } from "@transmi/domain";

/** Troncal de prueba hacia el sur por la Caracas: paradas cada 1 km. El GTFS de la «H15» trae Calle 72 → Calle 53 → Av. 39, sin Calle 57
 *  (como pasó en la calle hasta que se corrigió a mano en `STOP_PATCHES`). */
const latAt = (km: number) => 4.66 - km / 111;
function net(stopIds = ["C72", "C53", "AV39"]): TransitNetwork {
  const n = new TransitNetwork();
  n.routes.set("H", { id: "H", shortName: "H15", longName: "x", system: "troncal" });
  for (const [id, km] of [["PRE", -1], ["C72", 0], ["C57", 1], ["C53", 2], ["AV39", 3], ["C26", 4]] as const) n.stops.set(id, { id, code: id, name: id, position: { lat: latAt(km), lon: -74.06 } });
  n.shapes.set("H", [{ routeId: "H", direction: "0", headsign: "Sur", points: [{ lat: latAt(-1), lon: -74.06 }, { lat: latAt(5), lon: -74.06 }], stopIds }]);
  return n;
}
const kmOf: Record<string, number> = { PRE: -1, C72: 0, C57: 1, C53: 2, AV39: 3, C26: 4 };
/** Lotes de `buses` buses que recorren `path` (un reporte por parada). */
function ride(o: StopOrderObserver, path: string[], buses: number, routeId = "H", t0 = 1000): void {
  path.forEach((stop, i) => o.observe(Array.from({ length: buses }, (_, b): VehicleReport => ({ id: `b${b}`, routeId, lastStopId: stop, reportedAt: t0 + i * 60, position: { lat: latAt(kmOf[stop]! + 0.05), lon: -74.06 } }))));
}
function days(n: number, path: string[], buses: number, network = net()) {
  let stats = emptyStopOrderStats();
  for (let d = 1; d <= n; d++) { const o = new StopOrderObserver(network); ride(o, path, buses); stats = mergeStopSteps(stats, o.steps, `2026-11-${String(10 + d)}`); }
  return stats;
}
const steps = (s: StopSteps, k: string) => s.get("H")?.get(k)?.size ?? 0;

describe("observar los pasos de parada a parada", () => {
  it("cuenta cada bus una vez por paso, desde la segunda parada que se le ve (la primera puede venir del viaje anterior)", () => {
    const o = new StopOrderObserver(net());
    ride(o, ["C72", "C57", "C53"], 3);
    expect(steps(o.steps, "C72>C57")).toBe(0);
    expect(steps(o.steps, "C57>C53")).toBe(3);
  });
  it("al cambiar de ruta vuelve a empezar (la parada que trae es la del viaje anterior)", () => {
    const o = new StopOrderObserver(net());
    ride(o, ["C72", "C57", "C53"], 2, "OTRA");
    ride(o, ["AV39", "C26"], 2, "H", 2000);
    expect(o.steps.get("H")).toBeUndefined();
  });
  it("no cuenta una parada informada lejos de donde va el bus", () => {
    const o = new StopOrderObserver(net());
    o.observe([{ id: "x", routeId: "H", lastStopId: "C72", reportedAt: 1, position: { lat: latAt(0), lon: -74.06 } }]);
    o.observe([{ id: "x", routeId: "H", lastStopId: "C57", reportedAt: 60, position: { lat: latAt(1), lon: -74.06 } }]);
    o.observe([{ id: "x", routeId: "H", lastStopId: "C26", reportedAt: 120, position: { lat: latAt(1.1), lon: -74.06 } }]);      // a 3 km de C26
    o.observe([{ id: "x", routeId: "H", lastStopId: "AV39", reportedAt: 180, position: { lat: latAt(3), lon: -74.06 } }]);
    expect(o.steps.get("H")?.has("C57>C26") ?? false).toBe(false);
    expect(o.steps.get("H")?.has("C26>AV39") ?? false).toBe(false);
  });
});

describe("aprender correcciones al recorrido", () => {
  const PATH = ["PRE", "C72", "C57", "C53", "AV39"];
  it("encuentra la parada que falta (Calle 57 en la H15) con muchos buses y varios días, y la pone en su sitio", () => {
    const fixes = learnStopFixes(days(3, PATH, 20), net());
    const add = fixes.find((f) => f.kind === "add");
    expect(add).toMatchObject({ kind: "add", route: "H15", stop: "C57", anchor: "C72", where: "after", next: "C53" });
    const shapes = [{ routeId: "H", stopIds: ["C72", "C53", "AV39"] }];
    expect(applyLearnedStopFixes(shapes, () => "H15", () => true, fixes)).toHaveLength(1);
    expect(shapes[0]!.stopIds).toEqual(["C72", "C57", "C53", "AV39"]);
    // aplicarla otra vez no cambia nada (ya está), igual que cuando TransMilenio corrija el GTFS
    expect(applyLearnedStopFixes(shapes, () => "H15", () => true, fixes)).toHaveLength(0);
  });
  it("con pocos días o pocos buses no propone nada", () => {
    expect(learnStopFixes(days(2, PATH, 30), net())).toHaveLength(0);
    expect(learnStopFixes(days(3, PATH, 10), net())).toHaveLength(0);
  });
  it("un desvío de unos pocos buses no es una parada nueva", () => {
    let stats = days(3, PATH, 20);
    const nets = net();
    for (let d = 1; d <= 3; d++) { const o = new StopOrderObserver(nets); ride(o, ["PRE", "C72", "C53", "AV39"], 60); stats = mergeStopSteps(stats, o.steps, `2026-11-${10 + d}`); }
    expect(learnStopFixes(stats, nets).filter((f) => f.kind === "add")).toHaveLength(0);
  });
  it("encuentra la parada antes de la primera (la ruta sale de un portal que el GTFS no trae)", () => {
    const n = net(["C57", "C53", "AV39"]);
    const fixes = learnStopFixes(days(3, ["PRE", "C72", "C57", "C53", "AV39"], 20, n), n);
    expect(fixes).toContainEqual(expect.objectContaining({ kind: "add", stop: "C72", anchor: "C57", where: "before" }));
  });
  it("encuentra la parada donde los buses no paran", () => {
    const n = net(["C72", "C57", "C53", "AV39", "C26"]);
    const fixes = learnStopFixes(days(3, ["PRE", "C72", "C53", "AV39", "C26"], 20, n), n);
    expect(fixes).toEqual([expect.objectContaining({ kind: "drop", stop: "C57", prev: "C72", next: "C53" })]);
  });
  it("encuentra dos paradas al revés", () => {
    const n = net(["C72", "C53", "C57", "AV39"]);
    const fixes = learnStopFixes(days(3, ["PRE", "C72", "C57", "C53", "AV39"], 20, n), n);
    expect(fixes).toContainEqual(expect.objectContaining({ kind: "swap", first: "C53", second: "C57" }));
    const shapes = [{ routeId: "H", stopIds: ["C72", "C53", "C57", "AV39"] }];
    applyLearnedStopFixes(shapes, () => "H15", () => true, fixes.filter((f) => f.kind === "swap"));
    expect(shapes[0]!.stopIds).toEqual(["C72", "C57", "C53", "AV39"]);
  });
  it("los umbrales por defecto piden evidencia fuerte", () => {
    expect(STOP_ORDER_STRONG.minDays).toBeGreaterThanOrEqual(3);
    expect(STOP_ORDER_STRONG.minBuses).toBeGreaterThanOrEqual(40);
  });
  it("olvida los pasos que nadie repite en un mes", () => {
    const o = new StopOrderObserver(net()); ride(o, PATH, 5);
    let s = mergeStopSteps(emptyStopOrderStats(), o.steps, "2026-10-01");
    s = mergeStopSteps(s, new Map(), "2026-11-20");
    expect(s.steps).toEqual({});
  });
});
