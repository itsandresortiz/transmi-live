import { opposite, signalNow, type SignalColor, type SignalModel } from "./signal-timing";

/**
 * Semáforos medidos a mano y buses reales, aprendiendo unos de otros (desde el 2026-11-17).
 *
 * Cada vez que un bus se acerca a un semáforo medido se anota si iba detenido o avanzando y hacia dónde iba. Con eso:
 * - **los semáforos se validan con los buses**: si el ciclo medido está bien, los buses detenidos caen en su rojo y los que avanzan,
 *   en su verde. Se dice cuánto coincide y a qué horas (cada hora puede tener otro plan);
 * - **los buses dicen si el semáforo se corrió**: se prueba el mismo ciclo corrido unos segundos; si los buses encajan claramente mejor
 *   con otro punto de inicio, el plan cambió (o la medida quedó corrida) y conviene volver a medir;
 * - **se aprende qué sentido obedece a ese semáforo**: los buses que van en el mismo eje (norte-sur u oriente-occidente) siguen el
 *   ciclo; los del eje cruzado, el contrario. Eso no hay que decírselo: sale de los datos;
 * - **se prueba si la espera se puede predecir**: un bus que estaba detenido y arrancó lo hizo poco después de un inicio de verde. Si
 *   eso se cumple mucho más que por azar, el semáforo sirve para afinar los tiempos de llegada (paso siguiente; todavía no se usa).
 *
 * Nada de esto se muestra a los usuarios: solo en el modo de pruebas (ver 07-decisions).
 */
export type Heading = "N" | "E" | "S" | "O" | "?";
/** Un reporte de un bus que se acerca a un semáforo medido: `t` en segundos (hora del reporte), detenido o no, y hacia dónde iba. */
export interface BusNearSignal { t: number; still: boolean; h: Heading; /** Rumbo del bus en grados (0 = norte), si se sabe. */ b?: number }
/** Un bus que estaba detenido cerca del semáforo en `a` y ya avanzaba en `b` (segundos): arrancó entre los dos reportes. */
export interface BusGo { a: number; b: number; h: Heading; /** Rumbo del bus en grados al arrancar, si se sabe. */ bb?: number }

export type Axis = "NS" | "EO";
const axisOf = (h: Heading): Axis | null => (h === "N" || h === "S" ? "NS" : h === "E" || h === "O" ? "EO" : null);

/** El plan del semáforo que vale en cada momento (cada hora del día puede tener otro: ver `signalModelAt`). */
type PlanAt = (tMs: number) => SignalModel | null;
let planAt: PlanAt = () => null;
/** Color del semáforo medido (o del contrario, si `inverse`) en `tMs`, con el ciclo corrido `shiftMs`, según el plan de esa hora. */
function colorAt(_m: unknown, inverse: boolean, tMs: number, shiftMs = 0): SignalColor {
  const m = planAt(tMs)!, t = tMs - shiftMs;
  return inverse ? opposite(m, t) : signalNow(m, t).c;
}
/** 1 si el reporte encaja con el color (detenido en rojo, avanzando en verde), 0 si lo contradice, ½ en amarillo (puede ser cualquiera). */
const fits = (still: boolean, c: SignalColor) => (c === "y" ? 0.5 : still === (c === "r") ? 1 : 0);

export interface AxisLearning { axis: Axis; n: number; /** Cuánto encaja con el semáforo tal cual (0–1). */ same: number; /** Con el contrario. */ flipped: number; /** Lo que se concluye: `true` = ese eje sigue el ciclo contrario. */ inverse: boolean | null }
export interface SignalLearning {
  n: number;
  axes: AxisLearning[];
  /** Cuánto encajan los buses con el semáforo tal cual está medido (0–1; al azar daría ~0,5). `null` sin datos. */
  agree: number | null;
  /** El corrimiento (en segundos) con el que los buses encajan mejor, y cuánto encajarían así. */
  shift: { s: number; agree: number } | null;
  /** Por hora de Bogotá (0–23): cuántos reportes y cuánto encajan. Una hora que no encaja tiene otro plan. */
  hours: { h: number; n: number; agree: number }[];
  /** Buses detenidos junto al semáforo: cuántos, cuántos caían en su rojo o amarillo y qué parte sería por azar (0–1). */
  stopped: { n: number; red: number; chance: number };
  /** Arranques de buses detenidos: cuántos y en cuántos había un inicio de verde justo antes (y cuántos serían por azar). */
  goes: { n: number; ok: number; chance: number };
  /** Lo que se le dice al dueño (modo de pruebas). */
  text: string;
}

const MIN_AXIS = 12, MIN_N = 30;
const bogotaHour = (tSec: number) => Math.floor((((tSec - 5 * 3600) % 86_400) + 86_400) % 86_400 / 3600);

/** Lo que dicen los buses de un semáforo medido. `inverse` = el semáforo sigue al contrario de `model` (como el de TransMilenio). */
/** Rumbo aproximado de cada dirección (para reportes viejos que no guardaban el rumbo en grados). */
const SECTOR: Record<Heading, number | null> = { N: 0, E: 90, S: 180, O: 270, "?": null };
const angle = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
/** ¿El bus va en el sentido que controla el semáforo (±45°)? */
export function headsWith(rumbo: number, o: { h: Heading; b?: number }): boolean {
  const b = o.b ?? SECTOR[o.h];
  return b != null && angle(b, rumbo) <= 45;
}

/** `rumbo`: hacia dónde va el tráfico que controla el semáforo (de OpenStreetMap o de los recorridos). Si se sabe, solo cuentan los buses
 *  que van en ese sentido (los demás miran otro semáforo del cruce) y para ellos el color vale tal cual. */
export function learnFromBuses(plan: SignalModel | PlanAt, inverse: boolean, allObs: readonly BusNearSignal[], allGoes: readonly BusGo[] = [], rumbo?: number): SignalLearning {
  planAt = typeof plan === "function" ? plan : () => plan;
  // solo los reportes de horas en que se sabe qué plan tiene el semáforo (y, si se sabe hacia dónde mira, de buses en ese sentido)
  const dirOk = (o: { h: Heading; b?: number }) => rumbo == null || headsWith(rumbo, o);
  const obs = allObs.filter((o) => planAt(o.t * 1000) && dirOk(o)), goes = allGoes.filter((g) => planAt(g.a * 1000) && dirOk({ h: g.h, b: g.bb }));      // en un arranque `b` es la hora, no el rumbo
  const model = { cycle: 120_000 };      // para el rango de corrimientos que se prueban (±60 s)
  const byAxis = new Map<Axis, BusNearSignal[]>();
  for (const o of obs) { const a = axisOf(o.h); if (a) (byAxis.get(a) ?? byAxis.set(a, []).get(a)!).push(o); }
  // qué eje obedece al semáforo y cuál al contrario: el que encaja mejor (con suficientes reportes y una diferencia clara)
  const axes: AxisLearning[] = [];
  for (const [axis, list] of byAxis) {
    const same = mean(list.map((o) => fits(o.still, colorAt(model, inverse, o.t * 1000))));
    const flipped = mean(list.map((o) => fits(o.still, colorAt(model, !inverse, o.t * 1000))));
    axes.push({ axis, n: list.length, same, flipped, inverse: list.length >= MIN_AXIS && Math.abs(same - flipped) >= 0.08 ? flipped > same : null });
  }
  axes.sort((a, b) => b.n - a.n);
  // un eje sin conclusión se toma como el semáforo tal cual (el que se midió es el de ese eje casi siempre)
  const flipOf = new Map(axes.map((a) => [a.axis, rumbo == null && a.inverse === true]));
  // un eje sin datos (p. ej. arranques por una calle sin reportes) va tal cual: antes `inverse !== undefined` lo daba al revés
  const flip = (a: Axis | null) => !!(a && flipOf.get(a));
  const used = obs.filter((o) => axisOf(o.h));
  const score = (shiftMs: number, list = used) => mean(list.map((o) => fits(o.still, colorAt(model, inverse !== flip(axisOf(o.h)), o.t * 1000, shiftMs))));
  const agree = used.length ? score(0) : null;
  // el corrimiento: solo se dice si las dos mitades de los datos (por hora) señalan el mismo (±6 s) y ambas mejoran claramente. Con
  // cientos de reportes ruidosos, probar 60 corrimientos siempre encuentra uno que «encaja mejor» por azar (medido el 2026-11-17: el mejor
  // saltaba de −42 a +56 s entre franjas, y era distinto en dos semáforos que cambian juntos)
  let shift: SignalLearning["shift"] = null;
  const bestShift = (list: BusNearSignal[]) => {
    let b = { s: 0, agree: score(0, list), base: score(0, list) };
    for (let s = -Math.floor(model.cycle / 2000); s < model.cycle / 2000; s += 2) { const v = score(s * 1000, list); if (v > b.agree + 1e-9) b = { ...b, s, agree: v }; }
    return b;
  };
  if (used.length >= 2 * MIN_N) {
    const sorted = [...used].sort((a, b) => a.t - b.t), half = sorted.length >> 1;
    const A = bestShift(sorted.slice(0, half)), B = bestShift(sorted.slice(half));
    const near = (x: number, y: number) => { const c = model.cycle / 1000, d = Math.abs(x - y) % c; return Math.min(d, c - d) <= 6; };
    if (near(A.s, B.s) && A.agree - A.base >= 0.08 && B.agree - B.base >= 0.08) { const s = Math.round((A.s + B.s) / 4) * 2; shift = { s, agree: score(s * 1000) }; }
    else shift = { s: 0, agree: agree! };
  }
  // la prueba más clara: los buses DETENIDOS junto al semáforo deberían caer en su rojo (o amarillo) mucho más que por azar
  const stillObs = used.filter((o) => o.still);
  const redShare = (inv: boolean, at: number) => { const m = planAt(at)!; let n = 0; for (let t = 0; t < m.cycle; t += 1000) if ((inv ? opposite(m, m.anchor + t) : signalNow(m, m.anchor + t).c) !== "g") n++; return n / (m.cycle / 1000); };
  const stopped = { n: stillObs.length, red: stillObs.filter((o) => colorAt(model, inverse !== flip(axisOf(o.h)), o.t * 1000) !== "g").length, chance: mean(stillObs.map((o) => redShare(inverse !== flip(axisOf(o.h)), o.t * 1000))) };
  const byHour = new Map<number, BusNearSignal[]>();
  for (const o of used) { const h = bogotaHour(o.t); (byHour.get(h) ?? byHour.set(h, []).get(h)!).push(o); }
  const hours = [...byHour].map(([h, list]) => ({ h, n: list.length, agree: score(0, list) })).sort((a, b) => a.h - b.h);
  // arranques: el bus estaba detenido en `a` y avanzaba en `b`; su eje debía pasar a verde entre `a − 10 s` y `b`
  // (los 10 s: el bus de atrás en la fila arranca unos segundos después del cambio)
  let gn = 0, ok = 0, chance = 0;
  for (const g of goes) {
    const ax = axisOf(g.h);
    if (!ax || g.b - g.a > 60) continue;
    gn++;
    const inv = inverse !== flip(ax);
    for (let t = g.a - 10; t <= g.b; t++) {
      if (colorAt(model, inv, t * 1000) !== "g" && colorAt(model, inv, (t + 1) * 1000) === "g") { ok++; break; }
    }
    chance += Math.min(1, (g.b - g.a + 10) / (planAt(g.a * 1000)!.cycle / 1000));
  }
  return { n: used.length, axes, agree, shift, hours, stopped, goes: { n: gn, ok, chance: gn ? chance / gn : 0 }, text: describe(used.length, agree, shift, hours, rumbo == null ? axes : [], { n: gn, ok, chance: gn ? chance / gn : 0 }, stopped) };
}

function describe(n: number, agree: number | null, shift: SignalLearning["shift"], hours: SignalLearning["hours"], axes: AxisLearning[], goes: SignalLearning["goes"], stopped: SignalLearning["stopped"]): string {
  if (agree == null || n < MIN_N) return `Los buses todavía no dicen nada de este semáforo (${n} reportes; hacen falta unos ${MIN_N}).`;
  const pct = (x: number) => `${Math.round(x * 100)} %`;
  const out = [`Según ${n} reportes de buses, encajan ${pct(agree)} con tu medida (al azar sería ~50 %).`];
  if (stopped.n >= 15) {
    const got = stopped.red / stopped.n, sd = Math.sqrt(stopped.chance * (1 - stopped.chance) / stopped.n);
    out.push(`De ${stopped.n} buses detenidos, ${pct(got)} caían en tu rojo (al azar ${pct(stopped.chance)})${got - stopped.chance > 2 * sd ? ": los buses lo confirman." : got - stopped.chance < -2 * sd ? ": no cuadra (otro plan u otro sentido)." : ": todavía no se distingue del azar."}`);
  }
  if (shift && shift.s !== 0 && Math.abs(shift.s) > 6 && shift.agree - agree >= 0.08) out.push(`Encajarían mejor (${pct(shift.agree)}) con el ciclo corrido ${shift.s > 0 ? "+" : ""}${shift.s} s: puede que el plan se haya corrido; vuelve a medir.`);
  else if (agree >= 0.65) out.push("El ciclo medido se sostiene con los buses.");
  else if (agree < 0.58 && stopped.n < 15) out.push("Por ahora no se distingue del azar: los buses de ahí se detienen también por otras cosas (filas, paradas) y reportan cada ~20 s.");
  const bad = hours.filter((h) => h.n >= 30 && h.agree < 0.4).map((h) => `${h.h}:00`);
  if (bad.length) out.push(`A estas horas no encaja (otro plan): ${bad.join(", ")}.`);
  const known = axes.filter((a) => a.inverse != null).map((a) => `${a.axis === "NS" ? "norte-sur" : "oriente-occidente"} ${a.inverse ? "al revés" : "igual"}`);
  if (known.length) out.push(`Sentidos: ${known.join("; ")}.`);
  if (goes.n >= 8) out.push(`De ${goes.n} buses que arrancaron, ${goes.ok} lo hicieron justo tras el verde predicho (por azar serían ~${Math.round(goes.chance * goes.n)}).`);
  return out.join(" ");
}

function mean(a: number[]): number { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
