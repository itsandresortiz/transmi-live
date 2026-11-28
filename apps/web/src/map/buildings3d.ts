import type { GeoJSONSource, Map as MLMap } from "maplibre-gl";
import { BUILDINGS_IDECA_MIN_ZOOM, buildingCellLoader, buildingVolumes, buildingsRefreshKey, buildingColorExpression, clampBounds, snapCenter } from "@transmi/application";
import { CONFIG } from "../config";

/** Edificios reales de Bogotá (Catastro, datos abiertos de IDECA; ver tools/edificios.ts) en la vista 3D, de cerca. Mientras no estén
 *  publicados (o fuera de Bogotá) siguen los del mapa base; cuando llegan, los del mapa base se apagan (no se dibujan dos veces). */
const ID = "edificios-bogota";
/** Hasta cuántos edificios (los más cercanos al centro) y en qué radio (m). */
const COARSE = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
const MAX = COARSE ? 3500 : 9000, RADIUS_M = COARSE ? 600 : 900;      // en celular, menos (como los árboles)

export class Buildings3D {
  private on = false;
  private dark = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private key = "";
  private readonly cells = buildingCellLoader(CONFIG.buildingsBase, async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(String(r.status)); return r.json(); });
  /** Se llama cuando cambia si hay edificios de Bogotá (para apagar o prender los del mapa base). */
  onReady: (ready: boolean) => void = () => undefined;

  constructor(private readonly map: MLMap) {
    map.on("moveend", () => {
      if (!this.on) return;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => { this.timer = null; void this.refresh(); }, 350);
    });
  }

  get ready(): boolean { return this.cells.ready; }

  /** Enciende o apaga la capa (3D encendido), con la apariencia y bajo qué capa va (los nombres de calles del juego visible). */
  sync(on3D: boolean, dark: boolean, before?: string) {
    const m = this.map;
    if (!m.getSource(ID)) m.addSource(ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    if (!m.getLayer(ID)) {
      m.addLayer({
        id: ID, type: "fill-extrusion", source: ID, minzoom: BUILDINGS_IDECA_MIN_ZOOM, layout: { visibility: "none" },
        paint: {
          "fill-extrusion-color": buildingColorExpression(false) as never, "fill-extrusion-base": ["get", "b"],
          // suben al acercarse (como los del mapa base), sin aparecer de golpe
          "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], BUILDINGS_IDECA_MIN_ZOOM, ["get", "b"], BUILDINGS_IDECA_MIN_ZOOM + 0.6, ["get", "h"]],
          "fill-extrusion-opacity": 0.85, "fill-extrusion-vertical-gradient": true,
        },
      } as never, before && m.getLayer(before) ? before : undefined);
    } else if (before && m.getLayer(before)) m.moveLayer(ID, before);
    const changed = this.dark !== dark;
    this.on = on3D; this.dark = dark;
    m.setLayoutProperty(ID, "visibility", on3D ? "visible" : "none");
    m.setPaintProperty(ID, "fill-extrusion-color", buildingColorExpression(dark) as never);
    if (changed) this.key = "";
    if (on3D) void this.refresh();
  }

  private async refresh() {
    const m = this.map;
    if (!this.on || m.getZoom() < BUILDINGS_IDECA_MIN_ZOOM - 0.3) return;
    const c = m.getCenter(), center = snapCenter({ lon: c.lng, lat: c.lat });
    // solo el radio alrededor del centro redondeado (no el borde de la pantalla, que cambia con cada movimiento)
    const bounds = clampBounds({ west: -180, south: -90, east: 180, north: 90 }, center, RADIUS_M);
    const wasReady = this.cells.ready;
    const list = await this.cells.inView(bounds, () => { this.key = ""; void this.refresh(); });
    if (this.cells.ready !== wasReady) this.onReady(this.cells.ready);
    const key = buildingsRefreshKey(center, list.length, this.dark);
    if (key === this.key) return;
    this.key = key;
    (m.getSource(ID) as GeoJSONSource | undefined)?.setData(buildingVolumes(list, { dark: this.dark, center, max: MAX }) as never);
    this.cells.trim();
  }
}
