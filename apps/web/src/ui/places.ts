import { create } from "zustand";
import type { PlanPlace } from "@transmi/application";
import { safeStorage } from "../storage";

export type Slot = "home" | "work";
export const SLOT_LABEL: Record<Slot, string> = { home: "Casa", work: "Trabajo" };
const KEY = "tm.places.v1";
const ok = (p: unknown): p is PlanPlace => !!p && typeof (p as PlanPlace).name === "string" && Number.isFinite((p as PlanPlace).position?.lat) && Number.isFinite((p as PlanPlace).position?.lon);
const load = (): Record<Slot, PlanPlace | null> => {
  try { const j = JSON.parse(safeStorage.get(KEY) ?? "{}") as Partial<Record<Slot, unknown>>; return { home: ok(j.home) ? j.home : null, work: ok(j.work) ? j.work : null }; }
  catch { return { home: null, work: null }; }
};

interface Places extends Record<Slot, PlanPlace | null> { save(slot: Slot, p: PlanPlace | null): void }
/** Casa y trabajo: viven solo en este dispositivo. */
export const usePlaces = create<Places>((set, get) => ({
  ...load(),
  save: (slot, p) => { set({ [slot]: p } as Pick<Places, Slot>); safeStorage.set(KEY, JSON.stringify({ home: get().home, work: get().work })); },
}));
