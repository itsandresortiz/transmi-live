/** Raíz de composición de la app móvil: aquí (y solo aquí) se conectan los puertos con sus adaptadores.
 *  Es el mismo dominio y la misma aplicación que la web; cambian los adaptadores (sin Web Workers ni caché del navegador). */
import { cachedBytes } from "./offline";
import { LiveDataService, TransitState } from "@transmi/application";
import { GtfsLiteNetworkSource, ProxyLiveFeed } from "@transmi/infrastructure";
import { CONFIG } from "./config";
import { nowMs, updateClockOffset } from "./clock";

export { CONFIG };

export const transit = new TransitState();

const feed = new ProxyLiveFeed({ primaryBase: CONFIG.proxyUrl, fallbackBase: CONFIG.dataBase, onClock: updateClockOffset, waitSeconds: 20 });
export const liveData = new LiveDataService(feed, transit, { now: nowMs });
/** Las rutas cambian una vez al día: se usa la copia del teléfono si tiene menos de 12 h (abre al instante y sin gastar ~17 MB de datos) y, sin conexión, la que haya. */
const cachedGtfs = (async (url: RequestInfo | URL) => {
  const hit = await cachedBytes(String(url), "gtfs-lite.zip", 12 * 3_600_000, 45_000);
  const data = hit?.data;
  return { ok: !!data, status: data ? 200 : 503, arrayBuffer: async () => (data ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : new ArrayBuffer(0)) } as unknown as Response;
}) as typeof fetch;
export const networkSource = new GtfsLiteNetworkSource({ url: `${CONFIG.dataBase}gtfs-lite.zip`, fetchFn: cachedGtfs });
