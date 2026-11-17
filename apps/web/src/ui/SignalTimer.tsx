import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { nowMs } from "../clock";
import { type SignalColor as Color, type SignalMark as Mark, SIGNAL_COLOR_NAMES as NAMES, lastSession, measuredSignals, opposite, signalModel, signalNow, summarize } from "@transmi/application";

/**
 * Cronómetro de semáforos (solo en el modo de pruebas, `?pruebas`): el dueño mira un semáforo desde la calle o la ventana y toca
 * «Verde», «Amarillo» o «Rojo» cada vez que cambia. Con eso se mide el ciclo real (cuánto dura cada color) para compararlo con lo que
 * aprenden los buses. Las marcas se guardan en este navegador; «Copiar medidas» las deja listas para pegarlas en el chat.
 * La hora es la del servidor de datos (`nowMs`), la misma con que se comparan los reportes de los buses.
 */
export interface TimedSignal { lon: number; lat: number; title: string; text: string; tm: boolean }

const KEY = "tm.semaforo.marcas.v1";
const idOf = (s: TimedSignal) => `${s.lat.toFixed(6)},${s.lon.toFixed(6)}`;
function loadAll(): Record<string, Mark[]> { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, Mark[]>; } catch { return {}; } }
function saveAll(v: Record<string, Mark[]>) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* sin almacenamiento: quedan solo en pantalla */ } }

export const useSignalTimer = create<{ s: TimedSignal | null; open(s: TimedSignal): void; close(): void }>((set) => ({
  s: null, open: (s) => set({ s }), close: () => set({ s: null }),
}));

/** Los semáforos medidos con su color de ahora (para pintarlos en el mapa). */
export function liveSignals(t: number): { lon: number; lat: number; color: string }[] {
  const out: { lon: number; lat: number; color: string }[] = [];
  // las de este navegador y, para los semáforos que no se midieron aquí, las guardadas en el proyecto
  const local = loadAll(), ids = new Set([...Object.keys(shared), ...Object.keys(local)]);
  for (const id of ids) {
    // las de este navegador si ya alcanzan para un modelo; si no (p. ej. una sola vuelta), las guardadas en el proyecto
    const own = local[id] && signalModel(local[id]!), m = own || (shared[id] && signalModel(shared[id]!));
    if (!m) continue;
    const [lat, lon] = id.split(",").map(Number);
    out.push({ lon: lon!, lat: lat!, color: COLORS[!own && inverse.has(id) ? opposite(m, t) : signalNow(m, t).c] });
  }
  return out;
}
const COLORS: Record<Color, string> = { g: "#16a34a", y: "#f5b301", r: "#dc2626" };
const secs = (ms: number) => `${Math.round(ms / 1000)} s`;
const clock = (t: number) => new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true, timeZone: "America/Bogota" }).format(new Date(t));

/** Medidas guardadas en el proyecto (`tools/data/mediciones-semaforos.json`), para verlas desde cualquier navegador. */
let shared: Record<string, Mark[]> = {};
/** Semáforos guardados que alternan con otro (p. ej. el de TransMilenio): su color es el contrario. */
let inverse = new Set<string>();
export async function loadSharedMeasurements(): Promise<void> {
  try {
    const r = await fetch("https://raw.githubusercontent.com/itsandresortiz/transmi-live/main/tools/data/mediciones-semaforos.json", { cache: "no-cache" });
    if (r.ok) {
      const list = measuredSignals(await r.json()), key = (m: { lat: number; lon: number }) => `${m.lat.toFixed(6)},${m.lon.toFixed(6)}`;
      shared = Object.fromEntries(list.map((m) => [key(m), m.marks]));
      inverse = new Set(list.filter((m) => m.inverse).map(key));
    }
  } catch { /* sin conexión: solo las de este navegador */ }
}

export function SignalTimer() {
  const s = useSignalTimer((x) => x.s), close = useSignalTimer((x) => x.close);
  const [all, setAll] = useState(loadAll);
  const [msg, setMsg] = useState("");
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(id); }, []);
  // las marcas de este navegador o, si aquí no se ha medido, las guardadas en el proyecto
  const id = s ? idOf(s) : "", marks = useMemo(() => (all[id] && signalModel(all[id]!) ? all[id]! : shared[id] ?? all[id] ?? []), [all, id]);
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
