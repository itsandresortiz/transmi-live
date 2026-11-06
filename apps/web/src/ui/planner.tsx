import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import { type Itinerary, type Leg, type PlanPlace, type RideLeg, type WalkLeg, searchPlanPlaces } from "@transmi/application";
import { SYSTEM_LABEL } from "@transmi/domain";
import { transit } from "../composition-root";
import { routeBadgeColor, type MapTheme } from "../map/theme";
import { nowSec } from "../clock";
import { Back, Directions, Locate, Pin, Swap, Walk } from "./icons";
import { etaText } from "./format";
import { geocode } from "./geocode";
import { useFavs } from "./favorites";
import { useLocation } from "./location";
import { type Field, usePlanner } from "./plannerStore";
import { useUi } from "./store";
import { stopText } from "./stopname";
import type { Actions } from "./views";

/* ---------- utilidades de texto ---------- */

const mins = (s: number) => Math.max(1, Math.round(s / 60));
export function durText(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 1) return "menos de 1 min";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, "0")} min` : `${h} h`;
}
const hm = (sec: number) => new Date(sec * 1000).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit", timeZone: "America/Bogota" });
const meters = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace(".", ",")} km` : `${Math.round(m / 10) * 10} m`);
const transfersText = (n: number) => (n === 0 ? "Sin trasbordos" : n === 1 ? "1 trasbordo" : `${n} trasbordos`);
const isRide = (l: Leg): l is RideLeg => l.kind === "ride";
const isWalk = (l: Leg): l is WalkLeg => l.kind === "walk";

/** Abre «Cómo llegar» con un destino ya elegido (desde una parada o estación). */
export function openPlannerTo(place: PlanPlace) {
  const u = useUi.getState();
  u.setRoute(null); u.setTab("viaje"); u.setSheet("half");
  usePlanner.getState().setPlace("dest", place);
}

/* ---------- lo que se dibuja en el mapa ---------- */

export function tripGeo(it: Itinerary, th: MapTheme, origin: PlanPlace, dest: PlanPlace): { lines: FeatureCollection; points: FeatureCollection } {
  const lines: Feature<LineString>[] = [], points: Feature<Point>[] = [];
  const pt = (k: string, name: string, p: { lat: number; lon: number }, color = "#ffffff"): Feature<Point> => ({ type: "Feature", properties: { k, name, color }, geometry: { type: "Point", coordinates: [p.lon, p.lat] } });
  for (const leg of it.legs) {
    if (isRide(leg)) {
      const color = routeBadgeColor(th, transit.routeById(leg.routeId), leg.system);
      lines.push({ type: "Feature", properties: { k: "ride", color }, geometry: { type: "LineString", coordinates: leg.line.map((p) => [p.lon, p.lat]) } });
      points.push(pt("stop", leg.board.name, leg.board.position, color), pt("stop", leg.alight.name, leg.alight.position, color));
    } else lines.push({ type: "Feature", properties: { k: "walk" }, geometry: { type: "LineString", coordinates: leg.line.map((p) => [p.lon, p.lat]) } });
  }
  points.push(pt("origin", origin.name, origin.position), pt("dest", dest.name, dest.position));
  return { lines: { type: "FeatureCollection", features: lines }, points: { type: "FeatureCollection", features: points } };
}

/* ---------- pantalla ---------- */

export function PlannerView({ th, act }: { th: MapTheme; act: Actions }) {
  const p = usePlanner();
  const me = useLocation((l) => l.me);
  const setTab = useUi((u) => u.setTab);

  // al abrir sin origen: se intenta ubicar al usuario; mientras la pantalla está abierta los tiempos se recalculan con los buses en vivo
  useEffect(() => { if (p.originMe && !me && useLocation.getState().status !== "denied") void useLocation.getState().locate(); }, [p.originMe, me]);
  useEffect(() => { if (p.originMe && me && p.dest && !p.results && !p.busy) p.plan(); }, [p.originMe, me, p.dest, p.results, p.busy]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setInterval(() => { if (!document.hidden && usePlanner.getState().results) usePlanner.getState().plan(); }, 45_000); return () => clearInterval(t); }, []);

  const originLabel = p.originMe ? "Mi ubicación" : p.origin?.name ?? "";
  return (
    <>
      <div className="trip-top">
        <button className="back" onClick={() => { setTab("rutas"); }}><Back /> Cerrar</button>
        <h2>Cómo llegar</h2>
      </div>
      <div className="trip-fields">
        <div className="trip-col">
          <i className="dot a" /><i className="line" /><i className="dot b" />
        </div>
        <div className="trip-inputs">
          <PlaceInput field="origin" label={originLabel} placeholder="Punto de partida" />
          <PlaceInput field="dest" label={p.dest?.name ?? ""} placeholder="¿A dónde vas?" />
        </div>
        <button className="swap" aria-label="Intercambiar origen y destino" onClick={() => p.swap()} disabled={!p.dest}><Swap /></button>
      </div>
      {p.editing ? <Suggestions field={p.editing} /> : <Results th={th} act={act} />}
    </>
  );
}

function PlaceInput({ field, label, placeholder }: { field: Field; label: string; placeholder: string }) {
  const { editing, text, setEditing, setText } = usePlanner();
  const active = editing === field;
  return (
    <label className={`pin${active ? " on" : ""}`}>
      <input
        type="search" enterKeyHint="search" autoComplete="off" spellCheck={false} aria-label={field === "origin" ? "Desde" : "Hasta"}
        placeholder={placeholder} value={active ? text[field] : label}
        onFocus={(e) => { setEditing(field); e.currentTarget.select(); }}
        onChange={(e) => setText(field, e.target.value)}
      />
    </label>
  );
}

/* ---------- sugerencias ---------- */

function Suggestions({ field }: { field: Field }) {
  const { text, recents, setPlace, setEditing, setPicking } = usePlanner();
  const me = useLocation((l) => l.me);
  const favStops = useFavs((f) => f.stops);
  const q = useDeferredValue(text[field].trim());
  const local = useMemo(() => (q.length >= 2 ? searchPlanPlaces(transit, q, 6) : []), [q]);
  const [remote, setRemote] = useState<PlanPlace[]>([]);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  // direcciones y lugares (Photon / OpenStreetMap): se consulta cuando el usuario deja de escribir un momento
  useEffect(() => {
    setRemote([]);
    if (q.length < 3) { setBusy(false); return; }
    const id = ++seq.current, ctl = new AbortController();
    setBusy(true);
    const t = setTimeout(() => {
      geocode(q, me, ctl.signal).then((r) => { if (id === seq.current) setRemote(r); }).catch(() => undefined).finally(() => { if (id === seq.current) setBusy(false); });
    }, 380);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, me]);

  const favs = useMemo(() => favStops.slice(0, 4).map((id) => transit.stopById(id)).filter((s): s is NonNullable<typeof s> => !!s).map((s) => ({ name: stopText(s), position: s.position })), [favStops]);
  const pick = (pl: PlanPlace) => setPlace(field, pl);
  const Row = ({ title, sub, icon, onClick }: { title: string; sub?: string; icon: React.ReactNode; onClick(): void }) => (
    <button className="row prow" onClick={onClick}><span className="pico">{icon}</span><span className="rm"><span className="rt">{title}</span>{sub && <span className="rs">{sub}</span>}</span></button>
  );
  return (
    <div className="list psugg" role="listbox" aria-label="Lugares">
      <Row title="Mi ubicación" sub={me ? "Usar donde estoy ahora" : "Activar la ubicación"} icon={<Locate />} onClick={async () => { const g = await useLocation.getState().locate(); if (g) setPlace(field, field === "origin" ? "me" : { name: "Mi ubicación", position: g }); }} />
      <Row title="Elegir en el mapa" sub="Toca el punto exacto" icon={<Pin />} onClick={() => setPicking(field)} />
      {!q && recents.length > 0 && <div className="sec">Recientes</div>}
      {!q && recents.map((r) => <Row key={r.name + r.position.lat} title={r.name} icon={<Pin />} onClick={() => pick(r)} />)}
      {!q && favs.length > 0 && <div className="sec">Tus paradas favoritas</div>}
      {!q && favs.map((r) => <Row key={r.name + r.position.lat} title={r.name} icon={<Pin />} onClick={() => pick(r)} />)}
      {local.length > 0 && <div className="sec">Estaciones y paradas</div>}
      {local.map((r) => <Row key={r.name + r.position.lat} title={r.name} icon={<Directions />} onClick={() => pick(r)} />)}
      {(remote.length > 0 || busy) && <div className="sec">Direcciones y lugares</div>}
      {remote.map((r) => <Row key={r.name + r.position.lat} title={r.name.split(" · ")[0]!} sub={r.name.split(" · ").slice(1).join(" · ") || "Bogotá"} icon={<Pin />} onClick={() => pick(r)} />)}
      {busy && remote.length === 0 && <p className="hint" style={{ padding: "6px 4px" }}>Buscando lugares…</p>}
      {q.length >= 3 && !busy && !local.length && !remote.length && <p className="hint" style={{ padding: "10px 4px" }}>No encontramos «{q}». Prueba con el nombre de una estación, una calle con número («Cra 7 # 72») o un lugar conocido.</p>}
      <button className="btn" style={{ margin: "10px 0 4px" }} onClick={() => setEditing(null)}>Listo</button>
    </div>
  );
}

/* ---------- resultados ---------- */

function Results({ th, act }: { th: MapTheme; act: Actions }) {
  const { results, sel, busy, origin, originMe, dest, error, select, plan } = usePlanner();
  const me = useLocation((l) => l.me);
  if (!dest) return (
    <div className="empty"><Directions /><b>¿A dónde vas?</b>Elige un destino y te mostramos las mejores opciones con los buses que van en vivo, los trasbordos y cuánto caminas.</div>
  );
  if (originMe && !me) return (
    <div className="empty"><Locate /><b>Necesitamos tu punto de partida</b>Activa tu ubicación o elige el origen en el campo de arriba.
      <button className="btn primary" style={{ marginTop: 12 }} onClick={() => void useLocation.getState().locate()}>Usar mi ubicación</button></div>
  );
  if (!originMe && !origin) return <div className="empty"><Pin /><b>Falta el origen</b>Elige de dónde sales.</div>;
  if (busy && !results) return <div className="empty"><Directions /><b>Buscando cómo llegar…</b>Combinando rutas y buses que van en vivo.</div>;
  if (error) return <div className="empty"><Directions /><b>No pudimos calcular el viaje</b>{error}<button className="btn" style={{ marginTop: 12 }} onClick={() => plan()}>Reintentar</button></div>;
  if (!results) return null;
  if (!results.length) return (
    <div className="empty"><Directions /><b>No encontramos una forma de llegar</b>Puede que no haya paradas cerca de uno de los dos puntos, o que las rutas no estén operando a esta hora. Prueba moviendo el origen o el destino unos metros.</div>
  );
  return (
    <div className="tlist">
      <p className="hint tnote">Salida ahora · {hm(nowSec())}. Tiempos estimados con los buses que van en vivo y el tráfico habitual.</p>
      {results.map((it, i) => <Card key={i} it={it} i={i} on={i === sel} th={th} act={act} select={select} />)}
    </div>
  );
}

function Chain({ it, th }: { it: Itinerary; th: MapTheme }) {
  return (
    <div className="chain" aria-hidden="true">
      {it.legs.map((l, i) => isRide(l)
        ? <span key={i} className="rb sm" style={{ ["--c" as string]: routeBadgeColor(th, transit.routeById(l.routeId), l.system) }}>{l.shortName}</span>
        : <span key={i} className="wk"><Walk /> {mins(l.seconds)}</span>)}
    </div>
  );
}

function Bar({ it, th }: { it: Itinerary; th: MapTheme }) {
  const parts: { w: number; c: string; wait?: boolean }[] = [];
  for (const l of it.legs) {
    if (isWalk(l)) parts.push({ w: l.seconds, c: "var(--faint)" });
    else { if (l.waitSeconds > 30) parts.push({ w: l.waitSeconds, c: "var(--hover)", wait: true }); parts.push({ w: l.rideSeconds, c: routeBadgeColor(th, transit.routeById(l.routeId), l.system) }); }
  }
  const total = parts.reduce((a, b) => a + b.w, 0) || 1;
  return <div className="tbar" aria-hidden="true">{parts.map((x, i) => <i key={i} className={x.wait ? "wait" : ""} style={{ width: `${(x.w / total) * 100}%`, background: x.c }} />)}</div>;
}

function Card({ it, i, on, th, act, select }: { it: Itinerary; i: number; on: boolean; th: MapTheme; act: Actions; select(i: number): void }) {
  const first = it.legs.find(isRide);
  const now = nowSec();
  const onlyWalk = !first;
  return (
    <div className={`tcard${on ? " on" : ""}`}>
      <button className="thead" aria-pressed={on} onClick={() => select(i)}>
        <div className="ttop">
          <div className="ttags">{it.tags.map((t) => <span key={t} className={`tpill${t === "Más rápida" ? " best" : ""}`}>{t}</span>)}</div>
          <div className="tmin"><b>{durText(it.seconds)}</b><small>llegas {hm(it.arriveAt)}</small></div>
        </div>
        <Chain it={it} th={th} />
        <Bar it={it} th={th} />
        <div className="tsub">
          {onlyWalk ? `Caminando · ${meters(it.walkMeters)}` : <>{transfersText(it.transfers)} · caminas {meters(it.walkMeters)}</>}
          {first && <> · <span className={first.waitKind === "live" ? "live" : ""}>{first.waitKind === "live" ? `${first.shortName} llega ${etaText(first.departAt, now) === "llegando" ? "ya" : "en " + etaText(first.departAt, now)} (en vivo)` : `${first.shortName} pasa cada ~${mins(first.headwaySeconds)} min`}</span></>}
        </div>
      </button>
      {on && <Steps it={it} th={th} act={act} />}
    </div>
  );
}

function Steps({ it, th, act }: { it: Itinerary; th: MapTheme; act: Actions }) {
  const now = nowSec();
  return (
    <ol className="steps">
      {it.legs.map((l, i) => isWalk(l) ? (
        <li key={i} className="step walk">
          <span className="sico"><Walk /></span>
          <div><b>Camina {durText(l.seconds)}</b> <small>({meters(l.meters)})</small><div className="sd">hasta {l.toName}</div></div>
        </li>
      ) : (
        <li key={i} className="step ride" style={{ ["--c" as string]: routeBadgeColor(th, transit.routeById(l.routeId), l.system) }}>
          <span className="rb sm">{l.shortName}</span>
          <div>
            <b>{l.headsign ? `Hacia ${l.headsign}` : SYSTEM_LABEL[l.system]}</b>
            <div className="sd">Sube en <b>{l.board.name}</b></div>
            <div className="sd">{l.waitKind === "live" ? <span className="live">El bus llega {etaText(l.departAt, now) === "llegando" ? "ya" : "en " + etaText(l.departAt, now)} (en vivo)</span> : <>Pasa cada ~{mins(l.headwaySeconds)} min · espera aprox. {durText(l.waitSeconds)}</>}</div>
            <div className="sd">{l.stops} {l.stops === 1 ? "parada" : "paradas"} · {durText(l.rideSeconds)}</div>
            <div className="sd">Baja en <b>{l.alight.name}</b></div>
            <button className="btn sm ghost" onClick={() => act.openRoute(l.routeId)}>Ver la ruta {l.shortName}</button>
          </div>
        </li>
      ))}
      <li className="step end"><span className="sico"><Pin /></span><div><b>Llegas a las {hm(it.arriveAt)}</b></div></li>
    </ol>
  );
}
