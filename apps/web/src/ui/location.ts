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
    me: null, accuracy: null, status: "idle", following: false,
    setFollowing: (following) => set({ following }),
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
