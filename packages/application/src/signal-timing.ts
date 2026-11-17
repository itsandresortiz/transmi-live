/**
 * Tiempos de un semáforo medidos a mano (cronómetro de la web en modo de pruebas): con las marcas «verde / amarillo / rojo» se calcula
 * el ciclo y cuánto dura cada color y, si es de tiempo fijo, en qué color debería estar en cada momento. Lo usan la web y la app (solo
 * en modo de pruebas: el color en vivo NO se muestra a los usuarios, ver 07-decisions).
 */
export type SignalColor = "g" | "y" | "r";
type Color = SignalColor;
export interface SignalMark { t: number; c: SignalColor }
type Mark = SignalMark;

export const SIGNAL_COLOR_NAMES: Record<Color, string> = { g: "verde", y: "amarillo", r: "rojo" };
const NAMES = SIGNAL_COLOR_NAMES;
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y), h = s.length >> 1; return !s.length ? NaN : s.length % 2 ? s[h]! : (s[h - 1]! + s[h]!) / 2; };
const secs = (ms: number) => `${Math.round(ms / 1000)} s`;

/** Lo que se puede decir con las marcas: duración del ciclo y de cada color, y si se repite igual (tiempo fijo) o cambia.
 *  En Colombia el amarillo sale dos veces por vuelta (antes del rojo y, junto al rojo, antes del verde): el ciclo se mide entre dos
 *  verdes o entre dos rojos, nunca entre amarillos, y cada amarillo se cuenta según lo que viene después. */
export function summarize(marks: readonly Mark[]): { cycles: number[]; dur: Record<Color, number[]>; preGreen: number[]; text: string; cycle?: number } {
  const dur: Record<Color, number[]> = { g: [], y: [], r: [] }, preGreen: number[] = [], cycles: number[] = [];
  // la primera marca de una medición puede no ser un cambio (se empieza a mirar con la luz ya encendida): no se cuenta como inicio
  for (let i = 2; i < marks.length; i++) {
    const a = marks[i - 1]!, b = marks[i]!;
    if (a.t - marks[i - 2]!.t > 100_000) continue;      // tras una pausa larga, la luz ya llevaba rato encendida: no es una duración completa
    if (a.c === b.c || b.t - a.t >= 300_000) continue;
    if (a.c === "y" && b.c === "g") preGreen.push(b.t - a.t);      // amarillo antes del verde
    else dur[a.c].push(b.t - a.t);
  }
  const lastOf: Partial<Record<"g" | "r", number>> = {}, per = { g: 0, r: 0 };
  // una marca tras más de 100 s sin marcar no se sabe si fue un cambio (se dejó de mirar un rato y se volvió con la luz encendida):
  // no sirve para medir el ciclo
  for (let i = 1; i < marks.length; i++) {
    const m = marks[i]!;
    if (m.c === "y") continue;
    if (m.t - marks[i - 1]!.t > 100_000) { lastOf[m.c] = undefined; continue; }
    const p = lastOf[m.c];
    if (p != null && m.t - p <= 300_000 && m.t - p > 10_000) { cycles.push(m.t - p); per[m.c]++; }
    lastOf[m.c] = m.t;
  }
  const rounds = Math.max(per.g, per.r);
  if (!cycles.length) return { cycles, dur, preGreen, text: "Marca al menos dos veces el mismo color (verde o rojo) para calcular el ciclo: unas 2–3 vueltas." };
  // el ciclo: se prueba cada vuelta medida (afinada con las marcas lejanas) y se queda la que hace encajar más cambios a verde y a
  // rojo (±3 s). Así un toque tarde no corre el ciclo, como pasa con un promedio o una mediana
  // candidatas: cada vuelta medida, la mitad de las que saltaron una vuelta (marcas que faltaron) y su segundo entero más cercano
  // (solo se parten las vueltas claramente más largas que la más corta, y ningún ciclo puede durar menos que un rojo con sus amarillos)
  const base0 = med(cycles), shortest = Math.min(...cycles), cands: number[] = [];
  const floor = (dur.r.length ? Math.max(...dur.r) : 0) + 2 * (dur.y.length ? med(dur.y) : 0) + 10_000;
  for (const c of cycles) for (const k of [1, 2, 3]) {
    if (k > 1 && c < shortest * 1.6) continue;
    const v = c / k;
    if (v >= Math.max(30_000, floor) && v <= 240_000) cands.push(v, Math.round(v / 1000) * 1000);
  }
  if (!cands.length) cands.push(base0);
  const points = (["g", "r"] as const).map((c) => marks.filter((m, i) => m.c === c && i > 0 && m.t - marks[i - 1]!.t <= 100_000).map((m) => m.t));
  // cuántas marcas de un color caen (±3 s) en una cuadrícula del ciclo; cada marca se prueba como referencia y vale la mejor
  const fitOf = (ts: readonly number[], cyc: number) => {
    let best = { f: 0, w: 0 };
    for (const a of ts) {
      let f = 0, w = 0;
      for (const t of ts) { const off = Math.abs(t - a - Math.round((t - a) / cyc) * cyc); if (off <= 3000) f++; else w = Math.max(w, off); }
      if (f > best.f) best = { f, w };
    }
    return best;
  };
  const score = (cyc: number) => {
    let fit = 0, total = 0, worst = 0;
    const byColor = points.map((ts) => { const r = fitOf(ts, cyc); fit += r.f; total += ts.length; worst = Math.max(worst, r.w); return { fit: r.f, total: ts.length }; });
    return { fit, total, worst, byColor };
  };
  void base0;
  let cyc = refineCycle(marks, med(cands)), best = score(cyc);
  // vale más un ciclo en el que todos los cambios de un color (al menos 3) caen exactos: es lo típico de un cruce coordinado, que fija
  // el inicio de una fase y ajusta la otra según el tráfico (medido: rojos cada 120 s exactos y verdes corridos unos segundos)
  const value = (sc: ReturnType<typeof score>) => sc.fit + (sc.byColor.some((c) => c.total >= 3 && c.fit === c.total) ? 1.5 : 0);
  for (const c of cands) { const cc = refineCycle(marks, c), sc = score(cc); if (value(sc) > value(best) || (value(sc) === value(best) && sc.worst < best.worst)) { cyc = cc; best = sc; } }
  const { fit, total, worst, byColor } = best;
  const [pg, pr] = byColor;      // verde, rojo
  const restG = cyc - (dur.r.length ? med(dur.r) : 0) - (dur.y.length ? med(dur.y) : 0) - (preGreen.length ? med(preGreen) : 0);
  const greenTxt = dur.r.length && dur.y.length && restG > 3000 ? restG : dur.g.length ? med(dur.g) : NaN;      // el verde: lo que queda del ciclo
  const parts = [Number.isFinite(greenTxt) ? `verde ${secs(greenTxt)}` : "", dur.y.length ? `amarillo ${secs(med(dur.y))}` : "", dur.r.length ? `rojo ${secs(med(dur.r))}` : "", preGreen.length ? `amarillo antes del verde ${secs(med(preGreen))}` : ""].filter(Boolean);
  const steady = total < 3 || rounds < 2 ? ""      // con una sola vuelta no se puede decir si se repite
    : fit === total ? " Se repite igual: parece de tiempo fijo."
    : pr && pg && pr.total >= 2 && pr.fit === pr.total && pg.fit < pg.total ? ` El rojo empieza siempre en el mismo punto del ciclo; el verde varía unos segundos (el rojo dura entre ${secs(Math.min(...dur.r))} y ${secs(Math.max(...dur.r))}): ciclo fijo que ajusta el tiempo del cruce según el tráfico.`
    : pr && pg && pg.total >= 2 && pg.fit === pg.total && pr.fit < pr.total ? ` El verde empieza siempre en el mismo punto del ciclo; el rojo varía unos segundos: ciclo fijo que ajusta el tiempo del cruce según el tráfico.`
    : fit / total >= 0.7 ? ` ${fit} de ${total} cambios caen justo en un ciclo fijo; ${total - fit} se corrieron hasta ${secs(worst)} (puede ser el toque o que se adapte al tráfico).`
    : ` Solo ${fit} de ${total} cambios caen en un ciclo fijo: parece adaptarse al tráfico.`;
  return { cycles, dur, preGreen, cycle: cyc, text: `Ciclo de ${secs(cyc)} (${rounds} ${rounds === 1 ? "vuelta" : "vueltas"})${parts.length ? `: ${parts.join(", ")}` : ""}.${steady}` };
}

/** Modelo de un semáforo de tiempo fijo a partir de las marcas: el orden de colores desde que se pone rojo, cuánto dura cada uno y
 *  la hora de un inicio de rojo medido. `null` si aún no hay con qué (falta medir al menos una vuelta completa). */
export interface SignalModel { cycle: number; anchor: number; segs: { c: Color; d: number }[] }
/** Más de 5 min sin marcar = otra medición (ningún ciclo de semáforo pasa de ~4 min). */
const SESSION_GAP = 5 * 60_000;
/** Las marcas de la última sesión de medición: puede ser otro plan del semáforo (de noche, en hora pico…), y mezclarlas daría un ciclo
 *  que no existe. Un toque repetido del mismo color en menos de 10 s es un doble toque (o un amarillo marcado como rojo): cuenta el primero. */
export function lastSession(marks: readonly Mark[]): Mark[] {
  let i = marks.length - 1;
  while (i > 0 && marks[i]!.t - marks[i - 1]!.t <= SESSION_GAP) i--;
  return clean(marks.slice(Math.max(0, i)));
}
function clean(marks: readonly Mark[]): Mark[] {
  const out: Mark[] = [];
  for (const m of marks) { const p = out[out.length - 1]; if (p && p.c === m.c && m.t - p.t < 10_000) continue; out.push(m); }      // un mismo color dos veces en <10 s: un solo cambio
  return out;
}

export function signalModel(all: readonly Mark[]): SignalModel | null {
  const marks = lastSession(all), s = summarize(marks);
  const last = [...marks].reverse().find((m) => m.c === "r")?.t;
  if (!s.cycles.length || last == null || !s.dur.r.length || !s.dur.g.length) return null;
  // los semáforos cuentan en segundos enteros: si el ciclo medido queda a menos de medio segundo de uno (119,84 → 120), se usa ese,
  // para que el error no se acumule con las horas (0,16 s por vuelta son ~5 s en una hora)
  const measured = s.cycle ?? refineCycle(clean(all), med(s.cycles)), whole = Math.round(measured / 1000) * 1000;
  const cycle = Math.abs(measured - whole) < 500 ? whole : measured;
  // la referencia: el promedio de todos los inicios de rojo bien marcados (no un solo toque, que puede venir tarde o temprano)
  const reds = marks.filter((m, i) => m.c === "r" && i > 0 && m.t - marks[i - 1]!.t <= 100_000).map((m) => m.t);
  const res = reds.map((t) => { const d = t - last; return d - Math.round(d / cycle) * cycle; }).filter((r) => Math.abs(r) <= 3000);
  const anchor = last + (res.length ? res.reduce((a, b) => a + b, 0) / res.length : 0);
  // el verde es lo que queda del ciclo: los toques de inicio de verde suelen ser los menos confiables (se empieza a mirar en verde) y,
  // en un cruce que ajusta su tiempo, el rojo medido + los amarillos + el ciclo fijo dan el verde mejor que su mediana
  const R = med(s.dur.r), Yg = s.preGreen.length ? med(s.preGreen) : 0, Yb = s.dur.y.length ? med(s.dur.y) : 0;
  const G = cycle - R - Yg - Yb > 3000 ? cycle - R - Yg - Yb : med(s.dur.g);
  const raw = [{ c: "r" as Color, d: R }, { c: "y" as Color, d: Yg }, { c: "g" as Color, d: G }, { c: "y" as Color, d: Yb }].filter((x) => x.d > 0);
  const k = cycle / raw.reduce((a, x) => a + x.d, 0);       // por si acaso, que sume exactamente el ciclo
  return { cycle, anchor, segs: raw.map((x) => ({ c: x.c, d: x.d * k })) };
}
/** Afina el ciclo con marcas lejanas del mismo color: si entre el primer y el último verde (o rojo) caben justo N vueltas, el ciclo es
 *  ese tiempo / N (con 14 vueltas el error de un toque se divide entre 14). Si no encajan (otro plan), queda el ciclo medido. */
function refineCycle(all: readonly Mark[], base: number): number {
  let best = base, bestN = 1;
  for (const c of ["g", "r"] as const) {
    const ts = all.filter((m) => m.c === c).map((m) => m.t);
    for (let i = 0; i < ts.length; i++) for (let j = ts.length - 1; j > i; j--) {
      const span = ts[j]! - ts[i]!, n = Math.round(span / base);
      if (n > bestN && Math.abs(span / n - base) < 1500 && span < 6 * 3_600_000) {
        // todas las marcas de ese color entre i y j deben caer en el mismo ritmo (si no, en medio hubo otro plan)
        const fit = ts.slice(i, j + 1).every((t) => { const k = (t - ts[i]!) / (span / n); return Math.abs(k - Math.round(k)) * (span / n) < 4000; });
        if (fit) { best = span / n; bestN = n; }
        break;
      }
    }
  }
  return best;
}

/** Color que debería tener ahora y cuántos ms faltan para el siguiente cambio. */
export function signalNow(m: SignalModel, t: number): { c: Color; left: number } {
  let into = ((t - m.anchor) % m.cycle + m.cycle) % m.cycle;
  for (const s of m.segs) { if (into < s.d) return { c: s.c, left: s.d - into }; into -= s.d; }
  return { c: m.segs[0]!.c, left: 0 };
}


/** Lee el archivo de medidas guardadas en el proyecto (`tools/data/mediciones-semaforos.json`). */
export function measuredSignals(data: unknown): { lat: number; lon: number; title: string; marks: SignalMark[]; inverse: boolean; tm: boolean; follows: boolean; /** El semáforo al que sigue (si sigue a otro). */ ref?: { lat: number; lon: number } }[] {
  const list = (data as { mediciones?: { semaforo?: { lat?: number; lon?: number; titulo?: string; transmilenio?: boolean }; marcas?: [string, string][]; igual_a?: number; opuesto_de?: number }[] } | null)?.mediciones ?? [];
  const C: Record<string, SignalColor> = { verde: "g", amarillo: "y", rojo: "r" };
  const parse = (m: { marcas?: [string, string][] } | undefined) => (m?.marcas ?? []).map(([t, c]) => ({ t: Date.parse(t), c: C[c]! })).filter((x) => Number.isFinite(x.t) && x.c);
  return list.flatMap((m) => {
    const lat = Number(m.semaforo?.lat), lon = Number(m.semaforo?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
    // `igual_a`: un semáforo que cambia junto con otro (mismo cruce, mismo plan) usa también las marcas de ese otro
    // `opuesto_de`: uno que alterna con otro (p. ej. el de TransMilenio con los de carros): sus marcas, con los colores al revés
    const ref = typeof m.igual_a === "number" ? m.igual_a : typeof m.opuesto_de === "number" ? m.opuesto_de : -1;
    const shared = ref >= 0 && ref !== list.indexOf(m) ? parse(list[ref]) : [];
    const inverse = typeof m.opuesto_de === "number" && shared.length > 0;
    // (el ciclo sale de las del otro: las propias suelen ser pocas y de otra hora, y la medición más reciente mandaría)
    const marks = (shared.length ? shared : parse(m)).sort((a, b) => a.t - b.t);
    return marks.length ? [{ lat, lon, title: String(m.semaforo?.titulo ?? ""), marks, inverse, tm: m.semaforo?.transmilenio === true, follows: shared.length > 0, ref: shared.length ? { lat: Number(list[ref]!.semaforo?.lat), lon: Number(list[ref]!.semaforo?.lon) } : undefined }] : [];
  });
}

/** Los semáforos medidos con el color que deberían tener en `t` (para pintarlos en el mapa). */
export function liveSignalColors(measured: readonly { lat: number; lon: number; marks: readonly SignalMark[]; inverse?: boolean }[], t: number): { lon: number; lat: number; c: SignalColor }[] {
  const out: { lon: number; lat: number; c: SignalColor }[] = [];
  for (const m of measured) { const model = signalModel(m.marks); if (model) out.push({ lon: m.lon, lat: m.lat, c: m.inverse ? opposite(model, t) : signalNow(model, t).c }); }
  return out;
}

/** Color de un semáforo que alterna con el medido: verde mientras aquel está en rojo; amarillo en los ~2 s antes de que aquel pase a
 *  verde (es cuando este debe cerrar); rojo mientras aquel está en verde o en su amarillo (despeje). */
export function opposite(m: SignalModel, t: number): SignalColor {
  let into = ((t - m.anchor) % m.cycle + m.cycle) % m.cycle;
  for (let i = 0; i < m.segs.length; i++) {
    const seg = m.segs[i]!;
    if (into < seg.d) {
      if (seg.c === "r") return "g";
      const prev = m.segs[(i - 1 + m.segs.length) % m.segs.length]!;
      return seg.c === "y" && prev.c === "r" ? "y" : "r";
    }
    into -= seg.d;
  }
  return "r";
}
