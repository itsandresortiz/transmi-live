import { type GeoPoint, type RoadPath, toWorld } from "@transmi/domain";
import { type SignalMark, type SignalModel, measuredSignals, opposite, signalNow, signalPlans } from "./signal-timing";

/**
 * La espera en los semáforos medidos, sumada a las llegadas de los buses que tienen que cruzarlos.
 *
 * Solo entra un semáforo cuando los propios buses CONFIRMAN la medida (lo calcula cada 10 min `tools/signalstats.ts` y lo publica en
 * `aprendizaje.json` de la rama `signal-stats`): que los buses detenidos junto a él caigan en su rojo bastante más que al azar, y que los
 * que arrancan lo hagan justo tras su verde. Mientras no lo confirmen no cambia nada (al 2026-11-24 ninguno lo confirma: los detenidos
 * caen en el rojo 31–34 % contra 42 % al azar). Así una medida mal orientada no empeora los tiempos de nadie.
 */
type Axis = "NS" | "EO";
interface Confirmed { lat: number; lon: number; plan: (t: number) => SignalModel | null; inverse: boolean; axis: Axis }

/** Lo que publica `signalstats.ts` de cada semáforo (solo lo que se usa aquí). */
interface LearningRow {
  axes?: { axis?: string; n?: number; inverse?: boolean | null }[];
  stopped?: { n?: number; red?: number; chance?: number };
  goes?: { n?: number; ok?: number; chance?: number };
}
/** ¿Los buses confirman la medida? Detenidos en el rojo ≥15 puntos sobre el azar (con ≥30) y arranques tras el verde también (con ≥10). */
export function busesConfirm(r: LearningRow | undefined): boolean {
  const s = r?.stopped, g = r?.goes;
  if (!s?.n || !g?.n || s.n < 30 || g.n < 10) return false;
  return (s.red ?? 0) / s.n >= (s.chance ?? 1) + 0.15 && (g.ok ?? 0) / g.n >= (g.chance ?? 1) + 0.15;
}

export class SignalWaits {
  private list: Confirmed[] = [];
  get size(): number { return this.list.length; }

  /** `measured`: el archivo de medidas (`tools/data/mediciones-semaforos.json`); `learning`: `aprendizaje.json`. */
  load(measured: unknown, learning: unknown): void {
    const rows = ((learning as { semaforos?: Record<string, LearningRow> } | null)?.semaforos) ?? {};
    const out: Confirmed[] = [];
    for (const m of measuredSignals(measured)) {
      const row = rows[`${m.lat.toFixed(6)},${m.lon.toFixed(6)}`];
      if (!busesConfirm(row)) continue;
      // el eje que los buses ven seguir el ciclo (el de más reportes con una conclusión)
      const ax = [...(row!.axes ?? [])].filter((a) => (a.axis === "NS" || a.axis === "EO") && a.inverse != null).sort((a, b) => (b.n ?? 0) - (a.n ?? 0))[0];
      if (!ax) continue;
      out.push({ lat: m.lat, lon: m.lon, plan: signalPlans(m.marks as SignalMark[]), inverse: m.inverse !== (ax.inverse === true), axis: ax.axis as Axis });
    }
    this.list = out;
  }

  /** Segundos de espera en los semáforos confirmados entre los metros `fromS` y `toS` del recorrido `path`, si el bus llega a cada uno
   *  en rojo. `arriveAt(s)` dice a qué hora (s desde 1970) pasa el bus por el metro `s`. */
  waitAlong(path: RoadPath, fromS: number, toS: number, arriveAt: (s: number) => number): number {
    if (!this.list.length || toS <= fromS) return 0;
    let wait = 0;
    for (const sig of this.list) {
      const hit = path.projectAfter(toWorld(sig as GeoPoint), Math.max(0, fromS - 40), 30);
      if (!hit || hit.s <= fromS || hit.s >= toS) continue;
      // el sentido del bus en ese punto: solo cuenta si va por el eje que sigue el ciclo
      const tg = path.tangentAt(hit.s), axis: Axis = Math.abs(tg.uy) >= Math.abs(tg.ux) ? "NS" : "EO";
      if (axis !== sig.axis) continue;
      const t = arriveAt(hit.s) + wait, model = sig.plan(t * 1000);
      if (!model) continue;
      const c = sig.inverse ? opposite(model, t * 1000) : signalNow(model, t * 1000).c;
      if (c !== "r") continue;
      wait += redLeft(model, t * 1000, sig.inverse) / 1000;
    }
    return wait;
  }
}

/** Cuánto le falta al rojo (ms) en `t`, para el semáforo tal cual o para el que alterna con él (en rojo mientras el medido no lo está). */
function redLeft(m: SignalModel, t: number, inverse: boolean): number {
  const n = m.segs.length;
  let into = ((t - m.anchor) % m.cycle + m.cycle) % m.cycle, i = 0;
  for (; i < n; i++) { if (into < m.segs[i]!.d) break; into -= m.segs[i]!.d; }
  i %= n;
  let acc = 0;
  for (let k = 0; k < n; k++) {
    const seg = m.segs[(i + k) % n]!, part = k === 0 ? seg.d - into : seg.d;
    // tal cual: se espera mientras dure el rojo y el amarillo que viene antes del verde; el que alterna: hasta que el medido pase a rojo
    const waiting = inverse ? seg.c !== "r" : seg.c === "r" || (k > 0 && seg.c === "y");
    if (!waiting) return acc;
    acc += part;
  }
  return acc;
}
