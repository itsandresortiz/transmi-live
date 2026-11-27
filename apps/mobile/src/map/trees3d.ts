import { useEffect, useRef, useState, type RefObject } from "react";
import type { MapRef } from "@maplibre/maplibre-react-native";
import type { Feature, LineString, MultiLineString, MultiPolygon, Polygon } from "geojson";
import { TREE_3D_MIN_ZOOM, clampBounds, greenKeep, mergeTrees, nearestFirst, plantTrees, treeCellLoader, treesOutside, treeVolumes, type GreenArea } from "@transmi/application";
import { CONFIG } from "../config";
import type { Viewport } from "./useBuses";

/** Árboles con volumen de la app (vista 3D, de cerca). La app no admite capas propias: cada árbol se arma con piezas `fill-extrusion`
 *  (tronco y copa de nube hecha de rebanadas de esferas; ver `treeVolumes`). Salen de los árboles de verdad de la rama `arboles` y, en los
 *  parques del mapa base, de árboles sembrados con semilla fija (`plantTrees`). Solo los de la pantalla, cerca del centro y con tope. */

/** Tope de árboles y cuántos de ellos (los más cercanos) llevan la copa de nube completa; el resto, una sola esfera (4 piezas). */
export const TREE_MAX = 220, TREE_DETAIL = 50;
/** Radio alrededor del centro de la cámara (m): con el mapa inclinado la pantalla llega hasta el horizonte. */
const RADIUS_M = 380;
/** Capas del mapa base (style-light/dark.json, mismos nombres en los dos) de donde salen las zonas verdes y lo que hay que esquivar. */
const GREEN_LAYERS = ["landcover_grass", "landcover_wood"], PARK_LAYERS = ["park"];
const AVOID_LAYERS = ["landuse_pitch", "water"], PATH_LAYERS = ["highway_path"];
const ROAD_LAYERS = ["highway_minor", "highway_major_inner", "highway_motorway_inner"];
export const EMPTY_TREES = JSON.stringify({ type: "FeatureCollection", features: [] });

const cells = treeCellLoader(CONFIG.treesBase, async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(String(r.status)); return r.json(); });
const isArea = (g: { type: string } | null | undefined): g is Polygon | MultiPolygon => g?.type === "Polygon" || g?.type === "MultiPolygon";
const isLine = (g: { type: string } | null | undefined): g is LineString | MultiLineString => g?.type === "LineString" || g?.type === "MultiLineString";

/** Las piezas de los árboles de la pantalla, como texto GeoJSON (vacío fuera del 3D o de lejos: la capa queda montada igual). */
export function useTrees3d(map: RefObject<MapRef | null>, on: boolean, view: Viewport | null, center: RefObject<[number, number]>, dark: boolean, stations?: Polygon[]): string {
  const stationsRef = useRef<Polygon[]>([]);
  stationsRef.current = stations ?? [];
  const [json, setJson] = useState(EMPTY_TREES);
  const [tick, setTick] = useState(0);
  const last = useRef("");
  const near = on && !!view && view.zoom >= TREE_3D_MIN_ZOOM - 0.3;
  useEffect(() => {
    if (!near || !view) return;
    let dead = false;
    // después de que el mapa se queda quieto (y de la animación de inclinar): pedir las zonas verdes es una consulta al mapa nativo
    const id = setTimeout(async () => {
      const m = map.current;
      if (!m) return;
      try {
        const [lon, lat] = center.current ?? [view.west, view.south];
        const c = { lon, lat }, bounds = clampBounds(view, c, RADIUS_M);
        const q = (layers: string[]) => m.queryRenderedFeatures({ layers }).catch(() => [] as Feature[]);
        const [greens, parks, avoidF, pathF, roadF] = await Promise.all([q(GREEN_LAYERS), q(PARK_LAYERS), q(AVOID_LAYERS), q(PATH_LAYERS), q(ROAD_LAYERS)]);
        const areas: GreenArea[] = [];
        for (const f of greens) { const k = greenKeep(f.properties); if (k != null && isArea(f.geometry)) areas.push({ geometry: f.geometry, keep: k }); }
        for (const f of parks) { const k = greenKeep(f.properties, "park"); if (k != null && isArea(f.geometry)) areas.push({ geometry: f.geometry, keep: k }); }
        const planted = areas.length ? plantTrees({
          areas, bounds, center: c, max: TREE_MAX * 2,
          avoidAreas: avoidF.map((f) => f.geometry).filter(isArea),
          avoidLines: pathF.map((f) => f.geometry).filter(isLine), clear: 2.5,
          roads: roadF.map((f) => f.geometry).filter(isLine), roadClear: 6,
        }) : [];
        const real = await cells.inView(bounds, () => { if (!dead) setTick((t) => t + 1); });
        const trees = nearestFirst(treesOutside(mergeTrees(real, planted), stationsRef.current), c).slice(0, TREE_MAX);      // ninguno encima de una estación
        const key = `${dark}|${trees.length}|${trees[0]?.lon.toFixed(6)}|${trees[trees.length - 1]?.lat.toFixed(6)}`;
        if (dead || key === last.current) return;
        last.current = key;
        const full = treeVolumes(trees.slice(0, TREE_DETAIL), { dark }), lite = treeVolumes(trees.slice(TREE_DETAIL), { dark, detail: false });
        setJson(JSON.stringify({ type: "FeatureCollection", features: [...full.features, ...lite.features] }));
      } catch { /* el mapa se desmontó o la consulta falló: se intenta en el próximo movimiento */ }
    }, 450);
    return () => { dead = true; clearTimeout(id); };
  }, [near, view, dark, tick]);   // eslint-disable-line react-hooks/exhaustive-deps
  return near ? json : EMPTY_TREES;
}
