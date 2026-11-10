import { create } from "zustand";

/** El viaje en curso: en qué bus voy, en qué parada me bajo y cuántas paradas faltaban cuando la marqué (para la barra de avance).
 *  Vive fuera de las pantallas para que los avisos sigan aunque cierres la ventana. */
interface RideState { busId: string | null; alightId: string | null; total: number; set(busId: string, alightId: string | null, total?: number): void; clear(): void }
export const useRide = create<RideState>((set) => ({
  busId: null, alightId: null, total: 0,
  set: (busId, alightId, total = 0) => set({ busId, alightId, total }),
  clear: () => set({ busId: null, alightId: null, total: 0 }),
}));
