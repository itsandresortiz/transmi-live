import { create } from "zustand";
import { decodePositions } from "@transmi/infrastructure";
import type { VehicleReport } from "@transmi/domain";
import { transit } from "./composition-root";
import { nowMs } from "./clock";

/** Modo demostración: reproduce lotes reales guardados (carpeta `demo/` del repositorio) como si fueran de ahora, para probar la app cuando no hay servicio.
 *  Nunca se presenta como dato en vivo: mientras está activo, la app lo rotula como «Demostración» y deja de pedir datos reales. */
const BASE = "https://raw.githubusercontent.com/itsandresortiz/transmi-live/main/demo/";
const COUNT = 8, EVERY_MS = 20_000;

interface DemoState { on: boolean; loading: boolean; error: string | null; start(): Promise<void>; stop(): void }
let timer: ReturnType<typeof setInterval> | null = null;
let batches: VehicleReport[][] = [];

function play(i: number): void {
  const batch = batches[i % batches.length];
  if (!batch?.length) return;
  // se corre la hora de cada reporte para que el más nuevo sea «ahora»: así los tiempos y el movimiento se calculan igual que con datos reales
  const newest = batch.reduce((m, r) => Math.max(m, r.reportedAt), 0), shift = nowMs() / 1000 - newest;
  transit.applyPositions(batch.map((r) => ({ ...r, reportedAt: r.reportedAt + shift })), nowMs());
}

export const useDemo = create<DemoState>((set, get) => ({
  on: false, loading: false, error: null,
  start: async () => {
    if (get().on || get().loading) return;
    set({ loading: true, error: null });
    try {
      if (!batches.length) {
        const bufs = await Promise.all(Array.from({ length: COUNT }, (_, i) => fetch(`${BASE}positions-${i + 1}.pb`).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })));
        batches = bufs.map((b) => decodePositions(new Uint8Array(b)));
      }
      let i = 0;
      play(i);
      timer = setInterval(() => play(++i), EVERY_MS);
      set({ on: true, loading: false });
    } catch {
      set({ loading: false, error: "No pudimos descargar los buses de ejemplo. Revisa tu conexión." });
    }
  },
  stop: () => {
    if (timer) clearInterval(timer);
    timer = null;
    transit.dropStale(nowMs() + 86_400_000);      // saca los buses de ejemplo: el mapa queda con lo real
    set({ on: false });
  },
}));

export const isDemo = (): boolean => useDemo.getState().on;
