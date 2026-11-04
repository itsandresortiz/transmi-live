import type { NetworkSourcePort } from "@transmi/application";
import type { TransitNetwork } from "@transmi/domain";
import { buildNetwork, parseGtfsLite, type NetworkDto } from "./parse";

export interface NetworkSourceConfig {
  url: string;
  fetchFn?: typeof fetch;
  /** Crea el Web Worker del GTFS; si no se da (o falla) se procesa en el hilo principal. */
  createWorker?: () => Worker;
}

/** Descarga el GTFS reducido (publicado cada día) y lo convierte en la red de rutas. */
export class GtfsLiteNetworkSource implements NetworkSourcePort {
  constructor(private readonly cfg: NetworkSourceConfig) {}

  async load(): Promise<TransitNetwork> {
    const f = this.cfg.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    const res = await f(this.cfg.url);
    if (!res.ok) throw new Error(`GTFS: HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    return buildNetwork(await this.parse(buf));
  }

  private parse(buf: ArrayBuffer): Promise<NetworkDto> {
    const make = this.cfg.createWorker;
    if (!make || typeof Worker === "undefined") return parseGtfsLite(buf);
    return new Promise<NetworkDto>((resolve, reject) => {
      let w: Worker;
      try { w = make(); } catch { parseGtfsLite(buf).then(resolve, reject); return; }
      w.onmessage = (e: MessageEvent<{ ok: boolean; dto?: NetworkDto; error?: string }>) => {
        w.terminate();
        e.data.ok ? resolve(e.data.dto!) : reject(new Error(e.data.error));
      };
      w.onerror = () => { w.terminate(); parseGtfsLite(buf).then(resolve, reject); };
      w.postMessage(buf, [buf]);
    });
  }
}
