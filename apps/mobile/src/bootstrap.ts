import { AppState } from "react-native";
import { gunzipSync } from "fflate";
import { CONFIG, liveData, networkSource, transit } from "./composition-root";

/** Hermes (el motor de JavaScript del teléfono) no trae DecompressionStream: los archivos .gz se abren con fflate. */
async function gz<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return JSON.parse(new TextDecoder().decode(gunzipSync(new Uint8Array(await res.arrayBuffer())))) as T;
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
  void gz<Parameters<typeof transit.setServiceEnds>[0]>(`${CONFIG.scheduleBase}service-ends.json.gz?t=${hour}`).then((d) => d && transit.setServiceEnds(d));
  void gz<Parameters<typeof transit.setDepartures>[0]>(`${CONFIG.scheduleBase}departures.json.gz?t=${hour}`).then((d) => d && transit.setDepartures(d));

  const poll = () => { if (AppState.currentState === "active") void liveData.refresh().catch(() => undefined); };
  poll();
  const timer = setInterval(poll, POLL_MS);
  const sub = AppState.addEventListener("change", (s) => { if (s === "active") void liveData.refresh(true).catch(() => undefined); });
  return () => { clearInterval(timer); sub.remove(); started = false; };
}
