import { useEffect, useRef, useState, type RefObject } from "react";
import { BUILDINGS_IDECA_MIN_ZOOM, buildingCellLoader, buildingVolumes, buildingsRefreshKey, clampBounds, snapCenter } from "@transmi/application";
import { CONFIG } from "../config";
import type { Viewport } from "./useBuses";

/** Edificios reales de Bogotá (Catastro, datos abiertos de IDECA; ver tools/edificios.ts) en la vista 3D, de cerca. Se piden solo las
 *  celdas de la pantalla, en un radio y con tope (el teléfono no carga la ciudad entera). Mientras no estén publicados siguen los del
 *  mapa base (`ready` = falso). */
const MAX = 2500, RADIUS_M = 500;
const EMPTY = JSON.stringify({ type: "FeatureCollection", features: [] });
const cells = buildingCellLoader(CONFIG.buildingsBase, async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(String(r.status)); return r.json(); });

export function useBuildings3d(on: boolean, view: Viewport | null, center: RefObject<[number, number]>, dark: boolean): { json: string; ready: boolean } {
  const [json, setJson] = useState(EMPTY);
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState(0);
  const last = useRef("");
  const near = on && !!view && view.zoom >= BUILDINGS_IDECA_MIN_ZOOM - 0.3;
  useEffect(() => {
    if (!near || !view) return;
    let dead = false;
    const id = setTimeout(async () => {
      try {
        const [lon, lat] = center.current ?? [view.west, view.south];
        // solo el radio alrededor del centro redondeado (no el borde de la pantalla, que cambia con cada movimiento)
        const c = snapCenter({ lon, lat }), bounds = clampBounds({ west: -180, south: -90, east: 180, north: 90 }, c, RADIUS_M);
        const list = await cells.inView(bounds, () => { if (!dead) setTick((t) => t + 1); }, 4);
        if (dead) return;
        setReady(cells.ready);
        const key = buildingsRefreshKey(c, list.length, dark);
        if (key === last.current) return;
        last.current = key;
        setJson(JSON.stringify(buildingVolumes(list, { dark, center: c, max: MAX })));
        cells.trim(12);
      } catch { /* sin red: siguen los del mapa base */ }
    }, 400);
    return () => { dead = true; clearTimeout(id); };
  }, [near, view, dark, tick]);   // eslint-disable-line react-hooks/exhaustive-deps
  return { json: near ? json : EMPTY, ready };
}
