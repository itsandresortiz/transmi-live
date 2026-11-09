import { useEffect, useState } from "react";
import type { Feature, FeatureCollection, Point } from "geojson";
import { toGeo, type SystemType } from "@transmi/domain";
import { transit } from "@/composition-root";
import { nowSec } from "@/clock";
import { motion } from "./engine";
import { SYSTEM_COLOR } from "@/ui/theme";

export interface Viewport { west: number; south: number; east: number; north: number; zoom: number }

const MAX_BUSES = 1800;
const EMPTY: FeatureCollection<Point> = { type: "FeatureCollection", features: [] };

/** Buses de la pantalla como puntos para el mapa, recalculados cada segundo con el motor de movimiento. Solo los que se ven. */
export function useBusFeatures(view: Viewport | null, opts: { system?: SystemType | null; routeId?: string | null; enabled?: boolean } = {}): FeatureCollection<Point> {
  const [data, setData] = useState<FeatureCollection<Point>>(EMPTY);
  const { system = null, routeId = null, enabled = true } = opts;
  useEffect(() => {
    if (!enabled || !view) { setData(EMPTY); return; }
    const build = () => {
      const t = nowSec();
      const padX = (view.east - view.west) * 0.15, padY = (view.north - view.south) * 0.15;
      const features: Feature<Point>[] = [];
      for (const v of transit.fleet.values()) {
        if (routeId && v.routeId !== routeId) continue;
        if (system && v.system !== system) continue;
        const g = toGeo(motion.step(v, t));
        if (g.lon < view.west - padX || g.lon > view.east + padX || g.lat < view.south - padY || g.lat > view.north + padY) continue;
        features.push({ type: "Feature", id: v.id, geometry: { type: "Point", coordinates: [g.lon, g.lat] }, properties: { id: v.id, color: SYSTEM_COLOR[v.system], h: motion.heading(v.id) ?? v.bearing ?? 0, route: transit.routeOf(v)?.shortName ?? "" } });
        if (features.length >= MAX_BUSES) break;
      }
      setData({ type: "FeatureCollection", features });
    };
    build();
    const timer = setInterval(build, 1000);
    return () => clearInterval(timer);
  }, [view, system, routeId, enabled]);
  return data;
}
