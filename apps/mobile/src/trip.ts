import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { type GuideState, type Itinerary, type StopRef, startGuide } from "@transmi/application";
import { transit } from "./composition-root";
import { stopTag } from "./stopname";

/** El viaje de «Cómo llegar» que la persona está siguiendo paso a paso. Vive fuera de las pantallas (los avisos siguen aunque las cierres)
 *  y se guarda en el teléfono para recuperarlo si la app se cierra a mitad de camino. */
interface TripState {
  it: Itinerary | null;
  dest: string;
  guide: GuideState;
  /** Atraso (+) o adelanto (−) medido con el bus en vivo, en segundos. */
  shift: number;
  start(it: Itinerary, dest: string): void;
  update(guide: GuideState, shift: number): void;
  stop(): void;
}
const NONE = { it: null, dest: "", guide: { leg: 0, phase: "done" } as GuideState, shift: 0 };
/** Los trazados no hacen falta para guiar y pesan mucho: no se guardan. */
const light = (it: Itinerary): Itinerary => ({ ...it, legs: it.legs.map((l) => ({ ...l, line: [] })) });

export const useTrip = create<TripState>()(persist((set) => ({
  ...NONE,
  start: (it, dest) => set({ it: light(it), dest, guide: startGuide(it), shift: 0 }),
  update: (guide, shift) => set({ guide, shift }),
  stop: () => set(NONE),
}), {
  name: "tm.trip.v1", storage: createJSONStorage(() => AsyncStorage),
  partialize: (s) => ({ it: s.it, dest: s.dest, guide: s.guide, shift: s.shift }),
  // un viaje guardado que ya debió terminar hace rato no se retoma
  onRehydrateStorage: () => (s) => { if (s?.it && Date.now() / 1000 > s.it.arriveAt + s.shift + 1800) s.stop(); },
}));

/** «Calle 100, vagón 2» / «Portal Norte, plataforma T1» / el nombre solo. */
export function placeText(ref: StopRef): string {
  const tag = stopTag(transit.stopById(ref.id));
  return tag ? `${ref.name}, ${tag.charAt(0).toLowerCase()}${tag.slice(1)}` : ref.name;
}
