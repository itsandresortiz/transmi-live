import { create } from "zustand";
import { type Itinerary, type PlanPlace, planTrip } from "@transmi/application";
import { transit } from "../composition-root";
import { safeStorage } from "../storage";
import { nowMs } from "../clock";
import { useLocation } from "./location";

export type Field = "origin" | "dest";
const KEY = "tm.recents.v1";
const loadRecents = (): PlanPlace[] => {
  try {
    const a = JSON.parse(safeStorage.get(KEY) ?? "[]") as PlanPlace[];
    return Array.isArray(a) ? a.filter((p) => p && typeof p.name === "string" && Number.isFinite(p.position?.lat) && Number.isFinite(p.position?.lon)).slice(0, 6) : [];
  } catch { return []; }
};

interface PlannerState {
  /** Origen elegido; `null` + `originMe` = «Mi ubicación». */
  origin: PlanPlace | null; originMe: boolean; dest: PlanPlace | null;
  editing: Field | null; text: Record<Field, string>;
  results: Itinerary[] | null; sel: number; busy: boolean; computedAt: number; error: string | null;
  /** Se está esperando un toque en el mapa para este campo. */
  picking: Field | null;
  recents: PlanPlace[];
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
  results: null, sel: 0, busy: false, computedAt: 0, error: null, picking: null, recents: loadRecents(),

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
  reset: () => set({ origin: null, originMe: true, dest: null, editing: null, results: null, sel: 0, picking: null, error: null, text: { origin: "", dest: "" } }),

  plan: () => {
    const s = get(), me = useLocation.getState().me;
    const origin: PlanPlace | null = s.originMe ? (me ? { name: "Mi ubicación", position: me } : null) : s.origin;
    if (!origin || !s.dest) { set({ results: null, busy: false }); return; }
    set({ busy: true, error: null });
    // un instante después, para que se vea «Buscando…» antes de que el cálculo ocupe el hilo principal
    setTimeout(() => {
      try {
        const results = planTrip(transit, origin, s.dest!, { nowMs: nowMs() });
        set((c) => ({ results, busy: false, computedAt: Date.now(), sel: Math.min(c.sel, Math.max(0, results.length - 1)) }));
      } catch (e) { set({ busy: false, results: [], error: e instanceof Error ? e.message : "No pudimos calcular el viaje" }); }
    }, 30);
  },
}));
