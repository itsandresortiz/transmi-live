import { ALERT_EFFECT_LABEL, REPORT_WINDOW_S, type AlertEffect, type GeoPoint, type Route, type RouteShape, type ServiceAlert, alertMotive, alertValidity, isReportedAlert, parseStopName, stopLabelText } from "@transmi/domain";
import { shapeStops } from "./eta";
import type { TransitState } from "./transit-state";
import { alertRouteCandidates, alertRouteCode, alertRouteName } from "./alert-route";

/** Un aviso listo para leer: lo que pasa y a qué ruta en el título, dónde en el texto, y por qué y desde cuándo aparte.
 *  Los avisos de TransMilenio llegan escritos para sus operadores («TM01», «tp73 por tm02», «Novedad en la operacion en linea 10194\…»):
 *  así nadie entendía qué ruta ni qué pasaba. */
export interface AlertView {
  /** La etiqueta de arriba («Desvío», «Anuncio de TransMilenio»). */
  tag: string;
  /** Aún más corto, para una etiqueta pequeña junto a la ruta («Desvío», «Cambio temporal»). */
  short: string;
  title: string;
  body: string;
  /** «Motivo: obras en la vía» si el código lo deja ver. */
  reason: string | null;
  /** «Reportado hoy a las 9:51 p. m.» / «Desde el 17 nov · hasta el 23 nov». */
  when: string;
  /** Rutas a las que afecta (las conocidas, para mostrarlas como insignias). */
  routes: Route[];
  /** Hasta cuándo se muestra (segundos): su fin anunciado o, si es un reporte de un instante, unas horas después del reporte. */
  until: number | null;
  /** Corto, para etiquetas: «hasta las 4:51 a. m.» / «hasta el 23 nov». */
  untilText: string | null;
}

const NOUN: Record<AlertEffect, string> = {
  detour: "Desvío", noService: "Sin servicio", delays: "Demoras", reduced: "Servicio reducido", additional: "Servicio adicional",
  modified: "Cambio", stopMoved: "Parada trasladada", other: "Novedad",
};

export function alertView(state: TransitState, a: ServiceAlert, nowSec = Date.now() / 1000): AlertView {
  const when = alertValidity(a, nowSec);
  const until = alertUntil(a), untilText = until == null ? null : untilLabel(until, nowSec);
  let routes = alertRoutes(state, a);
  if (a.title || a.text) return { tag: "Anuncio de TransMilenio", short: "Cambio temporal", title: a.title ?? NOUN[a.effect], body: a.text ?? "", reason: null, when, routes, until, untilText };
  const code = alertRouteCode(a), name = alertRouteName(state, code, a), maybe = alertRouteCandidates(state, code, a);
  const noun = NOUN[a.effect];
  if (!routes.length && maybe.length) routes = maybe.map((n) => [...state.network.routes.values()].find((r) => r.shortName === n)).filter((r): r is Route => !!r);
  // los números internos (5 cifras) son siempre de rutas zonales; decirlo ayuda a saber si a uno le toca
  const kind = /^\d{5,}$/.test(code) ? "una ruta zonal" : "una ruta";
  const title = name ? `${noun} de la ruta ${name}` : maybe.length ? `${noun} de una de estas rutas: ${orList(maybe)}` : `${noun} de ${kind}`;
  const places = alertPlaces(state, a);
  const verb = a.effect === "detour" ? "No pasa por su recorrido normal" : a.effect === "noService" ? "No presta servicio" : a.effect === "delays" ? "Va con demoras" : "Hay cambios";
  let body = places.length >= 2 ? `${verb} entre ${places[0]} y ${places[places.length - 1]}.` : places.length === 1 ? `${verb} cerca de ${places[0]}.` : `${verb}.`;
  if (maybe.length) body += " TransMilenio no dice cuál de ellas es: todas pasan por ahí.";
  if (isReportedAlert(a) && a.effect === "detour") body += " Puede que el bus no pare en las paradas de ese tramo.";
  const m = alertMotive(a);
  return { tag: ALERT_EFFECT_LABEL[a.effect], short: ALERT_EFFECT_LABEL[a.effect], title, body, reason: m ? `Motivo: ${m.charAt(0).toLowerCase()}${m.slice(1)}` : null, when, routes, until, untilText };
}

const orList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} o ${xs[xs.length - 1]}`);

/** Los lugares del aviso con el nombre de la parada que usa la app (el texto de TransMilenio trae claves como «Alim_Plat1_…»). */
function alertPlaces(state: TransitState, a: ServiceAlert): string[] {
  const fromStops = a.stopIds.map((id) => state.stopById(id)?.name).filter((n): n is string => !!n).map((n) => stopLabelText(parseStopName(n)));
  if (fromStops.length) return [...new Set(fromStops)];
  return a.description.split("\\").slice(1).map((x) => x.replace(/^\w+?_/, "").replace(/^TM_/, "").replace(/_/g, " ").trim()).filter(Boolean);
}

/** Rutas conocidas del aviso: las del GTFS o, si trae un número que no existe, todas las de la ruta que se deduce. */
export function alertRoutes(state: TransitState, a: ServiceAlert): Route[] {
  const known = a.routeIds.map((id) => state.routeById(id)).filter((r): r is Route => !!r);
  if (known.length) return known;
  const name = alertRouteName(state, alertRouteCode(a), a);
  if (!name) return [];
  const one = [...state.network.routes.values()].find((r) => r.shortName === name);
  return one ? [one] : [];
}

/** Clave para no repetir el mismo aviso: TransMilenio publica la misma novedad varias veces (una por cada reporte del operador). */
export function alertDedupKey(state: TransitState, a: ServiceAlert): string {
  if (a.title || a.text) return `own|${a.id}`;
  const code = alertRouteCode(a);
  return `${alertRouteName(state, code, a) ?? code}|${a.effect}|${[...a.stopIds].sort().join(",")}`;
}

/** Hasta cuándo sigue vigente un aviso (segundos), o `null` si no tiene fin. */
export function alertUntil(a: ServiceAlert): number | null {
  if (isReportedAlert(a)) return a.endsAt! + REPORT_WINDOW_S;
  return a.endsAt ?? null;
}

function untilLabel(t: number, nowSec: number): string {
  const day = (x: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date(x * 1000));
  if (day(t) === day(nowSec) || t - nowSec < 12 * 3600) {
    const h = new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Bogota" }).format(new Date(t * 1000));
    return `hasta las ${h}`;
  }
  return `hasta el ${new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", timeZone: "America/Bogota" }).format(new Date(t * 1000)).replace(/\.$/, "")}`;
}

/** Los avisos vigentes de una ruta (sus dos sentidos), sin repetidos, listos para mostrar en la ruta, el bus o el viaje. */
export function routeAlertViews(state: TransitState, routeId: string, nowSec = Date.now() / 1000): { alert: ServiceAlert; view: AlertView }[] {
  const seen = new Set<string>(), out: { alert: ServiceAlert; view: AlertView }[] = [];
  for (const id of state.routeFamily(routeId)) for (const i of state.alertsByRoute.get(id) ?? []) {
    const a = state.alerts[i];
    if (!a) continue;
    const k = alertDedupKey(state, a);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ alert: a, view: alertView(state, a, nowSec) });
  }
  return out.sort((x, y) => Number(!!y.alert.title) - Number(!!x.alert.title) || (y.alert.startsAt ?? 0) - (x.alert.startsAt ?? 0));
}

/** ¿La ruta tiene algún aviso vigente? (para marcar sus buses en el mapa). */
export function routeHasAlert(state: TransitState, routeId: string): boolean {
  return state.routeFamily(routeId).some((id) => (state.alertsByRoute.get(id)?.length ?? 0) > 0);
}

/** El tramo del recorrido que toca el aviso (de su primera a su última parada, en el orden del recorrido), para pintarlo en el mapa.
 *  `null` si el aviso no trae al menos dos paradas de este recorrido. */
export function alertStretch(state: TransitState, a: ServiceAlert, shape: RouteShape): GeoPoint[] | null {
  const idx = a.stopIds.map((id) => shape.stopIds.indexOf(id)).filter((i) => i >= 0);
  if (idx.length < 2) return null;
  const i = Math.min(...idx), j = Math.max(...idx);
  const info = shapeStops(state, shape);
  if (!info || i === j) return null;
  const pts = info.path.slice(info.s[i]!, info.s[j]!);
  return pts.length >= 2 ? pts : null;
}
