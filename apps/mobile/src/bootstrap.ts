import { AppState } from "react-native";
import { gunzipSync } from "fflate";
import { CONFIG, liveData, networkSource, transit } from "./composition-root";
import { isDemo } from "./demo";
import { cachedBytes } from "./offline";
import { refreshMessages } from "./messages";

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

  // rutas y horarios: si no cargan (primera apertura sin señal y sin copia guardada), se reintenta con espera creciente y al volver a la app,
  // hasta que lleguen; antes se intentaba una sola vez y la app quedaba en «Cargando rutas…» hasta cerrarla
  let haveNet = false, haveEnds = false, haveDeps = false, loading = false, wait = 15_000, retry: ReturnType<typeof setTimeout> | undefined;
  const loadStatic = async () => {
    if (loading || (haveNet && haveEnds && haveDeps)) return;
    loading = true; clearTimeout(retry);
    await Promise.all([
      haveNet ? null : networkSource.load().then((n) => { transit.setNetwork(n); haveNet = true; }).catch(() => undefined),
      haveEnds ? null : gz<Parameters<typeof transit.setServiceEnds>[0]>(`${CONFIG.scheduleBase}service-ends.json.gz?t=${hour}`, "service-ends.json.gz").then((d) => { if (d) { transit.setServiceEnds(d); haveEnds = true; } }),
      haveDeps ? null : gz<Parameters<typeof transit.setDepartures>[0]>(`${CONFIG.scheduleBase}departures.json.gz?t=${hour}`, "departures.json.gz").then((d) => { if (d) { transit.setDepartures(d); haveDeps = true; } }),
    ]);
    loading = false;
    if (!(haveNet && haveEnds && haveDeps) && started) { retry = setTimeout(() => void loadStatic(), wait); wait = Math.min(wait * 2, 5 * 60_000); }
  };
  void loadStatic();

  const poll = () => { if (AppState.currentState === "active" && !isDemo()) void liveData.refresh().catch(() => undefined); };      // en demostración no se piden datos reales (se mezclarían)
  poll();
  const timer = setInterval(poll, POLL_MS);
  void refreshMessages();
  const msgTimer = setInterval(() => { if (AppState.currentState === "active") void refreshMessages(); }, 120_000);
  const sub = AppState.addEventListener("change", (s) => { if (s !== "active") return; void loadStatic(); void refreshMessages(); if (!isDemo()) void liveData.refresh(true).catch(() => undefined); });
  return () => { clearInterval(timer); clearInterval(msgTimer); clearTimeout(retry); sub.remove(); started = false; };
}
