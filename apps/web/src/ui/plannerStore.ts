import { create } from "zustand";
import { type Itinerary, type PlanPlace, type PlanSort, planTrip, sortItineraries } from "@transmi/application";
import { transit } from "../composition-root";
import { safeStorage } from "../storage";
import { nowMs } from "../clock";
import { useLocation } from "./location";

export type Field = "origin" | "dest";
export type SortBy = PlanSort;
/** Las opciones en el orden que pidió la persona. */
export function sortedResults(results: Itinerary[] | null, by: SortBy): Itinerary[] {
  return results ? sortItineraries(results, by) : [];
}
const KEY = "tm.recents.v1";
const loadRecents = (): PlanPlace[] => {
  try {
    const a = JSON.parse(safeStorage.get(KEY) ?? "[]") as PlanPlace[];
    return Array.isArray(a) ? a.filter((p) => p && typeof p.name === "string" && Number.isFinite(p.position?.lat) && Number.isFinite(p.position?.lon)).slice(0, 6) : [];
  } catch { return []; }
};

/** Cuándo viaja la persona: ahora, saliendo a cierta hora o llegando a cierta hora (`at` en ms). */
export type When = { mode: "now" } | { mode: "depart" | "arrive"; at: number };

/** Hora de hoy (o de mañana, si ya pasó) en Bogotá a partir de «HH:MM». */
export function timeToMs(hhmm: string, now = Date.now()): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm); if (!m) return null;
  const bogota = new Date(now - 5 * 3600_000);                    // Bogotá es UTC-5, sin horario de verano
  const base = Date.UTC(bogota.getUTCFullYear(), bogota.getUTCMonth(), bogota.getUTCDate(), Number(m[1]), Number(m[2])) + 5 * 3600_000;
  return base < now - 60_000 ? base + 86_400_000 : base;
}

interface PlannerState {
  when: When;
  setWhen(w: When): void;
  /** Origen elegido; `null` + `originMe` = «Mi ubicación». */
  origin: PlanPlace | null; originMe: boolean; dest: PlanPlace | null;
  editing: Field | null; text: Record<Field, string>;
  results: Itinerary[] | null; sel: number; busy: boolean; computedAt: number; error: string | null;
  /** Se está esperando un toque en el mapa para este campo. */
  picking: Field | null;
  sortBy: SortBy;
  recents: PlanPlace[];
  setSort(s: SortBy): void;
  setPlace(f: Field, p: PlanPlace | "me"): void;
  setEditing(f: Field | null): void;
  setText(f: Field, t: string): void;
  setPicking(f: Field | null): void;
  swap(): void;
  select(i: number): void;
  reset(): void;
  plan(): void;
}

const samePlace = (a: PlanPlace, b: PlanPlace) => Math.abs(a.position.lat - b.position.lat) < 1e-5 && Math.abs(a.position.lon - b.position.lon) < 1e-5;

export const usePlanner = create<PlannerState>((set, get) => ({
  origin: null, originMe: true, dest: null, editing: null, text: { origin: "", dest: "" },
  results: null, sel: 0, busy: false, computedAt: 0, error: null, picking: null, sortBy: "mejor", recents: loadRecents(), when: { mode: "now" },
  setWhen: (when) => { set({ when, results: null, sel: 0 }); get().plan(); },
  setSort: (sortBy) => set({ sortBy, sel: 0 }),

  setPlace: (f, p) => {
    if (p === "me") { if (f === "origin") set({ originMe: true, origin: null }); }
    else if (f === "origin") set({ origin: p, originMe: false });
    else {
      const recents = [p, ...get().recents.filter((r) => !samePlace(r, p))].slice(0, 6);
      safeStorage.set(KEY, JSON.stringify(recents));
      set({ dest: p, recents });
    }
    set((s) => ({ editing: null, text: { ...s.text, [f]: "" }, picking: null, results: null, sel: 0, error: null }));
    get().plan();
  },
  setEditing: (editing) => set({ editing }),
  setText: (f, t) => set((s) => ({ text: { ...s.text, [f]: t } })),
  setPicking: (picking) => set({ picking, editing: null }),
  swap: () => {
    const s = get(), me = useLocation.getState().me;
    const from: PlanPlace | null = s.originMe ? (me ? { name: "Mi ubicación", position: me } : null) : s.origin;
    const to = s.dest;
    set({ origin: to, originMe: false, dest: from, results: null, sel: 0, error: null });
    get().plan();
  },
  select: (sel) => set({ sel }),
  reset: () => set({ when: { mode: "now" }, origin: null, originMe: true, dest: null, editing: null, results: null, sel: 0, picking: null, error: null, text: { origin: "", dest: "" } }),

  plan: () => {
    const s = get(), me = useLocation.getState().me;
    const origin: PlanPlace | null = s.originMe ? (me ? { name: "Mi ubicación", position: me } : null) : s.origin;
    if (!origin || !s.dest) { set({ results: null, busy: false }); return; }
    set({ busy: true, error: null });
    // un instante después, para que se vea «Buscando…» antes de que el cálculo ocupe el hilo principal
    setTimeout(() => {
      try {
        const results = planFor(origin, s.dest!, s.when);
        set((c) => ({ results, busy: false, computedAt: Date.now(), sel: Math.min(c.sel, Math.max(0, results.length - 1)) }));
      } catch (e) { set({ busy: false, results: [], error: e instanceof Error ? e.message : "No pudimos calcular el viaje" }); }
    }, 30);
  },
}));

/** Calcula las opciones según cuándo viaja la persona. «Llegar a las…» busca la hora de salida que lo logra. */
function planFor(origin: PlanPlace, dest: PlanPlace, when: When): Itinerary[] {
  const now = nowMs();
  if (when.mode === "now" || (when.mode === "depart" && when.at - now < 120_000)) return planTrip(transit, origin, dest, { nowMs: now });
  if (when.mode === "depart") return planTrip(transit, origin, dest, { nowMs: when.at, scheduled: true });
  // llegar a las…: se parte de una salida estimada y se corrige según a qué hora llega realmente la mejor opción
  let depart = Math.max(now, when.at - 45 * 60_000), res: Itinerary[] = [];
  for (let i = 0; i < 3; i++) {
    const scheduled = depart - now > 120_000;
    res = planTrip(transit, origin, dest, { nowMs: depart, scheduled });
    if (!res.length) break;
    const best = Math.min(...res.map((r) => r.arriveAt * 1000));
    const next = Math.max(now, depart + (when.at - best));
    if (Math.abs(next - depart) < 90_000) break;
    depart = next;
  }
  const onTime = res.filter((r) => r.arriveAt * 1000 <= when.at + 60_000);
  return onTime.length ? onTime : res;
}
