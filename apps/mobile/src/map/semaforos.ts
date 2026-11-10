import { useEffect, useState } from "react";
import type { FeatureCollection, Point } from "geojson";

/** La red semafórica de Bogotá (datos abiertos de la Secretaría de Movilidad). La publica la web junto con la app: un archivo pequeño que se baja una vez. */
const URL = "https://transmilive.com/semaforos.json";
const EMPTY = JSON.stringify({ type: "FeatureCollection", features: [] });
let cache: string | null = null, pending: Promise<string> | null = null;

async function load(): Promise<string> {
  if (cache) return cache;
  pending ??= fetch(URL).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then((j: { rows?: [number, number, string][] }) => {
    const fc: FeatureCollection<Point> = { type: "FeatureCollection", features: (j.rows ?? []).map(([lon, lat, dir]) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: { dir } })) };
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
