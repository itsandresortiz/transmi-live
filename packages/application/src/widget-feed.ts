import type { SystemType } from "@transmi/domain";
import { arrivalOrPassed } from "./eta";
import type { TransitState } from "./transit-state";

/** Llegadas por parada para el widget del teléfono. Un proceso las publica cada minuto repartidas en archivos pequeños («cajones»);
 *  el widget baja solo el cajón de su parada, así se actualiza aunque la app esté cerrada y sin que nadie sepa qué parada mira cada quien. */
export const WIDGET_SHARDS = 64;
/** En qué cajón va una parada. La misma cuenta está escrita en Swift (`targets/widget/Widget.swift`, `widgetShard`): si cambia aquí, cambia allá. */
export function widgetShard(stopId: string): number {
  let h = 0;
  for (let i = 0; i < stopId.length; i++) h = (h * 31 + stopId.charCodeAt(i)) % 1_000_003;
  return h % WIDGET_SHARDS;
}

export interface WidgetArrival { /** ruta */ r: string; /** hacia dónde */ h: string; /** hora de llegada (s desde 1970) */ t: number; /** sistema (para el color) */ s: SystemType }

/** De una lista de llegadas ordenada, las que se le dan al widget: las `soon` más próximas y, después, una cada `gapSec` como mínimo.
 *  El teléfono deja refrescar un widget cada 15–60 min (iOS) o cada 30 min (Android). Con solo «las 8 más próximas», en una parada
 *  con movimiento todas pasaban en 5 minutos y el widget quedaba en «Sin buses acercándose» hasta abrir la app. Repartidas en el
 *  tiempo, siempre le queda algo que mostrar hasta el siguiente refresco. */
export function spreadArrivals<T extends { t: number }>(sorted: readonly T[], max = 16, soon = 4, gapSec = 150): T[] {
  const out: T[] = [];
  for (const a of sorted) {
    if (out.length >= max) break;
    if (out.length < soon || a.t - out[out.length - 1]!.t >= gapSec) out.push(a);
  }
  return out;
}

/** Los próximos buses que llegan a cada parada, a partir de dónde va cada bus y las paradas que le siguen.
 *  Solo buses con reporte reciente y llegadas dentro de la próxima hora, repartidas en el tiempo (`spreadArrivals`). */
export function arrivalsByStop(state: TransitState, nowMs: number, perStop = 16, ahead = 70, horizonSec = 3600): Map<string, WidgetArrival[]> {
  const now = nowMs / 1000, out = new Map<string, WidgetArrival[]>();
  for (const v of state.fleet.values()) {
    if (now - v.reportedAt > 180) continue;
    const seq = state.sequenceForDisplay(v), route = state.routeOf(v);
    if (!seq || !route) continue;
    const last = Math.min(seq.shape.stopIds.length - 1, seq.index + ahead);
    for (let j = seq.index + 1; j <= last; j++) {
      const eta = arrivalOrPassed(state, v, seq.shape, seq.index, j, nowMs);
      if (eta == null || !(eta > now - 20)) continue;       // si ya debió pasar por esa parada, no se anuncia
      if (eta - now > horizonSec) break;
      const id = seq.shape.stopIds[j]!, list = out.get(id) ?? out.set(id, []).get(id)!;
      list.push({ r: route.shortName, h: seq.shape.headsign, t: Math.round(eta), s: v.system });      // el sistema ya resuelto del bus (un alimentador puede venir mal clasificado en la ruta)
    }
  }
  for (const [id, list] of out) { list.sort((a, b) => a.t - b.t); out.set(id, spreadArrivals(list, perStop)); }
  return out;
}
