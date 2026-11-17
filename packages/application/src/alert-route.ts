import type { ServiceAlert } from "@transmi/domain";
import type { TransitState } from "./transit-state";

/**
 * El nombre que conoce la gente («539», «FA410») de la ruta de un aviso de TransMilenio.
 *
 * Desde nov. 2026 casi todos los avisos traen la ruta con un número interno («10194») que **no existe en el GTFS vigente** (parece la
 * numeración anterior): con 525 avisos, ninguno se podía traducir por ese número y la app decía «La ruta 10194 se desvía…».
 * Se deduce así, de lo más seguro a lo menos:
 *  1. el número existe en el GTFS → su nombre;
 *  2. el código ya es un nombre de ruta («F23», «K305»);
 *  3. alguna ruta del aviso existe en el GTFS → su nombre;
 *  4. las paradas del aviso: la única ruta que pasa por todas, en ese orden. Si son varias, se cruzan con los demás avisos del mismo
 *     número (casi siempre hay varios) y solo se nombra si queda una.
 * Si no hay certeza devuelve `undefined` y el texto dice «Una ruta…» en vez de un número que nadie reconoce.
 */
export function alertRouteName(state: TransitState, code: string, alert: ServiceAlert): string | undefined {
  const byId = state.routeById(code);
  if (byId) return byId.shortName;
  const idx = indexOf(state);
  if (idx.names.has(code)) return code;
  for (const id of alert.routeIds) { const r = state.routeById(id); if (r) return r.shortName; }
  const set = idx.byCode.get(code);
  return set && set.size === 1 ? [...set][0] : undefined;
}

interface Index { names: Set<string>; byCode: Map<string, Set<string>> }
let cache: { net: unknown; alerts: unknown; idx: Index } | null = null;

function indexOf(state: TransitState): Index {
  const net = state.network, alerts = state.alerts;
  if (cache && cache.net === net && cache.alerts === alerts) return cache.idx;
  const names = new Set<string>();
  const byStop = new Map<string, Set<string>>();
  for (const [rid, shapes] of net.shapes) {
    const sn = net.routes.get(rid)?.shortName;
    if (!sn) continue;
    names.add(sn);
    for (const sh of shapes) for (const s of sh.stopIds) (byStop.get(s) ?? byStop.set(s, new Set()).get(s)!).add(sn);
  }
  // ¿la ruta pasa por estas paradas en este orden?
  const inOrder = (sn: string, stops: readonly string[]) => {
    for (const r of net.routes.values()) {
      if (r.shortName !== sn) continue;
      for (const sh of net.shapes.get(r.id) ?? []) {
        let last = -1, ok = true;
        for (const s of stops) { const i = sh.stopIds.indexOf(s, last + 1); if (i < 0) { ok = false; break; } last = i; }
        if (ok) return true;
      }
    }
    return false;
  };
  const byCode = new Map<string, Set<string>>();
  for (const a of alerts) {
    const code = alertRouteCode(a);
    if (!code || names.has(code) || state.routeById(code) || !a.stopIds.length) continue;
    const sets = a.stopIds.map((s) => byStop.get(s) ?? new Set<string>());
    const cand = new Set([...sets[0]!].filter((n) => sets.every((x) => x.has(n)) && inOrder(n, a.stopIds)));
    const prev = byCode.get(code);
    byCode.set(code, prev ? new Set([...prev].filter((x) => cand.has(x))) : cand);
  }
  const idx = { names, byCode };
  cache = { net, alerts, idx };
  return idx;
}

/** El código de ruta con que viene escrito el aviso («Novedad en la operacion en linea 10194\…» → «10194»). */
export function alertRouteCode(a: ServiceAlert): string {
  return (a.description.split("\\")[0] ?? "").replace(/^.*\s/, "").trim();
}

/** Si no hay una sola ruta segura: las pocas que pueden ser (pasan por esas paradas en ese orden), para decir «puede ser la 260 o la HB608». */
export function alertRouteCandidates(state: TransitState, code: string, alert: ServiceAlert): string[] {
  if (alertRouteName(state, code, alert)) return [];
  const set = indexOf(state).byCode.get(code);
  return set && set.size > 1 && set.size <= 4 ? [...set].sort() : [];
}
