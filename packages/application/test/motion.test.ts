import { describe, expect, it } from "vitest";
import { DEFAULT_MOTION, MotionEngine, TransitState } from "@transmi/application";
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

describe("adelanto con los tiempos reales de cada tramo", () => {
  const T0 = 1_795_500_000;      // un martes cualquiera; el perfil trae el mismo tiempo en todas las franjas
  /** Mismo mundo, con un perfil donde el tramo P0 → S (2.500 m) tarda `sec` segundos. */
  function withProfile(sec: number | null): TransitState {
    const st = world();
    if (sec != null) {
      const tags: Record<string, number[]> = {};
      for (const d of ["wk", "sa", "su"]) for (let b = 0; b < 5; b++) tags[`${d}|${b}`] = [sec, 50];
      expect(st.hopProfile.load({ v: 1, updated: "", use: true, r: { "R|0": tags } })).toBe(true);
    }
    return st;
  }
  /** Dos reportes a 10 m/s (llegan con 60 s de edad, como hoy) y 60 s de reloj a 4 Hz: dónde se dibuja el bus. */
  function drive(st: TransitState, weight: number, stop: string | null = "P0"): number[] {
    const eng = new MotionEngine(st, { ...DEFAULT_MOTION, hopWeight: weight, hopWeightStill: weight, hopGain: 1 });
    st.applyPositions([{ ...rep(T0, 1000), lastStopId: stop ?? undefined }], (T0 + 60) * 1000);
    st.applyPositions([{ ...rep(T0 + 30, 1300), lastStopId: stop ?? undefined }], (T0 + 90) * 1000);
    const xs: number[] = [];
    for (let t = T0 + 90; t <= T0 + 150; t += 0.25) xs.push(xOf(eng.step(st.fleet.get("b")!, t)));
    return xs;
  }
  const last = (xs: number[]) => xs[xs.length - 1]!;
  const monotonic = (xs: number[]) => { for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(-0.01); };

  it("un tramo rápido a esta hora adelanta más al bus; uno lento, menos; y nunca retrocede", () => {
    const plain = last(drive(withProfile(null), 1));
    const fast = drive(withProfile(150), 1), slow = drive(withProfile(1000), 1);      // 16,7 m/s y 2,5 m/s de promedio en el tramo
    monotonic(fast); monotonic(slow);
    expect(last(fast)).toBeGreaterThan(plain + 300);
    expect(last(slow)).toBeLessThan(plain - 50);
    expect(last(slow)).toBeGreaterThan(1300);                 // pero sigue avanzando desde el reporte
  });

  it("con lo aprendido no se pasa de la última parada del recorrido", () => {
    const xs = drive(withProfile(60), 1);                     // 42 m/s: a los 150 s ya habría salido del recorrido
    monotonic(xs);
    expect(Math.max(...xs)).toBeLessThan(3000 + 30);
  });

  it("el peso mezcla los dos adelantos", () => {
    const only = last(drive(withProfile(150), 0)), full = last(drive(withProfile(150), 1)), half = last(drive(withProfile(150), 0.5));
    expect(half).toBeGreaterThan(only + 50);
    expect(half).toBeLessThan(full - 50);
  });

  it("sin parada informada no se usa lo aprendido (no se le asigna una por su cuenta)", () => {
    expect(drive(withProfile(150), 1, null)).toEqual(drive(withProfile(null), 1, null));
  });

  it("sin datos del tramo en que va (o con el perfil apagado), se mueve como antes", () => {
    const plain = drive(withProfile(null), 1);
    const off = withProfile(150); off.hopProfile.apply = false;
    expect(drive(off, 1)).toEqual(plain);
    const st = world();
    st.hopProfile.load({ v: 1, updated: "", use: true, r: { "R|0": { "wk|0": [150, 1] } } });      // muy pocas pasadas y de otra franja
    expect(drive(st, 1)).toEqual(plain);
  });
});

describe("un bus dibujado adelantado espera al real (nunca retrocede)", () => {
  it("si el bus real se detiene, el dibujado frena y se queda quieto en vez de seguir de largo o devolverse", () => {
    const st = world(), eng = new MotionEngine(st);
    // va a 12 m/s y de pronto se queda detenido mucho rato (trancón): el dibujado iba por delante de los reportes
    const reports: Record<number, VehicleReport> = { 0: rep(0, 1000), 10: rep(10, 1120), 20: rep(20, 1240), 30: rep(30, 1250), 40: rep(40, 1250), 50: rep(50, 1250), 60: rep(60, 1250), 70: rep(70, 1250), 80: rep(80, 1250) };
    const { xs } = run(st, eng, reports, 90);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(-0.01);
    // al final ya no se mueve (espera): los últimos 10 s avanza menos de 2 m
    expect(xs[xs.length - 1]! - xs[xs.length - 1 - 300]!).toBeLessThan(2);
  });
  it("dejar de mirarlo unos segundos y volver: no aparece más atrás de donde se había dibujado", () => {
    const st = world(), eng = new MotionEngine(st);
    run(st, eng, { 0: rep(0, 1000), 10: rep(10, 1120), 20: rep(20, 1240) }, 28);
    const before = xOf(eng.peek("b")!);
    // el reporte siguiente lo deja algo más atrás de lo dibujado; se vuelve a mirar 10 s después
    st.applyPositions([rep(30, 1250)], 30_000);
    const after = xOf(eng.step(st.fleet.get("b")!, 40));
    expect(after).toBeGreaterThanOrEqual(before - 0.5);
  });
});
