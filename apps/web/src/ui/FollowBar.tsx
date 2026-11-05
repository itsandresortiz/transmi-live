import { useRef } from "react";
import { SYSTEM_LABEL, type Vehicle } from "@transmi/domain";
import { transit } from "../composition-root";
import type { MapTheme } from "../map/theme";
import { routeBadgeColor } from "../map/theme";
import { useNow, useTransitVersion } from "./hooks";
import { Close } from "./icons";
import { nowMs } from "../clock";
import { stopText } from "./stopname";
import { useUi } from "./store";
import { delayText, untilText } from "./format";

const STALE_SECONDS = 90;

/** Barra fija mientras se sigue un bus: quién es, hacia dónde va y cómo dejar de seguirlo. */
export function FollowBar({ th, onResume }: { th: MapTheme; onResume(): void }) {
  const { followId, followPaused, setFollow } = useUi();
  useTransitVersion();
  const nowSec = useNow() / 1000;
  const last = useRef<Vehicle | null>(null);
  if (!followId) { last.current = null; return null; }
  const live = transit.fleet.get(followId);
  if (live) last.current = live;
  const v = live ?? last.current;
  if (!v) return null;
  const r = transit.routeOf(v), d = transit.delayOf(v), ns = transit.nextStopOf(v, nowMs());
  const silent = !live || nowSec - v.reportedAt > STALE_SECONDS;
  return (
    <div className="followbar glass" role="status" aria-live="polite">
      <span className="rb sm" style={{ ["--c" as string]: routeBadgeColor(th, r, v.system) }}>{r?.shortName ?? v.routeId}</span>
      <div className="fm">
        <b>{r?.longName || SYSTEM_LABEL[v.system]}</b>
        <span>
          {silent ? "Este bus dejó de reportar. Puede haber terminado su recorrido."
            : ns?.stop ? `${delayText(d)} · próxima: ${stopText(ns.stop)}${ns.arrivalAt ? ` ${untilText(ns.arrivalAt, nowSec)}` : ""}`
            : `${delayText(d)} · siguiéndolo`}
        </span>
        <em>{SYSTEM_LABEL[v.system]} · {v.plate || v.label || v.id}{transit.serviceOf(v)?.isLast ? " · " : ""}{transit.serviceOf(v)?.isLast && <b className="lasttxt">Último servicio</b>}</em>
      </div>
      {followPaused && !silent && <button className="btn primary sm" onClick={onResume}>Volver al bus</button>}
      <button className="fab sm" aria-label="Dejar de seguir" onClick={() => setFollow(null)}><Close /></button>
    </div>
  );
}
