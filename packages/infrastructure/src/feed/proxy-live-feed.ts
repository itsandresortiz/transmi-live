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
  /** Segundos que el intermediario puede retener la petición esperando datos nuevos (0 = no usar `/live`). */
  waitSeconds?: number;
}

/** Decodifica la respuesta de `/live`: 4 bytes de largo + JSON de cabecera + cuerpos concatenados. */
export function parseLiveFrames(buf: Uint8Array): { at: number; parts: { k: "pos" | "tu" | "al"; sig: string; body: Uint8Array }[] } | null {
  if (buf.length < 4) return null;
  const n = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(0);
  if (n <= 0 || 4 + n > buf.length) return null;
  try {
    const head = JSON.parse(new TextDecoder().decode(buf.subarray(4, 4 + n))) as { at?: number; parts?: { k: string; sig: string; len: number }[] };
    if (!head || !Array.isArray(head.parts) || typeof head.at !== "number") return null;
    let o = 4 + n;
    const parts: { k: "pos" | "tu" | "al"; sig: string; body: Uint8Array }[] = [];
    for (const p of head.parts) {
      if ((p.k !== "pos" && p.k !== "tu" && p.k !== "al") || o + p.len > buf.length) return null;
      parts.push({ k: p.k, sig: p.sig, body: buf.subarray(o, o + p.len) });
      o += p.len;
    }
    return { at: head.at, parts };
  } catch { return null; }
}

/** Edad máxima (segundos) de la copia de respaldo para usarla. Normalmente tiene menos de un minuto; si el proceso que la publica se detiene, puede tener horas. */
export const MAX_FALLBACK_AGE_S = 600;

interface Meta { pos?: string; tu?: string; al?: string; /** hora del servidor (segundos desde 1970) */ at?: number }

/** Lee los tres archivos de TransMilenio preguntando primero por una huella mínima (`meta`):
 *  solo se descarga lo que cambió. Si el intermediario falla usa la copia de respaldo. */
export class ProxyLiveFeed implements LiveFeedPort {
  private readonly f: typeof fetch;
  constructor(private readonly cfg: LiveFeedConfig) {
    this.f = cfg.fetchFn ?? ((...a) => fetch(...a));
  }

  /** `clock` = la hora que trae la respuesta es la del servidor en este instante (el intermediario). La copia de respaldo trae la hora en que
   *  se publicó, que puede ser de hace minutos u horas: usarla como reloj atrasaba la hora de la app y dañaba todos los tiempos de llegada. */
  private async json(url: string, clock = true): Promise<Meta | null> {
    try {
      const t0 = Date.now();
      const r = await this.f(url, { cache: "no-store" });
      if (!r.ok) return null;
      const m = (await r.json()) as Meta;
      const t1 = Date.now();
      // el reloj de cada aparato puede estar adelantado o atrasado: se mide contra la hora del servidor (±1 s) para que todos muestren lo mismo
      if (clock && typeof m.at === "number" && m.at > 1e9) this.cfg.onClock?.(m.at * 1000 + 500 - (t0 + t1) / 2);
      return m && m.pos ? m : null;
    } catch { return null; }
  }
  private async bytes(url: string): Promise<Uint8Array> {
    const r = await this.f(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`${url.split("/").pop()?.split("?")[0]}: HTTP ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }

  /** `undefined` = aún no se sabe; `false` = el intermediario desplegado no tiene `/live` (se usa el modo antiguo). */
  private bundle: boolean | undefined;

  /** Una sola petición que espera los cambios y los trae todos juntos. `undefined` si no está disponible. */
  private async pollBundle(primary: string, known: FeedSignature): Promise<LivePoll | null | undefined> {
    const wait = this.cfg.waitSeconds ?? 0;
    if (wait <= 0 || this.bundle === false) return undefined;
    try {
      const q = new URLSearchParams({ pos: known.pos ?? "", tu: known.tu ?? "", al: known.al ?? "", wait: String(wait) });
      const r = await this.f(`${primary}/live?${q}`, { cache: "no-store" });
      if (!r.ok) { if (r.status === 404) this.bundle = false; return undefined; }
      const frames = parseLiveFrames(new Uint8Array(await r.arrayBuffer()));
      if (!frames) { this.bundle = false; return undefined; } // una función antigua responde JSON con "endpoints"
      this.bundle = true;
      // la hora del servidor se toma al final de la espera (±1 s)
      if (frames.at > 1e9) this.cfg.onClock?.(frames.at * 1000 + 500 - Date.now());
      const batch: LiveBatch = {};
      const signature: FeedSignature = {};
      for (const p of frames.parts) {
        try {
          if (p.k === "pos") { batch.positions = decodePositions(p.body); signature.pos = p.sig; }
          else if (p.k === "tu") { batch.tripUpdates = decodeTripUpdates(p.body); signature.tu = p.sig; }
          else { batch.alerts = decodeAlerts(p.body); signature.al = p.sig; }
        } catch (e) { if (p.k === "pos") throw e; }
      }
      return batch.positions || batch.tripUpdates || batch.alerts ? { batch, signature, source: "live" } : null;
    } catch (e) {
      if (this.bundle === true) throw e; // ya funcionaba: es un fallo real de red
      return undefined;
    }
  }

  async poll(known: FeedSignature): Promise<LivePoll | null> {
    const primary = this.cfg.primaryBase.replace(/\/$/, "");
    const bundled = await this.pollBundle(primary, known);
    if (bundled !== undefined) return bundled;
    let meta = await this.json(`${primary}/meta`);
    let source: LivePoll["source"] = "live";
    let url = (k: "positions" | "tripupdates" | "alerts", sig: string) => `${primary}/${k}?v=${sig}`;
    if (!meta && this.cfg.fallbackBase) {
      const fb = this.cfg.fallbackBase;
      meta = await this.json(`${fb}meta.json?t=${Math.floor(Date.now() / 3000)}`, false);
      // una copia de respaldo vieja no sirve: mostraría los buses donde estaban hace rato. Es mejor quedarse sin datos (y decirlo) que dar un dato viejo.
      if (meta && typeof meta.at === "number" && meta.at > 1e9 && Date.now() / 1000 - meta.at > MAX_FALLBACK_AGE_S) {
        // hubo respuesta (hay internet), solo que no sirve: se marca para que no se confunda con «teléfono sin conexión»
        throw Object.assign(new Error("Copia de respaldo vieja"), { reachable: true });
      }
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
