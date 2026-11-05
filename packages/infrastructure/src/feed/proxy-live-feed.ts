import type { FeedSignature, LiveBatch, LiveFeedPort, LivePoll } from "@transmi/application";
import { decodeAlerts, decodePositions, decodeTripUpdates } from "../gtfsrt/decoders";

export interface LiveFeedConfig {
  /** Intermediario (Supabase): responde con CORS y sin caché larga. Rutas: `/meta`, `/positions`, … */
  primaryBase: string;
  /** Respaldo (copia en GitHub, con minutos de retraso). Archivos: `meta.json`, `positions.pb`, … */
  fallbackBase?: string;
  fetchFn?: typeof fetch;
  /** Se llama con cuántos ms adelanta (o atrasa) el reloj del servidor respecto al del dispositivo. */
  onClock?: (offsetMs: number) => void;
}

interface Meta { pos?: string; tu?: string; al?: string; /** hora del servidor (segundos desde 1970) */ at?: number }

/** Lee los tres archivos de TransMilenio preguntando primero por una huella mínima (`meta`):
 *  solo se descarga lo que cambió. Si el intermediario falla usa la copia de respaldo. */
export class ProxyLiveFeed implements LiveFeedPort {
  private readonly f: typeof fetch;
  constructor(private readonly cfg: LiveFeedConfig) {
    this.f = cfg.fetchFn ?? ((...a) => fetch(...a));
  }

  private async json(url: string): Promise<Meta | null> {
    try {
      const t0 = Date.now();
      const r = await this.f(url, { cache: "no-store" });
      if (!r.ok) return null;
      const m = (await r.json()) as Meta;
      const t1 = Date.now();
      // el reloj de cada aparato puede estar adelantado o atrasado: se mide contra la hora del servidor (±1 s) para que todos muestren lo mismo
      if (typeof m.at === "number" && m.at > 1e9) this.cfg.onClock?.(m.at * 1000 + 500 - (t0 + t1) / 2);
      return m && m.pos ? m : null;
    } catch { return null; }
  }
  private async bytes(url: string): Promise<Uint8Array> {
    const r = await this.f(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`${url.split("/").pop()?.split("?")[0]}: HTTP ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }

  async poll(known: FeedSignature): Promise<LivePoll | null> {
    const primary = this.cfg.primaryBase.replace(/\/$/, "");
    let meta = await this.json(`${primary}/meta`);
    let source: LivePoll["source"] = "live";
    let url = (k: "positions" | "tripupdates" | "alerts", sig: string) => `${primary}/${k}?v=${sig}`;
    if (!meta && this.cfg.fallbackBase) {
      const fb = this.cfg.fallbackBase;
      meta = await this.json(`${fb}meta.json?t=${Math.floor(Date.now() / 3000)}`);
      source = "delayed";
      url = (k, sig) => `${fb}${k}.pb?v=${sig}`;
    }
    if (!meta) throw new Error("Sin conexión con los datos");

    const batch: LiveBatch = {};
    const signature: FeedSignature = {};
    if (meta.pos && meta.pos !== known.pos) {
      batch.positions = decodePositions(await this.bytes(url("positions", meta.pos)));
      signature.pos = meta.pos;
    }
    if (meta.tu && meta.tu !== known.tu) {
      try { batch.tripUpdates = decodeTripUpdates(await this.bytes(url("tripupdates", meta.tu))); signature.tu = meta.tu; } catch { /* opcional */ }
    }
    if (meta.al && meta.al !== known.al) {
      try { batch.alerts = decodeAlerts(await this.bytes(url("alerts", meta.al))); signature.al = meta.al; } catch { /* opcional */ }
    }
    return batch.positions || batch.tripUpdates || batch.alerts ? { batch, signature, source } : null;
  }
}
