import { create } from "zustand";

/** Modo de pruebas del dueño (8 toques en «Buses en la calle», en Más): muestra lo que aún no es para los usuarios, como el detalle de cada semáforo al tocarlo.
 *  Vive solo mientras la app está abierta. */
export const useTestsMode = create<{ on: boolean; set(v: boolean): void }>((set) => ({ on: false, set: (on) => set({ on }) }));
