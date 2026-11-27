import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import Constants from "expo-constants";
import type { SFSymbol } from "@/ui/Symbol";
import type { SceneKind } from "@/ui/Illustrations";

/** Hojas de consejo: explican una función la primera vez que se usa (ilustración, título, texto y «Entendido»). Cada una sale una sola vez
 *  por teléfono; lo que ya se vio se guarda aquí (sin cuenta, solo en el teléfono). */
export type TipId = "ride" | "coming" | "plan" | "share";

export interface Tip { title: string; text: string; points: { symbol: SFSymbol; text: string }[]; badge: SFSymbol; scene: SceneKind; moving: boolean }

export const TIPS: Record<TipId, Tip> = {
  ride: {
    title: "Vas en este bus",
    text: "Te mostramos por dónde vas y cuánto falta para cada parada.",
    badge: "mappin.circle.fill", scene: "city", moving: true,
    points: [
      { symbol: "mappin.circle.fill", text: "Toca la parada donde te bajas. Cuando estés cerca, te avisamos para que alcances a timbrar." },
      { symbol: "location.fill", text: "Si el bus deja de enviar su ubicación, te seguimos con la tuya mientras la app esté abierta." },
      { symbol: "lock.fill", text: "Puedes bloquear el teléfono: el aviso de bajada llega a la hora calculada." },
    ],
  },
  // «Compartir por dónde va mi bus» viene encendido: se cuenta una vez, la primera vez que se usa «Voy en este bus» con el servidor ya
  // disponible (también a quien ya había visto la hoja de «Vas en este bus»)
  share: {
    title: "Tu bus ayuda a los demás",
    text: "Mientras vas en el bus, la app comparte por dónde va ese bus para que todos lo vean donde va de verdad.",
    badge: "bus.fill", scene: "city", moving: true,
    points: [
      { symbol: "bus.fill", text: "Se comparte solo por dónde va el bus en su recorrido, cada 20 segundos, mientras usas «Voy en este bus»." },
      { symbol: "lock.fill", text: "No se envía nada tuyo: ni tu nombre, ni tu teléfono, ni tu ubicación. Se borra a las 24 horas." },
      { symbol: "hand.raised.fill", text: "Si prefieres no compartir, apágalo en Más → «Compartir por dónde va mi bus»." },
    ],
  },
  coming: {
    title: "Te avisamos cuando venga",
    text: "Así no tienes que estar mirando la pantalla en la parada.",
    badge: "bell.fill", scene: "station", moving: false,
    points: [
      { symbol: "bell.fill", text: "Te llega un aviso cuando el bus esté a los minutos que elegiste de tu parada." },
      { symbol: "arrow.triangle.2.circlepath", text: "La hora se corrige con cada dato nuevo del bus. Con la app cerrada es aproximada." },
      { symbol: "xmark.circle.fill", text: "Si ya no lo necesitas, toca «Cancelar el aviso» en la misma parada." },
    ],
  },
  plan: {
    title: "Cómo llegar",
    text: "Escribe a dónde vas y te damos las mejores opciones en TransMilenio y SITP.",
    badge: "arrow.triangle.turn.up.right.diamond.fill", scene: "city", moving: true,
    points: [
      { symbol: "magnifyingglass", text: "Busca una estación, una parada, una dirección o un lugar conocido." },
      { symbol: "bus.fill", text: "Cada opción dice qué buses tomar, dónde hacer trasbordo y cuánto caminas." },
      { symbol: "bell.fill", text: "Toca «Seguir este viaje» y te avisamos cuándo salir, subir y bajarte." },
    ],
  },
};

interface Seen { seen: TipId[]; mark(id: TipId): void; reset(): void }
export const useTips = create<Seen>()(persist((set) => ({
  seen: [],
  mark: (id) => set((s) => (s.seen.includes(id) ? s : { seen: [...s.seen, id] })),
  reset: () => set({ seen: [] }),
}), { name: "tm.tips.v1", storage: createJSONStorage(() => AsyncStorage) }));

const hydrated = (): Promise<void> => new Promise((ok) => {
  if (useTips.persist.hasHydrated()) return ok();
  const off = useTips.persist.onFinishHydration(() => { off(); ok(); });
});

let open = false;
/** Muestra la hoja de consejo `id` si nunca se ha visto (y la marca como vista). Espera a leer lo guardado para no repetirla al abrir la app. */
export async function tipOnce(id: TipId, delayMs = 500): Promise<void> {
  if (Constants.expoConfig?.extra?.capturas) return;      // en la compilación para capturas automáticas taparía las pantallas
  await hydrated();
  if (open || useTips.getState().seen.includes(id)) return;
  useTips.getState().mark(id);
  open = true;
  setTimeout(() => { router.push({ pathname: "/tip/[id]", params: { id } }); setTimeout(() => { open = false; }, 1000); }, delayMs);
}
