import { useMemo } from "react";
import {
  upcomingAtStop, kpis, listVehicles, normalize, routeDetail, routesAtStop, searchAlerts, searchRoutes, searchStops,
} from "@transmi/application";
import { ALERT_EFFECT_LABEL, SYSTEMS, SYSTEM_LABEL, type Route, type SystemType, type Vehicle, describeAlert } from "@transmi/domain";
import { transit } from "../composition-root";
import estaciones from "../data/estaciones.json";
import { Back, Bus, Chevron } from "./icons";
import { useUi } from "./store";
import { delayClass, delayText, untilText } from "./format";
import { useNow, useTransitVersion } from "./hooks";
import type { MapTheme } from "../map/theme";

export interface Actions {
  openRoute(id: string): void;
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

export function Home({ th, act }: Props) {
  useTransitVersion();
  const k = kpis(transit);
  const { setTab, setOnlyLate } = useUi();
  return (
    <div className="stats">
      <div className="stat"><b>{k.vehicles.toLocaleString("es-CO")}</b><span>Buses en vivo</span></div>
      <div className="stat"><b>{k.routes}</b><span>Rutas activas</span></div>
      <button className="stat late" onClick={() => { setOnlyLate(true); setTab("buses"); }}><b>{k.late}</b><span>Muy tarde</span></button>
      <button className="stat" onClick={() => setTab("avisos")}><b>{k.alerts}</b><span>Avisos</span></button>
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
      <Home th={th} act={act} />
      <Chips th={th} />
      {!list.length ? <Empty title="Sin resultados" text="Prueba con otro número de ruta o destino." /> : (
        <div className="list">
          {page.map((r) => (
            <button key={r.id} className="row" onClick={() => act.openRoute(r.id)}>
              <span className="rb" style={{ ["--c" as string]: sysColor(th, r.system) }}>{r.shortName}</span>
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
      <span className="rb sm" style={{ ["--c" as string]: sysColor(th, v.system) }}>{r?.shortName ?? v.routeId}</span>
      <span className="rm"><span className="rt">{v.plate || v.label || v.id}</span><span className="rs">{r?.longName || SYSTEM_LABEL[v.system]}</span></span>
      <span className={`pill ${delayClass(d)}`}>{delayText(d)}</span>
    </button>
  );
}

export function BusesView({ th, act }: Props) {
  useTransitVersion();
  const { query, system, limit, onlyLate, setOnlyLate } = useUi();
  const list = listVehicles(transit, { query, system, lateOnly: onlyLate });
  const page = list.slice(0, limit);
  return (
    <>
      <Chips th={th} />
      <div className="chips"><button className="chip" aria-pressed={onlyLate} onClick={() => setOnlyLate(!onlyLate)}>Solo los que van muy tarde</button></div>
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
  const stops = searchStops(transit, query, limit);
  if (!q) return <Empty title="Busca una parada o estación" text="Escribe el nombre arriba, por ejemplo «Portal Norte» o «Calle 100»." />;
  if (!uniq.length && !stops.length) return <Empty title="Sin resultados" text={transit.network.stops.size ? "No encontramos esa parada." : "Cargando las paradas de la ciudad…"} />;
  return (
    <div className="list">
      {uniq.slice(0, 20).map(({ e, i }) => (
        <button key={`e${i}`} className="row" onClick={() => act.focusStation(i)}>
          <span className="rb sm" style={{ ["--c" as string]: th.troncal }}>TM</span>
          <span className="rm"><span className="rt">{e[2]}</span><span className="rs">{e[4]} · {e[3]}</span></span><span className="chev"><Chevron /></span>
        </button>
      ))}
      {stops.map((s) => (
        <button key={s.id} className="row" onClick={() => act.focusStop(s.id)}>
          <span className="rb sm" style={{ ["--c" as string]: th.system.otro }}>{s.code.slice(0, 5) || "·"}</span>
          <span className="rm"><span className="rt">{s.name}</span><span className="rs">Parada</span></span><span className="chev"><Chevron /></span>
        </button>
      ))}
    </div>
  );
}

export function AlertsView({ th, act }: Props) {
  useTransitVersion();
  const { query, openAlert, setOpenAlert } = useUi();
  const list = searchAlerts(transit, query);
  if (!list.length) return <Empty title="Sin avisos" text="No hay novedades del servicio en este momento." />;
  return (
    <>
      {list.map(({ alert, index }) => (
        <div key={index} className="card" role="group">
          <span className={`pill ${alert.effect === "noService" ? "bad" : alert.effect === "additional" ? "ok" : "warn"}`}>{ALERT_EFFECT_LABEL[alert.effect]}</span>
          <div className="ct">{alert.headline || describeAlert(alert)}</div>
          <div className="cs">{describeAlert(alert)}</div>
          {alert.routeIds.length > 0 && (
            <div className="rbs">
              {alert.routeIds.slice(0, openAlert === index ? 99 : 12).map((id) => {
                const r = transit.routeById(id);
                return <button key={id} className="rb sm" style={{ ["--c" as string]: sysColor(th, r?.system ?? "otro") }} onClick={() => r && act.openRoute(id)}>{r?.shortName ?? id}</button>;
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
  const { direction, setDirection, setRoute } = useUi();
  const d = routeDetail(transit, id);
  if (!d) return <Empty title="Ruta no encontrada" text="Ya no aparece en el servicio." />;
  const route: Route = d.route;
  const color = sysColor(th, route.system);
  const shapes = transit.network.shapes.get(id) ?? [];
  const cur = shapes.find((s) => s.direction === direction) ?? shapes[0];
  const avg = d.averageDelaySeconds;
  return (
    <>
      <button className="back" onClick={() => setRoute(null)}><Back /> Rutas</button>
      <div className="dcard">
        <span className="rb big" style={{ ["--c" as string]: color }}>{route.shortName}</span>
        <div><h2>{route.longName || SYSTEM_LABEL[route.system]}</h2>
          <p>{SYSTEM_LABEL[route.system]} · {d.vehicles.length} {d.vehicles.length === 1 ? "bus" : "buses"}{avg != null && Math.abs(avg) < 7200 ? ` · ${avg > 120 ? Math.round(avg / 60) + " min tarde" : avg < -120 ? Math.round(-avg / 60) + " min antes" : "a tiempo"} en promedio` : ""}</p></div>
      </div>
      {shapes.length > 1 && (
        <div className="seg" role="group" aria-label="Sentido">
          {shapes.map((s) => <button key={s.direction} aria-pressed={cur?.direction === s.direction} onClick={() => setDirection(s.direction)}>{s.headsign ? `Hacia ${s.headsign}` : `Sentido ${Number(s.direction) + 1}`}</button>)}
        </div>
      )}
      {d.alerts.map(({ alert, index }) => <div key={index} className="card"><span className="pill warn">{ALERT_EFFECT_LABEL[alert.effect]}</span><div className="cs" style={{ marginTop: 8 }}>{describeAlert(alert)}</div></div>)}
      <div className="sec">Buses en esta ruta</div>
      {d.vehicles.length ? <div className="list">{d.vehicles.slice(0, 40).map((v) => <BusRow key={v.id} v={v} th={th} act={act} />)}</div> : <Empty title="Sin buses ahora" text="Ningún bus de esta ruta está reportando en este momento." />}
      {cur && cur.stopIds.length > 0 && (
        <>
          <div className="sec">Paradas {cur.headsign ? `· hacia ${cur.headsign}` : ""}</div>
          <ul className="tl" style={{ ["--rc" as string]: color }}>
            {cur.stopIds.map((sid) => {
              const s = transit.stopById(sid);
              const here = d.vehicles.find((v) => v.nextStopId === sid);
              const arr = (transit.arrivalsByStop.get(sid) ?? []).find((a) => a.routeId === id);
              return (
                <li key={sid} className={here ? "here" : ""} onClick={() => act.focusStop(sid)}>
                  {s?.name ?? sid}{here && <span className="bx">{untilText(arr?.arrivalAt, nowSec)}</span>}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}

/** Contenido de los globos del mapa. */
export function BusPopup({ v, th, onFollow, onRoute, following }: { v: Vehicle; th: MapTheme; onFollow(): void; onRoute(): void; following: boolean }) {
  const nowSec = useNow() / 1000;
  useTransitVersion();
  const r = transit.routeOf(v), d = transit.delayOf(v), ns = transit.nextStopOf(v);
  const color = sysColor(th, v.system);
  const target = useUi((u) => u.targetStopId);
  const toTarget = target ? upcomingAtStop(transit, target, nowSec, 40).flatMap((x) => x.buses).find((b) => b.vehicle.id === v.id) : undefined;
  return (
    <div className="pc">
      <div className="ph"><span className="rb" style={{ ["--c" as string]: color }}>{r?.shortName ?? v.routeId}</span><div><h4>{SYSTEM_LABEL[v.system]}</h4><small>{r?.longName}</small></div></div>
      <div className="plate"><span>{v.plate || v.label || v.id}</span><span className={`pill ${delayClass(d)}`}>{delayText(d)}</span></div>
      {target && toTarget && (
        <div className="tgt"><b>{toTarget.official ? "" : "~"}{eta(toTarget.etaAt, nowSec)}</b> para llegar a <b>{transit.stopById(target)?.name}</b>
          <small>{toTarget.stopsAway <= 1 ? "es su próxima parada" : `le faltan ${toTarget.stopsAway - 1} ${toTarget.stopsAway - 1 === 1 ? "parada" : "paradas"} antes`}</small></div>
      )}
      <dl>
        <dt>Próxima parada</dt><dd>{ns?.stop?.name ?? "—"}</dd>
        <dt>Llega</dt><dd>{untilText(ns?.arrivalAt, nowSec)}</dd>
        <dt>Último reporte</dt><dd>hace {Math.max(0, Math.round(nowSec - v.reportedAt))} s</dd>
      </dl>
      <div className="acts"><button className="btn primary" onClick={onFollow}>{following ? "Dejar de seguir" : "Seguir"}</button><button className="btn" onClick={onRoute}>Ver ruta</button></div>
    </div>
  );
}

const away = (n: number) => (n <= 1 ? "su próxima parada" : `a ${n - 1} ${n - 1 === 1 ? "parada" : "paradas"}`);
const eta = (at: number, nowSec: number) => {
  const s = Math.round(at - nowSec);
  return s <= 15 ? "llegando" : s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
};

/** Parada: rutas que pasan y en cuánto llegan sus próximos buses. Tocar un bus lo muestra en el mapa. */
export function StopPopup({ stopId, th, onRoute, onBus }: { stopId: string; th: MapTheme; onRoute(id: string): void; onBus(id: string): void }) {
  useTransitVersion();
  const nowSec = useNow() / 1000;
  const s = transit.stopById(stopId);
  const rows = upcomingAtStop(transit, stopId, nowSec, 2).slice(0, 6);
  return (
    <div className="pc">
      <div className="ph"><div><h4>{s?.name ?? "Parada"}</h4><small>Próximos buses</small></div></div>
      {rows.length === 0 && <p className="cs" style={{ margin: "12px 0 0", color: "var(--muted)" }}>Ningún bus viene hacia esta parada en este momento.</p>}
      <div className="ups">
        {rows.map((r) => (
          <div key={r.route.id + r.direction} className="up">
            <button className="rb sm" style={{ ["--c" as string]: th.system[r.route.system] }} onClick={() => onRoute(r.route.id)}>{r.route.shortName}</button>
            <div className="upm">
              <span className="rs">{r.headsign ? `Hacia ${r.headsign}` : r.route.longName}</span>
              <div className="etas">
                {r.buses.map((b) => (
                  <button key={b.vehicle.id} className={`eta${b.official ? "" : " est"}`} onClick={() => onBus(b.vehicle.id)}
                    title={b.official ? "Hora oficial de TransMilenio" : "Tiempo calculado"}>
                    {b.official ? "" : "~"}{eta(b.etaAt, nowSec)}<small>{away(b.stopsAway)}</small>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
      {rows.some((r) => r.buses.some((b) => !b.official)) && <p className="note">El «~» es un cálculo; sin «~» es la hora oficial.</p>}
    </div>
  );
}

export function StationPopup({ index }: { index: number }) {
  const e = (estaciones as [number, number, string, string, string][])[index]!;
  return <div className="pc"><div className="ph"><div><h4>{e[2]}</h4><small>Estación TransMilenio</small></div></div>
    <dl><dt>Troncal</dt><dd>{e[4]}</dd><dt>Ubicación</dt><dd>{e[3]}</dd></dl></div>;
}
