import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

/** Preferencias de avisos que la persona elige en «Más». Viven solo en este teléfono. */
interface Settings { lastBus: boolean; setLastBus(v: boolean): void }
export const useSettings = create<Settings>()(persist((set) => ({
  lastBus: false,
  setLastBus: (lastBus) => set({ lastBus }),
}), { name: "tm.settings.v1", storage: createJSONStorage(() => AsyncStorage), partialize: (s) => ({ lastBus: s.lastBus }) }));
