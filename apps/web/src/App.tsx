import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { alertKey, useAlertsSeen } from "./ui/alertsSeen";
import { createRoot } from "react-dom/client";
import { connectionStatus, trafficSegments, trunkStations, upcomingAtStop, type ConnectionStatus } from "@transmi/application";
import { RoadPath, SYSTEM_LABEL, toWorld } from "@transmi/domain";
import { CONFIG, liveData, loadServiceEnds, networkSource, transit } from "./composition-root";
import { nowSec } from "./clock";
import { BusRenderer } from "./map/BusRenderer";
import { loadTroncales } from "./map/geodata";
import { buildStationGeometry } from "./map/stations";
import { MapController } from "./map/MapController";
import { currentScheme, routeBadgeColor, themeOf, type Scheme } from "./map/theme";
import estaciones from "./data/estaciones.json";
import { FollowBar } from "./ui/FollowBar";
import { Settings } from "./ui/Settings";
import { Sheet } from "./ui/Sheet";
import { Bell, Compass, Locate, Mark, Sliders } from "./ui/icons";
import { PlannerView, tripGeo } from "./ui/planner";
import { sortedResults, usePlanner } from "./ui/plannerStore";
import { reverse } from "./ui/geocode";
import { ago, agoShort } from "./ui/format";
import { useNow, useTransitVersion } from "./ui/hooks";
import { mapPadding } from "./ui/layout";
import { hadLocationPermission, useLocation } from "./ui/location";
import { type Target, formatHash, parseHash } from "./deeplink";
import { useUi } from "./ui/store";
import { StationView, StopRouteView, StopView } from "./ui/stopViews";
import { type Actions, AlertsView, BusPopup, BusesView, RouteDetailView, RoutesView, StationPopup, StopsView } from "./ui/views";

const POLL_MS = 2500;
/** Enlace con el que se abrió la página (se lee una sola vez, antes de que la app toque la dirección). */
const INITIAL_LINK = parseHash(location.hash);

export function App() {
  const mapEl = useRef<HTMLDivElement>(null);
  const mc = useRef<MapController | null>(null);
  const br = useRef<BusRenderer | null>(null);
  const popupRoot = useRef<ReturnType<typeof createRoot> | null>(null);
  const [scheme, setScheme] = useState<Scheme>(currentScheme);
  const [net, setNet] = useState(0);
  const [bearing, setBearing] = useState(0);
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
        if (window.matchMedia("(min-width:700px)").matches) return;
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
    const onRotate = () => setBearing(m.bearing);
    m.map.on("rotate", onRotate);
    (window as unknown as { __tm: unknown }).__tm = { transit, map: m, renderer: r, liveData, act, ui: useUi, planner: usePlanner };
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
      void Promise.all([m.ready, loadTroncales()]).then(([, lines]) => { m.setStations(buildStationGeometry(transit, trunkStations(transit), lines)); m.setNetwork(n); setNet((x) => x + 1); });
    }).catch(() => uiRef.current.showToast("No pudimos cargar las rutas; los buses siguen en vivo"));

    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => setScheme(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onScheme);
    return () => { stopped = true; clearInterval(t); document.removeEventListener("visibilitychange", vis); mq.removeEventListener("change", onScheme); r.stop(); m.destroy(); };
  }, [act]);

  /* ---------- estado de la interfaz → mapa ---------- */
  useEffect(() => { document.documentElement.dataset.scheme = scheme; void mc.current?.ready.then(() => { mc.current?.setScheme(scheme); if (transit.network.routes.size) mc.current?.recolorNetwork(transit.network); br.current?.refresh(); }); }, [scheme]);
  useEffect(() => { void mc.current?.ready.then(() => mc.current?.setToggles(ui.layers)); br.current?.refresh(); }, [ui.layers]);
  /* viaje planeado: se dibuja la opción elegida en el mapa y se encuadra */
  const planner = usePlanner();
  const alertCount = useAlertCount();
  useEffect(() => {
    const m = mc.current; if (!m) return;
    void m.ready.then(() => {
      const it = ui.tab === "viaje" ? sortedResults(planner.results, planner.sortBy)[planner.sel] : undefined;
      const origin = planner.originMe ? (useLocation.getState().me ? { name: "Mi ubicación", position: useLocation.getState().me! } : null) : planner.origin;
      if (!it || !origin || !planner.dest) { m.setTrip(null); return; }
      m.setTrip(tripGeo(it, thRef.current, origin, planner.dest));
      const pts = it.legs.flatMap((l) => l.line);
      if (pts.length) m.fit(pts, mapPadding(), 16);
    });
  }, [ui.tab, planner.results, planner.sel, planner.sortBy, planner.dest, planner.origin, planner.originMe, scheme]);   // eslint-disable-line react-hooks/exhaustive-deps
  /* elegir origen o destino tocando el mapa */
  useEffect(() => {
    const m = mc.current, field = planner.picking; if (!m) return;
    if (!field) { m.pickHandler = null; return; }
    uiRef.current.showToast(field === "origin" ? "Toca el mapa para elegir el punto de partida" : "Toca el mapa para elegir el destino");
    uiRef.current.setSheet("peek");
    m.pickHandler = (pt) => { void reverse(pt).then((place) => { usePlanner.getState().setPlace(field, place); uiRef.current.setSheet("half"); }); };
    return () => { if (m.pickHandler) m.pickHandler = null; };
  }, [planner.picking]);

  /* tráfico: velocidad de los buses en las calles, recalculada con cada dato nuevo (máx. una vez cada 4 s) */
  useEffect(() => {
    const m = mc.current; if (!ui.layers.traffic || !m) { return; }
    let last = 0, timer = 0;
    const run = () => { last = Date.now(); timer = 0; void m.ready.then(() => m.setTraffic(trafficSegments(transit, nowSec()))); };
    const off = transit.subscribe(() => { if (timer) return; const wait = Math.max(0, 4000 - (Date.now() - last)); timer = window.setTimeout(run, wait); });
    run();
    return () => { off(); if (timer) clearTimeout(timer); void m.ready.then(() => m.setTraffic([])); };
  }, [ui.layers.traffic]);
  /* semáforos: el archivo se baja solo la primera vez que se enciende la capa */
  useEffect(() => {
    const m = mc.current; if (!ui.layers.signals || !m || m.hasSignals) return;
    void m.ready.then(async () => {
      try {
        const r = await fetch(new URL("semaforos.json", new URL(import.meta.env.BASE_URL, location.href)).href);
        if (!r.ok) throw new Error(String(r.status));
        const d = (await r.json()) as { rows: [number, number, string, string, string][] };
        m.setSignals(d.rows);
      } catch { uiRef.current.showToast("Todavía no hay datos de semáforos disponibles"); }
    });
  }, [ui.layers.signals]);
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
      m.setFocusStop(st ? st.position : null, thRef.current.troncal, st?.id);
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

  const linked = useRef(false);
  /* enlaces: la dirección refleja lo que se está viendo y, al abrir un enlace, se llega directo a eso */
  useEffect(() => {
    const t: Target | null = ui.tab === "viaje" && planner.dest ? { kind: "viaje", from: planner.originMe || !planner.origin ? null : { lat: planner.origin.position.lat, lon: planner.origin.position.lon, name: planner.origin.name }, to: { lat: planner.dest.position.lat, lon: planner.dest.position.lon, name: planner.dest.name } } : ui.stopId ? { kind: "parada", id: ui.stopId } : ui.groupIds ? { kind: "estacion", ids: ui.groupIds } : ui.routeId && ui.tab === "rutas" ? { kind: "ruta", id: ui.routeId, direction: ui.direction } : null;
    if (!linked.current) return;                  // primero se abre el enlace con el que se llegó; recién después la dirección sigue a la pantalla
    const h = t ? formatHash(t) : "";
    if (location.hash !== h && (h || parseHash(location.hash))) history.replaceState(null, "", h || location.pathname + location.search);
  }, [ui.stopId, ui.groupIds, ui.routeId, ui.tab, ui.direction, net, planner.dest, planner.origin, planner.originMe]);
  useEffect(() => {
    if (linked.current || !net) return;
    const t = INITIAL_LINK; linked.current = true;
    if (!t) return;
    if (t.kind === "ruta") { if (!transit.routeById(t.id)) return uiRef.current.showToast("Esa ruta ya no aparece en el servicio"); act.openRoute(t.id); if (t.direction) uiRef.current.setDirection(t.direction); uiRef.current.setSheet("half"); }
    else if (t.kind === "parada") { if (!transit.stopById(t.id)) return uiRef.current.showToast("No encontramos esa parada"); act.openStop(t.id); }
    else if (t.kind === "viaje") {
      const P = usePlanner.getState();
      if (t.from) P.setPlace("origin", { name: t.from.name, position: { lat: t.from.lat, lon: t.from.lon } });
      P.setPlace("dest", { name: t.to.name, position: { lat: t.to.lat, lon: t.to.lon } });
      uiRef.current.setTab("viaje"); uiRef.current.setSheet("half");
    }
    else { const ids = t.ids.filter((id) => transit.stopById(id)); if (!ids.length) return uiRef.current.showToast("No encontramos esa estación"); act.openGroup(ids); }
  }, [net, act]);

  useEffect(() => { if (ui.toast) { const t = setTimeout(() => setToastOn(false), 2800); setToastOn(true); return () => clearTimeout(t); } }, [ui.toast]);
  const [toastOn, setToastOn] = useState(false);

  /* tu ubicación en tiempo real: el punto se mueve contigo y, si pulsaste el botón, el mapa te acompaña */
  const me = useLocation((l) => l.me), following = useLocation((l) => l.following), headingUp = useLocation((l) => l.headingUp), heading = useLocation((l) => l.heading);
  const flewAt = useRef(0);
  useEffect(() => { const m = mc.current; if (m) void m.ready.then(() => m.setMeHeading(heading)); }, [heading, me]);
  /* mapa que gira con hacia dónde miras: se evitan sacudidas ignorando cambios de menos de 4° y se gira por el camino corto */
  useEffect(() => {
    const m = mc.current; if (!m || !headingUp || heading == null) return;
    const cur = m.bearing;
    const diff = ((heading - cur + 540) % 360) - 180;
    if (Math.abs(diff) < 4) return;
    const here = useLocation.getState().me;
    m.map.easeTo({ bearing: cur + diff, ...(here ? { center: [here.lon, here.lat] as [number, number] } : {}), duration: 250, easing: (t) => t });
  }, [headingUp, heading]);
  useEffect(() => {
    const m = mc.current; if (!headingUp || !m) return;
    // si el usuario gira el mapa con los dedos, se respeta y se deja de girar solo
    const f = (e: { originalEvent?: unknown }) => { if (e.originalEvent) void useLocation.getState().setHeadingUp(false); };
    m.map.on("rotatestart", f);
    return () => { m.map.off("rotatestart", f); };
  }, [headingUp]);
  useEffect(() => { if (hadLocationPermission()) void useLocation.getState().locate(); }, []);
  useEffect(() => {
    const m = mc.current; if (!me || !m) return;
    void m.ready.then(() => {
      m.showMe(me);
      // (no se interrumpe el vuelo que acaba de empezar al pulsar el botón)
      if (useLocation.getState().following && Date.now() - flewAt.current > 1500) m.map.easeTo({ center: [me.lon, me.lat], ...(useLocation.getState().headingUp ? { bearing: m.bearing } : {}), duration: 900, easing: (t) => t });
    });
  }, [me]);

  const locate = async () => {
    const st = useLocation.getState();
    // segundo toque estando ya contigo: el mapa empieza a girar según hacia dónde miras; tercero: vuelve al norte
    if (st.following && st.me) {
      if (!st.headingUp) {
        const ok = await st.setHeadingUp(true);
        ui.showToast(ok ? "El mapa gira contigo. Toca otra vez para dejarlo fijo." : "Tu aparato no tiene brújula disponible");
      } else { await st.setHeadingUp(false); mc.current?.resetNorth(); }
      return;
    }
    const g = await st.locate();
    void st.trackHeading();                                // el toque permite pedir el permiso de la brújula (iPhone)
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
          {Math.abs(bearing) > 0.5 && <button className="fab glass" aria-label="Volver a poner el norte arriba" title="Norte arriba" onClick={() => mc.current?.resetNorth()}><span style={{ display: "grid", transform: `rotate(${-bearing}deg)` }}><Compass /></span></button>}
          <button className="fab glass bell" aria-label={ui.tab === "avisos" ? "Cerrar avisos" : `Avisos del servicio${alertCount ? `, ${alertCount} sin ver` : ""}`} aria-pressed={ui.tab === "avisos"} onClick={() => { const u = useUi.getState(); if (u.tab === "avisos") { u.setTab("rutas"); return; } u.setRoute(null); u.setTab("avisos"); u.setSheet("half"); }}>
            <Bell />{alertCount > 0 && <span className="badge">{alertCount > 99 ? "99+" : alertCount}</span>}
          </button>
          <button className="fab glass" aria-label={headingUp ? "Dejar el mapa fijo" : following ? "Girar el mapa según hacia dónde miro" : "Mi ubicación"} aria-pressed={following} onClick={() => void locate()}><Locate /></button>
          <button className="fab glass" aria-label="Ajustes del mapa" aria-pressed={ui.settingsOpen} onClick={() => ui.setSettingsOpen(true)}><Sliders /></button>
        </div>
      </header>
      <Sheet>
        {ui.tab === "viaje" ? <PlannerView th={th} act={act} />
          : ui.stopId ? (ui.stopRoute ? <StopRouteView th={th} act={act} /> : <StopView th={th} act={act} />)
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
  const cls = st.connection === "live" ? "live" : st.connection === "waiting" || st.connection === "idle" ? "warn" : st.connection === "stale" ? "bad" : "";
  const text =
    !online ? (st.ageSeconds != null ? `Sin internet · ${agoShort(st.ageSeconds)}` : "Sin internet")
    : st.connection === "idle" ? (st.ageSeconds != null ? `Sin servicio · ${agoShort(st.ageSeconds)}` : "Sin servicio por ahora")
    : st.connection === "connecting" ? "Conectando…"
    : st.connection === "live" ? `En vivo · hace ${ago(st.ageSeconds!)}`
    : st.connection === "waiting" ? `Actualizando · ${agoShort(st.ageSeconds!)}`
    : `Sin señal · ${agoShort(st.ageSeconds!)}`;
  return <div className="st" title={st.ageSeconds != null ? `Último dato hace ${ago(st.ageSeconds)}` : undefined}><span className={`dot ${cls}`} /><span>{text}</span></div>;
}
void CONFIG; void SYSTEM_LABEL;

/** Cuántos avisos vigentes aún no ha visto el usuario (se actualiza con cada lote de datos). */
function useAlertCount(): number {
  useTransitVersion();
  const seen = useAlertsSeen((s) => s.seen);
  const open = useUi((u) => u.tab === "avisos");
  // mientras la lista está abierta, todo lo que hay se da por visto
  useEffect(() => { if (open) useAlertsSeen.getState().markSeen(transit.alerts); });
  return open ? 0 : transit.alerts.reduce((n, a) => n + (seen.has(alertKey(a)) ? 0 : 1), 0);
}
