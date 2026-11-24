import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { OfflineManager, type OfflinePack } from "@maplibre/maplibre-react-native";

/** Mapa de Bogotá guardado en el teléfono: sin señal, el mapa base (calles, nombres, parques) se sigue viendo, no solo las zonas que el
 *  teléfono ya había visto. Se baja una sola vez (≈15–25 MB, calles hasta el nivel de barrio) un rato después de abrir la app y se
 *  renueva cada 30 días. Las calles más de cerca (zoom >14) se dibujan agrandando ese nivel. Los buses y rutas no van aquí (las rutas
 *  ya tienen su propia copia). Se puede apagar en Más → «Mapa sin conexión», y entonces se borra. */
const PACK = "bogota-v1";
/** Bogotá y sus bordes (Soacha, Chía, Funza, Mosquera): oeste, sur, este, norte. */
const BOUNDS: [number, number, number, number] = [-74.24, 4.46, -73.99, 4.84];
/** El mismo mapa base que usa la app: las calles salen de las mismas direcciones, así que el mapa claro y el oscuro usan esta copia. */
const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
const MAX_AGE_MS = 30 * 24 * 3600_000;

interface OfflineMapState {
  enabled: boolean;
  /** Avance de la descarga (0–100) mientras baja, o `null`. */
  progress: number | null;
  /** Megas guardados (cuando terminó). */
  mb: number | null;
  savedAt: number;
  setEnabled(v: boolean): void;
}
export const useOfflineMap = create<OfflineMapState>()(persist((set) => ({
  enabled: true, progress: null, mb: null, savedAt: 0,
  setEnabled: (v) => { set({ enabled: v }); if (v) void ensureOfflineMap(); else void removeOfflineMap(); },
}), {
  name: "tm.offlinemap.v1", storage: createJSONStorage(() => AsyncStorage),
  partialize: (s) => ({ enabled: s.enabled, mb: s.mb, savedAt: s.savedAt }),
}));

async function findPack(): Promise<OfflinePack | undefined> {
  const packs = await OfflineManager.getPacks();
  return packs.find((p) => p.metadata?.name === PACK);
}

let running = false;
/** Deja el mapa de Bogotá guardado (si está encendido): lo baja si falta, sigue una descarga a medias y lo renueva si es viejo. */
export async function ensureOfflineMap(): Promise<void> {
  if (running || !useOfflineMap.getState().enabled) return;
  running = true;
  try {
    let pack = await findPack();
    const savedAt = typeof pack?.metadata?.savedAt === "number" ? pack.metadata.savedAt : 0;
    if (pack && Date.now() - savedAt > MAX_AGE_MS) { await OfflineManager.deletePack(pack.id); pack = undefined; }
    const onProgress = (_: OfflinePack, st: { state: string; percentage: number; completedResourceSize: number }) => {
      if (st.state === "complete") { useOfflineMap.setState({ progress: null, mb: Math.round(st.completedResourceSize / 1e6), savedAt: Date.now() }); running = false; }
      else useOfflineMap.setState({ progress: Math.floor(st.percentage) });
    };
    const onError = () => { useOfflineMap.setState({ progress: null }); running = false; };      // sin señal: se intenta otra vez la próxima vez que se abra
    if (!pack) {
      await OfflineManager.createPack({ mapStyle: STYLE_URL, bounds: BOUNDS, minZoom: 9, maxZoom: 14, metadata: { name: PACK, savedAt: Date.now() } }, onProgress, onError);
      return;
    }
    const st = await pack.status();
    if (st.state === "complete") { useOfflineMap.setState({ progress: null, mb: Math.round(st.completedResourceSize / 1e6) }); running = false; return; }
    await OfflineManager.addListener(pack.id, onProgress, onError);
    await pack.resume();
  } catch { running = false; useOfflineMap.setState({ progress: null }); }
}

export async function removeOfflineMap(): Promise<void> {
  try { const pack = await findPack(); if (pack) await OfflineManager.deletePack(pack.id); } catch { /* nada que borrar */ }
  useOfflineMap.setState({ progress: null, mb: null, savedAt: 0 });
  running = false;
}
