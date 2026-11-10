import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { type GuideState, type Itinerary, type PlanPlace, type StopRef, startGuide } from "@transmi/application";
import { transit } from "./composition-root";

/** El viaje de «Cómo llegar» que la persona está siguiendo paso a paso. Vive fuera de las pantallas (los avisos siguen aunque las cierres)
 *  y se guarda en el teléfono para recuperarlo si la app se cierra a mitad de camino. */
interface TripState {
  it: Itinerary | null;
  dest: string;
  guide: GuideState;
  /** Atraso (+) o adelanto (−) medido con el bus en vivo, en segundos. */
  shift: number;
  /** El bus real que se sigue en el tramo actual (si se pudo identificar). */
  busId: string | null;
  /** A dónde va la persona, para poder buscar otra opción desde donde esté. */
  place: PlanPlace | null;
  start(it: Itinerary, dest: PlanPlace | null): void;
  update(guide: GuideState, shift: number, busId: string | null): void;
  stop(): void;
}
const NONE = { it: null, dest: "", guide: { leg: 0, phase: "done" } as GuideState, shift: 0, busId: null, place: null };
/** Los trazados no hacen falta para guiar y pesan mucho: no se guardan. */
const light = (it: Itinerary): Itinerary => ({ ...it, legs: it.legs.map((l) => ({ ...l, line: [] })) });

export const useTrip = create<TripState>()(persist((set) => ({
  ...NONE,
  start: (it, place) => set({ it: light(it), dest: place?.name ?? "", place, guide: startGuide(it), shift: 0, busId: null }),
  update: (guide, shift, busId) => set({ guide, shift, busId }),
  stop: () => set(NONE),
}), {
  name: "tm.trip.v1", storage: createJSONStorage(() => AsyncStorage),
  partialize: (s) => ({ it: s.it, dest: s.dest, guide: s.guide, shift: s.shift, place: s.place }),
  // un viaje guardado que ya debió terminar hace rato no se retoma
  onRehydrateStorage: () => (s) => { if (s?.it && Date.now() / 1000 > s.it.arriveAt + s.shift + 1800) s.stop(); },
}));

/** «Calle 100, vagón 2» / «Portal Norte, plataforma T1» / el nombre solo. */
export function placeText(ref: StopRef): string {
  // el nombre que trae el plan ya puede venir con su vagón («Av. Chile · vagón 2»): se arma desde la parada para no repetirlo
  const stop = transit.stopById(ref.id);
  if (!stop) return ref.name;
  const l = transit.labelOf(stop);
  return l.wagon ? `${l.title}, vagón ${l.wagon}` : l.platform ? `${l.title}, plataforma ${l.platform}` : l.title;
}
