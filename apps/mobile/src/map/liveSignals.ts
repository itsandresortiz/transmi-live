import { useEffect, useState } from "react";
import { liveSignalColors, measuredSignals } from "@transmi/application";
import { nowMs } from "@/clock";

/** Solo en modo de pruebas: los semáforos medidos a mano (guardados en el proyecto) con el color que deberían tener ahora, según su ciclo.
 *  No se muestra a los usuarios (ver 07-decisions: alguien podría guiarse por la app para cruzar). */
const URL = "https://raw.githubusercontent.com/itsandresortiz/transmi-live/main/tools/data/mediciones-semaforos.json";
const COLORS = { g: "#16a34a", y: "#f5b301", r: "#dc2626" } as const;
const EMPTY = JSON.stringify({ type: "FeatureCollection", features: [] });
let measured: ReturnType<typeof measuredSignals> | null = null;

export function useLiveSignals(enabled: boolean): string {
  const [json, setJson] = useState(EMPTY);
  useEffect(() => {
    if (!enabled) { setJson(EMPTY); return; }
    let gone = false, last = "";
    if (!measured) void fetch(`${URL}?t=${Math.floor(Date.now() / 60_000)}`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) measured = measuredSignals(d); }).catch(() => undefined);
    const id = setInterval(() => {
      if (gone || !measured) return;
      const fc = JSON.stringify({ type: "FeatureCollection", features: liveSignalColors(measured, nowMs()).map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: [p.lon, p.lat] }, properties: { color: COLORS[p.c] } })) });
      if (fc !== last) { last = fc; setJson(fc); }
    }, 400);
    return () => { gone = true; clearInterval(id); };
  }, [enabled]);
  return json;
}
