/** Raíz de composición: aquí (y solo aquí) se conectan los puertos con sus adaptadores. */
import { LiveDataService, TransitState } from "@transmi/application";
import { GtfsLiteNetworkSource, ProxyLiveFeed, WorkerLiveFeed } from "@transmi/infrastructure";
import { CONFIG } from "./config";
import { makeCachedFetch } from "./offline-cache";
import { safeStorage } from "./storage";

export { CONFIG };

export const transit = new TransitState();

/* lo que la app aprendió de cuánto tarda cada ruta entre paradas se conserva entre visitas */
const TT_KEY = "tm.traveltimes.v1";
try { const raw = safeStorage.get(TT_KEY); if (raw) transit.travelTimes.load(JSON.parse(raw)); } catch { /* datos viejos o dañados: se empieza de cero */ }
let ttSaved = 0;
transit.subscribe(() => { const now = Date.now(); if (now - ttSaved > 60_000) { ttSaved = now; safeStorage.set(TT_KEY, JSON.stringify(transit.travelTimes.toJSON())); } });

const cachedFetch = makeCachedFetch();
const feedFetch = makeCachedFetch({ onlyOffline: true });

/** Los datos en vivo se descargan y decodifican en un Web Worker (si el navegador lo permite) para no congelar el mapa. */
function makeFeed() {
  const cfg = { primaryBase: CONFIG.proxyUrl, fallbackBase: CONFIG.dataBase, fetchFn: feedFetch };
  try { if (typeof Worker !== "undefined") return new WorkerLiveFeed(new Worker(new URL("./feed.worker.ts", import.meta.url), { type: "module" })); }
  catch { /* sin soporte de workers: se hace en el hilo principal */ }
  return new ProxyLiveFeed(cfg);
}
const feed = makeFeed();
export const liveData = new LiveDataService(feed, transit);

export const networkSource = new GtfsLiteNetworkSource({
  url: `${CONFIG.dataBase}gtfs-lite.zip?t=${Math.floor(Date.now() / 3_600_000)}`,
  fetchFn: cachedFetch,
  createWorker: () => new Worker(new URL("../../../packages/infrastructure/src/gtfs/worker.ts", import.meta.url), { type: "module" }),
});
