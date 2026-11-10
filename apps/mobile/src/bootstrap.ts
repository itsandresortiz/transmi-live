import { AppState } from "react-native";
import { gunzipSync } from "fflate";
import { CONFIG, liveData, networkSource, transit } from "./composition-root";
import { isDemo } from "./demo";
import { cachedBytes } from "./offline";

/** Hermes (el motor de JavaScript del teléfono) no trae DecompressionStream: los archivos .gz se abren con fflate. */
async function gz<T>(url: string, name: string): Promise<T | null> {
  try {
    // los horarios cambian poco: copia del teléfono si tiene menos de 6 h y, sin conexión, la que haya
    const hit = await cachedBytes(url, name, 6 * 3_600_000);
    return hit ? JSON.parse(new TextDecoder().decode(gunzipSync(hit.data))) as T : null;
  } catch { return null; }
}

let started = false;
const POLL_MS = 10_000;

/** Arranca la carga de rutas y horarios y el ciclo de datos en vivo. Se puede llamar varias veces: solo la primera hace algo. */
export function startData(): () => void {
  if (started) return () => undefined;
  started = true;
  const hour = Math.floor(Date.now() / 3_600_000);

  void networkSource.load().then((n) => transit.setNetwork(n)).catch(() => undefined);
  void gz<Parameters<typeof transit.setServiceEnds>[0]>(`${CONFIG.scheduleBase}service-ends.json.gz?t=${hour}`, "service-ends.json.gz").then((d) => d && transit.setServiceEnds(d));
  void gz<Parameters<typeof transit.setDepartures>[0]>(`${CONFIG.scheduleBase}departures.json.gz?t=${hour}`, "departures.json.gz").then((d) => d && transit.setDepartures(d));

  const poll = () => { if (AppState.currentState === "active" && !isDemo()) void liveData.refresh().catch(() => undefined); };      // en demostración no se piden datos reales (se mezclarían)
  poll();
  const timer = setInterval(poll, POLL_MS);
  const sub = AppState.addEventListener("change", (s) => { if (s === "active" && !isDemo()) void liveData.refresh(true).catch(() => undefined); });
  return () => { clearInterval(timer); sub.remove(); started = false; };
}
