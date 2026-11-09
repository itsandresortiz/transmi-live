import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { PlanPlace } from "@transmi/application";

interface Saved {
  stops: string[]; routes: string[];
  /** Apodos que la persona les pone a sus paradas guardadas («La del colegio»). */
  nicknames: Record<string, string>;
  setNickname(id: string, name: string): void;
  home: PlanPlace | null; work: PlanPlace | null;
  toggleStop(id: string): void; toggleRoute(id: string): void;
  setPlace(slot: "home" | "work", p: PlanPlace | null): void;
}
const flip = (a: string[], id: string) => (a.includes(id) ? a.filter((x) => x !== id) : [id, ...a]);

/** Paradas, rutas, casa y trabajo guardados: viven solo en este teléfono, sin cuenta. */
export const useSaved = create<Saved>()(persist((set) => ({
  stops: [], routes: [], nicknames: {}, home: null, work: null,
  setNickname: (id, name) => set((s) => { const n = { ...s.nicknames }; if (name.trim()) n[id] = name.trim().slice(0, 40); else delete n[id]; return { nicknames: n }; }),
  toggleStop: (id) => set((s) => ({ stops: flip(s.stops, id) })),
  toggleRoute: (id) => set((s) => ({ routes: flip(s.routes, id) })),
  setPlace: (slot, p) => set({ [slot]: p } as Pick<Saved, "home" | "work">),
}), { name: "tm.saved.v1", storage: createJSONStorage(() => AsyncStorage) }));
