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
export interface BusNearSignal { t: number; still: boolean; h: Heading }
/** Un bus que estaba detenido cerca del semáforo en `a` y ya avanzaba en `b` (segundos): arrancó entre los dos reportes. */
export interface BusGo { a: number; b: number; h: Heading }

export type Axis = "NS" | "EO";
const axisOf = (h: Heading): Axis | null => (h === "N" || h === "S" ? "NS" : h === "E" || h === "O" ? "EO" : null);

/** Color del semáforo medido (o del contrario, si `inverse`) en `tMs`, con el ciclo corrido `shiftMs`. */
function colorAt(m: SignalModel, inverse: boolean, tMs: number, shiftMs = 0): SignalColor {
  const t = tMs - shiftMs;
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
  /** Arranques de buses detenidos: cuántos y en cuántos había un inicio de verde justo antes (y cuántos serían por azar). */
  goes: { n: number; ok: number; chance: number };
  /** Lo que se le dice al dueño (modo de pruebas). */
  text: string;
}

const MIN_AXIS = 12, MIN_N = 30;
const bogotaHour = (tSec: number) => Math.floor((((tSec - 5 * 3600) % 86_400) + 86_400) % 86_400 / 3600);

/** Lo que dicen los buses de un semáforo medido. `inverse` = el semáforo sigue al contrario de `model` (como el de TransMilenio). */
export function learnFromBuses(model: SignalModel, inverse: boolean, obs: readonly BusNearSignal[], goes: readonly BusGo[] = []): SignalLearning {
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
  const flipOf = new Map(axes.map((a) => [a.axis, a.inverse === true]));
  const used = obs.filter((o) => axisOf(o.h));
  const score = (shiftMs: number, list = used) => mean(list.map((o) => fits(o.still, colorAt(model, inverse !== flipOf.get(axisOf(o.h)!), o.t * 1000, shiftMs))));
  const agree = used.length ? score(0) : null;
  let shift: SignalLearning["shift"] = null;
  if (used.length >= MIN_N) {
    shift = { s: 0, agree: agree! };
    for (let s = -Math.floor(model.cycle / 2000); s < model.cycle / 2000; s += 2) {
      const v = score(s * 1000);
      if (v > shift.agree + 1e-9) shift = { s, agree: v };
    }
  }
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
    const inv = inverse !== flipOf.get(ax);
    for (let t = g.a - 10; t <= g.b; t++) {
      if (colorAt(model, inv, t * 1000) !== "g" && colorAt(model, inv, (t + 1) * 1000) === "g") { ok++; break; }
    }
    chance += Math.min(1, (g.b - g.a + 10) / (model.cycle / 1000));
  }
  return { n: used.length, axes, agree, shift, hours, goes: { n: gn, ok, chance: gn ? chance / gn : 0 }, text: describe(used.length, agree, shift, hours, axes, { n: gn, ok, chance: gn ? chance / gn : 0 }) };
}

function describe(n: number, agree: number | null, shift: SignalLearning["shift"], hours: SignalLearning["hours"], axes: AxisLearning[], goes: SignalLearning["goes"]): string {
  if (agree == null || n < MIN_N) return `Los buses todavía no dicen nada de este semáforo (${n} reportes; hacen falta unos ${MIN_N}).`;
  const pct = (x: number) => `${Math.round(x * 100)} %`;
  const out = [`Según ${n} reportes de buses, encajan ${pct(agree)} con tu medida (al azar sería ~50 %).`];
  if (shift && shift.s !== 0 && Math.abs(shift.s) > 6 && shift.agree - agree >= 0.08) out.push(`Encajarían mejor (${pct(shift.agree)}) con el ciclo corrido ${shift.s > 0 ? "+" : ""}${shift.s} s: puede que el plan se haya corrido; vuelve a medir.`);
  else if (agree >= 0.65) out.push("El ciclo medido se sostiene con los buses.");
  const bad = hours.filter((h) => h.n >= 15 && h.agree < 0.55).map((h) => `${h.h}:00`);
  if (bad.length) out.push(`A estas horas no encaja (otro plan): ${bad.join(", ")}.`);
  const known = axes.filter((a) => a.inverse != null).map((a) => `${a.axis === "NS" ? "norte-sur" : "oriente-occidente"} ${a.inverse ? "al revés" : "igual"}`);
  if (known.length) out.push(`Sentidos: ${known.join("; ")}.`);
  if (goes.n >= 8) out.push(`De ${goes.n} buses que arrancaron, ${goes.ok} lo hicieron justo tras el verde predicho (por azar serían ~${Math.round(goes.chance * goes.n)}).`);
  return out.join(" ");
}

function mean(a: number[]): number { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
