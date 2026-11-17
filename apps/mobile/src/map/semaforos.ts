import { useEffect, useState } from "react";
import type { FeatureCollection, Point } from "geojson";
import { type SignalRow, signalInfo } from "@transmi/application";

/** La red semafórica de Bogotá (datos abiertos de la Secretaría de Movilidad). La publica la web junto con la app: un archivo pequeño que se baja una vez. */
const URL = "https://transmilive.com/semaforos.json";
const EMPTY = JSON.stringify({ type: "FeatureCollection", features: [] });
let cache: string | null = null, pending: Promise<string> | null = null;

async function load(): Promise<string> {
  if (cache) return cache;
  pending ??= fetch(URL).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then((j: { rows?: SignalRow[] }) => {
    // cada punto es un cruce: al tocarlo se dice cuántos semáforos tiene y para quién (`title`, `text`)
    const fc: FeatureCollection<Point> = { type: "FeatureCollection", features: (j.rows ?? []).map((r) => { const i = signalInfo(r); return { type: "Feature", geometry: { type: "Point", coordinates: [r[0], r[1]] }, properties: { dir: r[2], title: i.title, text: i.text } }; }) };
    cache = JSON.stringify(fc);
    return cache;
  }).catch(() => { pending = null; return EMPTY; });
  return pending;
}

/** Los semáforos como texto GeoJSON, ya listos para el mapa; solo se descargan cuando la capa está activa. */
export function useSemaforos(enabled: boolean): string {
  const [data, setData] = useState(cache ?? EMPTY);
  useEffect(() => { if (enabled && data === EMPTY) void load().then(setData); }, [enabled, data]);
  return data;
}
