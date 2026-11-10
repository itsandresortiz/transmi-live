import { create } from "zustand";

/** El viaje en curso: en qué bus voy y en qué parada me bajo. Vive fuera de las pantallas para que los avisos sigan aunque cierres la hoja. */
interface RideState { busId: string | null; alightId: string | null; set(busId: string, alightId: string | null): void; clear(): void }
export const useRide = create<RideState>((set) => ({
  busId: null, alightId: null,
  set: (busId, alightId) => set({ busId, alightId }),
  clear: () => set({ busId: null, alightId: null }),
}));
