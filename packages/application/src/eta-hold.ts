/**
 * Tiempos de llegada que no «retroceden».
 *
 * Cada lote nuevo de TransMilenio recalcula la hora de llegada de cada bus. Si el bus quedó un poco más atrás de lo esperado (se detuvo en
 * un semáforo, su GPS saltó), la cuenta regresiva SUBÍA de golpe (de 1:10 a 1:50) y se veía como si el bus se hubiera devuelto. Igual que
 * en el mapa (el bus adelantado espera a que el real lo alcance), aquí la cuenta se detiene: se queda en el mismo número hasta que la nueva
 * hora la alcanza, y luego sigue bajando. Si la nueva hora es más de `HOLD_S` más tarde, es un atraso de verdad y se muestra tal cual.
 * Cuando la nueva hora es más temprano, se muestra enseguida (llega antes: eso no confunde).
 */
export const ETA_HOLD_S = 90;
/** Más de esto sin volver a preguntar por ese bus y esa parada: se olvida lo mostrado. */
const FORGET_S = 120;

export class EtaHold {
  private shown = new Map<string, { at: number; t: number }>();

  /** La hora a mostrar (s desde 1970) para el bus `busId` en la parada `stopId`, dada la nueva estimación `at`. */
  smooth(busId: string, stopId: string, at: number, nowSec: number): number {
    const key = `${busId}|${stopId}`, prev = this.shown.get(key);
    let out = at;
    if (prev && nowSec >= prev.t && nowSec - prev.t <= FORGET_S) {
      const later = at - prev.at;
      // la cuenta se queda quieta (lo que faltaba sigue faltando) mientras la nueva hora no la alcance
      if (later > 0 && later <= ETA_HOLD_S) out = Math.min(at, prev.at + (nowSec - prev.t));
    }
    if (this.shown.size > 30_000) this.prune(nowSec);
    this.shown.set(key, { at: out, t: nowSec });
    return out;
  }

  private prune(nowSec: number): void { for (const [k, v] of this.shown) if (nowSec - v.t > FORGET_S) this.shown.delete(k); }
}

/** Clave aparte para «Voy en este bus»: ahí la hora sale de tu GPS (`rideArrival`), no del reporte del bus; si compartiera la clave con
 *  las listas de las paradas, una cuenta frenaría a la otra con un cálculo distinto. */
export const rideHoldKey = (busId: string): string => `ride:${busId}`;
