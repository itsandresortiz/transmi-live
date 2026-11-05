import { SYSTEM_LABEL } from "@transmi/domain";
import { transit } from "../composition-root";
import type { MapTheme } from "../map/theme";
import { Back, Bus, Chevron } from "./icons";
import { StarButton, useUpcoming } from "./mine";
import { etaText, stopsAwayText } from "./format";
import { useUi } from "./store";
import type { Actions } from "./views";

const Empty = ({ title, text }: { title: string; text: string }) => <div className="empty"><Bus /><b>{title}</b>{text}</div>;

/** Parada abierta: las rutas que vienen hacia ella y en cuánto llega el próximo bus de cada una. */
export function StopView({ th }: { th: MapTheme }) {
  const { stopId, openStop, setStopRoute } = useUi();
  const stop = transit.stopById(stopId ?? undefined);
  const { rows, nowSec } = useUpcoming(stopId, 3);
  return (
    <>
      <button className="back" onClick={() => openStop(null)}><Back /> Atrás</button>
      <div className="dcard"><div style={{ flex: 1, minWidth: 0 }}><h2>{stop?.name ?? "Parada"}</h2><p>{rows.length ? `${rows.length} ${rows.length === 1 ? "ruta viene" : "rutas vienen"} hacia aquí · en vivo` : "Parada"}</p></div>{stopId && <StarButton kind="stop" id={stopId} />}</div>
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
                    <span className="rs">{first.official ? "" : "aprox. "}{stopsAwayText(first.stopsAway)}{next ? ` · luego ${etaText(next.etaAt, nowSec)}` : ""}</span>
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
  const heroNext = hero ? transit.stopById(hero.vehicle.nextStopId) : undefined;
  // paradas por las que vienen los buses, de la más lejana a la elegida
  const ks = row && shape ? row.buses.map((b) => shape.stopIds.indexOf(b.vehicle.nextStopId ?? "")).filter((k) => k >= 0) : [];
  const kmin = ks.length ? Math.min(...ks) : j;
  const path = shape && j >= 0 ? shape.stopIds.slice(Math.max(0, kmin), j + 1) : [];
  return (
    <>
      <button className="back" onClick={() => setStopRoute(null)}><Back /> {stop?.name ?? "Parada"}</button>
      <div className="dcard">
        <span className="rb big" style={{ ["--c" as string]: color }}>{route?.shortName}</span>
        <div><h2>{shape?.headsign ? `Hacia ${shape.headsign}` : route?.longName}</h2><p>{route ? SYSTEM_LABEL[route.system] : ""} · llega a {stop?.name}</p></div>
      </div>
      {!row || !hero ? <Empty title="Ningún bus viene ahora" text="Esta ruta no tiene buses acercándose a la parada en este momento." /> : (
        <>
          <div className="hero" style={{ ["--rc" as string]: color }}>
            <small>Próximo bus</small>
            <b>{etaText(hero.etaAt, nowSec)}{!hero.official && <i>aprox.</i>}</b>
            <span>
              {hero.stopsAway <= 1 ? `Ya va hacia esta parada.` : `Ahora va hacia ${heroNext?.name ?? "su próxima parada"}, ${stopsAwayText(hero.stopsAway)} de aquí.`}
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
                    <span className="rm"><span className="rt">{etaText(b.etaAt, nowSec)}{!b.official && <i className="apx"> aprox.</i>}</span><span className="rs">Bus {i + 2} · {stopsAwayText(b.stopsAway)}</span></span>
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
                  const at = row.buses.filter((b) => b.vehicle.nextStopId === sid);
                  const last = i === path.length - 1;
                  return (
                    <li key={sid} className={`${at.length ? "here" : ""}${last ? " goal" : ""}`} onClick={() => act.focusStop(sid)}>
                      {transit.stopById(sid)?.name ?? sid}
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
