import type { Clock, FeedSignature, LiveFeedPort } from "./ports";
import { systemClock } from "./ports";
import type { TransitState } from "./transit-state";

/** `idle`: la fuente responde pero no está publicando buses (típico de madrugada, cuando termina el servicio). */
export type Connection = "connecting" | "live" | "waiting" | "stale" | "idle";
export interface ConnectionStatus { connection: Connection; ageSeconds: number | null }

/** Qué tan fresco es el último lote, para mostrárselo al usuario. */
export function connectionStatus(state: TransitState, nowMs: number): ConnectionStatus {
  const answering = state.lastPollOkAt != null && nowMs - state.lastPollOkAt < 90_000;     // el servidor contestó hace poco
  if (state.lastBatchAt == null) return { connection: state.lastPollOkAt != null && answering ? "idle" : "connecting", ageSeconds: null };
  const age = Math.max(0, nowMs / 1000 - state.lastBatchAt);
  return { connection: age <= 45 ? "live" : age <= 180 ? "waiting" : answering ? "idle" : "stale", ageSeconds: age };
}

/** Caso de uso: pedir a la fuente lo nuevo y aplicarlo al estado. */
export class LiveDataService {
  private signature: FeedSignature = {};
  private lastChangeMs = 0;
  private busy = false;
  failures = 0;
  /** Tras recibir un lote, la fuente nunca publicó otro antes de ~9 s: no vale la pena preguntar antes. */
  static readonly QUIET_MS = 9000;

  constructor(private readonly feed: LiveFeedPort, private readonly state: TransitState, private readonly clock: Clock = systemClock) {}

  /** Devuelve `true` si llegaron datos nuevos. Los errores se cuentan en `failures` y se relanzan. */
  async refresh(force = false): Promise<boolean> {
    if (this.busy) return false;
    if (!force && this.lastChangeMs && this.clock.now() - this.lastChangeMs < LiveDataService.QUIET_MS) return false;
    this.busy = true;
    try {
      const poll = await this.feed.poll(this.signature);
      this.failures = 0;
      this.state.lastPollOkAt = this.clock.now();
      if (!poll) return false;
      const { batch, signature, source } = poll;
      const now = this.clock.now();
      if (batch.positions && this.state.fleet.size > 500 && batch.positions.length < 0.6 * this.state.fleet.size)
        throw new Error(`Lote incompleto (${batch.positions.length} buses)`);
      // retrasos y avisos primero, para que los buses nuevos ya tengan su retraso al aparecer
      if (batch.tripUpdates) this.state.applyTripUpdates(batch.tripUpdates);
      if (batch.alerts) this.state.applyAlerts(batch.alerts, now);
      if (batch.positions) {
        // un lote que trae mucho menos que el anterior llegó cortado: se descarta y se reintenta
        if (this.state.fleet.size > 500 && batch.positions.length < 0.6 * this.state.fleet.size)
          throw new Error(`Lote incompleto (${batch.positions.length} buses)`);
        this.state.applyPositions(batch.positions, now);
        this.lastChangeMs = now;
      }
      this.state.source = source;
      this.signature = { ...this.signature, ...signature };
      return true;
    } catch (e) {
      this.failures++;
      throw e;
    } finally {
      this.busy = false;
    }
  }
}
