import { create } from "zustand";

/** Lo que el mapa debe destacar: una parada, la ruta que viene hacia ella y los buses que se acercan. Lo fijan las hojas de parada y de ruta. */
export interface MapFocus {
  stopId: string | null;
  routeId: string | null;
  busIds: string[];
  /** Si se da, el mapa acompaña a ese bus. */
  followBusId: string | null;
}
const EMPTY: MapFocus = { stopId: null, routeId: null, busIds: [], followBusId: null };

export const useMapFocus = create<MapFocus & { set(f: Partial<MapFocus>): void; clear(): void }>((set) => ({
  ...EMPTY,
  set: (f) => set({ ...EMPTY, ...f }),
  clear: () => set(EMPTY),
}));
