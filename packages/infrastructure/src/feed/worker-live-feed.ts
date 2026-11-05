import type { FeedSignature, LiveFeedPort, LivePoll } from "@transmi/application";
import { type LiveFeedConfig, ProxyLiveFeed } from "./proxy-live-feed";

/** Mensajes entre la página y el worker que descarga y decodifica los datos en vivo. */
export type FeedRequest = { id: number; known: FeedSignature };
export type FeedResponse = { id: number; poll: LivePoll | null } | { id: number; error: string } | { clock: number };

/** Lado del worker: atiende los sondeos usando un `ProxyLiveFeed` (descarga + decodificación, fuera del hilo principal). */
export function serveLiveFeed(scope: { onmessage: ((e: MessageEvent<FeedRequest>) => void) | null; postMessage(m: FeedResponse): void }, cfg: LiveFeedConfig): void {
  const feed = new ProxyLiveFeed({ ...cfg, onClock: (ms) => scope.postMessage({ clock: ms }) });
  scope.onmessage = async (e) => {
    const { id, known } = e.data;
    try { scope.postMessage({ id, poll: await feed.poll(known) }); }
    catch (err) { scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) }); }
  };
}

/** Lado de la página: la misma interfaz que `ProxyLiveFeed`, pero el trabajo pesado ocurre en un Web Worker,
 *  así que decodificar ~14.000 registros cada ~20 s no congela el movimiento de los buses. */
export class WorkerLiveFeed implements LiveFeedPort {
  private nextId = 1;
  private pending = new Map<number, { resolve(p: LivePoll | null): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> }>();

  constructor(private readonly worker: Worker, private readonly onClock?: (offsetMs: number) => void, private readonly timeoutMs = 30_000) {
    worker.onmessage = (e: MessageEvent<FeedResponse>) => {
      if ("clock" in e.data) { this.onClock?.(e.data.clock); return; }
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      clearTimeout(p.timer);
      "error" in e.data ? p.reject(new Error(e.data.error)) : p.resolve(e.data.poll);
    };
    worker.onerror = () => { for (const [id, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error("El proceso de datos falló")); this.pending.delete(id); } };
  }

  poll(known: FeedSignature): Promise<LivePoll | null> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("Sin respuesta de los datos en vivo")); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, known } satisfies FeedRequest);
    });
  }
}
