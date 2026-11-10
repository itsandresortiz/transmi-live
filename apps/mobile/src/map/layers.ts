import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

/** Qué capas extra se dibujan en el mapa. Se recuerdan en este teléfono. */
export type LayerKey = "signals" | "stations" | "traffic";
interface Layers { signals: boolean; stations: boolean; traffic: boolean; set(k: LayerKey, v: boolean): void }
export const useMapLayers = create<Layers>()(persist((set) => ({
  signals: true, stations: true, traffic: false,
  set: (k, v) => set({ [k]: v } as Pick<Layers, LayerKey>),
}), { name: "tm.layers.v1", storage: createJSONStorage(() => AsyncStorage), partialize: (s) => ({ signals: s.signals, stations: s.stations, traffic: s.traffic }) }));
