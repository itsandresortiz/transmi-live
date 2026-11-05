/** Raíz de composición: aquí (y solo aquí) se conectan los puertos con sus adaptadores. */
import { LiveDataService, TransitState } from "@transmi/application";
import { GtfsLiteNetworkSource, ProxyLiveFeed, WorkerLiveFeed } from "@transmi/infrastructure";
import { CONFIG } from "./config";
import { nowMs, updateClockOffset } from "./clock";
import { makeCachedFetch } from "./offline-cache";

export { CONFIG };

export const transit = new TransitState();

const cachedFetch = makeCachedFetch();
const feedFetch = makeCachedFetch({ onlyOffline: true });

/** Los datos en vivo se descargan y decodifican en un Web Worker (si el navegador lo permite) para no congelar el mapa. */
function makeFeed() {
  const cfg = { primaryBase: CONFIG.proxyUrl, fallbackBase: CONFIG.dataBase, fetchFn: feedFetch, onClock: updateClockOffset };
  try { if (typeof Worker !== "undefined") return new WorkerLiveFeed(new Worker(new URL("./feed.worker.ts", import.meta.url), { type: "module" }), updateClockOffset); }
  catch { /* sin soporte de workers: se hace en el hilo principal */ }
  return new ProxyLiveFeed(cfg);
}
const feed = makeFeed();
export const liveData = new LiveDataService(feed, transit, { now: nowMs });

export const networkSource = new GtfsLiteNetworkSource({
  url: `${CONFIG.dataBase}gtfs-lite.zip?t=${Math.floor(Date.now() / 3_600_000)}`,
  fetchFn: cachedFetch,
  createWorker: () => new Worker(new URL("../../../packages/infrastructure/src/gtfs/worker.ts", import.meta.url), { type: "module" }),
});

/** Carga el primer y último viaje de cada ruta para marcar el «último servicio». Si falla, la app sigue sin esa marca. */
export async function loadServiceEnds(): Promise<void> {
  try {
    if (typeof DecompressionStream === "undefined") return;
    const res = await cachedFetch(`${CONFIG.scheduleBase}service-ends.json.gz?t=${Math.floor(Date.now() / 3_600_000)}`);
    if (!res.ok || !res.body) return;
    const text = await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).text();
    transit.setServiceEnds(JSON.parse(text));
  } catch { /* sin conexión o archivo aún no publicado */ }
}
