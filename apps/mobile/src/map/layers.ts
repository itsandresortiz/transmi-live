import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

/** Qué capas extra se dibujan en el mapa. Se recuerdan en este teléfono. */
export type LayerKey = "signals" | "stations" | "traffic";
interface Layers {
  signals: boolean; stations: boolean; traffic: boolean; set(k: LayerKey, v: boolean): void;
  /** Vista 3D: mapa inclinado y edificios con volumen (y sombra del relieve). */
  view3d: boolean; set3d(v: boolean): void;
}
export const useMapLayers = create<Layers>()(persist((set) => ({
  signals: true, stations: true, traffic: false, view3d: false,
  set: (k, v) => set({ [k]: v } as Pick<Layers, LayerKey>),
  set3d: (view3d) => set({ view3d }),
}), { name: "tm.layers.v1", storage: createJSONStorage(() => AsyncStorage), partialize: (s) => ({ signals: s.signals, stations: s.stations, traffic: s.traffic, view3d: s.view3d }) }));
