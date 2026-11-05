import { describe, expect, it } from "vitest";
import { MotionEngine, TransitState } from "@transmi/application";
import { METERS_PER_WORLD_UNIT, TransitNetwork, distanceMeters, toWorld, type VehicleReport } from "@transmi/domain";

const M_PER_DEG_LON = 111_320 * Math.cos((4.65 * Math.PI) / 180);
const lonAt = (meters: number) => -74.1 + meters / M_PER_DEG_LON;
/** Una calle recta de 8 km hacia el este. */
function world(): TransitState {
  const st = new TransitState();
  const net = new TransitNetwork();
  net.routes.set("R", { id: "R", shortName: "R1", longName: "Ruta", system: "troncal" });
  const pts = Array.from({ length: 81 }, (_, i) => ({ lat: 4.65, lon: lonAt(i * 100) }));
  net.stops.set("P0", { id: "P0", code: "P0", name: "Parada P0", position: { lat: 4.65, lon: lonAt(500) } });
  net.stops.set("S", { id: "S", code: "S", name: "Parada S", position: { lat: 4.65, lon: lonAt(3000) } });
  net.shapes.set("R", [{ routeId: "R", direction: "0", headsign: "x", points: pts, stopIds: ["P0", "S"] }]);
  st.setNetwork(net);
  return st;
}
const rep = (t: number, meters: number, lat = 4.65): VehicleReport => ({ id: "b", routeId: "R", tripId: "T", reportedAt: t, position: { lat, lon: lonAt(meters) } });
const xOf = (p: { x: number }) => ((p.x * 360 - 180) + 74.1) * M_PER_DEG_LON;

/** Simula `seconds` de reloj a 30 cuadros por segundo; `reports` son (t de llegada) → reporte. */
function run(st: TransitState, eng: MotionEngine, reports: Record<number, VehicleReport>, seconds: number) {
  const xs: number[] = [], ys: number[] = [], arrivals: number[] = [];
  for (let f = 0; f <= seconds * 30; f++) {
    const t = f / 30;
    for (const [at, r] of Object.entries(reports)) if (Math.abs(Number(at) - t) < 1 / 60) { st.applyPositions([r], t * 1000); arrivals.push(xs.length); }
    const v = st.fleet.get("b");
    if (!v) continue;
    const p = eng.step(v, t);
    xs.push(xOf(p)); ys.push(p.y);
  }
  return { xs, ys, arrivals };
}

describe("movimiento de los buses", () => {
  it("avanza por la calle y nunca retrocede, aunque el bus se haya detenido", () => {
    const st = world(), eng = new MotionEngine(st);
    // 10 m/s durante 40 s y luego el bus se detiene (semáforo): los reportes lo van revelando
    const reports: Record<number, VehicleReport> = { 0: rep(0, 1000), 10: rep(10, 1100), 20: rep(20, 1200), 30: rep(30, 1300), 40: rep(40, 1400), 50: rep(50, 1405), 60: rep(60, 1410), 70: rep(70, 1412) };
    const { xs, ys } = run(st, eng, reports, 80);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(-0.01);
    const lateral = Math.max(...ys.map((y) => Math.abs(y - ys[0]!))) * METERS_PER_WORLD_UNIT;
    expect(lateral).toBeLessThan(1);                       // siempre sobre la calle
    expect(xs[xs.length - 1]!).toBeGreaterThan(1300);
  });

  it("no da saltos cuando llega un reporte nuevo", () => {
    const st = world(), eng = new MotionEngine(st);
    const reports: Record<number, VehicleReport> = { 0: rep(0, 1000), 10: rep(10, 1100), 20: rep(20, 1200), 30: rep(30, 1330), 40: rep(40, 1380), 50: rep(50, 1500), 60: rep(60, 1560) };
    const { xs } = run(st, eng, reports, 70);
    let maxStep = 0;
    for (let i = 1; i < xs.length; i++) maxStep = Math.max(maxStep, Math.abs(xs[i]! - xs[i - 1]!));
    expect(maxStep).toBeLessThan(1.5);                      // < 45 m/s: nunca «teletransporta»
  });

  it("si el bus salta kilómetros (dato nuevo muy lejos), se desliza en vez de aparecer de golpe", () => {
    const st = world(), eng = new MotionEngine(st);
    const reports: Record<number, VehicleReport> = { 0: rep(0, 500), 10: rep(10, 600), 20: rep(20, 700), 30: rep(30, 800), 45: rep(45, 4000) };
    const { xs } = run(st, eng, reports, 60);
    let maxStep = 0;
    for (let i = 1; i < xs.length; i++) maxStep = Math.max(maxStep, Math.abs(xs[i]! - xs[i - 1]!));
    expect(maxStep).toBeLessThan(60);                       // por cuadro; un salto real sería de 3 km
    expect(xs[xs.length - 1]!).toBeGreaterThan(3500);       // y llega a su sitio
  });

  it("recién abierta la página (un solo lote, sin historial) los buses ya se mueven hacia su próxima parada", () => {
    const st = world(), eng = new MotionEngine(st);
    st.applyTripUpdates([{ tripId: "T", routeId: "R", delaySeconds: 0, nextStop: { stopId: "P0", arrivalAt: -30 } }]);   // llegó a P0 hace 30 s
    st.applyPositions([{ ...rep(0, 1000), lastStopId: "P0" }], 0);
    expect(st.fleet.get("b")!.velocity).toBeNull();
    const a = xOf(eng.step(st.fleet.get("b")!, 20)), b = xOf(eng.step(st.fleet.get("b")!, 40)), c = xOf(eng.step(st.fleet.get("b")!, 60));
    expect(b).toBeGreaterThan(a + 20);        // avanza, no espera al siguiente lote
    expect(c).toBeGreaterThan(b + 20);
    expect(c).toBeLessThan(3050);             // y hacia su parada, sin pasarse mucho
  });
  it("sin historial y sin parada conocida se queda donde está (no inventa)", () => {
    const st = world(), eng = new MotionEngine(st);
    st.applyPositions([rep(0, 1000)], 0);
    expect(xOf(eng.step(st.fleet.get("b")!, 30))).toBeCloseTo(1000, 0);
  });

  it("un bus que no va por ninguna ruta conocida no se sale en línea recta mientras espera datos nuevos", () => {
    const st = world(), eng = new MotionEngine(st);
    // misma ruta, pero el bus reporta 400 m al norte de la calle: no se puede pegar a ella
    st.applyPositions([rep(0, 1000, 4.6536)], 0); st.applyPositions([rep(30, 1300, 4.6536)], 30_000);
    const v = st.fleet.get("b")!;
    const a = eng.step(v, 30);
    let far = 0;
    for (let t = 31; t <= 150; t += 1) { const p = eng.step(v, t); far = Math.max(far, distanceMeters(a, p)); }
    expect(far).toBeLessThan(5);      // 2 minutos sin datos y sigue en su sitio, no flota hacia ninguna parte
  });

  it("un bus fuera de pantalla que vuelve a mirarse no se arrastra desde donde estaba", () => {
    const st = world(), eng = new MotionEngine(st);
    st.applyPositions([rep(0, 1000)], 0); st.applyPositions([rep(30, 1300)], 30_000);
    const v = st.fleet.get("b")!;
    const a = eng.step(v, 30);
    st.applyPositions([rep(300, 4000)], 300_000);
    const b = eng.step(st.fleet.get("b")!, 300);            // 270 s después
    expect(distanceMeters(a, b)).toBeGreaterThan(2500);     // arranca ya cerca de la realidad
    expect(distanceMeters(b, toWorld({ lat: 4.65, lon: lonAt(4000) }))).toBeLessThan(300);
  });
});
