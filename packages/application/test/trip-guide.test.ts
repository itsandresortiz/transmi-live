import { describe, expect, it } from "vitest";
import { advanceGuide, guideAlerts, guideNow, guideSteps, pendingAlerts, startGuide, type Itinerary, type RideLeg, type WalkLeg } from "@transmi/application";

/** Viaje de juguete: caminar 5 min a la estación, bus X1 (10 min), caminar 2 min, bus Z2 (8 min), caminar 3 min al destino. */
const T0 = 1_000_000, P = (i: number) => ({ lat: 4.65, lon: -74.1 + i * 0.01 });      // ~1,1 km entre puntos
const walk = (from: number, to: number, seconds: number, toName: string): WalkLeg => ({ kind: "walk", from: P(from), to: P(to), fromName: "x", toName, meters: seconds * 1.25, seconds, line: [] });
const ride = (short: string, head: string, b: number, a: number, departAt: number, arriveAt: number): RideLeg => ({
  kind: "ride", routeId: short, shortName: short, longName: short, headsign: head, system: "troncal",
  board: { id: "S" + b, name: "Estación " + b, position: P(b) }, alight: { id: "S" + a, name: "Estación " + a, position: P(a) }, stops: 4,
  waitSeconds: 120, waitKind: "estimated", departAt, arriveAt, rideSeconds: arriveAt - departAt, line: [], headwaySeconds: 300,
} as RideLeg);
const trip: Itinerary = {
  legs: [walk(0, 1, 300, "Estación 1"), ride("X1", "Portal Norte", 1, 5, T0 + 420, T0 + 1020), walk(5, 5.1, 120, "Estación 5b"), ride("Z2", "", 5.1, 8, T0 + 1300, T0 + 1780), walk(8, 8.2, 180, "Destino")],
  departAt: T0, arriveAt: T0 + 1960, seconds: 1960, walkMeters: 750, walkSeconds: 600, waitSeconds: 280, transfers: 1, live: false, tags: [],
};
trip.legs[3] = { ...(trip.legs[3] as RideLeg), board: { id: "S5b", name: "Paradero 5b", position: P(5.1) } };
const place = (s: { id: string; name: string }) => (s.id === "S1" ? `${s.name}, vagón 2` : s.name);

describe("guía paso a paso de un viaje", () => {
  it("lista los pasos con el vagón donde se toma el bus", () => {
    const steps = guideSteps(trip, place);
    expect(steps.map((s) => s.kind)).toEqual(["walk", "ride", "walk", "ride", "walk"]);
    expect(steps[0]!.title).toBe("Camina 5 min hasta Estación 1, vagón 2");
    expect(steps[1]!.title).toBe("Toma el X1 hacia Portal Norte");
    expect(steps[1]!.detail).toContain("baja en Estación 5");
  });

  it("con ubicación: avanza al llegar a la parada, al alejarse en el bus y al acercarse a donde se baja", () => {
    let s = startGuide(trip);
    expect(s).toEqual({ leg: 0, phase: "walk" });
    s = advanceGuide(trip, s, P(0.5), T0 + 100);
    expect(s).toEqual({ leg: 0, phase: "walk" });                       // aún va caminando
    s = advanceGuide(trip, s, P(1), T0 + 290);
    expect(s).toEqual({ leg: 1, phase: "wait" });                       // llegó a la estación: espera el bus
    s = advanceGuide(trip, s, P(2), T0 + 500);
    expect(s).toEqual({ leg: 1, phase: "ride" });                       // se alejó: va en el bus
    s = advanceGuide(trip, s, P(5), T0 + 1000);
    expect(s).toEqual({ leg: 2, phase: "walk" });                       // llegó a donde se baja: camina al siguiente
    s = advanceGuide(trip, s, P(5.1), T0 + 1100);
    expect(s).toEqual({ leg: 3, phase: "wait" });
  });

  it("no da por tomado el bus solo porque la ubicación saltó antes de la hora", () => {
    const s = advanceGuide(trip, { leg: 1, phase: "wait" }, P(1.5), T0 + 100);
    expect(s).toEqual({ leg: 1, phase: "wait" });
  });

  it("sin ubicación: avanza con la hora prevista, corrida por el atraso medido", () => {
    expect(advanceGuide(trip, startGuide(trip), null, T0 + 310)).toEqual({ leg: 1, phase: "wait" });
    expect(advanceGuide(trip, startGuide(trip), null, T0 + 1030)).toEqual({ leg: 2, phase: "walk" });
    expect(advanceGuide(trip, startGuide(trip), null, T0 + 1030, 120)).toEqual({ leg: 1, phase: "ride" });      // el bus va 2 min tarde: aún no se baja
    expect(advanceGuide(trip, startGuide(trip), null, T0 + 5000).phase).toBe("done");
  });

  it("dice qué hacer ahora y qué sigue", () => {
    expect(guideNow(trip, { leg: 0, phase: "walk" }, place).title).toBe("Camina hasta Estación 1, vagón 2");
    expect(guideNow(trip, { leg: 1, phase: "wait" }, place).title).toBe("Espera el X1 hacia Portal Norte");
    const riding = guideNow(trip, { leg: 1, phase: "ride" }, place);
    expect(riding.body).toBe("Bájate en Estación 5. Camina 2 min hasta Paradero 5b y toma el Z2.");
    expect(guideNow(trip, { leg: 4, phase: "walk" }, place).title).toBe("Camina hasta tu destino");
  });

  it("programa los avisos de cada bus: ya casi llega, prepárate, bájate y qué sigue", () => {
    const all = guideAlerts(trip, place);
    expect(all.map((a) => a.id)).toEqual(["g0-go", "g1-board", "g1-ready", "g1-off", "g3-board", "g3-ready", "g3-off"]);
    const off1 = all.find((a) => a.id === "g1-off")!, off3 = all.find((a) => a.id === "g3-off")!;
    expect(off1.title).toBe("Bájate aquí: Estación 5");
    expect(off1.body).toBe("Camina 2 min hasta Paradero 5b y toma el Z2.");
    expect(off3.body).toContain("hasta tu destino");
    expect(all.find((a) => a.id === "g1-board")!.body).toBe("Súbete en Estación 1, vagón 2, hacia Portal Norte.");
    for (let i = 1; i < all.length; i++) expect(all[i]!.at).toBeGreaterThanOrEqual(all[i - 1]!.at);
  });

  it("solo deja los avisos que faltan y les suma el atraso", () => {
    const left = pendingAlerts(trip, { leg: 1, phase: "ride" }, place, 60);
    expect(left.map((a) => a.id)).toEqual(["g1-ready", "g1-off", "g3-board", "g3-ready", "g3-off"]);
    expect(left[1]!.at).toBe(T0 + 1020 - 15 + 60);
  });
});
