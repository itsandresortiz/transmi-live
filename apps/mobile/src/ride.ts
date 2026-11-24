import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

/** El viaje en curso: en qué bus voy, en qué parada me bajo y cuántas paradas faltaban cuando la marqué (para la barra de avance).
 *  Vive fuera de las pantallas para que los avisos sigan aunque cierres la ventana. Se guarda en el teléfono (como «Cómo llegar»): si
 *  iOS cierra la app en segundo plano y la vuelves a abrir, el viaje y su «Bájate aquí» siguen (antes se perdían en silencio). */
interface RideState {
  busId: string | null; alightId: string | null; total: number;
  /** Cuándo se marcó (ms): un viaje guardado de hace horas ya no se recupera. */
  since: number;
  /** Ya se leyó lo guardado: antes de eso, «sin viaje» no significa que se haya terminado (no se cancelan sus avisos). */
  hydrated: boolean;
  set(busId: string, alightId: string | null, total?: number): void; clear(): void;
}
/** Un viaje en bus no dura más que esto: lo guardado más viejo se descarta al abrir la app. */
const MAX_RIDE_MS = 3 * 3600_000;
export const useRide = create<RideState>()(persist((set) => ({
  busId: null, alightId: null, total: 0, since: 0, hydrated: false,
  // al pasar el mismo viaje del GPS a su bus real o al revés (el bus dejó o volvió a reportar), no se reinicia la hora en que empezó
  set: (busId, alightId, total = 0) => set((s) => ({ busId, alightId, total, since: s.busId && s.since && s.busId.startsWith("gps:") !== busId.startsWith("gps:") ? s.since : Date.now() })),
  clear: () => set({ busId: null, alightId: null, total: 0, since: 0 }),
}), {
  name: "tm.ride.v1", storage: createJSONStorage(() => AsyncStorage),
  partialize: (s) => ({ busId: s.busId, alightId: s.alightId, total: s.total, since: s.since }),
  onRehydrateStorage: () => (s) => {
    if (s?.busId && Date.now() - s.since > MAX_RIDE_MS) s.clear();
    useRide.setState({ hydrated: true });
  },
}));
