import { describe, expect, it } from "vitest";
import {
  LiveDataService, TransitState, connectionStatus, kpis, listVehicles, searchRoutes, upcomingAtStop, routeDetail,
  type LiveFeedPort, type LivePoll,
} from "@transmi/application";
import { TransitNetwork, type VehicleReport } from "@transmi/domain";

const rep = (id: string, routeId: string, t: number, over: Partial<VehicleReport> = {}): VehicleReport => ({
  id, routeId, reportedAt: t, position: { lat: 4.65, lon: -74.07 }, ...over,
});

class FakeFeed implements LiveFeedPort {
  polls: LivePoll[] = [];
  calls = 0;
  fail = false;
  async poll() {
    this.calls++;
    if (this.fail) throw new Error("sin conexión");
    return this.polls.shift() ?? null;
  }
}
const clock = (start = 1_000_000) => { let t = start; return { now: () => t, advance: (ms: number) => (t += ms) }; };

describe("estado del tránsito", () => {
  it("deduce rutas y sistemas de los buses mientras no hay GTFS", () => {
    const s = new TransitState();
    s.applyPositions([
      rep("a", "100", 1000, { tripId: "TTBD1.1.100" }),
      rep("b", "100", 1000, { tripId: "TTBD2.1.100" }),
      rep("c", "200", 1000, { label: "Z70-1234" }),
    ], 0);
    expect(s.routeById("100")).toMatchObject({ system: "troncal", provisional: true });
    expect(s.routeById("200")?.system).toBe("zonal");
    expect(s.fleet.get("c")?.system).toBe("zonal");
  });
  it("usa el sistema del GTFS cuando carga la red", () => {
    const s = new TransitState();
    s.applyPositions([rep("a", "100", 1000, { label: "Z1-1" })], 0);
    const net = new TransitNetwork();
    net.routes.set("100", { id: "100", shortName: "B12", longName: "Calle 80", system: "troncal" });
    s.setNetwork(net);
    expect(s.fleet.get("a")?.system).toBe("troncal");
  });
  it("relaciona retrasos y llegadas con los buses", () => {
    const s = new TransitState();
    // TransMilenio informa la ÚLTIMA parada a la que llegó el bus (S9, con su hora real); la que sigue es S10
    const net = new TransitNetwork();
    net.routes.set("100", { id: "100", shortName: "B12", longName: "Calle 80", system: "troncal" });
    net.stops.set("S9", { id: "S9", code: "S9", name: "Nueve", position: { lat: 4.65, lon: -74.07 } });
    net.stops.set("S10", { id: "S10", code: "S10", name: "Diez", position: { lat: 4.651, lon: -74.07 } });
    net.shapes.set("100", [{ routeId: "100", direction: "0", headsign: "x", points: [], stopIds: ["S8", "S9", "S10", "S11"] }]);
    s.setNetwork(net);
    s.applyPositions([rep("a", "100", 1000, { tripId: "T1", lastStopId: "S9" })], 0);
    s.applyTripUpdates([{ tripId: "T1", routeId: "100", delaySeconds: 720, nextStop: { stopId: "S9", arrivalAt: 950 } }]);
    const v = s.fleet.get("a")!;
    expect(s.delayOf(v)).toMatchObject({ kind: "late", minutes: 12, severe: true });
    expect(s.nextStopOf(v, 1_000_000)?.stopId).toBe("S10");
    expect(s.nextStopOf(v, 1_000_000)?.arrivalAt).toBeGreaterThan(950);         // la hora de llegada a S9 más el tramo
    expect(upcomingAtStop(s, "S11", 1000, 3)[0]?.buses[0]?.stopsAway).toBe(2);  // S11 está 2 paradas después de la última
    expect(upcomingAtStop(s, "S8", 1000, 3)).toHaveLength(0);                   // S8 ya la pasó
    expect(kpis(s)).toMatchObject({ vehicles: 1, routes: 1, late: 1 });
  });
  it("busca rutas y buses, y arma el detalle de una ruta", () => {
    const s = new TransitState();
    s.applyPositions([
      rep("a", "1", 1000, { plate: "WDE058" }), rep("b", "1", 1000, { plate: "ABC123" }), rep("c", "2", 1000, { plate: "XYZ999" }),
    ], 0);
    expect(searchRoutes(s)[0]!.id).toBe("1");
    expect(listVehicles(s, { query: "abc" }).map((v) => v.id)).toEqual(["b"]);
    expect(routeDetail(s, "1")!.vehicles).toHaveLength(2);
    expect(routeDetail(s, "no-existe")).toBeUndefined();
  });
});

describe("servicio de datos en vivo", () => {
  it("aplica lo nuevo, y espera en silencio justo después de un lote", async () => {
    const feed = new FakeFeed(), c = clock(), state = new TransitState();
    const svc = new LiveDataService(feed, state, c);
    feed.polls.push({ source: "live", signature: { pos: "p1" }, batch: { positions: [rep("a", "1", 1000)] } });
    expect(await svc.refresh()).toBe(true);
    expect(state.fleet.size).toBe(1);
    expect(state.source).toBe("live");
    c.advance(3000);
    expect(await svc.refresh()).toBe(false);
    expect(feed.calls).toBe(1); // no preguntó: es muy pronto
    c.advance(7000);
    await svc.refresh();
    expect(feed.calls).toBe(2);
  });
  it("cuenta los fallos y se recupera", async () => {
    const feed = new FakeFeed(), svc = new LiveDataService(feed, new TransitState(), clock());
    feed.fail = true;
    await expect(svc.refresh()).rejects.toThrow();
    await expect(svc.refresh()).rejects.toThrow();
    expect(svc.failures).toBe(2);
    feed.fail = false;
    await svc.refresh();
    expect(svc.failures).toBe(0);
  });
  it("describe la frescura de los datos", () => {
    const s = new TransitState();
    expect(connectionStatus(s, 1_000_000).connection).toBe("connecting");
    s.applyPositions([rep("a", "1", 1000)], 0);
    expect(connectionStatus(s, 1_010_000).connection).toBe("live");
    expect(connectionStatus(s, 1_100_000).connection).toBe("waiting");
    expect(connectionStatus(s, 1_400_000).connection).toBe("stale");
  });
  it("de madrugada (la fuente responde pero no publica buses) no dice «conectando» ni «sin señal»", () => {
    const s = new TransitState();
    s.lastPollOkAt = 1_000_000;
    expect(connectionStatus(s, 1_030_000).connection).toBe("idle");        // nunca llegó un bus, pero el servidor contesta
    expect(connectionStatus(s, 1_200_000).connection).toBe("connecting");  // y si dejó de contestar, vuelve a conectando
    s.applyPositions([rep("a", "1", 1000)], 0);
    s.lastPollOkAt = 1_400_000;
    expect(connectionStatus(s, 1_410_000).connection).toBe("idle");        // último bus hace rato, servidor activo
    expect(connectionStatus(s, 1_600_000).connection).toBe("stale");       // servidor sin contestar
  });
});

describe("lotes incompletos", () => {
  it("descarta un lote con muchos menos buses que el anterior", async () => {
    const feed = new FakeFeed(), state = new TransitState(), c = clock(), svc = new LiveDataService(feed, state, c);
    const many = Array.from({ length: 800 }, (_, i) => rep("b" + i, "1", 1000));
    feed.polls.push({ source: "live", signature: { pos: "p1" }, batch: { positions: many } });
    await svc.refresh();
    c.advance(20_000);
    feed.polls.push({ source: "live", signature: { pos: "p2" }, batch: { positions: many.slice(0, 200).map((r) => ({ ...r, reportedAt: 1020 })) } });
    await expect(svc.refresh()).rejects.toThrow(/incompleto/);
    expect(state.fleet.size).toBe(800);
    expect(state.lastBatchAt).toBe(1000);
  });
});

import { ServiceEnds, serviceDay } from "@transmi/application";
describe("último servicio", () => {
  it("marca el último y el primer viaje programado de cada ruta", () => {
    const e = new ServiceEnds();
    e.load({ v: 1, routes: { "11856": { wk: { first: ["T-0401", 14400], last: ["T-2245", 82500] }, sa: { first: ["S-0500", 18000], last: ["S-2300", 82800] } } } });
    expect(e.markOf("T-2245")).toEqual({ isLast: true, isFirst: false, startSeconds: 82500 });
    expect(e.markOf("S-0500")?.isFirst).toBe(true);
    expect(e.markOf("T-1200")).toBeUndefined();
    expect(e.markOf(undefined)).toBeUndefined();
  });
});

describe("día de servicio y estado de la ruta", () => {
  // 2026-03-04 es miércoles; Bogotá = UTC-5
  const at = (iso: string) => Date.parse(iso);
  it("de madrugada todavía es el día anterior (horarios pasan de 24 h)", () => {
    const r = serviceDay(at("2026-03-04T05:30:00Z"));            // 00:30 miércoles
    expect(r.type).toBe("wk");
    expect(Math.round(r.secs)).toBe(86400 + 1800);
    expect(serviceDay(at("2026-03-08T06:00:00Z")).type).toBe("sa");  // 01:00 domingo = sábado de servicio
  });
  it("los festivos usan su horario especial", () => {
    expect(serviceDay(at("2026-03-23T15:00:00Z"), { "20260323": "su" }).type).toBe("su");
  });
  it("ruta: antes, en servicio y terminada", () => {
    const e = new ServiceEnds();
    e.load({ v: 2, routes: { A: { wk: { first: ["t1", 4 * 3600], last: ["t9", 22 * 3600] } } } });
    expect(e.routeStatus("A", at("2026-03-04T08:00:00Z"), 0)?.state).toBe("before");      // 03:00
    expect(e.routeStatus("A", at("2026-03-04T17:00:00Z"), 0)?.state).toBe("running");     // 12:00
    expect(e.routeStatus("A", at("2026-03-05T04:00:00Z"), 0)?.state).toBe("ended");       // 23:00
    expect(e.routeStatus("A", at("2026-03-05T04:00:00Z"), 3)?.state).toBe("running");     // aún hay buses en la calle
    expect(e.routeStatus("Z", at("2026-03-04T17:00:00Z"), 0)).toBeUndefined();
  });
});

import { trafficBand, trafficSegments } from "@transmi/application";
describe("tráfico en vivo", () => {
  it("clasifica la velocidad en bandas", () => {
    expect([0.5, 2, 5, 10].map(trafficBand)).toEqual([0, 1, 2, 3]);
  });
  it("pinta el último tramo de buses de calle y omite la troncal", () => {
    const s = new TransitState();
    const mk = (id: string, tripId: string, lon: number, at: number) => ({ id, routeId: "r-" + id, tripId, position: { lat: 4.65, lon }, reportedAt: at });
    s.applyPositions([mk("a", "t1", -74.08, 1000), mk("b", "TTBD1", -74.08, 1000)], 1_000_000);
    s.applyPositions([mk("a", "t1", -74.0786, 1030), mk("b", "TTBD1", -74.0786, 1030)], 1_030_000);
    const segs = trafficSegments(s, 1031);
    expect(segs.length).toBe(1);                                     // el bus «TTBD…» es troncal y no cuenta
    expect(segs[0]!.speed).toBeGreaterThan(3);
    expect(trafficSegments(s, 1200).length).toBe(0);                 // dato viejo
  });
});

import { liveDownText, serviceClosedNow } from "@transmi/application";
describe("de noche se dice que el servicio terminó, no que faltan datos", () => {
  const bogota = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h + 5, mi);
  it("sabe a qué horas no hay servicio", () => {
    expect(serviceClosedNow(bogota(2026, 11, 11, 23, 30))).toBe(true);     // miércoles 11:30 p. m.
    expect(serviceClosedNow(bogota(2026, 11, 12, 0, 10))).toBe(true);      // medianoche
    expect(serviceClosedNow(bogota(2026, 11, 12, 4, 0))).toBe(true);
    expect(serviceClosedNow(bogota(2026, 11, 12, 4, 45))).toBe(false);     // ya arrancó
    expect(serviceClosedNow(bogota(2026, 11, 11, 22, 30))).toBe(false);    // entre semana aún hay servicio
    expect(serviceClosedNow(bogota(2026, 11, 15, 22, 30))).toBe(true);     // domingo termina antes
    expect(serviceClosedNow(bogota(2026, 11, 11, 15, 0))).toBe(false);
  });
  it("elige el texto según la hora", () => {
    expect(liveDownText(bogota(2026, 11, 11, 23, 30)).title).toBe("Servicio finalizado por hoy");
    expect(liveDownText(bogota(2026, 11, 12, 0, 10)).title).toBe("Servicio finalizado");
    expect(liveDownText(bogota(2026, 11, 11, 15, 0)).title).toBe("Sin datos en vivo por ahora");
  });
});

import { ServiceEnds } from "@transmi/application";
describe("con el servicio terminado se dice cuándo sale el próximo bus", () => {
  const bogota = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h + 5, mi);
  const se = new ServiceEnds();
  se.load({ v: 1, routes: { R: { wk: { first: ["a", 4 * 3600 + 1800], last: ["b", 22 * 3600] }, sa: { first: ["c", 5 * 3600], last: ["d", 21 * 3600] } } } });
  it("entre semana, el de mañana; el viernes en la noche, el del sábado", () => {
    const wed = se.routeStatus("R", bogota(2026, 11, 11, 23, 30), 0)!;       // miércoles 11:30 p. m.
    expect(wed.state).toBe("ended"); expect(wed.nextFirstStart).toBe(4 * 3600 + 1800);
    const afterMidnight = se.routeStatus("R", bogota(2026, 11, 12, 0, 30), 0)!;   // sigue siendo el día de servicio del miércoles
    expect(afterMidnight.state).toBe("ended"); expect(afterMidnight.nextFirstStart).toBe(4 * 3600 + 1800);
    expect(se.routeStatus("R", bogota(2026, 11, 13, 23, 30), 0)!.nextFirstStart).toBe(5 * 3600);   // viernes → sábado
    expect(se.routeStatus("R", bogota(2026, 11, 11, 12, 0), 0)!.nextFirstStart).toBeUndefined();   // en servicio: no aplica
  });
});

import { isOffline, TransitState as TS2 } from "@transmi/application";
describe("sin conexión", () => {
  it("se deduce de consultas fallidas seguidas y manda sobre «servicio finalizado»", () => {
    const st = new TS2(), now = 1_800_000_000_000;
    expect(isOffline(st, now)).toBe(false);
    st.pollFailures = 1; st.lastPollFailAt = now - 5_000;
    expect(isOffline(st, now)).toBe(false);                       // una sola falla puede ser un tropiezo
    st.pollFailures = 3;
    expect(isOffline(st, now)).toBe(true);
    st.lastPollOkAt = now - 10_000;
    expect(isOffline(st, now)).toBe(false);                       // contestó hace poco: hay conexión
    expect(liveDownText(Date.UTC(2026, 10, 12, 5, 10), true).title).toBe("Sin conexión a internet");   // a medianoche y sin red: se dice sin conexión
  });
});

import { ALL_MODES, TRAVEL_MODES, systemsFor } from "@transmi/application";
describe("con qué viajar: los duales van aparte de TransMilenio", () => {
  it("«TransMilenio» solo da troncales; los duales tienen su propio modo", () => {
    expect(TRAVEL_MODES.find((m) => m.key === "troncal")!.systems).toEqual(["troncal"]);
    expect(systemsFor({ ...ALL_MODES, dual: false, zonal: false, alimentador: false })).toEqual(["troncal"]);
    expect(systemsFor({ ...ALL_MODES, zonal: false, alimentador: false })).toEqual(["troncal", "dual"]);
    expect(systemsFor(ALL_MODES)).toBeUndefined();
  });
});

import { TransitNetwork as TN3 } from "@transmi/domain";
describe("la misma ruta en sus dos sentidos", () => {
  it("agrupa las rutas con el mismo nombre y sistema (TransMilenio publica cada sentido aparte)", () => {
    const st = new TS2(), net = new TN3();
    net.routes.set("14047", { id: "14047", shortName: "7", longName: "Polo", system: "troncal" });
    net.routes.set("14048", { id: "14048", shortName: "7", longName: "Portal Suba", system: "troncal" });
    net.routes.set("13906", { id: "13906", shortName: "7", longName: "zonal", system: "zonal" });
    st.setNetwork(net);
    expect([...st.routeFamily("14047")].sort()).toEqual(["14047", "14048"]);     // el 7 zonal es otra ruta
    expect(st.routeFamily("13906")).toEqual(["13906"]);
    expect(st.routeFamily("no-existe")).toEqual(["no-existe"]);
  });
});

describe("buscar una ruta: lo que se escribió primero", () => {
  it("«7» da primero la ruta 7 (troncal antes que zonal), no las que solo tienen un 7 en el nombre", () => {
    const st = new TS2(), net = new TN3();
    const add = (id: string, shortName: string, system: "troncal" | "zonal" | "dual", longName = "") => net.routes.set(id, { id, shortName, longName, system });
    add("a", "HB647", "zonal"); add("b", "HA708", "zonal"); add("c", "MK86", "dual", "Cra. 7 con Calle 107A");
    add("7z", "7", "zonal"); add("7a", "7", "troncal", "Polo"); add("7b", "7", "troncal", "Portal Suba"); add("d", "73", "zonal"); add("e", "C17", "troncal");
    st.setNetwork(net);
    const names = searchRoutes(st, { query: "7" }).map((r) => `${r.shortName}/${r.system}`);
    expect(names.slice(0, 3)).toEqual(["7/troncal", "7/troncal", "7/zonal"]);
    expect(names[3]).toBe("73/zonal");                                  // luego las que empiezan por 7
    expect(names.indexOf("MK86/dual")).toBe(names.length - 1);          // al final, la que solo coincide por su descripción
    // en la app, los dos sentidos de la misma ruta salen como una sola
    expect(searchRoutes(st, { query: "7", mergeDirections: true }).filter((r) => r.shortName === "7").map((r) => r.system)).toEqual(["troncal", "zonal"]);
  });
});
