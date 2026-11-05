import { create } from "zustand";
import { type GeoPoint, distanceMeters, toWorld } from "@transmi/domain";
import { safeStorage } from "../storage";

const KEY = "tm.location.ok";
/** Solo se actualiza la posición si te moviste al menos esto (m): evita repintar con el ruido del GPS. */
const MIN_MOVE_METERS = 4;

interface Loc {
  me: GeoPoint | null;
  accuracy: number | null;
  status: "idle" | "asking" | "ok" | "denied" | "unsupported";
  /** El mapa acompaña tu ubicación (como en las apps de mapas) hasta que muevas el mapa con el dedo. */
  following: boolean;
  setFollowing(v: boolean): void;
  /** Hacia dónde miras (grados desde el norte), de la brújula del celular o del movimiento por el GPS. */
  heading: number | null;
  /** El mapa gira para que lo que está frente a ti quede arriba. */
  headingUp: boolean;
  /** Activa o apaga el giro con tu orientación. Devuelve `false` si el aparato no tiene brújula ni permiso. */
  setHeadingUp(v: boolean): Promise<boolean>;
  /** Empieza a seguir tu ubicación en tiempo real y devuelve la primera posición. */
  locate(): Promise<GeoPoint | null>;
}

let watchId: number | null = null;
let wanted = false;

export const useLocation = create<Loc>((set, get) => {
  const onFix = (p: GeolocationPosition) => {
    const next = { lat: p.coords.latitude, lon: p.coords.longitude };
    const prev = get().me;
    if (prev && get().status === "ok" && distanceMeters(toWorld(prev), toWorld(next)) < MIN_MOVE_METERS) return;
    safeStorage.set(KEY, "1");
    // en movimiento el GPS da el rumbo; parado se usa la brújula
    if (p.coords.heading != null && !Number.isNaN(p.coords.heading) && (p.coords.speed ?? 0) > 1.2) set({ heading: p.coords.heading });
    set({ me: next, accuracy: p.coords.accuracy ?? null, status: "ok" });
  };
  const onError = (e: GeolocationPositionError) => {
    if (e.code === e.PERMISSION_DENIED) { safeStorage.remove(KEY); wanted = false; stop(); set({ status: "denied" }); }
    // otros errores (sin señal momentánea): se sigue intentando
  };
  const start = () => {
    if (watchId != null || !navigator.geolocation) return;
    watchId = navigator.geolocation.watchPosition(onFix, onError, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  };
  const stop = () => { if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; } };
  // con la pantalla apagada o la pestaña oculta se deja de usar el GPS (batería)
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); else if (wanted) start(); });

  return {
    me: null, accuracy: null, status: "idle", following: false, heading: null, headingUp: false,
    setFollowing: (following) => set(following ? { following } : { following, headingUp: false }),
    setHeadingUp: async (v) => {
      if (!v) { stopCompass(); set({ headingUp: false }); return true; }
      const ok = await startCompass((h) => set({ heading: h }));
      if (!ok && get().heading == null) return false;
      set({ headingUp: true });
      return true;
    },
    locate: () => new Promise((resolve) => {
      if (!navigator.geolocation) { set({ status: "unsupported" }); return resolve(null); }
      wanted = true;
      if (get().status !== "ok") set({ status: "asking" });
      start();
      const cur = get().me;
      if (cur && get().status === "ok") return resolve(cur);
      const off = useLocation.subscribe((s) => { if (s.status === "ok" || s.status === "denied") { off(); clearTimeout(t); resolve(s.me); } });
      const t = setTimeout(() => { off(); if (get().status === "asking") set({ status: "idle" }); resolve(get().me); }, 12000);
    }),
  };
});

/** Si el usuario ya dio permiso antes, se ubica solo al abrir. */
export const hadLocationPermission = () => safeStorage.get(KEY) === "1";

/* ---- brújula del aparato ---- */
let compassOff: (() => void) | null = null;
function stopCompass() { compassOff?.(); compassOff = null; }

/** Empieza a leer la brújula. En iPhone hay que pedir permiso (solo se puede dentro de un toque del usuario). */
async function startCompass(onHeading: (deg: number) => void): Promise<boolean> {
  if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) return false;
  const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
  try { if (DOE.requestPermission && (await DOE.requestPermission()) !== "granted") return false; } catch { return false; }
  stopCompass();
  let got = false, last = 0;
  const handler = (e: Event) => {
    const o = e as DeviceOrientationEvent & { webkitCompassHeading?: number };
    // iPhone da el rumbo directo; Android da alpha (antihorario) en el evento «absolute»
    const h = o.webkitCompassHeading ?? (o.alpha != null && (o.absolute || e.type === "deviceorientationabsolute") ? (360 - o.alpha) % 360 : null);
    if (h == null) return;
    const t = performance.now();
    if (t - last < 120) return;                     // ~8 veces por segundo bastan
    last = t; got = true;
    onHeading(h + ((screen.orientation?.angle ?? 0)));
  };
  window.addEventListener("deviceorientationabsolute", handler as EventListener, true);
  window.addEventListener("deviceorientation", handler as EventListener, true);
  compassOff = () => { window.removeEventListener("deviceorientationabsolute", handler as EventListener, true); window.removeEventListener("deviceorientation", handler as EventListener, true); };
  await new Promise((r) => setTimeout(r, 600));
  if (!got) { stopCompass(); return false; }
  return true;
}
