import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { nowMs } from "../clock";

/**
 * Cronómetro de semáforos (solo en el modo de pruebas, `?pruebas`): el dueño mira un semáforo desde la calle o la ventana y toca
 * «Verde», «Amarillo» o «Rojo» cada vez que cambia. Con eso se mide el ciclo real (cuánto dura cada color) para compararlo con lo que
 * aprenden los buses. Las marcas se guardan en este navegador; «Copiar medidas» las deja listas para pegarlas en el chat.
 * La hora es la del servidor de datos (`nowMs`), la misma con que se comparan los reportes de los buses.
 */
export interface TimedSignal { lon: number; lat: number; title: string; text: string; tm: boolean }
type Color = "g" | "y" | "r";
interface Mark { t: number; c: Color }

const KEY = "tm.semaforo.marcas.v1";
const idOf = (s: TimedSignal) => `${s.lat.toFixed(6)},${s.lon.toFixed(6)}`;
function loadAll(): Record<string, Mark[]> { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, Mark[]>; } catch { return {}; } }
function saveAll(v: Record<string, Mark[]>) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* sin almacenamiento: quedan solo en pantalla */ } }

export const useSignalTimer = create<{ s: TimedSignal | null; open(s: TimedSignal): void; close(): void }>((set) => ({
  s: null, open: (s) => set({ s }), close: () => set({ s: null }),
}));

const NAMES: Record<Color, string> = { g: "verde", y: "amarillo", r: "rojo" };
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y), h = s.length >> 1; return !s.length ? NaN : s.length % 2 ? s[h]! : (s[h - 1]! + s[h]!) / 2; };
const secs = (ms: number) => `${Math.round(ms / 1000)} s`;
const clock = (t: number) => new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true, timeZone: "America/Bogota" }).format(new Date(t));

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

/** Los semáforos medidos con su color de ahora (para pintarlos en el mapa). */
export function liveSignals(t: number): { lon: number; lat: number; color: string }[] {
  const out: { lon: number; lat: number; color: string }[] = [];
  for (const [id, marks] of Object.entries(loadAll())) {
    const m = signalModel(marks);
    if (!m) continue;
    const [lat, lon] = id.split(",").map(Number);
    out.push({ lon: lon!, lat: lat!, color: COLORS[signalNow(m, t).c] });
  }
  return out;
}
const COLORS: Record<Color, string> = { g: "#16a34a", y: "#f5b301", r: "#dc2626" };

export function SignalTimer() {
  const s = useSignalTimer((x) => x.s), close = useSignalTimer((x) => x.close);
  const [all, setAll] = useState(loadAll);
  const [msg, setMsg] = useState("");
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(id); }, []);
  const id = s ? idOf(s) : "", marks = useMemo(() => all[id] ?? [], [all, id]);
  if (!s) return null;
  const add = (c: Color) => { const next = { ...all, [id]: [...marks, { t: nowMs(), c }] }; setAll(next); saveAll(next); if (navigator.vibrate) navigator.vibrate(30); };
  const undo = () => { const next = { ...all, [id]: marks.slice(0, -1) }; setAll(next); saveAll(next); };
  const clear = () => { if (!confirm("¿Borrar las marcas de este semáforo?")) return; const next = { ...all }; delete next[id]; setAll(next); saveAll(next); };
  const session = lastSession(marks), sum = summarize(session), last = marks[marks.length - 1], model = signalModel(marks), live = model ? signalNow(model, nowMs()) : null;
  const sessions = marks.length ? marks.reduce((n, m, i) => n + (i > 0 && m.t - marks[i - 1]!.t > 15 * 60_000 ? 1 : 0), 1) : 0;
  const copy = async () => {
    const data = { semaforo: { titulo: s.title, lat: s.lat, lon: s.lon, transmilenio: s.tm }, resumen: sum.text, marcas: marks.map((m) => [new Date(m.t).toISOString(), NAMES[m.c]]) };
    const txt = `Medidas del semáforo ${s.title}${s.tm ? " (TM)" : ""}\n${sum.text}\n${JSON.stringify(data)}`;
    try { await navigator.clipboard.writeText(txt); setMsg("Copiado: pégalo en el chat."); }
    catch { try { await navigator.share?.({ text: txt }); } catch { setMsg("No se pudo copiar."); } }
  };
  const copyAll = async () => {
    const data = Object.entries(loadAll()).filter(([, m]) => m.length).map(([key, m]) => ({ semaforo: key, resumen: summarize(lastSession(m)).text, marcas: m.map((x) => [new Date(x.t).toISOString(), NAMES[x.c]]) }));
    const txt = `Medidas de ${data.length} semáforo${data.length === 1 ? "" : "s"} (TransMi LIVE)\n${JSON.stringify(data)}`;
    try { await navigator.clipboard.writeText(txt); setMsg(`Copiadas las medidas de ${data.length} semáforo${data.length === 1 ? "" : "s"}: pégalas en el chat.`); }
    catch { try { await navigator.share?.({ text: txt }); } catch { setMsg("No se pudo copiar."); } }
  };
  const btn = (c: Color, label: string, bg: string) => <button className="btn" style={{ flex: 1, minHeight: 64, fontSize: 17, background: bg, color: c === "y" ? "#111" : "#fff" }} onClick={() => add(c)}>{label}</button>;
  return (
    <div className="glass" role="dialog" aria-label="Cronómetro del semáforo" style={{ position: "fixed", zIndex: 70, left: "50%", transform: "translateX(-50%)", bottom: "calc(16px + env(safe-area-inset-bottom,0px))", width: "min(94vw,440px)", padding: 14, borderRadius: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <small className="kick">Cronómetro (pruebas){s.tm ? " · semáforo de TransMilenio" : ""}</small>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{s.title}</div>
        </div>
        <button className="btn" aria-label="Cerrar" onClick={close}>✕</button>
      </div>
      <p className="cs" style={{ fontSize: 12.5, margin: "6px 0 10px", opacity: 0.8 }}>{s.text}</p>
      <div style={{ display: "flex", gap: 8 }}>{btn("g", "Verde", "#16a34a")}{btn("y", "Amarillo", "#f5b301")}{btn("r", "Rojo", "#dc2626")}</div>
      <p style={{ fontSize: 14, margin: "10px 0 4px" }}>{last ? `Último: ${NAMES[last.c]} a las ${clock(last.t)} · hace ${secs(nowMs() - last.t)}` : "Toca el color en el momento en que cambia la luz."}</p>
      <p className="cs" style={{ fontSize: 13.5, margin: "0 0 8px" }}>{sessions > 1 ? `Medición más reciente (${session.length} marcas; ${sessions} mediciones guardadas)` : `${marks.length} marcas`} · {sum.text}</p>
      {live ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 10px", padding: "8px 10px", borderRadius: 12, background: "var(--hover)" }}>
          <span aria-hidden style={{ width: 22, height: 22, borderRadius: 11, background: COLORS[live.c], boxShadow: `0 0 12px ${COLORS[live.c]}` }} />
          <span style={{ fontSize: 15, fontWeight: 650 }}>Debería estar en {NAMES[live.c]} · cambia en {Math.ceil(live.left / 1000)} s</span>
        </div>
      ) : null}
      {live ? <p className="cs" style={{ fontSize: 12, margin: "-4px 0 8px", opacity: 0.75 }}>Es una predicción con tus medidas (tiempo fijo). Si no coincide con la calle, cambió de plan: vuelve a medir.</p> : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn primary" onClick={() => void copy()} disabled={!marks.length}>Copiar medidas</button>
        <button className="btn" onClick={() => void copyAll()}>Copiar todos</button>
        <button className="btn" onClick={undo} disabled={!marks.length}>Deshacer</button>
        <button className="btn" onClick={clear} disabled={!marks.length}>Borrar</button>
      </div>
      {msg ? <p className="cs" style={{ marginTop: 6 }}>{msg}</p> : null}
    </div>
  );
}
