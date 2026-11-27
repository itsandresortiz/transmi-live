import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { parseSharedRides } from "@transmi/application";
import type { RouteShape } from "@transmi/domain";
import { CONFIG } from "./config";
import { transit } from "./composition-root";
import { nowMs } from "./clock";

/**
 * «Ayudar a mejorar el mapa» (ENCENDIDO por defecto desde el 2026-11-27, decisión del dueño; se apaga en Más y se explica en la hoja
 * de consejo de «Voy en este bus» y en la política de privacidad): mientras vas en un bus con «Voy en este bus» y tu GPS
 * confirma que vas en él, cada ~20 s se manda por dónde va ESE BUS sobre su recorrido: ruta, recorrido, metros desde el inicio, hora,
 * velocidad y el número del bus solo si es uno de los datos de TransMilenio. Nada de ti ni de tu teléfono (ni coordenadas, ni identificador).
 * Con eso todas las apps dibujan ese bus donde va de verdad durante ≤60 s. El servidor lo borra a las 24 h.
 * Si el servidor está apagado (`CONFIG.ridesUrl` en `null`), el interruptor no aparece y no se envía nada.
 */
interface ShareState { on: boolean; set(on: boolean): void }
export const useShareRides = create<ShareState>()(persist((set) => ({ on: true, set: (on) => set({ on }) }), {
  name: "tm.share.v1", storage: createJSONStorage(() => AsyncStorage), partialize: (s) => ({ on: s.on }),
}));
/** ¿Se puede ofrecer? (el servidor está configurado). */
export const shareAvailable = (): boolean => !!CONFIG.ridesUrl;

const EVERY_MS = 20_000;
let lastShare = 0;

/** Llamar con cada lectura del GPS que confirma que vas en el bus (`check.kind === "on"`). Solo envía si el permiso está encendido. */
export function maybeShareRide(busId: string, routeId: string, shape: RouteShape, meters: number, speed: number | null | undefined): void {
  if (!CONFIG.ridesUrl || !useShareRides.getState().on) return;
  const now = nowMs();
  if (now - lastShare < EVERY_MS) return;
  const k = transit.network.shapes.get(routeId)?.indexOf(shape) ?? -1;
  if (k < 0) return;
  lastShare = now;
  const body: Record<string, unknown> = { r: routeId, k, m: Math.round(meters), t: Math.round(now / 1000) };
  if (speed != null && speed >= 0 && speed < 40) body.v = Math.round(speed * 10) / 10;
  if (!busId.startsWith("gps:")) body.b = busId;      // solo el número de un bus de los datos, nunca el de un viaje con GPS
  void fetch(`${CONFIG.ridesUrl}/compartir`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => undefined);
}

/** Lee cada ~20 s las posiciones compartidas vigentes (archivo público; no gasta invocaciones del servidor). Apagado si no hay dirección. */
export function startSharedRides(): () => void {
  const url = CONFIG.sharedRidesUrl;
  if (!url) return () => undefined;
  let stopped = false;
  const load = async () => {
    if (AppState.currentState !== "active") return;
    try {
      const r = await fetch(`${url}?t=${Math.floor(Date.now() / 10_000)}`);
      if (r.ok && !stopped) transit.sharedRides.set(parseSharedRides(await r.json()), nowMs() / 1000);
    } catch { /* sin señal: se quedan las que había (caducan solas a los 60 s) */ }
  };
  void load();
  const timer = setInterval(() => void load(), 20_000);
  return () => { stopped = true; clearInterval(timer); };
}
