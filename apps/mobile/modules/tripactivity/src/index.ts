import { requireOptionalNativeModule } from "expo";

/** Lo que muestra la actividad en vivo del viaje (pantalla de bloqueo e isla dinámica). Debe coincidir con `ContentState` en Swift. */
export interface TripActivityState { title: string; detail: string; badge: string; color: string; until: number; untilLabel: string; step: number; steps: number; arrive: number; /** A dónde lleva al tocarla. */ link: string }
interface TripActivityNative { isAvailable(): boolean; show(dest: string, json: string): Promise<boolean>; end(): Promise<void> }

/** El módulo nativo, o `null` donde no existe (web, Android, compilaciones viejas). */
const native = requireOptionalNativeModule<TripActivityNative>("TripActivity");

/** Crea o actualiza la actividad en vivo. Nunca lanza: si no se puede (sin permiso, sin widget), devuelve `false`. */
export async function showTripActivity(dest: string, state: TripActivityState): Promise<boolean> {
  try { return native ? await native.show(dest, JSON.stringify(state)) : false; } catch { return false; }
}
export async function endTripActivity(): Promise<void> {
  try { await native?.end(); } catch { /* no había actividad */ }
}
