import { create } from "zustand";

/** «Avísame cuando venga»: el bus que esperas en una parada y cuántos minutos antes de que llegue quieres el aviso.
 *  Vive fuera de las pantallas: el aviso se sigue corrigiendo con la app abierta aunque cierres la ficha de la parada. */
export interface BusWatch { stopId: string; routeId: string; busId: string; minutes: number; since: number }
interface State { w: BusWatch | null; set(w: BusWatch): void; clear(): void }
export const useBusWatch = create<State>((set) => ({ w: null, set: (w) => set({ w }), clear: () => set({ w: null }) }));
