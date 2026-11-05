/** Raíz de composición: aquí (y solo aquí) se conectan los puertos con sus adaptadores. */
import { LiveDataService, TransitState } from "@transmi/application";
import { GtfsLiteNetworkSource, ProxyLiveFeed } from "@transmi/infrastructure";
import { makeCachedFetch } from "./offline-cache";
import { safeStorage } from "./storage";

export const CONFIG = {
  /** Función de Supabase que lee TransMilenio con CORS (ver supabase/functions/tm). */
  proxyUrl: "https://kmefztxxhipjowgcfxds.supabase.co/functions/v1/rapid-responder",
  /** Copia de respaldo y GTFS reducido, publicados por GitHub Actions en la rama live-data. */
  dataBase: "https://raw.githubusercontent.com/itsandresortiz/transmi-live/live-data/",
} as const;

export const transit = new TransitState();

/* lo que la app aprendió de cuánto tarda cada ruta entre paradas se conserva entre visitas */
const TT_KEY = "tm.traveltimes.v1";
try { const raw = safeStorage.get(TT_KEY); if (raw) transit.travelTimes.load(JSON.parse(raw)); } catch { /* datos viejos o dañados: se empieza de cero */ }
let ttSaved = 0;
transit.subscribe(() => { const now = Date.now(); if (now - ttSaved > 60_000) { ttSaved = now; safeStorage.set(TT_KEY, JSON.stringify(transit.travelTimes.toJSON())); } });

const cachedFetch = makeCachedFetch();
const feedFetch = makeCachedFetch({ onlyOffline: true });

const feed = new ProxyLiveFeed({ primaryBase: CONFIG.proxyUrl, fallbackBase: CONFIG.dataBase, fetchFn: feedFetch });
export const liveData = new LiveDataService(feed, transit);

export const networkSource = new GtfsLiteNetworkSource({
  url: `${CONFIG.dataBase}gtfs-lite.zip?t=${Math.floor(Date.now() / 3_600_000)}`,
  fetchFn: cachedFetch,
  createWorker: () => new Worker(new URL("../../../packages/infrastructure/src/gtfs/worker.ts", import.meta.url), { type: "module" }),
});
