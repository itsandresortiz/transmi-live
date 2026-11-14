import { useEffect, useState } from "react";
import type { Feature, FeatureCollection, Point } from "geojson";
import { toGeo, type SystemType, type Vehicle, isStaleReport } from "@transmi/domain";
import { cadenceMs } from "@transmi/application";
import { transit } from "@/composition-root";
import { nowSec } from "@/clock";
import { motion } from "./engine";
import { SYSTEM_COLOR } from "@/ui/theme";
import { useRide } from "@/ride";
import { snappedPosition } from "@/rideSnap";
import { isVirtualRide, virtualParts } from "@/virtualRide";

export interface Viewport { west: number; south: number; east: number; north: number; zoom: number }

/** Cuántos buses se dibujan según el zoom: lejos no se distinguen y cada actualización cuesta. */
const capFor = (zoom: number) => (zoom < 11 ? 500 : zoom < 13 ? 700 : 900);
/** A quién se conserva primero cuando no caben todos: troncales y duales (son pocos y los que más se buscan), luego alimentadores y zonales. */
const PRIORITY: Record<SystemType, number> = { troncal: 0, dual: 0, alimentador: 1, zonal: 2, otro: 3 };
const hash = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0; return Math.abs(h); };
const EMPTY: FeatureCollection<Point> = { type: "FeatureCollection", features: [] };

/** Buses de la pantalla como puntos para el mapa, recalculados con el motor de movimiento a la cadencia de `cadenceMs`. Solo los que se ven. */
export function useBusFeatures(view: Viewport | null, opts: { system?: SystemType | null; routeId?: string | null; /** Solo los buses de estas rutas (las de un viaje, por ejemplo). */ routeIds?: readonly string[] | null; enabled?: boolean; everyMs?: number; /** Buses que nunca se dejan fuera de la muestra (el resaltado, el bus en el que vas). */ keepIds?: readonly string[] } = {}): FeatureCollection<Point> {
  const [data, setData] = useState<FeatureCollection<Point>>(EMPTY);
  const { system = null, routeId = null, routeIds = null, enabled = true, everyMs = 0 } = opts;
  const only = routeIds?.join(",") ?? "", keep = opts.keepIds?.join(",") ?? "";
  useEffect(() => {
    if (!enabled || !view) { setData(EMPTY); return; }
    const onlySet = only ? new Set(only.split(",")) : null, keepSet = new Set(keep ? keep.split(",") : []);
    const build = () => {
      const family = routeId ? new Set(transit.routeFamily(routeId)) : null;
      const t = nowSec();
      const padX = (view.east - view.west) * 0.05, padY = (view.north - view.south) * 0.05;
      const features: Feature<Point>[] = [];
      const cap = capFor(view.zoom), far = 0.03 + padX;
      const labels = view.zoom >= 15;
      // 1) los que pueden estar en pantalla, por su último reporte (un bus no avanza más de unos 3 km entre reportes): así el motor de
      //    movimiento calcula cientos de buses por tanda y no miles
      let inView: Vehicle[] = [];
      for (const v of transit.fleet.values()) {
        if (family && !family.has(v.routeId)) continue;      // la ruta elegida y su sentido contrario (TransMilenio los publica como rutas distintas)
        if (onlySet && !onlySet.has(v.routeId)) continue;
        if (system && v.system !== system) continue;
        if (v.position.lon < view.west - far || v.position.lon > view.east + far || v.position.lat < view.south - far || v.position.lat > view.north + far) continue;
        inView.push(v);
      }
      // 2) si son demasiados para dibujarlos todos (mapa muy alejado), se deja una muestra estable (siempre los mismos, no al azar) que
      //    conserva TODOS los troncales y duales: antes se cortaba por orden de llegada y la mayoría de los buses no salía,
      //    troncales incluidos (el dueño iba en un B11 que no aparecía en el mapa)
      const limit = Math.round(cap * 1.4);
      if (inView.length > limit) inView = inView.map((v) => ({ v, k: keepSet.has(v.id) ? -1 : PRIORITY[v.system] * 1e10 + (hash(v.id) % 1e9) })).sort((a, b) => a.k - b.k).slice(0, limit).map((x) => x.v);
      const ride = useRide.getState().busId, rideNow = t * 1000;      // mismo reloj con que se guardan las lecturas del GPS
      for (const v of inView) {
        // el bus en el que vas se dibuja donde va tu teléfono (el dato de TransMilenio llega ~1 min tarde y el bus se veía atrás o adelantado)
        const mine = v.id === ride ? snappedPosition(v.id, rideNow) : null;
        const g = mine ?? toGeo(motion.step(v, t));
        if (g.lon < view.west - padX || g.lon > view.east + padX || g.lat < view.south - padY || g.lat > view.north + padY) continue;
        const h = (((mine?.heading ?? motion.heading(v.id) ?? v.bearing ?? 90) % 360) + 360) % 360;
        features.push({ type: "Feature", id: v.id, geometry: { type: "Point", coordinates: [g.lon, g.lat] }, properties: { id: v.id, color: SYSTEM_COLOR[v.system], sprite: `top-${v.system}-${v.system === "troncal" ? "l" : "s"}`, rot: h, o: !mine && isStaleReport(v, t) ? 0.38 : 1, route: labels ? transit.routeOf(v)?.shortName ?? "" : "" } });
      }
      // el bus en el que vas, si no aparece en los datos de TransMilenio: se dibuja donde va tu teléfono
      if (isVirtualRide(ride) && (!system || transit.routeById(virtualParts(ride)?.routeId ?? "")?.system === system)) {
        const g = snappedPosition(ride, rideNow), vp = virtualParts(ride), r = vp ? transit.routeById(vp.routeId) : undefined;
        if (g && r) features.push({ type: "Feature", id: ride, geometry: { type: "Point", coordinates: [g.lon, g.lat] }, properties: { id: ride, color: SYSTEM_COLOR[r.system], sprite: `top-${r.system}-${r.system === "troncal" ? "l" : "s"}`, rot: ((g.heading % 360) + 360) % 360, o: 1, route: labels ? r.shortName : "" } });
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
  }, [view, system, routeId, only, keep, enabled, everyMs]);
  return data;
}
