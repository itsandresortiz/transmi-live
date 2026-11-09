/** Raíz de composición de la app móvil: aquí (y solo aquí) se conectan los puertos con sus adaptadores.
 *  Es el mismo dominio y la misma aplicación que la web; cambian los adaptadores (sin Web Workers ni caché del navegador). */
import { LiveDataService, TransitState } from "@transmi/application";
import { GtfsLiteNetworkSource, ProxyLiveFeed } from "@transmi/infrastructure";
import { CONFIG } from "./config";
import { nowMs, updateClockOffset } from "./clock";

export { CONFIG };

export const transit = new TransitState();

const feed = new ProxyLiveFeed({ primaryBase: CONFIG.proxyUrl, fallbackBase: CONFIG.dataBase, onClock: updateClockOffset, waitSeconds: 20 });
export const liveData = new LiveDataService(feed, transit, { now: nowMs });
export const networkSource = new GtfsLiteNetworkSource({ url: `${CONFIG.dataBase}gtfs-lite.zip` });
