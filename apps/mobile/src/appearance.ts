import { Appearance } from "react-native";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

/** Apariencia de la app: la del teléfono (automático), siempre clara o siempre oscura. Se recuerda en este teléfono. */
export type AppearanceMode = "auto" | "light" | "dark";
const apply = (m: AppearanceMode) => { try { Appearance.setColorScheme(m === "auto" ? "unspecified" : m); } catch { /* sin soporte: queda la del sistema */ } };

export const useAppearance = create<{ mode: AppearanceMode; setMode(m: AppearanceMode): void }>()(persist((set) => ({
  mode: "auto",
  setMode: (mode) => { apply(mode); set({ mode }); },
}), { name: "tm.appearance.v1", storage: createJSONStorage(() => AsyncStorage), partialize: (s) => ({ mode: s.mode }), onRehydrateStorage: () => (s) => { if (s && s.mode !== "auto") apply(s.mode); } }));
