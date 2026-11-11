import { useEffect, useState } from "react";
import type { Feature, FeatureCollection, Point } from "geojson";
import { toGeo, type SystemType, isStaleReport } from "@transmi/domain";
import { cadenceMs } from "@transmi/application";
import { transit } from "@/composition-root";
import { nowSec } from "@/clock";
import { motion } from "./engine";
import { SYSTEM_COLOR } from "@/ui/theme";

export interface Viewport { west: number; south: number; east: number; north: number; zoom: number }

/** Cuántos buses se dibujan según el zoom: lejos no se distinguen y cada actualización cuesta. */
const capFor = (zoom: number) => (zoom < 11 ? 300 : zoom < 13 ? 600 : 900);
const hash = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0; return Math.abs(h); };
const EMPTY: FeatureCollection<Point> = { type: "FeatureCollection", features: [] };

/** Buses de la pantalla como puntos para el mapa, recalculados con el motor de movimiento a la cadencia de `cadenceMs`. Solo los que se ven. */
export function useBusFeatures(view: Viewport | null, opts: { system?: SystemType | null; routeId?: string | null; /** Solo los buses de estas rutas (las de un viaje, por ejemplo). */ routeIds?: readonly string[] | null; enabled?: boolean; everyMs?: number } = {}): FeatureCollection<Point> {
  const [data, setData] = useState<FeatureCollection<Point>>(EMPTY);
  const { system = null, routeId = null, routeIds = null, enabled = true, everyMs = 0 } = opts;
  const only = routeIds?.join(",") ?? "";
  useEffect(() => {
    if (!enabled || !view) { setData(EMPTY); return; }
    const onlySet = only ? new Set(only.split(",")) : null;
    const build = () => {
      const t = nowSec();
      const padX = (view.east - view.west) * 0.05, padY = (view.north - view.south) * 0.05;
      const features: Feature<Point>[] = [];
      const cap = capFor(view.zoom), far = 0.03 + padX;
      let seen = 0;
      const labels = view.zoom >= 15;
      for (const v of transit.fleet.values()) {
        if (routeId && v.routeId !== routeId) continue;
        if (onlySet && !onlySet.has(v.routeId)) continue;
        if (system && v.system !== system) continue;
        // primero se descartan por su último reporte los que están lejos de la pantalla (un bus no avanza más de unos 3 km entre reportes): así el motor de movimiento calcula cientos de buses por tanda y no miles
        if (v.position.lon < view.west - far || v.position.lon > view.east + far || v.position.lat < view.south - far || v.position.lat > view.north + far) continue;
        const g = toGeo(motion.step(v, t));
        if (g.lon < view.west - padX || g.lon > view.east + padX || g.lat < view.south - padY || g.lat > view.north + padY) continue;
        // a lo lejos se deja una muestra estable de buses (siempre los mismos), no una al azar
        if (++seen > cap && hash(v.id) % 3 !== 0) continue;
        const h = (((motion.heading(v.id) ?? v.bearing ?? 90) % 360) + 360) % 360;
        features.push({ type: "Feature", id: v.id, geometry: { type: "Point", coordinates: [g.lon, g.lat] }, properties: { id: v.id, color: SYSTEM_COLOR[v.system], sprite: `top-${v.system}-${v.system === "troncal" ? "l" : "s"}`, rot: h, o: isStaleReport(v, t) ? 0.38 : 1, route: labels ? transit.routeOf(v)?.shortName ?? "" : "" } });
        if (features.length >= cap * 1.4) break;
      }
      setData({ type: "FeatureCollection", features });
      return features.length;
    };
    let timer: ReturnType<typeof setTimeout>, stopped = false, lastPrune = Date.now();
    const loop = () => {
      const t0 = Date.now();
      const count = build();
      if (Date.now() - lastPrune > 30_000) { lastPrune = Date.now(); motion.prune(); }      // el motor olvida los buses que ya no existen (si no, la memoria crece sin parar)
      const spent = Date.now() - t0;
      if (!stopped) timer = setTimeout(loop, Math.max(everyMs, cadenceMs(view.zoom, count), spent * 3));      // si calcular tarda mucho, se espacia: los toques tienen prioridad sobre el movimiento
    };
    loop();
    return () => { stopped = true; clearTimeout(timer); };
  }, [view, system, routeId, only, enabled, everyMs]);
  return data;
}
