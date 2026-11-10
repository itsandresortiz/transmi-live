import { create } from "zustand";
import { type Itinerary, type PlanPlace, type PlanSort, planTrip, sortItineraries, ALL_MODES, type TravelMode, type TravelModes, systemsFor, toggleMode } from "@transmi/application";
import type { SystemType } from "@transmi/domain";
import { transit } from "@/composition-root";
import { nowMs } from "@/clock";
import { locateMe } from "@/location";

/** Cuándo viaja la persona: ahora, saliendo a cierta hora o llegando a cierta hora (`at` en ms). */
export type When = { mode: "now" } | { mode: "depart" | "arrive"; at: number };

/** Cómo se puede planear «salir ahora»: `live` con buses reportando, `schedule` si no reportan pero el horario dice que hay servicio, `none` si no hay servicio. */
export function nowMode(): "live" | "schedule" | "none" {
  if (transit.fleet.size >= 50) return "live";
  const now = nowMs();
  let running = 0;
  for (const id of transit.network.routes.keys()) if (transit.serviceEnds.routeStatus(id, now, 0)?.state === "running" && ++running >= 200) return "schedule";
  return "none";
}

/** Calcula las opciones según cuándo viaja la persona. «Llegar a las…» busca la hora de salida que lo logra. */
export function planFor(origin: PlanPlace, dest: PlanPlace, when: When, systems?: SystemType[]): Itinerary[] {
  const now = nowMs();
  const isNow = when.mode === "now" || (when.mode === "depart" && when.at - now < 120_000);
  if (isNow) { const m = nowMode(); return m === "none" ? [] : planTrip(transit, origin, dest, { systems, nowMs: now, scheduled: m === "schedule" }); }
  if (when.mode === "depart") return planTrip(transit, origin, dest, { systems, nowMs: when.at, scheduled: true });
  let depart = Math.max(now, when.at - 45 * 60_000), res: Itinerary[] = [];
  for (let i = 0; i < 3; i++) {
    res = planTrip(transit, origin, dest, { systems, nowMs: depart, scheduled: depart - now > 120_000 });
    if (!res.length) break;
    const best = Math.min(...res.map((r) => r.arriveAt * 1000));
    const next = Math.max(now, depart + (when.at - best));
    if (Math.abs(next - depart) < 90_000) break;
    depart = next;
  }
  const onTime = res.filter((r) => r.arriveAt * 1000 <= when.at + 60_000);
  return onTime.length ? onTime : res;
}

interface PlannerState {
  origin: PlanPlace | null;          // null = «Mi ubicación»
  dest: PlanPlace | null;
  when: When;
  sortBy: PlanSort;
  results: Itinerary[] | null;
  sel: number;
  busy: boolean;
  /** Si es «home» o «work», el próximo lugar que se elija como destino se guarda como casa o trabajo. */
  saveAs: "home" | "work" | null;
  setSaveAs(s: "home" | "work" | null): void;
  setDest(p: PlanPlace | null): void;
  setOrigin(p: PlanPlace | null): void;
  setWhen(w: When): void;
  /** Con qué quiere viajar la persona (TransMilenio, SITP zonal, alimentador). */
  modes: TravelModes;
  toggleMode(k: TravelMode): void;
  setSort(s: PlanSort): void;
  select(i: number): void;
  swap(): Promise<void>;
  plan(): Promise<void>;
}

export const usePlanner = create<PlannerState>((set, get) => ({
  origin: null, dest: null, when: { mode: "now" }, sortBy: "mejor", results: null, sel: 0, busy: false, saveAs: null,
  setSaveAs: (saveAs) => set({ saveAs }),
  setDest: (dest) => { set({ dest, results: null, sel: 0 }); void get().plan(); },
  setOrigin: (origin) => { set({ origin, results: null, sel: 0 }); void get().plan(); },
  modes: ALL_MODES,
  toggleMode: (k) => { set((c) => ({ modes: toggleMode(c.modes, k), results: null, sel: 0 })); void get().plan(); },
  setWhen: (when) => { set({ when, results: null, sel: 0 }); void get().plan(); },
  setSort: (sortBy) => set({ sortBy, sel: 0 }),
  select: (sel) => set({ sel }),
  swap: async () => {
    const s = get(), me = await locateMe();
    const from: PlanPlace | null = s.origin ?? (me ? { name: "Mi ubicación", position: me } : null);
    set({ origin: s.dest, dest: from, results: null, sel: 0 });
    void get().plan();
  },
  plan: async () => {
    const s = get();
    if (!s.dest) { set({ results: null, busy: false }); return; }
    set({ busy: true });
    const me = s.origin ? null : await locateMe();
    const origin: PlanPlace | null = s.origin ?? (me ? { name: "Mi ubicación", position: me } : null);
    if (!origin) { set({ busy: false, results: [] }); return; }
    // un instante después, para que se vea «Buscando…» antes de que el cálculo ocupe el hilo principal
    setTimeout(() => {
      try { const results = planFor(origin, s.dest!, s.when, systemsFor(s.modes)); set((c) => ({ results, busy: false, sel: Math.min(c.sel, Math.max(0, results.length - 1)) })); }
      catch { set({ results: [], busy: false }); }
    }, 30);
  },
}));

export const sorted = (r: Itinerary[] | null, by: PlanSort): Itinerary[] => (r ? sortItineraries(r, by) : []);
