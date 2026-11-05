import { create } from "zustand";
import type { SystemType } from "@transmi/domain";
import type { ColorMode, Motion } from "../map/BusRenderer";

export type Tab = "rutas" | "buses" | "paradas" | "avisos";
export type SheetState = "peek" | "half" | "full";
export interface Layers { streets: boolean; stops: boolean; network: boolean; buses: boolean }

interface UiState {
  tab: Tab;
  query: string;
  system: SystemType | null;
  limit: number;
  sheet: SheetState;
  routeId: string | null;
  /** Si se abrió «Ver ruta» desde un bus, la ruta se muestra desde el punto de vista de ese bus. */
  routeBusId: string | null;
  /** Parada abierta y, dentro de ella, la ruta elegida. */
  stopId: string | null;
  /** Estación abierta con todos sus vagones o plataformas. */
  groupIds: string[] | null;
  stopRoute: { routeId: string; direction: string } | null;
  direction: string;
  onlyLate: boolean;
  openAlert: number | null;
  followId: string | null;
  /** El usuario movió el mapa con el dedo: el seguimiento se pausa hasta que pida volver al bus. */
  followPaused: boolean;
  /** Parada que el usuario eligió: los tiempos de los buses se cuentan hasta ella. */
  targetStopId: string | null;
  settingsOpen: boolean;
  layers: Layers;
  colorMode: ColorMode;
  motion: Motion;
  toast: { text: string; n: number } | null;

  setTab(t: Tab): void;
  setQuery(q: string): void;
  setSystem(s: SystemType | null): void;
  more(): void;
  setSheet(s: SheetState): void;
  setRoute(id: string | null, busId?: string | null): void;
  openStop(id: string | null): void;
  openGroup(ids: string[] | null): void;
  setStopRoute(r: { routeId: string; direction: string } | null): void;
  setDirection(d: string): void;
  setOnlyLate(v: boolean): void;
  setOpenAlert(i: number | null): void;
  setFollow(id: string | null): void;
  setFollowPaused(v: boolean): void;
  setTargetStop(id: string | null): void;
  setSettingsOpen(v: boolean): void;
  setLayer(k: keyof Layers, v: boolean): void;
  setColorMode(m: ColorMode): void;
  setMotion(m: Motion): void;
  showToast(text: string): void;
}

const PAGE = 60;
export const useUi = create<UiState>((set) => ({
  tab: "rutas", query: "", system: null, limit: PAGE, sheet: "peek", routeId: null, routeBusId: null, stopId: null, groupIds: null, stopRoute: null, direction: "0", onlyLate: false,
  openAlert: null, followId: null, followPaused: false, targetStopId: null, settingsOpen: false,
  layers: { streets: true, stops: true, network: false, buses: true },
  colorMode: "system", motion: "predict", toast: null,

  setTab: (tab) => set((s) => (s.tab === tab && !s.stopId ? s : { tab, stopId: null, groupIds: null, stopRoute: null, query: "", limit: PAGE, onlyLate: tab === "buses" ? s.onlyLate : false })),
  setQuery: (query) => set({ query, limit: PAGE }),
  setSystem: (system) => set({ system, limit: PAGE }),
  more: () => set((s) => ({ limit: s.limit + PAGE })),
  setSheet: (sheet) => set({ sheet }),
  setRoute: (routeId, busId = null) => set({ routeId, routeBusId: routeId ? busId : null, direction: "0", stopId: null, groupIds: null, stopRoute: null }),
  openGroup: (groupIds) => set({ groupIds, stopId: null, stopRoute: null, routeId: null, routeBusId: null }),
  openStop: (stopId) => set({ stopId, stopRoute: null, targetStopId: stopId, routeId: null, routeBusId: null }),
  setStopRoute: (stopRoute) => set({ stopRoute }),
  setDirection: (direction) => set({ direction }),
  setOnlyLate: (onlyLate) => set({ onlyLate, limit: PAGE }),
  setOpenAlert: (openAlert) => set({ openAlert }),
  setFollow: (followId) => set({ followId, followPaused: false }),
  setFollowPaused: (followPaused) => set({ followPaused }),
  setTargetStop: (targetStopId) => set({ targetStopId }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setLayer: (k, v) => set((s) => ({ layers: { ...s.layers, [k]: v } })),
  setColorMode: (colorMode) => set({ colorMode }),
  setMotion: (motion) => set({ motion }),
  showToast: (text) => set((s) => ({ toast: { text, n: (s.toast?.n ?? 0) + 1 } })),
}));
