import { SYSTEM_LABEL } from "@transmi/domain";
import { transit } from "../composition-root";
import type { MapTheme } from "../map/theme";
import { Back, Bus, Chevron } from "./icons";
import { StarButton, useUpcoming } from "./mine";
import { nowMs } from "../clock";
import { LastBadge } from "./lastService";
import { labelOf, stopKind, stopTag, stopText } from "./stopname";
import { routesAtStop, siblingStops } from "@transmi/application";
import { useMemo } from "react";
import { useTransitVersion } from "./hooks";
import { etaText, stopsAwayText } from "./format";
import { useUi } from "./store";
import type { Actions } from "./views";

const Empty = ({ title, text }: { title: string; text: string }) => <div className="empty"><Bus /><b>{title}</b>{text}</div>;

/** Parada abierta: las rutas que vienen hacia ella y en cuánto llega el próximo bus de cada una. */
export function StopView({ th, act }: { th: MapTheme; act: Actions }) {
  const { stopId, openStop, setStopRoute } = useUi();
  const stop = transit.stopById(stopId ?? undefined);
  const { rows, nowSec } = useUpcoming(stopId, 3);
  const label = labelOf(stop), tag = stopTag(stop);
  const siblings = useMemo(() => (stop ? siblingStops(transit, stop).map((x) => ({ x, names: [...new Set(routesAtStop(transit, x.id).map((r) => r.shortName))].slice(0, 2).join(" ") })) : []), [stop, transit.network]);   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <button className="back" onClick={() => openStop(null)}><Back /> Atrás</button>
      <div className="dcard"><div style={{ flex: 1, minWidth: 0 }}><small className="kick">{stopKind(stop)}</small><h2>{label?.title ?? "Parada"}</h2>
        <p>{tag && <b className="vtag">{tag}</b>}{tag ? " · " : ""}{rows.length ? `${rows.length} ${rows.length === 1 ? "ruta viene" : "rutas vienen"} hacia aquí · en vivo` : "Sin buses acercándose"}</p></div>{stopId && <StarButton kind="stop" id={stopId} />}</div>
      {siblings.length > 1 && (
        <div className="chips" role="group" aria-label="Otros vagones de esta estación">
          {siblings.map(({ x, names }) => {
            const t = stopTag(x) || x.code || "Parada";
            const dup = siblings.filter((y) => (stopTag(y.x) || y.x.code) === t).length > 1;      // varias paradas del mismo vagón (una por sentido): se distinguen por sus rutas
            return <button key={x.id} className="chip" aria-pressed={x.id === stopId} onClick={() => act.openStop(x.id)}>{dup && names ? `${t} · ${names}` : t}</button>;
          })}
        </div>
      )}
      {rows.length === 0 ? <Empty title="Ningún bus viene ahora" text="Cuando un bus se acerque a esta parada aparecerá aquí." /> : (
        <>
          <div className="sec">Toca una ruta para ver de dónde viene</div>
          <div className="list">
            {rows.map((r) => {
              const first = r.buses[0]!, next = r.buses[1];
              return (
                <button key={r.route.id + r.direction} className="row stoprow" onClick={() => setStopRoute({ routeId: r.route.id, direction: r.direction })}>
                  <span className="rb" style={{ ["--c" as string]: th.system[r.route.system] }}>{r.route.shortName}</span>
                  <span className="rm">
                    <span className="rt">{r.headsign ? `Hacia ${r.headsign}` : r.route.longName}</span>
                    <span className="rs">{first.official ? "" : "aprox. "}{stopsAwayText(first.stopsAway)}{next ? ` · luego ${etaText(next.etaAt, nowSec)}` : ""}{(first.vehicle && transit.serviceOf(first.vehicle)?.isLast) || (next && transit.serviceOf(next.vehicle)?.isLast) ? " · " : ""}{first.vehicle && transit.serviceOf(first.vehicle)?.isLast ? <LastBadge mark={transit.serviceOf(first.vehicle)} /> : next && transit.serviceOf(next.vehicle)?.isLast ? <><LastBadge mark={transit.serviceOf(next.vehicle)} /></> : null}</span>
                  </span>
                  <span className={`etabig${first.etaAt - nowSec <= 60 ? " soon" : ""}`}>{etaText(first.etaAt, nowSec)}</span>
                  <span className="chev"><Chevron /></span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

/** Una estación o portal con todos sus vagones o plataformas, cada uno con las rutas que se detienen ahí. */
export function StationView({ th, act }: { th: MapTheme; act: Actions }) {
  const { groupIds, openGroup } = useUi();
  useTransitVersion();
  const stops = (groupIds ?? []).map((id) => transit.stopById(id)).filter((s): s is NonNullable<typeof s> => !!s);
  const rows = useMemo(() => stops.map((s) => {
    const rs = routesAtStop(transit, s.id);
    const names = [...new Set(rs.map((r) => r.shortName))];
    // hacia dónde van las rutas que paran en este vagón (destino de la primera)
    const shape = rs.length ? (transit.network.shapes.get(rs[0]!.id) ?? []).find((sh) => sh.stopIds.includes(s.id)) : undefined;
    return { s, names, towards: shape?.headsign || rs[0]?.longName || "" };
  }), [groupIds, transit.network]);   // eslint-disable-line react-hooks/exhaustive-deps
  const title = stops[0] ? labelOf(stops[0])?.title : "Estación";
  const wagons = stops.some((s) => labelOf(s)?.wagon);
  return (
    <>
      <button className="back" onClick={() => openGroup(null)}><Back /> Atrás</button>
      <div className="dcard"><div><small className="kick">{stops[0] ? stopKind(stops[0]) : "Estación"}</small><h2>{title}</h2><p>{wagons ? `${stops.length} paradas en ${new Set(stops.map((s) => labelOf(s)?.wagon)).size} vagones` : `${stops.length} paradas`} · toca una para ver sus buses</p></div></div>
      <div className="list">
        {rows.map(({ s, names, towards }) => {
          const tag = stopTag(s);
          return (
            <button key={s.id} className="row stoprow" onClick={() => act.openStop(s.id)}>
              <span className="rb" style={{ ["--c" as string]: th.troncal }}>{labelOf(s)?.wagon ? `V${labelOf(s)!.wagon}` : labelOf(s)?.platform ?? "·"}</span>
              <span className="rm">
                <span className="rt">{tag || s.name}{towards && <i className="apx"> · hacia {towards}</i>}</span>
                <span className="rs">{names.slice(0, 8).join(" · ") + (names.length > 8 ? ` · +${names.length - 8}` : "")}</span>
              </span>
              <span className="chev"><Chevron /></span>
            </button>
          );
        })}
      </div>
    </>
  );
}

/** Una ruta de la parada: de dónde viene el próximo bus y los siguientes. */
export function StopRouteView({ th, act }: { th: MapTheme; act: Actions }) {
  const { stopId, stopRoute, setStopRoute } = useUi();
  const { rows: all, nowSec } = useUpcoming(stopId, 6);
  if (!stopId || !stopRoute) return null;
  const stop = transit.stopById(stopId);
  const row = all.find((r) => r.route.id === stopRoute.routeId && r.direction === stopRoute.direction);
  const route = transit.routeById(stopRoute.routeId);
  const color = th.system[route?.system ?? "otro"];
  const shape = transit.network.shapes.get(stopRoute.routeId)?.find((s) => s.direction === stopRoute.direction);
  const j = shape ? shape.stopIds.indexOf(stopId) : -1;
  const hero = row?.buses[0];
  const heroNext = hero ? transit.nextStopOf(hero.vehicle, nowMs())?.stop : undefined;
  // paradas por las que vienen los buses, de la más lejana a la elegida
  const nextIdx = (b: { vehicle: { lastStopId?: string } }) => (shape ? shape.stopIds.indexOf(b.vehicle.lastStopId ?? "") + 1 : -1);   // la parada que sigue a la última
  const ks = row && shape ? row.buses.map(nextIdx).filter((k) => k > 0) : [];
  const kmin = ks.length ? Math.min(...ks) : j;
  const path = shape && j >= 0 ? shape.stopIds.slice(Math.max(0, kmin), j + 1) : [];
  return (
    <>
      <button className="back" onClick={() => setStopRoute(null)}><Back /> {stopText(stop, "Parada")}</button>
      <div className="dcard">
        <span className="rb big" style={{ ["--c" as string]: color }}>{route?.shortName}</span>
        <div><h2>{shape?.headsign ? `Hacia ${shape.headsign}` : route?.longName}</h2><p>{route ? SYSTEM_LABEL[route.system] : ""} · llega a {stopText(stop)}</p></div>
      </div>
      {!row || !hero ? <Empty title="Ningún bus viene ahora" text="Esta ruta no tiene buses acercándose a la parada en este momento." /> : (
        <>
          {transit.serviceOf(hero.vehicle)?.isLast && <div className="lastnote"><LastBadge mark={transit.serviceOf(hero.vehicle)} long /><br />Es el último viaje programado de hoy en esta ruta: después de este no hay más buses.</div>}
          <div className="hero" style={{ ["--rc" as string]: color }}>
            <small>Próximo bus</small>
            <b>{etaText(hero.etaAt, nowSec)}{!hero.official && <i>aprox.</i>}</b>
            <span>
              {hero.stopsAway <= 1 ? `Ya va hacia esta parada.` : `Ahora va hacia ${stopText(heroNext, "su próxima parada")}, ${stopsAwayText(hero.stopsAway)} de aquí.`}
            </span>
            <div className="acts">
              <button className="btn primary" onClick={() => act.followBus(hero.vehicle.id)}>Seguir este bus</button>
              <button className="btn" onClick={() => act.focusBus(hero.vehicle.id, true)}>Ver en el mapa</button>
            </div>
          </div>
          {row.buses.length > 1 && (
            <>
              <div className="sec">Los siguientes</div>
              <div className="list">
                {row.buses.slice(1).map((b, i) => (
                  <button key={b.vehicle.id} className="row" onClick={() => act.focusBus(b.vehicle.id, true)}>
                    <span className="rm"><span className="rt">{etaText(b.etaAt, nowSec)}{!b.official && <i className="apx"> aprox.</i>}{transit.serviceOf(b.vehicle)?.isLast && <> <LastBadge mark={transit.serviceOf(b.vehicle)} /></>}</span><span className="rs">Bus {i + 2} · {stopsAwayText(b.stopsAway)}</span></span>
                    <span className="chev"><Chevron /></span>
                  </button>
                ))}
              </div>
            </>
          )}
          {path.length > 1 && (
            <>
              <div className="sec">Recorrido hasta tu parada</div>
              <ul className="tl" style={{ ["--rc" as string]: color }}>
                {path.map((sid, i) => {
                  const at = row.buses.filter((b) => shape?.stopIds[nextIdx(b)] === sid);
                  const last = i === path.length - 1;
                  return (
                    <li key={sid} className={`${at.length ? "here" : ""}${last ? " goal" : ""}`} onClick={() => act.focusStop(sid)}>
                      {stopText(transit.stopById(sid), sid)}
                      {last && <span className="bx">tu parada</span>}
                      {at.map((b) => <span key={b.vehicle.id} className="bx bus">bus va hacia aquí</span>)}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </>
      )}
    </>
  );
}
