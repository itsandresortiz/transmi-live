import { create } from "zustand";
import { safeStorage } from "../storage";

interface Favs {
  stops: string[];
  routes: string[];
  toggleStop(id: string): void;
  toggleRoute(id: string): void;
}
const KEY = "tm.favorites.v1";
const load = (): { stops: string[]; routes: string[] } => {
  try {
    const j = JSON.parse(safeStorage.get(KEY) ?? "{}") as { stops?: unknown; routes?: unknown };
    const ok = (a: unknown): string[] => (Array.isArray(a) ? a.filter((x): x is string => typeof x === "string").slice(0, 100) : []);
    return { stops: ok(j.stops), routes: ok(j.routes) };
  } catch { return { stops: [], routes: [] }; }
};
const flip = (a: string[], id: string) => (a.includes(id) ? a.filter((x) => x !== id) : [id, ...a]);

/** Paradas y rutas favoritas: viven solo en este dispositivo, sin cuenta. */
export const useFavs = create<Favs>((set, get) => ({
  ...load(),
  toggleStop: (id) => { set({ stops: flip(get().stops, id) }); safeStorage.set(KEY, JSON.stringify({ stops: get().stops, routes: get().routes })); },
  toggleRoute: (id) => { set({ routes: flip(get().routes, id) }); safeStorage.set(KEY, JSON.stringify({ stops: get().stops, routes: get().routes })); },
}));
