import { AppState } from "react-native";
import { gunzipSync } from "fflate";
import { CONFIG, liveData, networkSource, transit } from "./composition-root";
import { isDemo } from "./demo";
import { cachedBytes } from "./offline";
import { refreshMessages } from "./messages";
import { startSharedRides } from "./shareRide";

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
  const hourNow = () => Math.floor(Date.now() / 3_600_000);

  // rutas y horarios: si no cargan (primera apertura sin señal y sin copia guardada), se reintenta con espera creciente y al volver a la app,
  // hasta que lleguen; antes se intentaba una sola vez y la app quedaba en «Cargando rutas…» hasta cerrarla
  let haveNet = false, haveEnds = false, haveDeps = false, loading = false, wait = 15_000, retry: ReturnType<typeof setTimeout> | undefined, loadedAt = 0;
  const loadStatic = async () => {
    if (loading || (haveNet && haveEnds && haveDeps)) return;
    loading = true; clearTimeout(retry);
    await Promise.all([
      haveNet ? null : networkSource.load().then((n) => { transit.setNetwork(n); haveNet = true; }).catch(() => undefined),
      haveEnds ? null : gz<Parameters<typeof transit.setServiceEnds>[0]>(`${CONFIG.scheduleBase}service-ends.json.gz?t=${hourNow()}`, "service-ends.json.gz").then((d) => { if (d) { transit.setServiceEnds(d); haveEnds = true; } }),
      haveDeps ? null : gz<Parameters<typeof transit.setDepartures>[0]>(`${CONFIG.scheduleBase}departures.json.gz?t=${hourNow()}`, "departures.json.gz").then((d) => { if (d) { transit.setDepartures(d); haveDeps = true; } }),
    ]);
    loading = false;
    if (haveNet && haveEnds && haveDeps) loadedAt = Date.now();
    if (!(haveNet && haveEnds && haveDeps) && started) { retry = setTimeout(() => void loadStatic(), wait); wait = Math.min(wait * 2, 5 * 60_000); }
  };
  void loadStatic();
  // tiempos reales por tramo (~0,5 MB): opcionales y sin apuro; se leen unos segundos después para no frenar la apertura
  const loadHops = () => {
    void gz<unknown>(`${CONFIG.hopBase}profile.json.gz?t=${hourNow()}`, "hop-profile.json.gz").then((d) => { if (d) transit.hopProfile.load(d); });
    // semáforos medidos y lo que dicen los buses de ellos: la espera solo se suma si los buses la confirman (ver signal-eta.ts)
    const j = (u: string) => fetch(`${u}?t=${hourNow()}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    void Promise.all([j(`${CONFIG.signalsUrl}`), j(`${CONFIG.signalLearningUrl}`)]).then(([m, l]) => { if (m && l) transit.signalWaits.load(m, l); });
    void j(CONFIG.footprintsUrl).then((d) => { if (d) transit.signalWaits.loadFootprints(d); });
  };
  const hops = setTimeout(loadHops, 4000);
  // iOS puede tener la app suspendida días: al volver a ella tras más de 12 h se cargan de nuevo la red del día (con sus cierres temporales),
  // los horarios y los tiempos aprendidos (antes solo se leían al abrirla de cero y, p. ej., un cierre ya vencido seguía en «Cómo llegar»)
  const refreshIfOld = () => { if (loadedAt && Date.now() - loadedAt > 12 * 3_600_000) { haveNet = haveEnds = haveDeps = false; loadedAt = 0; void loadStatic(); loadHops(); } };

  const poll = () => { if (AppState.currentState === "active" && !isDemo()) void liveData.refresh().catch(() => undefined); };      // en demostración no se piden datos reales (se mezclarían)
  poll();
  const timer = setInterval(poll, POLL_MS);
  void refreshMessages();
  const msgTimer = setInterval(() => { if (AppState.currentState === "active") void refreshMessages(); }, 120_000);
  const sub = AppState.addEventListener("change", (s) => { if (s !== "active") return; refreshIfOld(); void loadStatic(); void refreshMessages(); if (!isDemo()) void liveData.refresh(true).catch(() => undefined); });
  // posiciones que comparte la gente que va en un bus (apagado mientras el servidor no esté configurado)
  const stopShared = startSharedRides();
  return () => { clearTimeout(hops); clearInterval(timer); clearInterval(msgTimer); clearTimeout(retry); sub.remove(); stopShared(); started = false; };
}
