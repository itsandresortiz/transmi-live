import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { connectionStatus, type ConnectionStatus } from "@transmi/application";
import { SYSTEM_LABEL } from "@transmi/domain";
import { CONFIG, liveData, networkSource, transit } from "./composition-root";
import { BusRenderer } from "./map/BusRenderer";
import { MapController } from "./map/MapController";
import { currentScheme, themeOf, type Scheme } from "./map/theme";
import estaciones from "./data/estaciones.json";
import { Settings } from "./ui/Settings";
import { Sheet } from "./ui/Sheet";
import { Locate, Mark, Sliders } from "./ui/icons";
import { ago } from "./ui/format";
import { useNow, useTransitVersion } from "./ui/hooks";
import { mapPadding } from "./ui/layout";
import { useUi } from "./ui/store";
import { type Actions, AlertsView, BusPopup, BusesView, RouteDetailView, RoutesView, StationPopup, StopPopup, StopsView } from "./ui/views";

const POLL_MS = 2500;

export function App() {
  const mapEl = useRef<HTMLDivElement>(null);
  const mc = useRef<MapController | null>(null);
  const br = useRef<BusRenderer | null>(null);
  const popupRoot = useRef<ReturnType<typeof createRoot> | null>(null);
  const [scheme, setScheme] = useState<Scheme>(currentScheme);
  const [net, setNet] = useState(0);
  const th = useMemo(() => themeOf(scheme), [scheme]);
  const ui = useUi();
  const thRef = useRef(th); thRef.current = th;
  const uiRef = useRef(ui); uiRef.current = ui;

  /* ---------- acciones (lo que el usuario pide a la aplicación) ---------- */
  const closePopup = useCallback(() => { mc.current?.closePopup(); popupRoot.current?.unmount(); popupRoot.current = null; }, []);
  const popup = useCallback((p: { lat: number; lon: number }, node: React.ReactNode) => {
    const m = mc.current; if (!m) return;
    popupRoot.current?.unmount();
    const host = document.createElement("div");
    const root = createRoot(host);
    root.render(node);
    popupRoot.current = root;
    m.showPopup(p, host, () => { if (popupRoot.current === root) { popupRoot.current = null; setTimeout(() => root.unmount()); } });
  }, []);

  const act: Actions = useMemo(() => {
    const s = () => useUi.getState();
    const a: Actions = {
      openRoute(id) {
        closePopup(); s().setFollow(null); s().setRoute(id); s().setTab("rutas"); s().setRoute(id);
      },
      focusBus(id, keepTarget = false) {
        if (!keepTarget) s().setTargetStop(null);
        const v = transit.fleet.get(id), m = mc.current; if (!v || !m) return;
        const p = br.current?.position(id) ?? v.position;
        s().setSheet("peek");
        m.flyTo(p, Math.max(m.zoom, 16), { ...mapPadding(), top: 300 });
        popup(p, <BusPopup v={v} th={thRef.current} following={s().followId === id}
          onFollow={() => { const f = s().followId === id ? null : id; s().setFollow(f); closePopup(); s().showToast(f ? "Siguiendo este bus" : "Dejaste de seguirlo"); }}
          onRoute={() => a.openRoute(v.routeId)} />);
      },
      focusStop(id) {
        const st = transit.stopById(id), m = mc.current; if (!st || !m) return;
        s().setTargetStop(id);
        m.flyTo(st.position, Math.max(m.zoom, 16), { ...mapPadding(), top: 410 });
        popup(st.position, <StopPopup stopId={id} th={thRef.current} onRoute={a.openRoute} onBus={(bid) => a.focusBus(bid, true)} />);
      },
      focusStation(i) {
        const e = (estaciones as [number, number, string, string, string][])[i], m = mc.current; if (!e || !m) return;
        const p = { lat: e[0], lon: e[1] };
        m.flyTo(p, 16.5, mapPadding());
        popup(p, <StationPopup index={i} />);
      },
      focusAlert(i) {
        const al = transit.alerts[i], m = mc.current; if (!al || !m) return;
        const pts = al.stopIds.map((id) => transit.stopById(id)?.position).filter((p): p is NonNullable<typeof p> => !!p);
        if (!pts.length) { s().showToast("Este aviso no tiene paradas en el mapa"); return; }
        m.setAlertStops(pts); m.fit(pts, mapPadding(), 15.5); s().setSheet("peek");
      },
    };
    return a;
  }, [closePopup, popup]);

  /* ---------- mapa, buses y datos en vivo ---------- */
  useEffect(() => {
    const m = new MapController(mapEl.current!, currentScheme(), {
      onBusClick: (id) => act.focusBus(id),
      onStopClick: (id) => act.focusStop(id),
      onStationClick: (i) => act.focusStation(i),
    });
    mc.current = m;
    const r = new BusRenderer(transit, m, () => {
      const u = uiRef.current;
      return { colorMode: u.colorMode, motion: u.motion, system: u.tab === "buses" || u.tab === "rutas" ? u.system : null, routeId: u.tab === "rutas" ? u.routeId : null, visible: u.layers.buses };
    }, () => thRef.current);
    br.current = r;
    (window as unknown as { __tm: unknown }).__tm = { transit, map: m, renderer: r, liveData, act };
    let stopped = false;
    void m.ready.then(() => { if (!stopped) { r.start(); m.setToggles(uiRef.current.layers); } });

    const poll = async () => {
      try { await liveData.refresh(); } catch { /* el estado de conexión lo muestra */ }
    };
    void poll();
    const t = setInterval(poll, POLL_MS);
    const vis = () => { if (!document.hidden) void liveData.refresh(true).catch(() => {}); };
    document.addEventListener("visibilitychange", vis);

    void networkSource.load().then((n) => {
      if (stopped) return;
      transit.setNetwork(n);
      void m.ready.then(() => { m.setNetwork(n); setNet((x) => x + 1); });
    }).catch(() => uiRef.current.showToast("No pudimos cargar las rutas; los buses siguen en vivo"));

    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => setScheme(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onScheme);
    return () => { stopped = true; clearInterval(t); document.removeEventListener("visibilitychange", vis); mq.removeEventListener("change", onScheme); r.stop(); m.destroy(); };
  }, [act]);

  /* ---------- estado de la interfaz → mapa ---------- */
  useEffect(() => { document.documentElement.dataset.scheme = scheme; void mc.current?.ready.then(() => { mc.current?.setScheme(scheme); if (transit.network.routes.size) mc.current?.recolorNetwork(transit.network); br.current?.refresh(); }); }, [scheme]);
  useEffect(() => { void mc.current?.ready.then(() => mc.current?.setToggles(ui.layers)); br.current?.refresh(); }, [ui.layers]);
  useEffect(() => { br.current?.refresh(); }, [ui.colorMode, ui.motion, ui.system, ui.tab, ui.routeId]);
  useEffect(() => { br.current?.setFollow(ui.followId); }, [ui.followId]);
  useEffect(() => {
    const m = mc.current; if (!m) return;
    void m.ready.then(() => {
      m.setAlertStops(null);
      const id = ui.routeId, shapes = id ? transit.network.shapes.get(id) : undefined;
      if (!id || !shapes) { m.showRoute(null, "0", "", () => undefined); return; }
      const route = transit.routeById(id);
      const dir = shapes.find((s) => s.direction === ui.direction) ? ui.direction : shapes[0]!.direction;
      m.showRoute(shapes, dir, thRef.current.system[route?.system ?? "otro"], (sid) => transit.stopById(sid)?.position);
    });
  }, [ui.routeId, ui.direction, net, scheme]);
  useEffect(() => {
    const m = mc.current, id = ui.routeId; if (!m || !id) return;
    const shapes = transit.network.shapes.get(id); if (!shapes) return;
    const cur = shapes.find((s) => s.direction === ui.direction) ?? shapes[0]!;
    m.fit(cur.points, mapPadding(), 15);
  }, [ui.routeId, ui.direction]);

  useEffect(() => { if (ui.toast) { const t = setTimeout(() => setToastOn(false), 2800); setToastOn(true); return () => clearTimeout(t); } }, [ui.toast]);
  const [toastOn, setToastOn] = useState(false);

  const locate = () => {
    if (!navigator.geolocation) return ui.showToast("Tu navegador no permite ubicarte");
    navigator.geolocation.getCurrentPosition(
      (p) => { const g = { lat: p.coords.latitude, lon: p.coords.longitude }; mc.current?.showMe(g); mc.current?.flyTo(g, 15.5, mapPadding()); },
      () => ui.showToast("No pudimos obtener tu ubicación. Revisa el permiso del navegador."),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return (
    <>
      <div ref={mapEl} id="map" role="application" aria-label="Mapa de Bogotá con buses en tiempo real" />
      <header className="top">
        <div className="brand glass">
          <div className="mark"><Mark /></div>
          <div className="bt"><b>TransMi <i>LIVE</i></b><Status /></div>
        </div>
        <div className="tools">
          <button className="fab glass" aria-label="Mi ubicación" onClick={locate}><Locate /></button>
          <button className="fab glass" aria-label="Ajustes del mapa" aria-pressed={ui.settingsOpen} onClick={() => ui.setSettingsOpen(true)}><Sliders /></button>
        </div>
      </header>
      <Sheet>
        {ui.routeId && ui.tab === "rutas" ? <RouteDetailView id={ui.routeId} th={th} act={act} />
          : ui.tab === "rutas" ? <RoutesView th={th} act={act} />
          : ui.tab === "buses" ? <BusesView th={th} act={act} />
          : ui.tab === "paradas" ? <StopsView th={th} act={act} />
          : <AlertsView th={th} act={act} />}
      </Sheet>
      <Settings th={th} />
      <div className={`toast glass${toastOn ? " on" : ""}`} role="status" aria-live="polite">{ui.toast?.text}</div>
    </>
  );
}

function Status() {
  useTransitVersion();
  const now = useNow();
  const st: ConnectionStatus = connectionStatus(transit, now);
  const cls = st.connection === "live" ? "live" : st.connection === "waiting" ? "warn" : st.connection === "stale" ? "bad" : "";
  const text =
    st.connection === "connecting" ? "Conectando…"
    : st.connection === "live" ? `En vivo · hace ${ago(st.ageSeconds!)}`
    : st.connection === "waiting" ? `Actualizando · hace ${ago(st.ageSeconds!)}`
    : `Sin señal · hace ${ago(st.ageSeconds!)}`;
  return <div className="st"><span className={`dot ${cls}`} /><span>{text}</span></div>;
}
void CONFIG; void SYSTEM_LABEL;
