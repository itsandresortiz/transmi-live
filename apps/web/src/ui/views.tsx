import { useMemo } from "react";
import {
  arrivalAtIndex, upcomingAtStop, kpis, listVehicles, normalize, routeDetail, routesAtStop, searchAlerts, searchRoutes, searchStopGroups, siblingStops,
} from "@transmi/application";
import { ALERT_EFFECT_LABEL, SYSTEMS, SYSTEM_LABEL, type Route, type SystemType, type Vehicle, alertReference, alertTitle, alertValidity, describeAlert } from "@transmi/domain";
import { transit } from "../composition-root";
import estaciones from "../data/estaciones.json";
import { Back, Bus, Chevron } from "./icons";
import { nowMs } from "../clock";
import { stopCode, stopKind, stopTag, stopText } from "./stopname";
import { FirstBadge, LastBadge, RouteStatusNote, clockOfDay } from "./lastService";
import { FavoritesSection, NearbySection, StarButton } from "./mine";
import { ShareButton } from "./share";
import { useFavs } from "./favorites";
import { useLocation } from "./location";
import { alertsFor, nearestStops, routeIdsAtStops } from "@transmi/application";
import { useState } from "react";
import { useUi } from "./store";
import { delayClass, delayText, etaText, stopsAwayText, untilText } from "./format";
import { useEffect, useRef } from "react";
import { useNow, useTransitVersion } from "./hooks";
import { routeBadgeColor, type MapTheme } from "../map/theme";

export interface Actions {
  openRoute(id: string, busId?: string): void;
  openStop(id: string): void;
  openGroup(ids: string[]): void;
  followBus(id: string): void;
  focusBus(id: string, keepTarget?: boolean): void;
  focusStop(id: string): void;
  focusStation(i: number): void;
  focusAlert(i: number): void;
}
type Props = { th: MapTheme; act: Actions };
const sysColor = (th: MapTheme, s: SystemType) => th.system[s];

const Empty = ({ title, text }: { title: string; text: string }) =>
  <div className="empty"><Bus /><b>{title}</b>{text}</div>;

function Chips({ th }: { th: MapTheme }) {
  const { system, setSystem } = useUi();
  return (
    <div className="chips" role="group" aria-label="Filtrar por sistema">
      <button className="chip" aria-pressed={system === null} onClick={() => setSystem(null)}>Todos</button>
      {SYSTEMS.map((s) => (
        <button key={s} className="chip" style={{ ["--c" as string]: sysColor(th, s) }} aria-pressed={system === s} onClick={() => setSystem(system === s ? null : s)}>
          <i />{SYSTEM_LABEL[s]}
        </button>
      ))}
    </div>
  );
}

function More({ shown, total }: { shown: number; total: number }) {
  const more = useUi((s) => s.more);
  return total > shown ? <button className="more" onClick={more}>Ver más ({total - shown})</button> : null;
}

/** Cifras generales del servicio (buses, rutas activas, retrasos y avisos). Viven en Ajustes: son más de información que de uso diario. */
export function ServiceStats() {
  useTransitVersion();
  const k = kpis(transit);
  const { setTab, setSettingsOpen, setSheet } = useUi();
  const go = (f: () => void) => () => { f(); setSettingsOpen(false); setSheet("half"); };
  return (
    <div className="stats">
      <div className="stat"><b>{k.vehicles.toLocaleString("es-CO")}</b><span>Buses en vivo</span></div>
      <div className="stat"><b>{k.routes}</b><span>Rutas activas</span></div>
      <div className="stat late"><b>{k.late}</b><span>Muy tarde</span></div>
      <button className="stat" onClick={go(() => setTab("avisos"))}><b>{k.alerts}</b><span>Avisos</span></button>
    </div>
  );
}

export function RoutesView({ th, act }: Props) {
  useTransitVersion();
  const { query, system, limit } = useUi();
  const list = searchRoutes(transit, { query, system });
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of transit.fleet.values()) m.set(v.routeId, (m.get(v.routeId) ?? 0) + 1);
    return m;
  }, [transit.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const page = list.slice(0, limit);
  return (
    <>
      <FavoritesSection th={th} act={act} />
      <Chips th={th} />
      {!list.length ? <Empty title="Sin resultados" text="Prueba con otro número de ruta o destino." /> : (
        <div className="list">
          {page.map((r) => (
            <button key={r.id} className="row" onClick={() => act.openRoute(r.id)}>
              <span className="rb" style={{ ["--c" as string]: routeBadgeColor(th, r) }}>{r.shortName}</span>
              <span className="rm"><span className="rt">{r.longName || SYSTEM_LABEL[r.system]}</span><span className="rs">{SYSTEM_LABEL[r.system]}</span></span>
              <span className="rr">{counts.get(r.id) ?? 0} <Bus /></span>
              <span className="chev"><Chevron /></span>
            </button>
          ))}
          <More shown={page.length} total={list.length} />
        </div>
      )}
    </>
  );
}

function BusRow({ v, th, act }: { v: Vehicle } & Props) {
  const r = transit.routeOf(v), d = transit.delayOf(v);
  return (
    <button className="row" onClick={() => act.focusBus(v.id)}>
      <span className="rb sm" style={{ ["--c" as string]: routeBadgeColor(th, r, v.system) }}>{r?.shortName ?? v.routeId}</span>
      <span className="rm"><span className="rt">{v.plate || v.label || v.id}</span><span className="rs">{r?.longName || SYSTEM_LABEL[v.system]}</span></span>
      <span className={`pill ${delayClass(d)}`}>{delayText(d)}</span>
    </button>
  );
}

export function BusesView({ th, act }: Props) {
  useTransitVersion();
  const { query, system, limit } = useUi();
  const list = listVehicles(transit, { query, system });
  const page = list.slice(0, limit);
  return (
    <>
      <Chips th={th} />
      {!list.length ? <Empty title="Sin buses" text={transit.fleet.size ? "Ningún bus coincide con el filtro." : "Esperando los primeros datos en vivo…"} /> : (
        <div className="list">{page.map((v) => <BusRow key={v.id} v={v} th={th} act={act} />)}<More shown={page.length} total={list.length} /></div>
      )}
    </>
  );
}

export function StopsView({ th, act }: Props) {
  useTransitVersion();
  const { query, limit } = useUi();
  const q = normalize(query.trim());
  const stations = q
    ? (estaciones as [number, number, string, string, string][]).map((e, i) => ({ e, i })).filter(({ e }) => normalize(`${e[2]} ${e[3]} ${e[4]}`).includes(q))
    : [];
  const seen = new Set<string>();
  const uniq = stations.filter(({ e }) => !seen.has(e[2]) && !!seen.add(e[2]));
  const groups = useMemo(() => searchStopGroups(transit, query, limit), [query, limit, transit.network]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!q) return <><FavoritesSection th={th} act={act} /><NearbySection th={th} act={act} /><p className="hint" style={{ margin: "16px 2px" }}>O escribe arriba el nombre de una parada o estación, por ejemplo «Portal Norte».</p></>;
  if (!uniq.length && !groups.length) return <Empty title="Sin resultados" text={transit.network.stops.size ? "No encontramos esa parada." : "Cargando las paradas de la ciudad…"} />;
  // las estaciones de la troncal que ya salen como grupo de vagones no se repiten
  const groupTitles = new Set(groups.map((g) => normalize(g.title)));
  return (
    <div className="list">
      {uniq.filter(({ e }) => !groupTitles.has(normalize(e[2]))).slice(0, 20).map(({ e, i }) => (
        <button key={`e${i}`} className="row" onClick={() => act.focusStation(i)}>
          <span className="rb sm" style={{ ["--c" as string]: th.troncal }}>TM</span>
          <span className="rm"><span className="rt">{e[2]}</span><span className="rs">{e[4]} · {e[3]}</span></span><span className="chev"><Chevron /></span>
        </button>
      ))}
      {groups.map((g) => {
        const wagons = g.stops.map((s) => transit.labelOf(s).wagon).filter((w): w is number => !!w);
        const plats = g.stops.filter((s) => transit.labelOf(s).platform).length;
        const kind = stopKind(g.stops[0]);
        const sub = g.stops.length === 1 ? (stopTag(g.stops[0]) ? `${kind} · ${stopTag(g.stops[0])}` : kind)
          : wagons.length >= 2 ? `${kind} · vagones ${[...new Set(wagons)].sort((a, b) => a - b).join(", ")}`
          : plats ? `${kind} · ${plats} plataformas` : `${kind} · ${g.stops.length} paradas`;
        return (
          <button key={g.stops[0]!.id} className="row" onClick={() => (g.stops.length === 1 ? act.openStop(g.stops[0]!.id) : act.openGroup(g.stops.map((s) => s.id)))}>
            <span className="rb sm" style={{ ["--c" as string]: g.stops.length > 1 ? th.troncal : th.system.otro }}>{g.stops.length > 1 ? "TM" : (stopCode(g.stops[0]).slice(0, 5) || "·")}</span>
            <span className="rm"><span className="rt">{g.title}</span><span className="rs">{sub}</span></span><span className="chev"><Chevron /></span>
          </button>
        );
      })}
    </div>
  );
}

export function AlertsView({ th, act }: Props) {
  useTransitVersion();
  const { query, openAlert, setOpenAlert } = useUi();
  const [scope, setScope] = useState<"all" | "mine" | "near">("all");
  const favStops = useFavs((f) => f.stops), favRoutes = useFavs((f) => f.routes);
  const me = useLocation((l) => l.me);
  const all = searchAlerts(transit, query);
  const mine = useMemo(() => {
    if (!favStops.length && !favRoutes.length) return [];
    const routes = new Set([...favRoutes, ...routeIdsAtStops(transit, favStops)]);
    return alertsFor(transit, routes, new Set(favStops));
  }, [favStops, favRoutes, transit.alerts, transit.network]);   // eslint-disable-line react-hooks/exhaustive-deps
  const near = useMemo(() => {
    if (!me) return [];
    const ids = nearestStops(transit, me, 12, 800).map((n) => n.stop.id);
    return alertsFor(transit, routeIdsAtStops(transit, ids), new Set(ids));
  }, [me, transit.alerts, transit.network]);   // eslint-disable-line react-hooks/exhaustive-deps
  const hasMine = favStops.length + favRoutes.length > 0;
  const setTab = useUi((u) => u.setTab);
  const base = scope === "mine" ? mine : scope === "near" ? near : all;
  const q = normalize(query.trim());
  const list = q ? base.filter((x) => all.some((y) => y.index === x.index)) : base;
  return (
    <>
      <div className="trip-top">
        <button className="back" onClick={() => setTab("rutas")}><Back /> Cerrar</button>
        <h2>Avisos del servicio</h2>
      </div>
      <div className="chips" role="group" aria-label="Qué avisos ver">
        <button className="chip" aria-pressed={scope === "all"} onClick={() => setScope("all")}>Todos ({all.length})</button>
        {hasMine && <button className="chip" aria-pressed={scope === "mine"} onClick={() => setScope("mine")}>De mis favoritos ({mine.length})</button>}
        {me && <button className="chip" aria-pressed={scope === "near"} onClick={() => setScope("near")}>Cerca de mí ({near.length})</button>}
      </div>
      {!hasMine && !me && <p className="hint" style={{ margin: "0 2px 10px" }}>Guarda paradas o rutas con ⭐, o activa tu ubicación, para ver solo los avisos que te afectan.</p>}
      {!list.length ? <Empty title="Sin avisos" text={scope === "all" ? "No hay novedades del servicio en este momento." : "Nada que te afecte por ahora."} /> : list.map(({ alert, index }) => (
        <div key={index} className="card" role="group">
          <span className={`pill ${alert.effect === "noService" ? "bad" : alert.effect === "additional" ? "ok" : "warn"}`}>{ALERT_EFFECT_LABEL[alert.effect]}</span>
          <div className="ct">{alertTitle(alert)}</div>
          <div className="cs">{describeAlert(alert)}</div>
          <div className="cs faint" style={{ fontSize: 12, marginTop: 4 }}>{[alertValidity(alert), alert.headline ? `Ref. ${alertReference(alert)}` : ""].filter(Boolean).join(" · ")}</div>
          {alert.routeIds.length > 0 && (
            <div className="rbs">
              {alert.routeIds.slice(0, openAlert === index ? 99 : 12).map((id) => {
                const r = transit.routeById(id);
                return <button key={id} className="rb sm" style={{ ["--c" as string]: routeBadgeColor(th, r) }} onClick={() => r && act.openRoute(id)}>{r?.shortName ?? id}</button>;
              })}
              {alert.routeIds.length > 12 && openAlert !== index && <button className="chip" onClick={() => setOpenAlert(index)}>+{alert.routeIds.length - 12}</button>}
            </div>
          )}
          {alert.stopIds.length > 0 && <button className="btn" onClick={() => act.focusAlert(index)}>Ver en el mapa</button>}
        </div>
      ))}
    </>
  );
}

export function RouteDetailView({ id, th, act }: { id: string } & Props) {
  useTransitVersion();
  const nowSec = useNow() / 1000;
  const { direction, setDirection, setRoute, routeBusId } = useUi();
  const d = routeDetail(transit, id);
  const nextRef = useRef<HTMLLIElement>(null);
  const bus = routeBusId ? transit.fleet.get(routeBusId) : undefined;
  const shapes = transit.network.shapes.get(id) ?? [];
  // si se abrió desde un bus, se muestra el sentido en el que va ese bus
  const busShape = bus?.lastStopId ? shapes.find((sh) => sh.stopIds.includes(bus.lastStopId!)) : undefined;
  const cur = busShape ?? shapes.find((s) => s.direction === direction) ?? shapes[0];
  const k = bus && cur ? cur.stopIds.indexOf(bus.lastStopId ?? "") : -1;      // última parada a la que llegó; la que sigue es k + 1
  useEffect(() => {
    const el = nextRef.current, box = el?.closest(".view") as HTMLElement | null;
    if (!el || !box) return;
    // la hoja es más alta que lo que se ve en pantalla: se cuenta solo la parte visible
    const hidden = window.matchMedia("(min-width:900px)").matches ? 0 : parseFloat(getComputedStyle(box.parentElement!).getPropertyValue("--sy")) || 0;
    const visible = box.clientHeight - hidden;
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - visible * 0.3;
    box.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, [k, cur?.direction]);
  if (!d) return <Empty title="Ruta no encontrada" text="Ya no aparece en el servicio." />;
  const route: Route = d.route;
  const color = routeBadgeColor(th, route);
  const avg = d.averageDelaySeconds;
  return (
    <>
      <button className="back" onClick={() => setRoute(null)}><Back /> {bus ? "Atrás" : "Rutas"}</button>
      <div className="dcard">
        <span className="rb big" style={{ ["--c" as string]: color }}>{route.shortName}</span>
        <div style={{ flex: 1, minWidth: 0 }}><h2>{cur?.headsign ? `Hacia ${cur.headsign}` : route.longName || SYSTEM_LABEL[route.system]}</h2>
          <p>{SYSTEM_LABEL[route.system]}{bus ? ` · bus ${bus.plate || bus.label || bus.id}` : ` · ${d.vehicles.length} ${d.vehicles.length === 1 ? "bus" : "buses"}`}{!bus && avg != null && Math.abs(avg) < 7200 ? ` · ${avg > 120 ? Math.round(avg / 60) + " min tarde" : avg < -120 ? Math.round(-avg / 60) + " min antes" : "a tiempo"} en promedio` : ""}</p></div>
        <ShareButton target={{ kind: "ruta", id, direction: cur?.direction }} title={`Ruta ${route.shortName}`} />
        <StarButton kind="route" id={id} />
      </div>
      {!bus && shapes.length > 1 && (
        <div className="seg" role="group" aria-label="Sentido">
          {shapes.map((s) => <button key={s.direction} aria-pressed={cur?.direction === s.direction} onClick={() => setDirection(s.direction)}>{s.headsign ? `Hacia ${s.headsign}` : `Sentido ${Number(s.direction) + 1}`}</button>)}
        </div>
      )}
      <RouteStatusNote routeId={id} nowMs={nowSec * 1000} />
      {d.alerts.map(({ alert, index }) => <div key={index} className="card"><span className="pill warn">{ALERT_EFFECT_LABEL[alert.effect]}</span><div className="ct" style={{ marginTop: 8 }}>{alertTitle(alert)}</div><div className="cs">{describeAlert(alert)}</div>{alertValidity(alert) && <div className="cs" style={{ fontSize: 12, marginTop: 4, opacity: .7 }}>{alertValidity(alert)}</div>}</div>)}
      {cur && cur.stopIds.length > 0 && (
        <>
          <div className="sec">{bus ? "Por dónde va este bus" : "Paradas"}</div>
          <ul className="tl" style={{ ["--rc" as string]: color }}>
            {cur.stopIds.map((sid, i) => {
              const s = transit.stopById(sid);
              const isNext = !!bus && k >= 0 && i === k + 1, passed = !!bus && k >= 0 && i <= k;
              const tag = !bus || k < 0 || i <= k ? null
                : `${isNext ? "Próxima parada · " : "aprox. "}${etaText(arrivalAtIndex(transit, bus, cur, k, i, nowMs()), nowSec)}`;
              // vista general de la ruta: buses que van hacia esta parada (es la siguiente de cada uno)
              const heading = !bus ? d.vehicles.filter((v) => { const q = transit.sequenceOf(v); return q?.shape === cur && q.index + 1 === i; }) : [];
              return (
                <li key={sid} ref={isNext ? nextRef : undefined} className={`${isNext ? "next" : ""}${passed ? " passed" : ""}${heading.length ? " here" : ""}`} onClick={() => act.openStop(sid)}>
                  {stopText(s, sid)}{tag && <span className={`bx${isNext ? "" : " soft"}`}>{tag}</span>}
                  {heading.length > 0 && <span className="bx">{heading.length === 1 ? "1 bus va hacia aquí" : `${heading.length} buses van hacia aquí`}</span>}
                </li>
              );
            })}
          </ul>
        </>
      )}
      <details className="morebuses">
        <summary>Ver los {d.vehicles.length} {d.vehicles.length === 1 ? "bus" : "buses"} de esta ruta</summary>
        {d.vehicles.length ? <div className="list">{d.vehicles.slice(0, 40).map((v) => <BusRow key={v.id} v={v} th={th} act={act} />)}</div> : <Empty title="Sin buses ahora" text="Ningún bus de esta ruta está reportando en este momento." />}
      </details>
    </>
  );
}

/** Contenido de los globos del mapa. */
export function BusPopup({ v, th, onFollow, onRoute, following }: { v: Vehicle; th: MapTheme; onFollow(): void; onRoute(): void; following: boolean }) {
  const nowSec = useNow() / 1000;
  useTransitVersion();
  const r = transit.routeOf(v), d = transit.delayOf(v), ns = transit.nextStopOf(v, nowMs());
  const color = routeBadgeColor(th, r, v.system);
  const target = useUi((u) => u.targetStopId);
  const mark = transit.serviceOf(v);
  const toTarget = target ? upcomingAtStop(transit, target, nowSec, 40).flatMap((x) => x.buses).find((b) => b.vehicle.id === v.id) : undefined;
  return (
    <div className="pc">
      <div className="ph">
        <span className="rb big" style={{ ["--c" as string]: color }}>{r?.shortName ?? v.routeId}</span>
        <div><h4>{r?.longName || SYSTEM_LABEL[v.system]}</h4><small>{SYSTEM_LABEL[v.system]} · <span className="plate-s">{v.plate || v.label || v.id}</span></small>{(mark?.isLast || mark?.isFirst) && <div style={{ marginTop: 6 }}><LastBadge mark={mark} long /><FirstBadge mark={mark} /></div>}</div>
      </div>
      {target && toTarget && (
        <div className="tgt">Llega {toTarget.official ? "en" : "en aprox."} <b>{etaText(toTarget.etaAt, nowSec)}</b> a <b>{stopText(transit.stopById(target))}</b>
          <small>{toTarget.stopsAway <= 1 ? "es su próxima parada" : `le faltan ${toTarget.stopsAway - 1} ${toTarget.stopsAway - 1 === 1 ? "parada" : "paradas"} antes`}</small></div>
      )}
      <dl>
        <dt>Próxima parada</dt><dd>{stopText(ns?.stop, "—")}</dd>
        <dt>Llega</dt><dd>{untilText(ns?.arrivalAt, nowSec)}</dd>
        <dt>Puntualidad</dt><dd><span className={`pill ${delayClass(d)}`}>{delayText(d)}</span></dd>
        {(mark?.isLast || mark?.isFirst) && <><dt>Salida programada</dt><dd>{clockOfDay(mark.startSeconds)}</dd></>}
        <dt>Último reporte</dt><dd>hace {Math.max(0, Math.round(nowSec - v.reportedAt))} s</dd>
      </dl>
      <div className="acts"><button className="btn primary" onClick={onFollow}>{following ? "Dejar de seguir" : "Seguir"}</button><button className="btn" onClick={onRoute}>Ver ruta</button></div>
    </div>
  );
}


export function StationPopup({ index }: { index: number }) {
  const e = (estaciones as [number, number, string, string, string][])[index]!;
  return <div className="pc"><div className="ph"><div><h4>{e[2]}</h4><small>Estación TransMilenio</small></div></div>
    <dl><dt>Troncal</dt><dd>{e[4]}</dd><dt>Ubicación</dt><dd>{e[3]}</dd></dl></div>;
}
