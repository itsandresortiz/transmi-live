import { create } from "zustand";
import type { GeoPoint } from "@transmi/domain";
import { safeStorage } from "../storage";

const KEY = "tm.location.ok";
interface Loc {
  me: GeoPoint | null;
  status: "idle" | "asking" | "ok" | "denied" | "unsupported";
  /** Pide la ubicación (el navegador muestra su aviso de permiso la primera vez). */
  locate(): Promise<GeoPoint | null>;
}

export const useLocation = create<Loc>((set) => ({
  me: null,
  status: "idle",
  locate: () => new Promise((resolve) => {
    if (!navigator.geolocation) { set({ status: "unsupported" }); return resolve(null); }
    set({ status: "asking" });
    navigator.geolocation.getCurrentPosition(
      (p) => { const me = { lat: p.coords.latitude, lon: p.coords.longitude }; safeStorage.set(KEY, "1"); set({ me, status: "ok" }); resolve(me); },
      () => { safeStorage.remove(KEY); set({ status: "denied" }); resolve(null); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 20000 },
    );
  }),
}));
/** Si el usuario ya dio permiso antes, se ubica solo al abrir. */
export const hadLocationPermission = () => safeStorage.get(KEY) === "1";
