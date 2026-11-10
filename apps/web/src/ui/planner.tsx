import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import { type Itinerary, type Leg, type PlanPlace, type RideLeg, type WalkLeg, diagnosePlan, searchPlanPlaces, TRAVEL_MODES } from "@transmi/application";
import { SYSTEM_LABEL } from "@transmi/domain";
import { transit } from "../composition-root";
import { routeBadgeColor, type MapTheme } from "../map/theme";
import { nowSec } from "../clock";
import { Back, Directions, Locate, Pin, Swap, Walk } from "./icons";
import { etaText } from "./format";
import { geocode } from "./geocode";
import { useFavs } from "./favorites";
import { useLocation } from "./location";
import { type Field, type SortBy, nowMode, sortedResults, timeToMs, usePlanner } from "./plannerStore";
import { useRide } from "./ride";
import { useTrip } from "./trip";
import { SLOT_LABEL, type Slot, usePlaces } from "./places";
import { shareUrl } from "../deeplink";
import { useNow } from "./hooks";
import { haptic } from "./haptics";
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
  u.setRoute(null); u.setTab("viaje"); u.setSheet("full");
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

  // al abrir sin origen: se intenta ubicar al usuario; mientras la pantalla está abierta los tiempos se recalculan con los buses en vivo
  useEffect(() => { if (p.originMe && !me && useLocation.getState().status !== "denied") void useLocation.getState().locate(); }, [p.originMe, me]);
  useEffect(() => { if (p.originMe && me && p.dest && !p.results && !p.busy) p.plan(); }, [p.originMe, me, p.dest, p.results, p.busy]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setInterval(() => { if (!document.hidden && usePlanner.getState().results && usePlanner.getState().when.mode === "now") usePlanner.getState().plan(); }, 45_000); return () => clearInterval(t); }, []);

  const originLabel = p.originMe ? "Mi ubicación" : p.origin?.name ?? "";
  return (
    <>
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
      {!p.editing && p.dest && <WhenRow />}
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

/* ---------- cuándo viajas ---------- */

const hhmmNow = (ms: number) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Bogota" }).format(new Date(ms));

function WhenRow() {
  const { when, setWhen, modes, toggleMode } = usePlanner();
  const [time, setTime] = useState(() => (Number(hhmmNow(Date.now()).slice(0, 2)) < 5 ? "05:00" : hhmmNow(Date.now() + 3600_000)));      // de madrugada se propone la hora en que arranca el servicio
  const apply = (mode: "depart" | "arrive", t: string) => { const at = timeToMs(t); if (at) setWhen({ mode, at }); };
  return (
    <div className="when" role="group" aria-label="Cuándo viajas">
      <div className="tchips">
        <button className="chip" aria-pressed={when.mode === "now"} onClick={() => { haptic(); setWhen({ mode: "now" }); }}>Salir ahora</button>
        <button className="chip" aria-pressed={when.mode === "depart"} onClick={() => { haptic(); apply("depart", time); }}>Salir a las…</button>
        <button className="chip" aria-pressed={when.mode === "arrive"} onClick={() => { haptic(); apply("arrive", time); }}>Llegar a las…</button>
      </div>
      <div className="tchips" role="group" aria-label="Con qué quieres viajar">
        {TRAVEL_MODES.map((m) => <button key={m.key} className="chip" aria-pressed={modes[m.key]} onClick={() => { haptic(); toggleMode(m.key); }}>{m.label}</button>)}
      </div>
      {when.mode !== "now" && (
        <label className="whent">
          <span>{when.mode === "depart" ? "Hora de salida" : "Hora de llegada"}</span>
          <input type="time" value={hhmmNow(when.at)} onChange={(e) => { setTime(e.target.value); if (e.target.value) apply(when.mode as "depart" | "arrive", e.target.value); }} />
          <small>{new Date(when.at).toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short", timeZone: "America/Bogota" })}</small>
        </label>
      )}
    </div>
  );
}

/** «Guardar como Casa / Trabajo» para el destino que se está viendo. */
function SavePlace() {
  const dest = usePlanner((p) => p.dest);
  const saved = usePlaces();
  if (!dest) return null;
  const same = (s: Slot) => saved[s] && Math.abs(saved[s]!.position.lat - dest.position.lat) < 1e-5 && Math.abs(saved[s]!.position.lon - dest.position.lon) < 1e-5;
  const slots = (["home", "work"] as Slot[]).filter((s) => !same(s));
  if (!slots.length) return null;
  return (
    <div className="savep">
      {slots.map((s) => <button key={s} className="tlink" onClick={() => { saved.save(s, dest); haptic(); useUi.getState().showToast(`Guardado como ${SLOT_LABEL[s].toLowerCase()}`); }}>Guardar como {SLOT_LABEL[s].toLowerCase()}</button>)}
    </div>
  );
}

/* ---------- sugerencias ---------- */

function Suggestions({ field }: { field: Field }) {
  const { text, recents, setPlace, setEditing, setPicking } = usePlanner();
  const me = useLocation((l) => l.me);
  const favStops = useFavs((f) => f.stops);
  const saved = usePlaces();
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
      {!q && (["home", "work"] as Slot[]).map((s) => saved[s] && <Row key={s} title={SLOT_LABEL[s]} sub={saved[s]!.name} icon={<Pin />} onClick={() => pick(saved[s]!)} />)}
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

const SORTS: [SortBy, string][] = [["mejor", "Mejor"], ["rapida", "Más rápida"], ["trasbordos", "Menos trasbordos"], ["caminata", "Menos caminata"]];

/** Enlace del viaje actual para compartirlo (WhatsApp, etc.). */
async function shareTrip() {
  const p = usePlanner.getState(), me = useLocation.getState().me;
  if (!p.dest) return;
  const from = p.originMe ? null : p.origin ? { lat: p.origin.position.lat, lon: p.origin.position.lon, name: p.origin.name } : null;
  const url = shareUrl({ kind: "viaje", from, to: { lat: p.dest.position.lat, lon: p.dest.position.lon, name: p.dest.name } });
  void me;
  try { if (navigator.share) { await navigator.share({ title: `Cómo llegar a ${p.dest.name}`, text: `Cómo llegar a ${p.dest.name} en TransMi LIVE`, url }); return; } } catch (e) { if ((e as Error).name === "AbortError") return; }
  try { await navigator.clipboard.writeText(url); useUi.getState().showToast("Enlace del viaje copiado"); } catch { useUi.getState().showToast("No pudimos copiar el enlace"); }
}

function Results({ th, act }: { th: MapTheme; act: Actions }) {
  const { results, sel, busy, origin, originMe, dest, error, select, plan, sortBy, setSort, computedAt, when } = usePlanner();
  const me = useLocation((l) => l.me);
  const now = useNow();
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
  if (!results.length) return <NoResults />;
  const list = sortedResults(results, sortBy);
  const age = Math.max(0, Math.round((now - computedAt) / 1000));
  return (
    <div className="tlist" role="region" aria-label="Opciones para llegar">
      <p className="sr" role="status">{list.length} {list.length === 1 ? "opción encontrada" : "opciones encontradas"}.</p>
      <div className="tchips" role="group" aria-label="Ordenar opciones">
        {SORTS.map(([k, l]) => <button key={k} className="chip" aria-pressed={sortBy === k} onClick={() => { haptic(); setSort(k); }}>{l}</button>)}
      </div>
      <div className="tnote">
        <span>{when.mode === "now" ? (nowMode() === "schedule" ? `Sales ahora (${hm(now / 1000)}) · sin buses en vivo: tiempos según horarios` : `Sales ahora (${hm(now / 1000)}) · actualizado hace ${age < 5 ? "unos segundos" : `${age} s`}`)
          : when.mode === "depart" ? `Sales a las ${hm(when.at / 1000)} · según horarios y frecuencias`
          : `Llegas a las ${hm(when.at / 1000)} · según horarios y frecuencias`}</span>
        <span className="tacts">
          <button className="tlink" onClick={() => plan()} disabled={busy}>{busy ? "Actualizando…" : "Actualizar"}</button>
          <button className="tlink" onClick={() => void shareTrip()}>Compartir</button>
        </span>
      </div>
      <SavePlace />
      {list.map((it, i) => <Card key={i} it={it} i={i} on={i === sel} th={th} act={act} select={select} nowS={now / 1000} />)}
      <p className="hint tfoot">Tiempos estimados con los buses que van en vivo y el tráfico habitual; pueden cambiar. Caminatas en línea recta con un margen por las calles.</p>
    </div>
  );
}

function NoResults() {
  const { origin, originMe, dest, when } = usePlanner();
  const me = useLocation((l) => l.me);
  if (when.mode !== "arrive" && (when.mode === "now" || when.at - Date.now() < 120_000) && nowMode() === "none") return (
    <div className="empty"><Directions /><b>Ahora no hay buses en servicio</b>TransMilenio no está reportando buses en este momento. Elige «Salir a las…» o «Llegar a las…» y una hora (por ejemplo, mañana 5:00 a. m.) para ver las rutas que funcionan a esa hora.</div>
  );
  const from = originMe && me ? { name: "Mi ubicación", position: me } : origin;
  const d = from && dest ? diagnosePlan(transit, from, dest) : null;
  let why = "Prueba moviendo el origen o el destino unos metros.";
  if (d) {
    if (d.nearOrigin === 0 && d.nearDest === 0) why = "No hay paradas a menos de 900 m ni del origen ni del destino. Acércate a una avenida o elige puntos dentro de Bogotá.";
    else if (d.nearOrigin === 0) why = "No hay paradas a menos de 900 m del punto de partida. Prueba con un origen más cerca de una avenida o estación.";
    else if (d.nearDest === 0) why = "No hay paradas a menos de 900 m del destino. Prueba con un punto más cerca de una avenida o estación.";
    else if (d.routesRunning === 0) why = d.liveData ? "Ahora mismo no hay rutas en servicio." : "No hay datos en vivo y, según los horarios, ya no hay servicio a esta hora.";
    else if (when.mode !== "now") why = "A esa hora no encontramos rutas que conecten los dos puntos según los horarios. Prueba con otra hora o cambia un poco el origen o el destino.";
    else why = "Hay paradas cerca de los dos puntos, pero ninguna combinación de rutas (hasta tres trasbordos) los conecta con los buses que van ahora. Prueba más tarde o cambia un poco el origen o el destino.";
  }
  return <div className="empty"><Directions /><b>No encontramos una forma de llegar</b>{why}</div>;
}

function Chain({ it, th }: { it: Itinerary; th: MapTheme }) {
  return (
    <div className="chain" aria-hidden="true">
      {it.legs.map((l, i) => (
        <span key={i} className="cl">
          {i > 0 && <span className="sep">›</span>}
          {isRide(l)
            ? <span className="rb sm" style={{ ["--c" as string]: routeBadgeColor(th, transit.routeById(l.routeId), l.system) }}>{l.shortName}</span>
            : <span className="wk"><Walk /> {mins(l.seconds)} min</span>}
        </span>
      ))}
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

/** «llega en 3 min 20 s (en vivo)»: la cuenta regresiva avanza sola cada segundo. */
function liveLine(l: RideLeg, nowS: number): string {
  const e = etaText(l.departAt, nowS);
  return e === "llegando" ? "ya está llegando" : `llega en ${e}`;
}

/** Lo que lee un lector de pantalla: «Opción 1, más rápida: 35 minutos, llegas 9:25 p. m., sin trasbordos, ruta H17, caminas 1,4 km». */
function summary(it: Itinerary, i: number): string {
  const rides = it.legs.filter(isRide).map((l) => l.shortName);
  return `Opción ${i + 1}${it.tags.length ? `, ${it.tags.join(", ").toLowerCase()}` : ""}: ${durText(it.seconds)}, llegas ${hm(it.arriveAt)}, ${transfersText(it.transfers).toLowerCase()}${rides.length ? `, ruta${rides.length > 1 ? "s" : ""} ${rides.join(" y ")}` : ", a pie"}, caminas ${meters(it.walkMeters)}`;
}

function Card({ it, i, on, th, act, select, nowS }: { it: Itinerary; i: number; on: boolean; th: MapTheme; act: Actions; select(i: number): void; nowS: number }) {
  const first = it.legs.find(isRide);
  const onlyWalk = !first;
  const alerts = it.legs.filter(isRide).reduce((a, l) => a + l.alerts, 0);
  const slow = it.legs.filter(isRide).some((l) => l.lowFrequency);
  return (
    <div className={`tcard${on ? " on" : ""}`}>
      <button className="thead" aria-pressed={on} aria-expanded={on} aria-label={summary(it, i)} onClick={() => { haptic(); select(i); }}>
        <div className="ttop">
          <div className="ttags">
            {it.tags.map((t) => <span key={t} className={`tpill${t === "Más rápida" ? " best" : ""}`}>{t}</span>)}
            {alerts > 0 && <span className="tpill warn">{alerts} {alerts === 1 ? "aviso" : "avisos"}</span>}
            {slow && <span className="tpill warn">Poca frecuencia</span>}
          </div>
          <div className="tmin"><b>{durText(it.seconds)}</b><small>llegas {hm(it.arriveAt)}</small></div>
        </div>
        <Chain it={it} th={th} />
        <Bar it={it} th={th} />
        <div className="tsub">
          {onlyWalk ? `Caminando · ${meters(it.walkMeters)}` : <>{transfersText(it.transfers)} · caminas {meters(it.walkMeters)}</>}
          {first && <> · <span className={first.waitKind === "live" ? "live" : ""}>{first.waitKind === "live" ? `${first.shortName} ${liveLine(first, nowS)} (en vivo)` : `${first.shortName} pasa cada ~${mins(first.headwaySeconds)} min`}</span></>}
        </div>
      </button>
      {on && <Steps it={it} th={th} act={act} nowS={nowS} />}
    </div>
  );
}

function Steps({ it, th, act, nowS }: { it: Itinerary; th: MapTheme; act: Actions; nowS: number }) {
  const setTab = useUi((u) => u.setTab);
  return (
    <ol className="steps" aria-label="Pasos del viaje">
      {it.legs.map((l, i) => isWalk(l) ? (
        <li key={i} className="step walk">
          <span className="sico"><Walk /></span>
          <div><b>Camina {durText(l.seconds)}</b> <small>({meters(l.meters)})</small><div className="sd">hasta {l.toName}</div></div>
        </li>
      ) : (
        <li key={i} className="step ride" style={{ ["--c" as string]: routeBadgeColor(th, transit.routeById(l.routeId), l.system) }}>
          <span className="rb sm">{l.shortName}</span>
          <div>
            <b>{l.headsign ? `Hacia ${l.headsign}` : `${SYSTEM_LABEL[l.system]} ${l.shortName}`}</b>
            <div className="sd">Sube en <b>{l.board.name}</b></div>
            <div className="sd">{l.waitKind === "live"
              ? <span className="live">El bus{l.busLabel ? ` ${l.busLabel}` : ""} {liveLine(l, nowS)} (en vivo)</span>
              : <>Pasa cada ~{mins(l.headwaySeconds)} min · espera aprox. {durText(l.waitSeconds)}</>}</div>
            <div className="sd">{l.stops} {l.stops === 1 ? "parada" : "paradas"} · {durText(l.rideSeconds)}</div>
            {l.between.length > 0 && (
              <details className="via"><summary>Ver las {l.between.length} {l.between.length === 1 ? "parada intermedia" : "paradas intermedias"}</summary>
                <ul>{l.between.map((b) => <li key={b.id}>{b.name}</li>)}</ul></details>
            )}
            <div className="sd">Baja en <b>{l.alight.name}</b></div>
            {l.lowFrequency && <div className="swarn">Esta ruta pasa con poca frecuencia (cada ~{mins(l.headwaySeconds)} min).</div>}
            {l.alerts > 0 && <div className="swarn">Hay {l.alerts} {l.alerts === 1 ? "aviso" : "avisos"} de servicio en esta ruta. <button className="tlink" onClick={() => setTab("avisos")}>Ver avisos</button></div>}
            <div className="sbtns">
              {l.busId && <button className="btn sm" onClick={() => act.followBus(l.busId!)}>Seguir el bus</button>}
              {l.busId && <button className="btn sm primary" onClick={() => useRide.getState().start(l.busId!, l.alight.id)}>Voy en este bus</button>}
              <button className="btn sm ghost" onClick={() => act.openRoute(l.routeId)}>Ver la ruta {l.shortName}</button>
            </div>
          </div>
        </li>
      ))}
      <li className="step end"><span className="sico"><Pin /></span><div><b>Llegas a las {hm(it.arriveAt)}</b>
        {it.legs.some(isRide) && <div className="sbtns"><button className="btn sm primary" onClick={() => useTrip.getState().start(it, usePlanner.getState().dest?.name ?? "")}>Seguir este viaje</button></div>}
        {it.legs.some(isRide) && <div className="sd">Te vamos diciendo en pantalla cuándo subir, cuándo bajar y qué sigue, mientras tengas esta página abierta.</div>}
      </div></li>
    </ol>
  );
}
