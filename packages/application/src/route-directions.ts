import type { RouteShape, Vehicle } from "@transmi/domain";
import { arrivalAtIndex, displayNextIndex } from "./eta";
import type { TransitState } from "./transit-state";

/** Un sentido de una ruta tal como lo ve la gente («hacia Portal Norte»), aunque TransMilenio lo publique con otro código de ruta.
 *  Puede juntar varios recorridos que terminan en el mismo sitio (variantes cortas): se muestra el más largo. */
export interface RouteDirection {
  /** Identificador estable del sentido dentro de la familia: `ruta:sentido` del recorrido principal. */
  key: string;
  /** Código de ruta del recorrido principal (para horario, estado del día y enlaces). */
  routeId: string;
  direction: string;
  /** Recorrido principal: el que se dibuja y cuyas paradas se listan. */
  shape: RouteShape;
  /** Todos los recorridos de la familia que van hacia el mismo sitio (incluye `shape`). */
  shapes: readonly RouteShape[];
  /** A dónde va: el destino que publica TransMilenio o, si no lo trae (troncales), el nombre de su última parada. */
  toward: string;
  /** «Hacia Portal Norte». */
  label: string;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** A dónde va un recorrido: el destino publicado o el nombre limpio (sin vagón ni plataforma) de su última parada. */
export function shapeToward(state: TransitState, sh: RouteShape): string {
  if (sh.headsign.trim()) return sh.headsign.trim();
  const last = state.stopById(sh.stopIds[sh.stopIds.length - 1]);
  return last ? state.labelOf(last).title : "";
}

/** Los sentidos de una ruta contando su «familia» (mismo nombre y sistema; TransMilenio publica cada sentido con un código aparte en
 *  261 de 668 nombres). El orden no depende de con qué código se abrió la ficha: así el selector no salta al cambiar de sentido. */
export function routeDirections(state: TransitState, routeId: string): RouteDirection[] {
  const shapes: RouteShape[] = [];
  for (const id of [...state.routeFamily(routeId)].sort()) for (const sh of state.network.shapes.get(id) ?? []) if (sh.stopIds.length || sh.points.length > 1) shapes.push(sh);
  const groups = new Map<string, { toward: string; shapes: RouteShape[] }>();
  shapes.forEach((sh, i) => {
    const toward = shapeToward(state, sh), k = toward ? norm(toward) : `#${i}`;      // sin nombre no se junta con nada
    const g = groups.get(k);
    if (g) g.shapes.push(sh); else groups.set(k, { toward, shapes: [sh] });
  });
  const out: RouteDirection[] = [];
  for (const g of groups.values()) {
    const main = g.shapes.reduce((a, b) => (b.stopIds.length > a.stopIds.length ? b : a));
    out.push({ key: `${main.routeId}:${main.direction}`, routeId: main.routeId, direction: main.direction, shape: main, shapes: g.shapes, toward: g.toward, label: g.toward ? `Hacia ${g.toward}` : `Sentido ${out.length + 1}` });
  }
  return out;
}

/** El sentido que se muestra primero: el del código y sentido pedidos (desde una parada, un enlace o un bus); si no, el del código;
 *  si no, el primero. */
export function pickDirection(dirs: readonly RouteDirection[], want: { routeId?: string | null; direction?: string | null; key?: string | null }): RouteDirection | undefined {
  return (want.key ? dirs.find((d) => d.key === want.key) : undefined)
    ?? dirs.find((d) => d.shapes.some((s) => s.routeId === want.routeId && (want.direction == null || s.direction === want.direction)))
    ?? dirs.find((d) => d.shapes.some((s) => s.routeId === want.routeId))
    ?? dirs[0];
}

/** El sentido en que va un bus de la familia (o nada si no se le encuentra recorrido). */
export function directionOfBus(state: TransitState, dirs: readonly RouteDirection[], v: Vehicle): RouteDirection | undefined {
  const seq = state.sequenceForDisplay(v);
  return seq ? dirs.find((d) => d.shapes.includes(seq.shape)) : undefined;
}

export interface DirectionBus {
  vehicle: Vehicle;
  /** Índice, en las paradas del recorrido principal, de la última parada por la que pasó (la próxima es `k + 1`). */
  k: number;
  nextStopId: string;
  /** Hora estimada de llegada a la próxima parada (segundos desde 1970). */
  at: number;
}

/** Los buses de la familia que van en este sentido, con su próxima parada y la hora a la que llegan a ella; el más adelantado primero.
 *  Un bus de una variante corta se ubica en las paradas del recorrido principal por su próxima parada. */
export function directionBuses(state: TransitState, dir: RouteDirection, nowMs: number): DirectionBus[] {
  const family = new Set(dir.shapes.map((s) => s.routeId)), out: DirectionBus[] = [];
  for (const v of state.fleet.values()) {
    if (!family.has(v.routeId)) continue;
    const seq = state.sequenceForDisplay(v);
    if (!seq || !dir.shapes.includes(seq.shape)) continue;
    const j = displayNextIndex(state, v, seq.shape, seq.index, nowMs), nextId = seq.shape.stopIds[j];
    if (!nextId) continue;
    const k = seq.shape === dir.shape ? j - 1 : dir.shape.stopIds.indexOf(nextId) - 1;
    if (k < -1) continue;
    out.push({ vehicle: v, k, nextStopId: nextId, at: arrivalAtIndex(state, v, seq.shape, seq.index, j, nowMs) });
  }
  return out.sort((a, b) => b.k - a.k);
}

/* ---------- favoritos: una ruta guardada es la ruta en sus dos sentidos ---------- */

/** ¿Está guardada la ruta (cualquiera de sus códigos)? Los favoritos viejos guardaban un código por sentido y siguen valiendo. */
export function isRouteSaved(state: TransitState, saved: readonly string[], routeId: string): boolean {
  return state.routeFamily(routeId).some((id) => saved.includes(id)) || saved.includes(routeId);
}

/** Guarda la ruta (un código basta para la familia) o la quita con todos sus códigos. */
export function toggleSavedRoute(state: TransitState, saved: readonly string[], routeId: string): string[] {
  if (!isRouteSaved(state, saved, routeId)) return [routeId, ...saved];
  const fam = new Set([routeId, ...state.routeFamily(routeId)]);
  return saved.filter((id) => !fam.has(id));
}

/** Las rutas guardadas para mostrar: una por familia, en el orden en que se guardaron. Si quedaron guardados los dos sentidos (de antes),
 *  sale una sola vez. Mientras la red no carga se devuelven tal cual (no se pierde nada). */
export function savedRouteFamilies(state: TransitState, saved: readonly string[]): string[] {
  const seen = new Set<string>(), out: string[] = [];
  for (const id of saved) {
    const r = state.routeById(id), k = r ? `${r.system}|${r.shortName}` : `#${id}`;
    if (seen.has(k)) continue;
    seen.add(k); out.push(id);
  }
  return out;
}
