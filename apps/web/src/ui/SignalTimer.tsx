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
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)]! : NaN; };
const secs = (ms: number) => `${Math.round(ms / 1000)} s`;
const clock = (t: number) => new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true, timeZone: "America/Bogota" }).format(new Date(t));

/** Lo que se puede decir con las marcas: duración del ciclo y de cada color, y si se repite igual (tiempo fijo) o cambia. */
export function summarize(marks: readonly Mark[]): { cycles: number[]; dur: Record<Color, number[]>; text: string } {
  const dur: Record<Color, number[]> = { g: [], y: [], r: [] }, cycles: number[] = [];
  for (let i = 1; i < marks.length; i++) { const a = marks[i - 1]!, b = marks[i]!; if (a.c !== b.c && b.t - a.t < 600_000) dur[a.c].push(b.t - a.t); }
  const lastOf: Partial<Record<Color, number>> = {}, per: Record<Color, number> = { g: 0, y: 0, r: 0 };
  for (const m of marks) { const p = lastOf[m.c]; if (p != null && m.t - p < 900_000 && m.t - p > 10_000) { cycles.push(m.t - p); per[m.c]++; } lastOf[m.c] = m.t; }
  const rounds = Math.max(per.g, per.y, per.r);      // vueltas completas medidas (cada color da su propia medida del ciclo)
  if (cycles.length < 2) return { cycles, dur, text: "Marca al menos 3 cambios del mismo color (unas 3 vueltas) para calcular el ciclo." };
  const spread = Math.max(...cycles) - Math.min(...cycles);
  const parts = (["g", "y", "r"] as Color[]).filter((c) => dur[c].length).map((c) => `${NAMES[c]} ${secs(med(dur[c]))}`);
  return { cycles, dur, text: `Ciclo de ${secs(med(cycles))} (${rounds} ${rounds === 1 ? "vuelta" : "vueltas"})${parts.length ? `: ${parts.join(", ")}` : ""}. ${spread <= 4000 ? "Se repite igual: parece de tiempo fijo." : `Varía ${secs(spread)} entre vueltas: puede adaptarse al tráfico.`}` };
}

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
  const sum = summarize(marks), last = marks[marks.length - 1];
  const copy = async () => {
    const data = { semaforo: { titulo: s.title, lat: s.lat, lon: s.lon, transmilenio: s.tm }, resumen: sum.text, marcas: marks.map((m) => [new Date(m.t).toISOString(), NAMES[m.c]]) };
    const txt = `Medidas del semáforo ${s.title}${s.tm ? " (TM)" : ""}\n${sum.text}\n${JSON.stringify(data)}`;
    try { await navigator.clipboard.writeText(txt); setMsg("Copiado: pégalo en el chat."); }
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
      <p className="cs" style={{ fontSize: 13.5, margin: "0 0 8px" }}>{marks.length} marcas · {sum.text}</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn primary" onClick={() => void copy()} disabled={!marks.length}>Copiar medidas</button>
        <button className="btn" onClick={undo} disabled={!marks.length}>Deshacer</button>
        <button className="btn" onClick={clear} disabled={!marks.length}>Borrar</button>
      </div>
      {msg ? <p className="cs" style={{ marginTop: 6 }}>{msg}</p> : null}
    </div>
  );
}
