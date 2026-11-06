import { useEffect, useRef } from "react";
import { create } from "zustand";
import { arrivalAtIndex } from "@transmi/application";
import { routeTitle } from "@transmi/domain";
import { transit } from "../composition-root";
import { nowMs } from "../clock";
import type { MapTheme } from "../map/theme";
import { routeBadgeColor } from "../map/theme";
import { useNow, useTransitVersion } from "./hooks";
import { Close } from "./icons";
import { haptic } from "./haptics";
import { etaText } from "./format";
import { stopText } from "./stopname";
import { useUi } from "./store";

interface RideState { busId: string | null; stopId: string | null; start(busId: string, stopId: string): void; stop(): void }
/** Modo «voy en el bus»: sigue el bus y avisa antes de la parada donde bajas. */
export const useRide = create<RideState>((set) => ({
  busId: null, stopId: null,
  start: (busId, stopId) => { set({ busId, stopId }); useUi.getState().setFollow(busId); useUi.getState().setSheet("peek"); },
  stop: () => set({ busId: null, stopId: null }),
}));

let wake: { release(): Promise<void> } | null = null;
async function keepAwake(on: boolean) {
  try {
    if (!on) { await wake?.release(); wake = null; return; }
    const nav = navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } };
    if (!wake && nav.wakeLock) wake = await nav.wakeLock.request("screen");
  } catch { /* no es indispensable */ }
}
const buzz = (pattern: number[]) => { try { navigator.vibrate?.(pattern); } catch { /* sin vibración */ } };

export function RideBar({ th }: { th: MapTheme }) {
  const { busId, stopId, stop } = useRide();
  useTransitVersion();
  const nowSec = useNow() / 1000;
  const warned = useRef<number>(99);
  useEffect(() => { void keepAwake(!!busId); warned.current = 99; return () => void keepAwake(false); }, [busId, stopId]);
  const v = busId ? transit.fleet.get(busId) : undefined;
  const target = stopId ? transit.stopById(stopId) : undefined;
  const seq = v ? transit.sequenceOf(v) : undefined;
  const ti = seq && stopId ? seq.shape.stopIds.indexOf(stopId, Math.max(0, seq.index)) : -1;
  const left = seq && ti >= 0 ? ti - seq.index : null;           // paradas por recorrer hasta la tuya (0 = ya llegó)
  const eta = v && seq && ti >= 0 ? arrivalAtIndex(transit, v, seq.shape, seq.index, ti, nowMs()) : undefined;

  useEffect(() => {
    if (left == null) return;
    if (left <= 0) { if (warned.current > 0) { warned.current = 0; buzz([300, 120, 300, 120, 500]); useUi.getState().showToast("Llegaste a tu parada"); } }
    else if (left === 1) { if (warned.current > 1) { warned.current = 1; buzz([250, 100, 250]); useUi.getState().showToast("La siguiente parada es la tuya"); } }
    else if (left === 3) { if (warned.current > 3) { warned.current = 3; buzz([120]); } }
  }, [left]);

  if (!busId || !stopId) return null;
  const r = v ? transit.routeOf(v) : undefined;
  const silent = !v || nowSec - v.reportedAt > 120;
  const text = silent ? "Perdimos la señal de este bus. Revisa por la ventana."
    : left == null ? "No podemos ubicar tu parada en la ruta de este bus."
    : left <= 0 ? "¡Es tu parada! Prepárate para bajar."
    : left === 1 ? "La siguiente parada es la tuya."
    : `Faltan ${left} paradas${eta ? ` · ${etaText(eta, nowSec)}` : ""}`;
  return (
    <div className={`followbar ridebar glass${left != null && left <= 1 ? " now" : ""}`} role="status" aria-live="assertive">
      <span className="rb sm" style={{ ["--c" as string]: routeBadgeColor(th, r, v?.system ?? "otro") }}>{r?.shortName ?? "—"}</span>
      <div className="fm">
        <b>Bajas en {target ? stopText(target) : "tu parada"}</b>
        <span>{text}</span>
        <em>{r?.longName ? routeTitle(r) : ""}</em>
      </div>
      <button className="btn sm" onClick={() => { haptic(); stop(); useUi.getState().setFollow(null); }}>Ya bajé</button>
      <button className="fab sm" aria-label="Salir del modo viaje" onClick={() => stop()}><Close /></button>
    </div>
  );
}
