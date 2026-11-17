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
export function summarize(marks: readonly Mark[]): { cycles: number[]; dur: Record<Color, number[]>; preGreen: number[]; text: string } {
  const dur: Record<Color, number[]> = { g: [], y: [], r: [] }, preGreen: number[] = [], cycles: number[] = [];
  // la primera marca de una medición puede no ser un cambio (se empieza a mirar con la luz ya encendida): no se cuenta como inicio
  for (let i = 2; i < marks.length; i++) {
    const a = marks[i - 1]!, b = marks[i]!;
    if (a.c === b.c || b.t - a.t >= 300_000) continue;
    if (a.c === "y" && b.c === "g") preGreen.push(b.t - a.t);      // amarillo antes del verde
    else dur[a.c].push(b.t - a.t);
  }
  const lastOf: Partial<Record<"g" | "r", number>> = {}, per = { g: 0, r: 0 };
  for (const m of marks.slice(1)) {
    if (m.c === "y") continue;
    const p = lastOf[m.c];
    if (p != null && m.t - p <= 300_000 && m.t - p > 10_000) { cycles.push(m.t - p); per[m.c]++; }
    lastOf[m.c] = m.t;
  }
  const rounds = Math.max(per.g, per.r);
  if (!cycles.length) return { cycles, dur, preGreen, text: "Marca al menos dos veces el mismo color (verde o rojo) para calcular el ciclo: unas 2–3 vueltas." };
  const mc = med(cycles), ok = cycles.filter((c) => Math.abs(c - mc) <= mc * 0.25);      // una marca fuera de lugar no cuenta como «varía»
  const spread = Math.max(...ok) - Math.min(...ok);
  const parts = [dur.g.length ? `verde ${secs(med(dur.g))}` : "", dur.y.length ? `amarillo ${secs(med(dur.y))}` : "", dur.r.length ? `rojo ${secs(med(dur.r))}` : "", preGreen.length ? `amarillo antes del verde ${secs(med(preGreen))}` : ""].filter(Boolean);
  const steady = cycles.length < 2 ? "" : spread <= 4000 ? " Se repite igual: parece de tiempo fijo." : ` Varía ${secs(spread)} entre vueltas: puede adaptarse al tráfico.`;
  return { cycles, dur, preGreen, text: `Ciclo de ${secs(med(cycles))} (${rounds} ${rounds === 1 ? "vuelta" : "vueltas"})${parts.length ? `: ${parts.join(", ")}` : ""}.${steady}` };
}

/** Modelo de un semáforo de tiempo fijo a partir de las marcas: el orden de colores desde que se pone rojo, cuánto dura cada uno y
 *  la hora de un inicio de rojo medido. `null` si aún no hay con qué (falta medir al menos una vuelta completa). */
export interface SignalModel { cycle: number; anchor: number; segs: { c: Color; d: number }[] }
/** Más de 5 min sin marcar = otra medición (ningún ciclo de semáforo pasa de ~4 min). */
const SESSION_GAP = 5 * 60_000;
/** Las marcas de la última sesión de medición: puede ser otro plan del semáforo (de noche, en hora pico…), y mezclarlas daría un ciclo
 *  que no existe. Un toque repetido del mismo color en menos de 5 s es un doble toque: cuenta el primero. */
export function lastSession(marks: readonly Mark[]): Mark[] {
  let i = marks.length - 1;
  while (i > 0 && marks[i]!.t - marks[i - 1]!.t <= SESSION_GAP) i--;
  return clean(marks.slice(Math.max(0, i)));
}
function clean(marks: readonly Mark[]): Mark[] {
  const out: Mark[] = [];
  for (const m of marks) { const p = out[out.length - 1]; if (p && p.c === m.c && m.t - p.t < 5000) continue; out.push(m); }
  return out;
}

export function signalModel(all: readonly Mark[]): SignalModel | null {
  const marks = lastSession(all), s = summarize(marks);
  const anchor = [...marks].reverse().find((m) => m.c === "r")?.t;
  if (!s.cycles.length || anchor == null || !s.dur.r.length || !s.dur.g.length) return null;
  const cycle = refineCycle(clean(all), med(s.cycles));
  const raw = [{ c: "r" as Color, d: med(s.dur.r) }, { c: "y" as Color, d: s.preGreen.length ? med(s.preGreen) : 0 }, { c: "g" as Color, d: med(s.dur.g) }, { c: "y" as Color, d: s.dur.y.length ? med(s.dur.y) : 0 }].filter((x) => x.d > 0);
  const k = cycle / raw.reduce((a, x) => a + x.d, 0);       // se ajusta para que sume exactamente el ciclo medido
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
export function measuredSignals(data: unknown): { lat: number; lon: number; title: string; marks: SignalMark[] }[] {
  const list = (data as { mediciones?: { semaforo?: { lat?: number; lon?: number; titulo?: string }; marcas?: [string, string][] }[] } | null)?.mediciones ?? [];
  const C: Record<string, SignalColor> = { verde: "g", amarillo: "y", rojo: "r" };
  return list.flatMap((m) => {
    const lat = Number(m.semaforo?.lat), lon = Number(m.semaforo?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
    const marks = (m.marcas ?? []).map(([t, c]) => ({ t: Date.parse(t), c: C[c]! })).filter((x) => Number.isFinite(x.t) && x.c).sort((a, b) => a.t - b.t);
    return marks.length ? [{ lat, lon, title: String(m.semaforo?.titulo ?? ""), marks }] : [];
  });
}

/** Los semáforos medidos con el color que deberían tener en `t` (para pintarlos en el mapa). */
export function liveSignalColors(measured: readonly { lat: number; lon: number; marks: readonly SignalMark[] }[], t: number): { lon: number; lat: number; c: SignalColor }[] {
  const out: { lon: number; lat: number; c: SignalColor }[] = [];
  for (const m of measured) { const model = signalModel(m.marks); if (model) out.push({ lon: m.lon, lat: m.lat, c: signalNow(model, t).c }); }
  return out;
}
