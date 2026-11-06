import { useEffect, useMemo } from "react";
import { nearestStops, upcomingAtStop } from "@transmi/application";
import { transit } from "../composition-root";
import type { MapTheme } from "../map/theme";
import { routeBadgeColor } from "../map/theme";
import { Bus, Chevron, Locate } from "./icons";
import { nowSec as serverNowSec } from "../clock";
import { etaText } from "./format";
import { stopKind, stopText } from "./stopname";
import { useFavs } from "./favorites";
import { useNow, useTransitVersion } from "./hooks";
import { hadLocationPermission, useLocation } from "./location";
import type { Actions } from "./views";

/** Próximos buses de una parada, calculados una vez por lote (no cada segundo). */
export function useUpcoming(stopId: string | null, perRoute: number) {
  const version = useTransitVersion();
  const nowSec = useNow() / 1000;
  const rows = useMemo(() => (stopId ? upcomingAtStop(transit, stopId, serverNowSec(), perRoute) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version, stopId, perRoute]);
  return { rows, nowSec };
}

export function StarButton({ kind, id }: { kind: "stop" | "route"; id: string }) {
  const on = useFavs((f) => (kind === "stop" ? f.stops : f.routes).includes(id));
  const toggle = useFavs((f) => (kind === "stop" ? f.toggleStop : f.toggleRoute));
  return (
    <button className={`star${on ? " on" : ""}`} aria-pressed={on} aria-label={on ? "Quitar de favoritos" : "Guardar en favoritos"} onClick={() => toggle(id)}>
      <svg width="22" height="22" viewBox="0 0 24 24" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="m12 3.3 2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-3-5.4 3 1.1-6-4.5-4.2 6.1-.8z" /></svg>
    </button>
  );
}

/** Tarjeta corta de una parada con lo que viene ahora. */
export function StopCard({ stopId, th, act, meters }: { stopId: string; th: MapTheme; act: Actions; meters?: number }) {
  const stop = transit.stopById(stopId);
  const { rows, nowSec } = useUpcoming(stopId, 1);
  if (!stop) return null;
  const dist = meters == null ? "" : meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
  return (
    <button className="card stopcard" onClick={() => act.openStop(stopId)}>
      <div className="sct"><b>{stopText(stop)}</b>{stopKind(stop) !== "Parada" && <span className="kindchip">{stopKind(stop)}</span>}{dist && <span>{dist}</span>}<span className="chev"><Chevron /></span></div>
      {rows.length ? (
        <div className="scr">
          {rows.slice(0, 3).map((r) => (
            <span key={r.route.id + r.direction} className="scc">
              <i className="rb sm" style={{ ["--c" as string]: routeBadgeColor(th, r.route) }}>{r.route.shortName}</i>
              <em>{etaText(r.buses[0]!.etaAt, nowSec)}</em>
            </span>
          ))}
        </div>
      ) : <div className="cs">Ningún bus viene ahora</div>}
    </button>
  );
}

export function FavoritesSection({ th, act }: { th: MapTheme; act: Actions }) {
  useTransitVersion();
  const stops = useFavs((f) => f.stops), routes = useFavs((f) => f.routes);
  if (!stops.length && !routes.length) return null;
  return (
    <div className="favs">
      <div className="sec" style={{ marginTop: 4 }}>Tus favoritos</div>
      {stops.map((id) => <StopCard key={id} stopId={id} th={th} act={act} />)}
      {routes.length > 0 && (
        <div className="rbs" style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "2px 0 10px" }}>
          {routes.map((id) => { const r = transit.routeById(id); return r ? <button key={id} className="rb" style={{ ["--c" as string]: routeBadgeColor(th, r) }} onClick={() => act.openRoute(id)}>{r.shortName}</button> : null; })}
        </div>
      )}
    </div>
  );
}

export function NearbySection({ th, act, compact = false }: { th: MapTheme; act: Actions; compact?: boolean }) {
  useTransitVersion();
  const { me, status, locate } = useLocation();
  useEffect(() => { if (status === "idle" && hadLocationPermission()) void locate(); }, [status, locate]);
  const near = useMemo(() => (me ? nearestStops(transit, me, compact ? 3 : 6) : []), [me, transit.network, compact]);   // eslint-disable-line react-hooks/exhaustive-deps
  // en la primera pantalla, sin ubicación, basta una fila discreta (no una tarjeta grande)
  if (compact && !me) {
    if (status === "denied" || status === "unsupported") return null;
    return <button className="row nearrow" onClick={() => void locate()} disabled={status === "asking"}><span className="pico"><Locate /></span><span className="rm"><span className="rt">{status === "asking" ? "Buscando tu ubicación…" : "Ver paradas cerca de ti"}</span><span className="rs">Y cuándo pasa el próximo bus</span></span><span className="chev"><Chevron /></span></button>;
  }
  return (
    <div className="nearby">
      <div className="sec" style={{ marginTop: compact ? 4 : 12 }}>Cerca de ti</div>
      {!me ? (
        <div className="card">
          <div className="cs">{status === "denied" ? "No pudimos ubicarte. Revisa el permiso de ubicación del navegador y vuelve a intentar." : status === "unsupported" ? "Tu navegador no permite ubicarte." : "Mira de una vez las paradas más cercanas y cuándo pasa el próximo bus."}</div>
          <button className="btn primary" style={{ marginTop: 12 }} disabled={status === "asking"} onClick={() => void locate()}><Locate /> {status === "asking" ? "Buscando tu ubicación…" : "Usar mi ubicación"}</button>
        </div>
      ) : !transit.network.stops.size ? (
        <div className="empty"><Bus /><b>Cargando paradas…</b></div>
      ) : near.length ? near.map((n) => <StopCard key={n.stop.id} stopId={n.stop.id} th={th} act={act} meters={n.meters} />)
        : <div className="empty"><Bus /><b>No hay paradas a menos de 1,2 km</b>Acércate a un sector con servicio.</div>}
    </div>
  );
}
