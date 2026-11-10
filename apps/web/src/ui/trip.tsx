import { useEffect, useRef } from "react";
import { create } from "zustand";
import { type GuideState, type Itinerary, type StopRef, advanceGuide, busForLeg, guideNow, liveShift, startGuide } from "@transmi/application";
import { transit } from "../composition-root";
import { nowMs } from "../clock";
import type { MapTheme } from "../map/theme";
import { routeBadgeColor } from "../map/theme";
import { useNow, useTransitVersion } from "./hooks";
import { Close } from "./icons";
import { haptic } from "./haptics";
import { etaText } from "./format";
import { useLocation } from "./location";
import { useUi } from "./store";

/** «Seguir este viaje»: la guía paso a paso de una opción de «Cómo llegar» (la misma lógica de la app, `trip-guide`).
 *  En la web no hay notificaciones del sistema: avisa en pantalla (y con vibración donde exista) mientras la página esté abierta. */
interface TripState { it: Itinerary | null; dest: string; guide: GuideState; shift: number; busId: string | null; start(it: Itinerary, dest: string): void; update(g: GuideState, shift: number, busId: string | null): void; stop(): void }
const NONE = { it: null, dest: "", guide: { leg: 0, phase: "done" } as GuideState, shift: 0, busId: null };
export const useTrip = create<TripState>((set) => ({
  ...NONE,
  start: (it, dest) => { set({ it, dest, guide: startGuide(it), shift: 0, busId: null }); if (useLocation.getState().status !== "denied") void useLocation.getState().locate(); useUi.getState().setSheet("peek"); },
  update: (guide, shift, busId) => set({ guide, shift, busId }),
  stop: () => set(NONE),
}));

/** «Calle 100, vagón 2» / el nombre solo. */
export function placeText(ref: StopRef): string {
  // el nombre que trae el plan ya puede venir con su vagón («Av. Chile · vagón 2»): se arma desde la parada para no repetirlo
  const stop = transit.stopById(ref.id);
  if (!stop) return ref.name;
  const l = transit.labelOf(stop);
  return l.wagon ? `${l.title}, vagón ${l.wagon}` : l.platform ? `${l.title}, plataforma ${l.platform}` : l.title;
}
const buzz = (pattern: number[]) => { try { navigator.vibrate?.(pattern); } catch { /* sin vibración */ } };

export function TripBar({ th }: { th: MapTheme }) {
  const { it, dest, guide, shift, busId, stop } = useTrip();
  useTransitVersion();
  const now = useNow();
  const me = useLocation((l) => l.me);
  const meRef = useRef(me); meRef.current = me;

  // cada pocos segundos: en qué paso vas (por tu ubicación o, sin ella, por la hora) y cuánto se corre el plan según el bus real
  useEffect(() => {
    if (!it) return;
    const tick = () => {
      const st = useTrip.getState();
      if (!st.it) return;
      const here = meRef.current, leg = it.legs[st.guide.leg];
      let s = st.shift, bus: string | null = null;
      if (leg?.kind === "ride") {
        bus = busForLeg(transit, leg, st.guide.phase, here, nowMs() / 1000, st.busId ?? undefined) ?? null;
        const live = liveShift(transit, leg, st.guide.phase, bus ?? undefined, nowMs());
        if (live != null) s = live;
      }
      const g = advanceGuide(it, st.guide, here, nowMs() / 1000, s);
      if (g.phase === "done") { buzz([300, 120, 300]); useUi.getState().showToast("Llegaste a tu destino"); st.stop(); return; }
      const moved = g.leg !== st.guide.leg || g.phase !== st.guide.phase;
      if (moved) { buzz([250, 100, 250]); useUi.getState().showToast(guideNow(it, g, placeText).title); }
      if (moved || s !== st.shift || bus !== st.busId) st.update(g, s, moved ? null : bus);
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, [it]);

  if (!it) return null;
  const leg = it.legs[guide.leg], nowDo = guideNow(it, guide, placeText);
  const key = leg?.kind === "ride" ? (guide.phase === "wait" ? leg.departAt : leg.arriveAt) + shift : null;
  const r = leg?.kind === "ride" ? transit.routeById(leg.routeId) : undefined;
  return (
    <div className="followbar ridebar glass" role="status" aria-live="polite">
      <span className="rb sm" style={{ ["--c" as string]: leg?.kind === "ride" ? routeBadgeColor(th, r, leg.system) : "var(--accent)" }}>{leg?.kind === "ride" ? leg.shortName : "A pie"}</span>
      <div className="fm">
        <b>{nowDo.title}</b>
        <span>{nowDo.body}{key && key > now / 1000 ? ` ${guide.phase === "wait" ? "Llega en" : "Te bajas en"} ${etaText(key, now / 1000)}${busId ? " (en vivo)" : " (aprox.)"}.` : ""}</span>
        <em>Paso {guide.leg + 1} de {it.legs.length}{dest ? ` · hacia ${dest}` : ""}</em>
      </div>
      <button className="fab sm" aria-label="Terminar el viaje" onClick={() => { haptic(); stop(); }}><Close /></button>
    </div>
  );
}
