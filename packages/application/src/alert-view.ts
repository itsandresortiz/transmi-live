import { ALERT_EFFECT_LABEL, type AlertEffect, type Route, type ServiceAlert, alertMotive, alertValidity, isReportedAlert, parseStopName, stopLabelText } from "@transmi/domain";
import type { TransitState } from "./transit-state";
import { alertRouteCandidates, alertRouteCode, alertRouteName } from "./alert-route";

/** Un aviso listo para leer: lo que pasa y a qué ruta en el título, dónde en el texto, y por qué y desde cuándo aparte.
 *  Los avisos de TransMilenio llegan escritos para sus operadores («TM01», «tp73 por tm02», «Novedad en la operacion en linea 10194\…»):
 *  así nadie entendía qué ruta ni qué pasaba. */
export interface AlertView {
  /** La etiqueta de arriba («Desvío», «Anuncio de TransMilenio»). */
  tag: string;
  title: string;
  body: string;
  /** «Motivo: obras en la vía» si el código lo deja ver. */
  reason: string | null;
  /** «Reportado hoy a las 9:51 p. m.» / «Desde el 17 nov · hasta el 23 nov». */
  when: string;
  /** Rutas a las que afecta (las conocidas, para mostrarlas como insignias). */
  routes: Route[];
}

const NOUN: Record<AlertEffect, string> = {
  detour: "Desvío", noService: "Sin servicio", delays: "Demoras", reduced: "Servicio reducido", additional: "Servicio adicional",
  modified: "Cambio", stopMoved: "Parada trasladada", other: "Novedad",
};

export function alertView(state: TransitState, a: ServiceAlert, nowSec = Date.now() / 1000): AlertView {
  const when = alertValidity(a, nowSec);
  let routes = alertRoutes(state, a);
  if (a.title || a.text) return { tag: "Anuncio de TransMilenio", title: a.title ?? NOUN[a.effect], body: a.text ?? "", reason: null, when, routes };
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
  return { tag: ALERT_EFFECT_LABEL[a.effect], title, body, reason: m ? `Motivo: ${m.charAt(0).toLowerCase()}${m.slice(1)}` : null, when, routes };
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
