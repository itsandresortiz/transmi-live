import type { Map as MLMap } from "maplibre-gl";
import type { LineString, MultiLineString, MultiPolygon, Polygon } from "geojson";
import { TREE_3D_MIN_ZOOM, capNearest, clampBounds, greenKeep, mergeTrees, plantTrees, treeCellLoader, type GreenArea } from "@transmi/application";
import { CONFIG } from "../config";
import type { TreeLayer } from "./TreeLayer";

/** Árboles de la vista 3D de la web: decide cuándo se ven, de dónde salen (árboles de verdad de la rama `arboles` y, en los parques del
 *  mapa base, árboles sembrados) y se los pasa a la capa de three.js, que se carga solo la primera vez que hacen falta. */

const ID = "arboles-3d";
/** En pantallas táctiles (celulares) menos árboles y más cerca: three.js dibuja cada esfera y el teléfono se calienta. */
const coarse = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
// tope más bajo desde que los parques grandes llevan menos árboles (2026-11-27): con eso se ven igual de llenos y pesan menos
const MAX = coarse ? 450 : 1200, RADIUS_M = coarse ? 450 : 800;
/** Radio de siembra alrededor del centro: más chico al acercarse (a zoom 18 la pantalla abarca ~300 m). */
const radiusAt = (z: number) => Math.max(260, Math.min(RADIUS_M, RADIUS_M / 2 ** ((z - 16) * 0.75)));
/** Calles: ningún árbol a menos de estos metros del eje (senderos y calles). */
const ROAD_CLASSES = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service", "busway", "track", "raceway"]);

const cells = treeCellLoader(CONFIG.treesBase, async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(String(r.status)); return r.json(); });

export class Trees3D {
  private layer: TreeLayer | null = null;
  private loading = false;
  private key = "";
  private on = false;
  private dark = false;
  private before: string | undefined;
  /** Para medir: cuánto tardó armar los árboles la última vez (ms) y cuántos hay. */
  stats = { plantMs: 0, buildMs: 0, count: 0, real: 0, areas: 0, planted: 0 };

  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Llegó relieve nuevo: hay que volver a apoyar los árboles en el suelo. */
  private groundDirty = false;

  constructor(private readonly map: MLMap) {
    // al terminar de moverse y cuando llegan teselas (zonas verdes o relieve) se recalculan los árboles de la pantalla, medio segundo después
    // de lo último. No se espera a «idle»: con los buses en movimiento el mapa casi nunca queda quieto
    const later = () => {
      if (!this.on) return;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => { this.timer = null; void this.refresh(); }, 500);
    };
    map.on("moveend", later);
    map.on("sourcedata", (e) => {
      if (!this.on || !e.tile) return;
      if (e.sourceId === "relieve") { this.groundDirty = true; later(); } else if (e.sourceId === "openmaptiles") later();
    });
  }

  /** Enciende o apaga los árboles (3D encendido) y les dice la apariencia y bajo qué capa van (los nombres de calles del juego visible). */
  sync(on3D: boolean, dark: boolean, before?: string) {
    const m = this.map;
    const zoomOk = m.getZoom() >= TREE_3D_MIN_ZOOM - 0.4;
    const changed = dark !== this.dark;
    this.on = on3D; this.dark = dark;
    if (this.layer && m.getLayer(ID)) {
      m.setLayoutProperty(ID, "visibility", on3D ? "visible" : "none");
      if (before !== this.before && before && m.getLayer(before)) { m.moveLayer(ID, before); this.before = before; }
    }
    this.before ??= before;
    if (!on3D || !zoomOk) return;
    if (changed) this.key = "";
    if (!this.layer && !this.loading) {
      this.loading = true;
      // three.js va en su propio trozo: solo se baja la primera vez que alguien enciende el 3D de cerca
      void import("./TreeLayer").then(({ TreeLayer }) => {
        this.layer = new TreeLayer(ID, MAX);
        const b = this.before && m.getLayer(this.before) ? this.before : undefined;
        m.addLayer(this.layer, b);
        m.setLayoutProperty(ID, "visibility", this.on ? "visible" : "none");
        this.loading = false;
        void this.refresh();
      }).catch(() => { this.loading = false; });
      return;
    }
    void this.refresh();
  }

  private async refresh() {
    const m = this.map, layer = this.layer;
    if (!layer || !this.on || m.getZoom() < TREE_3D_MIN_ZOOM - 0.4) return;
    const t0 = performance.now();
    const c = m.getCenter(), center = { lon: c.lng, lat: c.lat }, vb = m.getBounds();
    const bounds = clampBounds({ west: vb.getWest(), south: vb.getSouth(), east: vb.getEast(), north: vb.getNorth() }, center, radiusAt(m.getZoom()));
    const q = (sourceLayer: string) => m.querySourceFeatures("openmaptiles", { sourceLayer });
    const areas: GreenArea[] = [], avoid: (Polygon | MultiPolygon)[] = [], paths: (LineString | MultiLineString)[] = [], roads: (LineString | MultiLineString)[] = [];
    const isArea = (g: { type: string }): g is Polygon | MultiPolygon => g.type === "Polygon" || g.type === "MultiPolygon";
    const isLine = (g: { type: string }): g is LineString | MultiLineString => g.type === "LineString" || g.type === "MultiLineString";
    for (const sl of ["landcover", "park"]) for (const f of q(sl)) {
      const keep = greenKeep(f.properties, sl);
      if (keep != null && isArea(f.geometry)) areas.push({ geometry: f.geometry, keep });
    }
    if (!areas.length) { if (layer.count) layer.setTrees([], this.dark); return; }
    for (const f of q("landuse")) if (isArea(f.geometry) && ["pitch", "playground", "stadium", "track"].includes(String(f.properties?.class))) avoid.push(f.geometry);
    for (const f of q("water")) if (isArea(f.geometry)) avoid.push(f.geometry);
    for (const f of q("building")) if (isArea(f.geometry)) avoid.push(f.geometry);
    for (const f of q("transportation")) {
      if (!isLine(f.geometry)) { if (isArea(f.geometry)) avoid.push(f.geometry); continue; }       // plazas peatonales
      const cls = String(f.properties?.class);
      if (cls === "path") paths.push(f.geometry); else if (ROAD_CLASSES.has(cls)) roads.push(f.geometry);
    }
    const planted = plantTrees({ areas, avoidAreas: avoid, avoidLines: paths, clear: 2.5, roads, roadClear: 6, bounds, center, max: MAX * 2 });
    const real = await cells.inView(bounds, () => { this.key = ""; void this.refresh(); });
    const trees = capNearest(mergeTrees(real, planted), MAX, center);
    const key = `${this.dark}|${trees.length}|${trees[0]?.lon.toFixed(6)}|${trees[trees.length - 1]?.lat.toFixed(6)}`;
    this.stats.plantMs = Math.round(performance.now() - t0); this.stats.areas = areas.length; this.stats.planted = planted.length;
    if (key === this.key && !this.groundDirty) return;
    this.groundDirty = false;
    this.key = key;
    layer.setTrees(trees, this.dark);
    this.stats.buildMs = Math.round(layer.lastBuildMs); this.stats.count = layer.count; this.stats.real = real.length;
  }
}
