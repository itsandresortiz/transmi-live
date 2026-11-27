/** Raíz de composición: aquí (y solo aquí) se conectan los puertos con sus adaptadores. */
import { LiveDataService, type NetworkSourcePort, TransitState } from "@transmi/application";
import { type CompactNetworkDto, GtfsLiteNetworkSource, type NetworkDto, ProxyLiveFeed, WorkerLiveFeed, buildNetwork, expandNetwork } from "@transmi/infrastructure";
import { CONFIG } from "./config";
import { nowMs, updateClockOffset } from "./clock";
import { makeCachedFetch } from "./offline-cache";

export { CONFIG };

export const transit = new TransitState();

const cachedFetch = makeCachedFetch();
const feedFetch = makeCachedFetch({ onlyOffline: true });

/** Los datos en vivo se descargan y decodifican en un Web Worker (si el navegador lo permite) para no congelar el mapa. */
function makeFeed() {
  const cfg = { primaryBase: CONFIG.proxyUrl, fallbackBase: CONFIG.dataBase, fetchFn: feedFetch, onClock: updateClockOffset, waitSeconds: 20 };
  try { if (typeof Worker !== "undefined") return new WorkerLiveFeed(new Worker(new URL("./feed.worker.ts", import.meta.url), { type: "module" }), updateClockOffset); }
  catch { /* sin soporte de workers: se hace en el hilo principal */ }
  return new ProxyLiveFeed(cfg);
}
const feed = makeFeed();
export const liveData = new LiveDataService(feed, transit, { now: nowMs });

const zipSource = new GtfsLiteNetworkSource({
  url: `${CONFIG.dataBase}gtfs-lite.zip?t=${Math.floor(Date.now() / 3_600_000)}`,
  fetchFn: cachedFetch,
  createWorker: () => new Worker(new URL("../../../packages/infrastructure/src/gtfs/worker.ts", import.meta.url), { type: "module" }),
});

/** Lee un archivo .json.gz publicado (o su copia sin conexión). */
async function gzJson<T>(url: string): Promise<T | null> {
  if (typeof DecompressionStream === "undefined") return null;
  const res = await cachedFetch(`${url}?t=${Math.floor(Date.now() / 3_600_000)}`);
  if (!res.ok || !res.body) return null;
  return JSON.parse(await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).text()) as T;
}
/** La red de rutas: primero la ya procesada en formato compacto (`network2.json.gz`, ~1 MB, la misma que usa la app), luego la de
 *  siempre (`network.json.gz`, ~2 MB) y, si ninguna está, el GTFS reducido (`gtfs-lite.zip`, 17 MB que hay que procesar). Antes la web
 *  descargaba siempre los 17 MB: en un celular con datos tardaba y gastaba mucho más. */
export const networkSource: NetworkSourcePort = {
  async load() {
    try {
      const d2 = await gzJson<CompactNetworkDto>(`${CONFIG.dataBase}network2.json.gz`);
      if (d2?.v === 2 && d2.shapes?.length && d2.stops?.length) return buildNetwork(expandNetwork(d2));
    } catch { /* se intenta con el formato de siempre */ }
    try {
      const d1 = await gzJson<NetworkDto & { v?: number }>(`${CONFIG.dataBase}network.json.gz`);
      if (d1?.v === 1 && d1.shapes?.length && d1.stops?.length) return buildNetwork(d1);
    } catch { /* se intenta con el GTFS reducido */ }
    return zipSource.load();
  },
};

/** Carga las horas de salida programadas (para mostrar horarios por parada). Si falla o aún no existe, la app sigue sin eso. */
export async function loadDepartures(): Promise<void> {
  try {
    if (typeof DecompressionStream === "undefined") return;
    const res = await cachedFetch(`${CONFIG.scheduleBase}departures.json.gz?t=${Math.floor(Date.now() / 3_600_000)}`);
    if (!res.ok || !res.body) return;
    const text = await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).text();
    transit.setDepartures(JSON.parse(text));
  } catch { /* sin conexión o archivo aún no publicado */ }
}

/** Carga los tiempos reales por tramo y hora (para calcular mejor las llegadas). Si falla, se usa el valor fijo por parada. */
export async function loadHopProfile(): Promise<void> {
  try {
    if (typeof DecompressionStream === "undefined") return;
    const res = await cachedFetch(`${CONFIG.hopBase}profile.json.gz?t=${Math.floor(Date.now() / 3_600_000)}`);
    if (!res.ok || !res.body) return;
    const text = await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).text();
    transit.hopProfile.load(JSON.parse(text));
  } catch { /* sin conexión o archivo aún no publicado */ }
}

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

/** Semáforos medidos y lo que dicen los buses de ellos: su espera se suma a las llegadas solo si los buses la confirman (ver signal-eta.ts). */
export async function loadSignalWaits(): Promise<void> {
  try {
    const t = Math.floor(Date.now() / 3_600_000);
    const [m, l] = await Promise.all([CONFIG.signalsUrl, CONFIG.signalLearningUrl].map((u) => fetch(`${u}?t=${t}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)));
    if (m && l) transit.signalWaits.load(m, l);
    const fp = await fetch(`${CONFIG.footprintsUrl}?t=${t}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (fp) transit.signalWaits.loadFootprints(fp);
  } catch { /* sin conexión: no se suma nada */ }
}
