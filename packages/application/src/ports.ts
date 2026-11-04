import type { ServiceAlert, TransitNetwork, TripUpdate, VehicleReport } from "@transmi/domain";

/** Lo que trae un sondeo de la fuente en tiempo real. Solo incluye lo que cambió. */
export interface LiveBatch {
  positions?: VehicleReport[];
  tripUpdates?: TripUpdate[];
  alerts?: ServiceAlert[];
}
/** `live` = intermediario al día; `delayed` = copia de respaldo, con retraso de minutos. */
export type FeedSource = "live" | "delayed";
/** Huellas de lo último que ya se descargó, para pedir solo lo nuevo. */
export interface FeedSignature { pos?: string; tu?: string; al?: string }
export interface LivePoll { batch: LiveBatch; signature: FeedSignature; source: FeedSource }

export interface LiveFeedPort {
  /** Devuelve lo nuevo, o `null` si no hay cambios. Lanza error si la fuente no responde o llega un lote corrupto. */
  poll(known: FeedSignature): Promise<LivePoll | null>;
}
export interface NetworkSourcePort {
  load(): Promise<TransitNetwork>;
}
export interface Clock { now(): number }
export const systemClock: Clock = { now: () => Date.now() };
