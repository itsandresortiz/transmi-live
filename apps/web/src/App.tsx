import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { connectionStatus, trunkStations, upcomingAtStop, type ConnectionStatus } from "@transmi/application";
import { RoadPath, SYSTEM_LABEL, toWorld } from "@transmi/domain";
import { CONFIG, liveData, loadServiceEnds, networkSource, transit } from "./composition-root";
import { nowSec } from "./clock";
import { BusRenderer } from "./map/BusRenderer";
import { buildStationGeometry } from "./map/stations";
import { MapController } from "./map/MapController";
import { currentScheme, routeBadgeColor, themeOf, type Scheme } from "./map/theme";
import estaciones from "./data/estaciones.json";
import { FollowBar } from "./ui/FollowBar";
import { Settings } from "./ui/Settings";
import { Sheet } from "./ui/Sheet";
import { Locate, Mark, Sliders } from "./ui/icons";
import { ago } from "./ui/format";
import { useNow, useTransitVersion } from "./ui/hooks";
import { mapPadding } from "./ui/layout";
import { hadLocationPermission, useLocation } from "./ui/location";
import { useUi } from "./ui/store";
import { StationView, StopRouteView, StopView } from "./ui/stopViews";
import { type Actions, AlertsView, BusPopup, BusesView, RouteDetailView, RoutesView, StationPopup, StopsView } from "./ui/views";

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
      openRoute(id, busId) {
        closePopup(); s().setFollow(null); s().setTab("rutas"); s().setRoute(id, busId ?? null);
      },
      openStop(id) {
        const st = transit.stopById(id); if (!st) return;
        closePopup(); s().openStop(id); s().setSheet("half");
      },
      openGroup(ids) {
        const first = transit.stopById(ids[0]), m = mc.current; if (!first || !m) return;
        closePopup(); s().openGroup(ids); s().setSheet("half");
        const pts = ids.map((id) => transit.stopById(id)?.position).filter((p): p is NonNullable<typeof p> => !!p);
        m.showRoute(null, "0", "", () => undefined); m.setFocusStop(null);
        m.fit(pts, mapPadding(), 17);
      },
      followBus(id) {
        const v = transit.fleet.get(id), m = mc.current; if (!v || !m) return;
        s().setFollow(id); s().setSheet("peek");
        m.flyTo(br.current?.position(id) ?? v.position, Math.max(m.zoom, 16), mapPadding());
      },
      focusBus(id, keepTarget = false) {
        if (!keepTarget) s().setTargetStop(null);
        const v = transit.fleet.get(id), m = mc.current; if (!v || !m) return;
        const p = br.current?.position(id) ?? v.position;
        s().setSheet("peek");
        m.flyTo(p, Math.max(m.zoom, 16), { ...mapPadding(), top: 420 });
        popup(p, <BusPopup v={v} th={thRef.current} following={s().followId === id}
          onFollow={() => { const f = s().followId === id ? null : id; s().setFollow(f); closePopup(); if (f) { s().setSheet("peek"); mc.current?.flyTo(br.current?.position(id) ?? v.position, Math.max(mc.current.zoom, 16), mapPadding()); } }}
          onRoute={() => a.openRoute(v.routeId, v.id)} />);
      },
      focusStop(id) { a.openStop(id); },
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
      onGroupClick: (ids) => act.openGroup(ids),
      onPointerHold: (h) => br.current?.setHold(h),
      // como en las apps de mapas: tocar el mapa baja el panel para verlo completo (en celular)
      onMapTap: () => {
        if (window.matchMedia("(min-width:900px)").matches) return;
        (document.activeElement as HTMLElement | null)?.blur?.();
        if (uiRef.current.sheet !== "peek") uiRef.current.setSheet("peek");
        if (uiRef.current.settingsOpen) uiRef.current.setSettingsOpen(false);
      },
      onUserDrag: () => { if (uiRef.current.followId) uiRef.current.setFollowPaused(true); if (useLocation.getState().following) useLocation.getState().setFollowing(false); },
    });
    mc.current = m;
    const r = new BusRenderer(transit, m, () => {
      const u = uiRef.current;
      return { colorMode: u.colorMode, motion: u.motion, system: !u.stopRoute && (u.tab === "buses" || u.tab === "rutas") ? u.system : null, routeId: u.stopRoute?.routeId ?? (u.tab === "rutas" ? u.routeId : null), visible: u.layers.buses };
    }, () => thRef.current);
    br.current = r;
    (window as unknown as { __tm: unknown }).__tm = { transit, map: m, renderer: r, liveData, act, ui: useUi };
    let stopped = false;
    void m.ready.then(() => { if (!stopped) { r.start(); m.setToggles(uiRef.current.layers); } });

    const poll = async () => {
      if (document.hidden || navigator.onLine === false) return; // pantalla apagada o sin red: no se gasta servidor ni batería
      try { await liveData.refresh(); } catch { /* el estado de conexión lo muestra */ }
    };
    void poll();
    const t = setInterval(poll, POLL_MS);
    const vis = () => { if (!document.hidden) void liveData.refresh(true).catch(() => {}); };
    document.addEventListener("visibilitychange", vis);

    void loadServiceEnds();
    void networkSource.load().then((n) => {
      if (stopped) return;
      transit.setNetwork(n);
      void m.ready.then(() => { m.setStations(buildStationGeometry(transit, trunkStations(transit))); m.setNetwork(n); setNet((x) => x + 1); });
    }).catch(() => uiRef.current.showToast("No pudimos cargar las rutas; los buses siguen en vivo"));

    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => setScheme(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onScheme);
    return () => { stopped = true; clearInterval(t); document.removeEventListener("visibilitychange", vis); mq.removeEventListener("change", onScheme); r.stop(); m.destroy(); };
  }, [act]);

  /* ---------- estado de la interfaz → mapa ---------- */
  useEffect(() => { document.documentElement.dataset.scheme = scheme; void mc.current?.ready.then(() => { mc.current?.setScheme(scheme); if (transit.network.routes.size) mc.current?.recolorNetwork(transit.network); br.current?.refresh(); }); }, [scheme]);
  useEffect(() => { void mc.current?.ready.then(() => mc.current?.setToggles(ui.layers)); br.current?.refresh(); }, [ui.layers]);
  useEffect(() => { br.current?.refresh(); }, [ui.colorMode, ui.motion, ui.system, ui.tab, ui.routeId, ui.stopRoute]);
  useEffect(() => { br.current?.setFollow(ui.followId); }, [ui.followId]);
  useEffect(() => { br.current?.setFollowPaused(ui.followPaused); }, [ui.followPaused]);
  useEffect(() => {
    const m = mc.current; if (!m) return;
    if (ui.stopId) return;
    void m.ready.then(() => {
      m.setAlertStops(null);
      const fv = ui.followId ? transit.fleet.get(ui.followId) : undefined;
      const id = ui.routeId ?? fv?.routeId ?? null, shapes = id ? transit.network.shapes.get(id) : undefined;
      if (!id || !shapes) { m.showRoute(null, "0", "", () => undefined); return; }
      const route = transit.routeById(id);
      const own = !ui.routeId && fv ? shapes.find((sh) => fv.lastStopId && sh.stopIds.includes(fv.lastStopId))?.direction : undefined;
      const want = own ?? ui.direction;
      const dir = shapes.find((s) => s.direction === want) ? want : shapes[0]!.direction;
      m.showRoute(shapes, dir, routeBadgeColor(thRef.current, route), (sid) => transit.stopById(sid)?.position);
    });
  }, [ui.routeId, ui.direction, ui.followId, ui.stopId, net, scheme]);

  /* estaciones de la troncal: se iluminan los vagones donde para la ruta que se está viendo y se marca el de la parada abierta */
  useEffect(() => {
    const m = mc.current; if (!m) return;
    void m.ready.then(() => {
      const fv = ui.followId ? transit.fleet.get(ui.followId) : undefined;
      const rid = ui.stopRoute?.routeId ?? ui.routeId ?? fv?.routeId ?? null;
      const shapes = rid ? transit.network.shapes.get(rid) : undefined;
      const want = ui.stopRoute?.direction ?? (ui.routeId ? ui.direction : undefined);
      const shape = shapes?.find((x) => x.direction === want) ?? (fv && shapes ? shapes.find((x) => fv.lastStopId && x.stopIds.includes(fv.lastStopId)) : undefined) ?? shapes?.[0];
      const color = routeBadgeColor(thRef.current, rid ? transit.routeById(rid) : undefined, "troncal");
      m.setStationState(new Set(shape?.stopIds ?? []), color, ui.stopId);
    });
  }, [ui.routeId, ui.direction, ui.stopRoute, ui.stopId, ui.followId, net, scheme]);

  /* parada abierta: se marca en el mapa y, si hay una ruta elegida, solo por donde vienen sus buses */
  useEffect(() => {
    const m = mc.current; if (!m) return;
    void m.ready.then(() => {
      const st = transit.stopById(ui.stopId ?? undefined);
      m.setFocusStop(st ? st.position : null, thRef.current.troncal);
      if (!st || !ui.stopId) return;
      const pad = mapPadding();
      if (!ui.stopRoute) {
        m.showRoute(null, "0", "", () => undefined);
        m.flyTo(st.position, Math.max(m.zoom, 16), pad);
        return;
      }
      const { routeId, direction } = ui.stopRoute;
      const shape = transit.network.shapes.get(routeId)?.find((x) => x.direction === direction);
      const color = routeBadgeColor(thRef.current, transit.routeById(routeId));
      if (!shape || shape.points.length < 2) { m.showRoute(null, "0", "", () => undefined); m.flyTo(st.position, 16, pad); return; }
      const path = new RoadPath(shape.points);
      const end = path.project(toWorld(st.position), 0, 0, 250)?.s ?? path.length;
      const row = upcomingAtStop(transit, ui.stopId, nowSec(), 6).find((r) => r.route.id === routeId && r.direction === direction);
      const hits = (row?.buses ?? []).map((b) => path.project(b.vehicle.world, 0, 0, 150)?.s).filter((x): x is number => x != null && x <= end);
      const start = Math.max(0, (hits.length ? Math.min(...hits) : end - 1200) - 120);
      const j = shape.stopIds.indexOf(ui.stopId);
      const ks = (row?.buses ?? []).map((b) => shape.stopIds.indexOf(b.vehicle.lastStopId ?? "") + 1).filter((k) => k > 0);
      const kmin = ks.length ? Math.min(...ks) : Math.max(0, j - 6);
      const stops = shape.stopIds.slice(Math.max(0, kmin), j + 1).flatMap((id) => { const p = transit.stopById(id)?.position; return p ? [{ id, p }] : []; });
      const pts = path.slice(start, end);
      m.showSegment(pts, color, stops);
      m.fit([...pts, st.position], pad, 16.5);
    });
  }, [ui.stopId, ui.stopRoute, net]);
  useEffect(() => {
    const m = mc.current, id = ui.routeId; if (!m || !id) return;
    const shapes = transit.network.shapes.get(id); if (!shapes) return;
    const cur = shapes.find((s) => s.direction === ui.direction) ?? shapes[0]!;
    m.fit(cur.points, mapPadding(), 15);
  }, [ui.routeId, ui.direction]);

  useEffect(() => { if (ui.toast) { const t = setTimeout(() => setToastOn(false), 2800); setToastOn(true); return () => clearTimeout(t); } }, [ui.toast]);
  const [toastOn, setToastOn] = useState(false);

  /* tu ubicación en tiempo real: el punto se mueve contigo y, si pulsaste el botón, el mapa te acompaña */
  const me = useLocation((l) => l.me), following = useLocation((l) => l.following);
  const flewAt = useRef(0);
  useEffect(() => { if (hadLocationPermission()) void useLocation.getState().locate(); }, []);
  useEffect(() => {
    const m = mc.current; if (!me || !m) return;
    void m.ready.then(() => {
      m.showMe(me);
      // (no se interrumpe el vuelo que acaba de empezar al pulsar el botón)
      if (useLocation.getState().following && Date.now() - flewAt.current > 1500) m.map.easeTo({ center: [me.lon, me.lat], duration: 900, easing: (t) => t });
    });
  }, [me]);

  const locate = async () => {
    const st = useLocation.getState();
    const g = await st.locate();
    if (!g) return ui.showToast("No pudimos obtener tu ubicación. Revisa el permiso del navegador.");
    uiRef.current.setFollow(null);                      // seguir un bus y seguirte a ti son cosas distintas
    st.setFollowing(true);
    flewAt.current = Date.now();
    mc.current?.showMe(g); mc.current?.flyTo(g, Math.max(mc.current.zoom, 16), mapPadding());
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
          <button className="fab glass" aria-label="Mi ubicación" aria-pressed={following} onClick={() => void locate()}><Locate /></button>
          <button className="fab glass" aria-label="Ajustes del mapa" aria-pressed={ui.settingsOpen} onClick={() => ui.setSettingsOpen(true)}><Sliders /></button>
        </div>
      </header>
      <Sheet>
        {ui.stopId ? (ui.stopRoute ? <StopRouteView th={th} act={act} /> : <StopView th={th} act={act} />)
          : ui.groupIds ? <StationView th={th} act={act} />
          : ui.routeId && ui.tab === "rutas" ? <RouteDetailView id={ui.routeId} th={th} act={act} />
          : ui.tab === "rutas" ? <RoutesView th={th} act={act} />
          : ui.tab === "buses" ? <BusesView th={th} act={act} />
          : ui.tab === "paradas" ? <StopsView th={th} act={act} />
          : <AlertsView th={th} act={act} />}
      </Sheet>
      <FollowBar th={th} onResume={() => { useUi.getState().setFollowPaused(false); }} />
      <Settings th={th} />
      <div className={`toast glass${toastOn ? " on" : ""}`} role="status" aria-live="polite">{ui.toast?.text}</div>
    </>
  );
}

function useOnline(): boolean {
  const [on, setOn] = useState(() => navigator.onLine);
  useEffect(() => {
    const f = () => setOn(navigator.onLine);
    window.addEventListener("online", f); window.addEventListener("offline", f);
    return () => { window.removeEventListener("online", f); window.removeEventListener("offline", f); };
  }, []);
  return on;
}

function Status() {
  useTransitVersion();
  const now = useNow();
  const online = useOnline();
  const st: ConnectionStatus = connectionStatus(transit, now);
  const cls = st.connection === "live" ? "live" : st.connection === "waiting" ? "warn" : st.connection === "stale" ? "bad" : "";
  const text =
    !online ? (st.ageSeconds != null ? `Sin internet · último dato hace ${ago(st.ageSeconds)}` : "Sin internet")
    : st.connection === "connecting" ? "Conectando…"
    : st.connection === "live" ? `En vivo · hace ${ago(st.ageSeconds!)}`
    : st.connection === "waiting" ? `Actualizando · hace ${ago(st.ageSeconds!)}`
    : `Sin señal · hace ${ago(st.ageSeconds!)}`;
  return <div className="st"><span className={`dot ${cls}`} /><span>{text}</span></div>;
}
void CONFIG; void SYSTEM_LABEL;
