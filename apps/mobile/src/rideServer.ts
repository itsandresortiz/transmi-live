import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { CONFIG } from "./config";
import { rangRideAlerts } from "./notify";
import { useTrip } from "./trip";
import { setTripActivityPush, tripActivityPushToken } from "../modules/tripactivity/src";

/**
 * Avisos del viaje desde el servidor (función de Supabase «viajes»; APAGADO mientras `CONFIG.ridesUrl` sea `null` o la app no se haya
 * compilado con el permiso de avisos remotos). Con «Voy en este bus» y parada de bajada, la app le cuenta al servidor qué bus, dónde te bajas
 * y a qué teléfono avisar; el servidor recalcula cada ~20 s con los datos en vivo y manda «Faltan 3 paradas», «Prepárate para bajar»,
 * «Bájate aquí» y (iPhone) la actividad en vivo, aunque la app esté cerrada. Al terminar el viaje (o a las 3 h) se borra todo.
 * Si el servidor no responde, la app sigue con sus avisos locales de siempre.
 */
const KEY = "tm.ride.server.v1";
/** Cada cuánto se le recuerda el viaje al servidor mientras la app está abierta (también le dice «estoy abierta»). */
const EVERY_MS = 25_000;
/** El servidor se encarga de los avisos si respondió bien hace menos de esto. */
const OWN_MS = 90_000;

const extra = Constants.expoConfig?.extra as { pushIos?: boolean; pushAndroid?: boolean } | undefined;
const compiledWithPush = Platform.OS === "ios" ? extra?.pushIos === true : Platform.OS === "android" ? extra?.pushAndroid === true : false;
/** ¿Está encendido? (servidor configurado y app compilada con avisos remotos). */
export const rideServerOn = (): boolean => !!CONFIG.ridesUrl && compiledWithPush;
if (rideServerOn()) setTripActivityPush(true);

interface Reg { id: string; clave: string }
let reg: Reg | null = null, loaded = false;
let lastAck = 0, lastSent = 0, lastKey = "", busy = false;
let deviceToken: string | null = null;

/** Texto aleatorio (hex). Sin `crypto` del sistema (Hermes no siempre lo trae) se usa `Math.random`: la clave solo protege que otro borre tu
 *  viaje, y el identificador no dice nada de ti. */
function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  const c = (globalThis as { crypto?: { getRandomValues?(x: Uint8Array): Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(a); else for (let i = 0; i < bytes; i++) a[i] = Math.floor(Math.random() * 256);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function registration(create: boolean): Promise<Reg | null> {
  if (!loaded) {
    loaded = true;
    try { const raw = await AsyncStorage.getItem(KEY); if (raw) reg = JSON.parse(raw) as Reg; } catch { /* sin nada guardado */ }
  }
  if (!reg && create) {
    reg = { id: randomHex(16), clave: randomHex(24) };
    try { await AsyncStorage.setItem(KEY, JSON.stringify(reg)); } catch { /* si no se guarda, al reabrir se registra de nuevo */ }
  }
  return reg;
}

async function post(path: string, body: unknown): Promise<{ ok?: boolean; avisa?: boolean } | null> {
  try {
    const r = await fetch(`${CONFIG.ridesUrl}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return r.ok ? ((await r.json()) as { ok?: boolean; avisa?: boolean }) : null;
  } catch { return null; }
}

/** ¿El servidor se está encargando de los avisos de este viaje? (Si sí, la app no los programa en el teléfono: no sonarían dos veces.) */
export const rideServerOwns = (): boolean => rideServerOn() && Date.now() - lastAck < OWN_MS;

/** Le cuenta (o recuerda) al servidor el viaje en curso. Se llama en cada vuelta del vigilante del viaje; solo envía cada ~25 s o si cambió algo. */
export async function syncRideServer(r: { busId: string; alightId: string; total: number; route: string; color: string; stop: string }): Promise<void> {
  if (!rideServerOn() || busy) return;
  // la actividad en vivo es de este viaje solo si no la ocupa un viaje de «Cómo llegar» (si no, el servidor la pisaría)
  const activityToken = Platform.OS === "ios" && !useTrip.getState().it ? tripActivityPushToken() : null;
  // se envía ya si cambió el bus, la parada o llegó el token de la actividad en vivo; si no, cada ~25 s
  const key = `${r.busId}|${r.alightId}|${activityToken ?? ""}`;
  if (key === lastKey && Date.now() - lastSent < EVERY_MS) return;
  busy = true;
  try {
    lastSent = Date.now();
    const g = await registration(true);
    if (!g) return;
    if (!deviceToken) {
      const perm = await Notifications.getPermissionsAsync().catch(() => null);
      if (perm?.granted) deviceToken = await Notifications.getDevicePushTokenAsync().then((t) => (typeof t.data === "string" ? t.data : null)).catch(() => null);
    }
    const res = await post("viaje", {
      id: g.id, clave: g.clave, plataforma: Platform.OS, entorno: __DEV__ ? "pruebas" : "produccion",
      tokenAviso: deviceToken, tokenActividad: activityToken, busId: r.busId, paradaBajada: r.alightId, total: r.total,
      ruta: r.route, color: r.color, paradaNombre: r.stop, sonados: rangRideAlerts(),
    });
    lastAck = res?.ok && res.avisa ? Date.now() : 0;
    lastKey = key;
  } finally { busy = false; }
}

/** El viaje terminó (o se quitó): se borra del servidor con sus tokens. */
export async function endRideServer(): Promise<void> {
  lastAck = 0; lastKey = "";
  if (!CONFIG.ridesUrl) return;
  const g = await registration(false);
  if (!g) return;
  reg = null;
  try { await AsyncStorage.removeItem(KEY); } catch { /* nada guardado */ }
  await post("fin", { id: g.id, clave: g.clave });
}
