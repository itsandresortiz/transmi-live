import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { advanced } from "./layout";
import { Close, Directions, Search } from "./icons";
import { haptic } from "./haptics";
import { type SheetState, type Tab, useUi } from "./store";
import { useTransitVersion } from "./hooks";
import { usePlanner } from "./plannerStore";

const TABS: [Tab, string][] = [["viaje", "Cómo llegar"], ["rutas", "Rutas"], ["buses", "Buses"], ["paradas", "Paradas"]];
const PEEK = 152;

export const sheetHeight = () => window.innerHeight - 76 - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sat")) || 0);
const offsetOf = (s: SheetState, h: number) => (s === "peek" ? h - PEEK : s === "half" ? h * 0.46 : 0);

export function Sheet({ children }: { children: ReactNode }) {
  const { tab, setTab, query, setQuery, sheet, setSheet, routeId, stopId, groupIds, stopRoute } = useUi();
  // al abrir una ruta, parada o estación el panel pasa a ser «de detalle»: sin buscador ni pestañas (como en Mapas de Apple), con toda la altura para el contenido
  const detail = (tab === "rutas" && !!routeId) || !!stopId || !!groupIds;
  useTransitVersion();
  const el = useRef<HTMLElement>(null);
  const drag = useRef<{ y0: number; off0: number; moved: boolean; t: number; y: number; v: number } | null>(null);

  const apply = useCallback((s: SheetState) => {
    const e = el.current; if (!e) return;
    const h = e.offsetHeight, off = offsetOf(s, h);
    e.style.setProperty("--sy", `${off}px`);
    document.documentElement.dataset.sheet = s;
    document.documentElement.style.setProperty("--vis", advanced() ? "0px" : `${h - off}px`);
  }, []);
  useEffect(() => { apply(sheet); const on = () => apply(useUi.getState().sheet); window.addEventListener("resize", on); return () => window.removeEventListener("resize", on); }, [sheet, apply]);
  // como en Mapas de Apple: al abrir una ruta, una parada o las opciones de un viaje, el panel sube hasta arriba para verlo todo
  const hasTrip = usePlanner((p) => !!p.results?.length);
  useEffect(() => { if (routeId && useUi.getState().sheet !== "full") setSheet("full"); }, [routeId, setSheet]);
  useEffect(() => { if (tab === "viaje" && hasTrip && useUi.getState().sheet !== "full") setSheet("full"); }, [tab, hasTrip, setSheet]);

  const down = (ev: React.PointerEvent) => {
    if (advanced() || (ev.target as HTMLElement).closest("input,button.tab,button.clear")) return;
    const e = el.current!;
    drag.current = { y0: ev.clientY, off0: offsetOf(sheet, e.offsetHeight), moved: false, t: performance.now(), y: ev.clientY, v: 0 };
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    e.classList.add("dragging");
  };
  const move = (ev: React.PointerEvent) => {
    const d = drag.current, e = el.current; if (!d || !e) return;
    const dy = ev.clientY - d.y0;
    const t = performance.now(), dt = t - d.t;
    if (dt > 0) d.v = d.v * 0.4 + ((ev.clientY - d.y) / dt) * 0.6;       // velocidad suavizada (px/ms; positivo = hacia abajo)
    d.t = t; d.y = ev.clientY;
    if (Math.abs(dy) > 4) d.moved = true;
    e.style.setProperty("--sy", `${Math.min(e.offsetHeight - 80, Math.max(0, d.off0 + dy))}px`);
  };
  const up = (ev: React.PointerEvent) => {
    const d = drag.current, e = el.current; if (!d || !e) return;
    drag.current = null; e.classList.remove("dragging");
    const h = e.offsetHeight, off = Math.min(h - 80, Math.max(0, d.off0 + ev.clientY - d.y0));
    if (!d.moved) { setSheet(sheet === "peek" ? "half" : sheet === "half" ? "full" : "peek"); return; }
    const cands: SheetState[] = ["full", "half", "peek"];
    // con un deslizón rápido se salta al siguiente nivel en esa dirección; si no, al más cercano (con un empujoncito según la velocidad)
    const order: SheetState[] = ["full", "half", "peek"];
    const here = order.indexOf(sheet);
    const flick = Math.abs(d.v) > 0.45 && performance.now() - d.t < 90;
    const best = flick ? order[Math.min(2, Math.max(0, here + (d.v > 0 ? 1 : -1)))]! : cands.reduce((a, b) => Math.abs(offsetOf(a, h) - (off + d.v * 120)) <= Math.abs(offsetOf(b, h) - (off + d.v * 120)) ? a : b);
    if (best === sheet) apply(best); else setSheet(best);
  };

  return (
    <main className="sheet glass" ref={el} aria-label="Rutas, buses, paradas y avisos">
      <div className="shead" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <div className="grab" role="button" tabIndex={0} aria-label="Subir o bajar el panel" onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setSheet(sheet === "peek" ? "half" : "peek"); }}><i /></div>
        {tab !== "viaje" && !detail && <label className="search">
          <Search />
          <input type="search" inputMode="search" enterKeyHint="search" autoComplete="off" autoCapitalize="off" spellCheck={false}
            placeholder={tab === "paradas" ? "Buscar parada o estación" : tab === "buses" ? "Buscar placa o ruta" : tab === "avisos" ? "Buscar aviso por ruta o parada" : "Buscar ruta o destino"}
            aria-label="Buscar" value={query} onFocus={() => sheet === "peek" && setSheet("half")} onChange={(e) => setQuery(e.target.value)} />
          {query && <button className="clear" type="button" aria-label="Borrar búsqueda" onClick={() => setQuery("")}><Close /></button>}
        </label>}
        {!detail && <div className="tabs" role="tablist">
          {TABS.map(([t, l]) => (
            <button key={t} className={`tab${t === "viaje" ? " hot" : ""}`} role="tab" aria-selected={tab === t} onClick={() => { haptic(); setTab(t); useUi.getState().setRoute(null); if (useUi.getState().sheet === "peek") setSheet("half"); }}>
              {t === "viaje" && <Directions />}{l}
            </button>
          ))}
        </div>}
      </div>
      <div className="view" role="tabpanel" aria-live="polite"><div className="vk" key={`${tab}|${routeId ?? ""}|${stopId ?? ""}|${groupIds?.join(",") ?? ""}|${stopRoute?.routeId ?? ""}`}>{children}</div></div>
    </main>
  );
}
