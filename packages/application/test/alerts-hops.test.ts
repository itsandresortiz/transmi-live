import { describe, expect, it } from "vitest";
import { TransitNetwork, type ServiceAlert, type VehicleReport } from "@transmi/domain";
import { HopProfile, TransitState, alertRouteName, alertView, buildHopProfile, hopTag, rawArrival, searchAlerts } from "../src";

const LAT0 = 4.70, LON = -74.08, M = 1 / 111_000;
const at = (m: number) => ({ lat: LAT0 + m * M, lon: LON });
function world() {
  const net = new TransitNetwork();
  net.routes.set("14000", { id: "14000", shortName: "539", longName: "Soches", system: "zonal" });
  net.routes.set("14001", { id: "14001", shortName: "K308", longName: "", system: "zonal" });
  net.routes.set("14002", { id: "14002", shortName: "K311", longName: "", system: "zonal" });
  ["A", "B", "C", "D", "E"].forEach((id, i) => net.stops.set(id, { id, code: id, name: `Br. ${id}`, position: at(i * 1000) }));
  net.shapes.set("14000", [{ routeId: "14000", direction: "0", headsign: "", points: [at(0), at(4000)], stopIds: ["A", "B", "C", "D", "E"] }]);
  net.shapes.set("14001", [{ routeId: "14001", direction: "0", headsign: "", points: [at(0), at(4000)], stopIds: ["C", "D", "E"] }]);
  net.shapes.set("14002", [{ routeId: "14002", direction: "0", headsign: "", points: [at(0), at(4000)], stopIds: ["C", "D"] }]);
  const s = new TransitState(); s.setNetwork(net); return s;
}
const alert = (code: string, stopIds: string[], extra: Partial<ServiceAlert> = {}): ServiceAlert => ({
  id: 1, headline: "TM01", description: `Novedad en la operacion en linea ${code}\\001A01_TM_${stopIds[0]}\\002A01_TM_${stopIds[1]}`, effect: "detour",
  routeIds: [code], stopIds, startsAt: Date.now() / 1000 - 60, endsAt: Date.now() / 1000 - 58, ...extra,
});

describe("avisos que se entienden", () => {
  it("deduce la ruta por sus paradas cuando el número no existe en el GTFS", () => {
    const s = world(), a = alert("10194", ["A", "B"]);
    s.applyAlerts([a]);
    expect(alertRouteName(s, "10194", a)).toBe("539");
    expect(alertView(s, a).title).toBe("Desvío de la ruta 539");
    expect(alertView(s, a).body).toContain("entre Br. A y Br. B");
    expect(s.alertsByRoute.get("14000")).toEqual([0]);      // y aparece en la ficha de la ruta
  });
  it("si varias rutas pasan por ahí no adivina: las nombra como posibles", () => {
    const s = world(), a = alert("10331", ["C", "D"]);
    s.applyAlerts([a]);
    const v = alertView(s, a);
    expect(v.title).toBe("Desvío de una de estas rutas: 539, K308 o K311");
    expect(v.body).toContain("no dice cuál");
  });
  it("cruza los avisos del mismo número para quedarse con una ruta", () => {
    const s = world(), a = alert("10331", ["C", "D"]), b = alert("10331", ["D", "E"], { id: 2 });
    s.applyAlerts([a, b]);
    expect(alertView(s, a).title).toBe("Desvío de una de estas rutas: 539 o K308");
  });
  it("sin certeza no muestra el número interno", () => {
    const s = world(), a = alert("10999", ["E", "A"]);
    s.applyAlerts([a]);
    expect(alertView(s, a).title).toBe("Desvío de una ruta zonal");
    expect(alertView(s, a).body).not.toContain("10999");
  });
  it("el mismo aviso repetido se muestra una vez", () => {
    const s = world();
    s.applyAlerts([alert("10194", ["A", "B"]), alert("10194", ["B", "A"], { id: 2 })]);
    expect(searchAlerts(s)).toHaveLength(1);
  });
  it("los anuncios que trae la red van primero y con su propio texto", () => {
    const s = world();
    s.network.notices = [{ id: -1, headline: "Cierre", description: "", effect: "modified", title: "Vagón cerrado", text: "Texto claro.", routeIds: ["14001"], stopIds: ["C"] }];
    s.applyAlerts([alert("10194", ["A", "B"])]);
    const l = searchAlerts(s);
    expect(alertView(s, l[0]!.alert)).toMatchObject({ tag: "Anuncio de TransMilenio", title: "Vagón cerrado", body: "Texto claro." });
    expect(s.alertsByStop.get("C")).toBeDefined();
  });
});

describe("tiempos reales por tramo", () => {
  const NOW = Date.parse("2026-11-17T08:00:00-05:00");        // martes, pico de la mañana
  it("la franja y el tipo de día salen en hora de Bogotá", () => {
    expect(hopTag(NOW)).toEqual({ day: "wk", bucket: 1 });
    expect(hopTag(Date.parse("2026-11-15T23:30:00-05:00"))).toEqual({ day: "su", bucket: 4 });
  });
  it("arma el perfil y descarta tramos que ya no existen", () => {
    const p = buildHopProfile({ "14000|0|1|wk|1": { n: 10, sum: 1200 }, "14000|0|9|wk|1": { n: 5, sum: 100 } }, (k) => (k === "14000|0" ? 5 : undefined), "x");
    expect(p.r["14000|0"]!["wk|1"]).toEqual([0, 0, 120, 10, 0, 0, 0, 0]);
    expect(buildHopProfile({ "14000|0|1|wk|1": { n: 2, sum: 240 } }, () => 5, "x").r).toEqual({});      // muy pocas pasadas: no se publica
  });
  it("mezcla lo aprendido con el valor fijo según cuántas pasadas tiene", () => {
    const h = new HopProfile();
    h.load({ v: 1, updated: "", r: { "R|0": { "wk|1": [0, 0, 120, 3, 200, 30] } } });
    const shape = { routeId: "R", direction: "0", headsign: "", points: [], stopIds: ["a", "b", "c", "d"] };
    expect(h.seconds(shape, 0, NOW, 60)).toBe(60);                          // sin datos: el fijo
    expect(h.seconds(shape, 1, NOW, 60)).toBe(90);                          // 3 pasadas: mitad y mitad
    expect(h.seconds(shape, 2, NOW, 60)).toBeCloseTo((30 * 200 + 3 * 60) / 33);
    expect(h.seconds(shape, 1, Date.parse("2026-11-21T08:00:00-05:00"), 60)).toBe(90);   // sábado sin datos propios: los de entre semana
    h.apply = false;
    expect(h.seconds(shape, 2, NOW, 60)).toBe(60);
  });
  it("el cálculo de llegada usa el tramo lento", () => {
    const s = world();
    const r: VehicleReport = { id: "bus", routeId: "14000", reportedAt: NOW / 1000, position: at(0), lastStopId: "A" };
    s.applyPositions([r], NOW);
    const v = s.fleet.get("bus")!, shape = s.network.shapes.get("14000")![0]!;
    const before = rawArrival(s, v, shape, 0, 2, NOW).eta;
    s.hopProfile.load({ v: 1, updated: "", r: { "14000|0": { "wk|1": [600, 100, 600, 100, 0, 0, 0, 0] } } });
    expect(rawArrival(s, v, shape, 0, 2, NOW).eta).toBeGreaterThan(before + 600);
  });
});

describe("avisos en la ruta", () => {
  it("lista los avisos de la ruta (sus dos sentidos) y el tramo que tocan", async () => {
    const { routeAlertViews, routeHasAlert, alertStretch, alertUntil } = await import("../src");
    const s = world(), a = alert("10194", ["B", "D"]);
    s.applyAlerts([a]);
    expect(routeHasAlert(s, "14000")).toBe(true);
    expect(routeHasAlert(s, "14001")).toBe(false);
    const l = routeAlertViews(s, "14000");
    expect(l).toHaveLength(1);
    expect(l[0]!.view.untilText).toMatch(/^hasta las /);
    expect(alertUntil(a)).toBe(a.endsAt! + 6 * 3600);
    const pts = alertStretch(s, a, s.network.shapes.get("14000")![0]!)!;
    expect(Math.round((pts[0]!.lat - 4.70) * 111_000)).toBe(1000);
    expect(Math.round((pts[pts.length - 1]!.lat - 4.70) * 111_000)).toBe(3000);
    expect(alertStretch(s, alert("10194", ["B"]), s.network.shapes.get("14000")![0]!)).toBeNull();
  });
});

describe("horario de la ruta: qué día es «hoy»", () => {
  it("de madrugada tras un festivo, cuando ya terminó el servicio de ayer, «hoy» es el día nuevo", async () => {
    const { ServiceEnds } = await import("../src");
    const s = new ServiceEnds();
    s.load({ v: 1, dates: { "20261116": "su" }, routes: { R: {
      wk: { first: ["a", 4 * 3600], last: ["b", 23 * 3600] },
      su: { first: ["c", 4 * 3600], last: ["d", 23.5 * 3600] },
    } } });
    const at = (iso: string) => Date.parse(`${iso}-05:00`);
    expect(s.scheduleOf("R", at("2026-11-16T22:00:00"))!.today).toBe("su");        // lunes festivo, de noche
    expect(s.scheduleOf("R", at("2026-11-17T00:30:00"))!.today).toBe("su");        // el último bus de ayer aún va en camino
    expect(s.scheduleOf("R", at("2026-11-17T01:50:00"))!.today).toBe("wk");        // ya terminó: es martes
    expect(s.scheduleOf("R", at("2026-11-17T08:00:00"))!.today).toBe("wk");
  });
});

describe("último bus que se acerca", () => {
  it("dice el último bus de tus rutas en la parada solo en la última hora, según el horario", async () => {
    const { lastBusSoon } = await import("../src");
    const s = world();
    // 539 pasa por B a +600 s de su salida; última salida entre semana 22:00 → por B a las 22:10
    s.setDepartures({ v: 1, routes: { "14000": { "0": { stops: ["A", "B", "C", "D", "E"], off: [0, 600, 1200, 1800, 2400], wk: [5 * 3600, 17 * 3600] } } } });      // salidas en diferencias: 5:00 y 22:00
    s.setServiceEnds({ v: 1, routes: {} });
    const at = (iso: string) => Date.parse(`${iso}-05:00`);
    expect(lastBusSoon(s, "B", [], at("2026-11-17T18:00:00"))).toEqual([]);                 // falta mucho: no se dice nada
    const l = lastBusSoon(s, "B", [], at("2026-11-17T21:30:00"));
    expect(l).toHaveLength(1);
    expect(l[0]!.shortName).toBe("539");
    expect(new Date(l[0]!.time * 1000).toISOString()).toBe("2026-11-18T03:10:00.000Z");     // 22:10 de Bogotá
    expect(lastBusSoon(s, "B", [], at("2026-11-17T22:20:00"))).toEqual([]);                 // ya pasó
  });
});

describe("semáforos", () => {
  it("cuenta los grupos de señal y arma el texto del cruce", async () => {
    const { countSignalGroups, signalInfo } = await import("../src");
    expect(countSignalGroups("1,2,3")).toBe(3);
    expect(countSignalGroups("N/A")).toBe(0);
    expect(countSignalGroups("22,23,31 (Reg)")).toBe(3);
    const i = signalInfo([-74.05, 4.75, "KR 16 X CL 187", "Usaquén", "VEHICULAR, PEATONAL", 3, 0, 3, 0, 4, "PMT"]);
    expect(i.title).toBe("KR 16 X CL 187");
    expect(i.text).toBe("Cruce con 6 semáforos: 3 para carros, 3 peatonales. Cambia en 4 fases por ciclo. Ahora funciona con un plan de manejo de tránsito (obras o desvíos). Localidad: Usaquén.");
    expect(signalInfo([-74, 4.7, "AK 7 X CL 1", "", ""]).text).toBe("Cruce con semáforo.");      // archivo viejo
  });
});

describe("semáforos en su sitio", () => {
  it("dibuja cada semáforo con posición y, si no hay, el punto del cruce", async () => {
    const { signalPoints } = await import("../src");
    const pts = signalPoints([
      [-74.09367, 4.74459, "KR 102B BIS X AC 145", "SUBA", "", 3, 1, 3, 1, 2, "NORMAL", [[-74.0937, 4.7446, "c"], [-74.0936, 4.7449, "t"]]],
      [-74.1, 4.7, "AK 7 X CL 1", "", ""],
    ]);
    expect(pts).toHaveLength(3);
    expect(pts[1]).toMatchObject({ lon: -74.0936, label: "TM", tm: true, title: "KR 102B BIS X AC 145" });
    expect(pts[2]).toMatchObject({ lon: -74.1, label: "AK 7 X CL 1", tm: false });
  });
});
