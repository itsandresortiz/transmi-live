/** Raíz de composición: aquí (y solo aquí) se conectan los puertos con sus adaptadores. */
import { LiveDataService, TransitState } from "@transmi/application";
import { GtfsLiteNetworkSource, ProxyLiveFeed } from "@transmi/infrastructure";

export const CONFIG = {
  /** Función de Supabase que lee TransMilenio con CORS (ver supabase/functions/tm). */
  proxyUrl: "https://kmefztxxhipjowgcfxds.supabase.co/functions/v1/rapid-responder",
  /** Copia de respaldo y GTFS reducido, publicados por GitHub Actions en la rama live-data. */
  dataBase: "https://raw.githubusercontent.com/itsandresortiz/transmi-live/live-data/",
} as const;

export const transit = new TransitState();

const feed = new ProxyLiveFeed({ primaryBase: CONFIG.proxyUrl, fallbackBase: CONFIG.dataBase });
export const liveData = new LiveDataService(feed, transit);

export const networkSource = new GtfsLiteNetworkSource({
  url: `${CONFIG.dataBase}gtfs-lite.zip?t=${Math.floor(Date.now() / 3_600_000)}`,
  createWorker: () => new Worker(new URL("../../../packages/infrastructure/src/gtfs/worker.ts", import.meta.url), { type: "module" }),
});
