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
