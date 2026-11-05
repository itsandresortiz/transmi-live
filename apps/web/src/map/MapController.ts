import maplibregl, { type ExpressionSpecification, type GeoJSONSource, type Map as MLMap, type Popup } from "maplibre-gl";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import type { GeoPoint, RouteShape, SystemType, TransitNetwork } from "@transmi/domain";
import * as geo from "./geodata";
import { busSprite } from "./sprites";
import { type MapTheme, type Scheme, themeOf } from "./theme";

export interface MapEvents {
  onBusClick(id: string): void;
  onStopClick(id: string): void;
  onStationClick(index: number): void;
  onUserDrag?(): void;
  /** El dedo o el mouse está sobre el mapa (true) o se soltó (false). */
  onPointerHold?(hold: boolean): void;
}
export interface LayerToggles { streets: boolean; stops: boolean; network: boolean; buses: boolean }

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const FONT = ["Noto Sans Regular"];
const STREET_LAYERS = ["street-0", "street-2", "street-3", "street-4"];
const BUS_LAYERS = ["bus-dots"];
const BOGOTA: [number, number] = [-74.075, 4.65];

const zoomWidth = (...pairs: [number, number][]): ExpressionSpecification =>
  ["interpolate", ["linear"], ["zoom"], ...pairs.flat()] as ExpressionSpecification;

/** Envuelve MapLibre: arma las capas del mapa de Bogotá y expone operaciones en el lenguaje de la aplicación. */
export class MapController {
  readonly map: MLMap;
  readonly ready: Promise<void>;
  private theme: MapTheme;
  private popup: Popup | null = null;
  private me: maplibregl.Marker | null = null;
  private networkLoaded = false;
  /** Lo asigna quien dibuja los buses en canvas: devuelve el bus bajo ese punto de la pantalla. */
  busHit: ((pt: { x: number; y: number }) => string | null) | null = null;

  constructor(container: HTMLElement, scheme: Scheme, private readonly events: MapEvents) {
    this.theme = themeOf(scheme);
    const base = new URL(import.meta.env.BASE_URL, location.href).href;
    const emptyGlyph = `${base}fonts/empty.pbf`;
    this.map = new maplibregl.Map({
      container,
      style: {
        version: 8,
        glyphs: `${base}fonts/{fontstack}/{range}.pbf`,
        sources: {},
        layers: [{ id: "bg", type: "background", paint: { "background-color": this.theme.mapbg } }],
      },
      center: BOGOTA, zoom: 11, minZoom: 9, maxZoom: 19.5,
      attributionControl: false, dragRotate: false, pitchWithRotate: false, maxPitch: 0,
      fadeDuration: 0, renderWorldCopies: false,
      // los rangos de tipografía que no incluimos (otros alfabetos) se resuelven en vacío, sin error
      transformRequest: (url, type) =>
        type === "Glyphs" && !/\/(0-255|256-511)\.pbf$/.test(url) ? { url: emptyGlyph } : undefined,
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "© OpenStreetMap · TransMilenio · Bogotá" }), "bottom-right");
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    this.ready = new Promise((res) => this.map.once("load", () => { this.addLayers(); this.bindEvents(); void this.loadStatic(); res(); }));
  }

  /* ---------- capas ---------- */
  private src(id: string, data: FeatureCollection = EMPTY, extra: Record<string, unknown> = {}) {
    this.map.addSource(id, { type: "geojson", data, ...extra });
  }

  private addLayers() {
    const m = this.map, t = this.theme;
    this.src("localidades"); this.src("localidad-labels"); this.src("roads"); this.src("troncales");
    this.src("network"); this.src("street-labels"); this.src("estaciones"); this.src("stops");
    this.src("route-sel"); this.src("route-stops"); this.src("alert-stops"); this.src("buses"); this.src("stop-focus");

    m.addLayer({ id: "localidades-fill", type: "fill", source: "localidades", paint: { "fill-color": t.land } });
    m.addLayer({ id: "localidades-line", type: "line", source: "localidades", paint: { "line-color": t.landLine, "line-width": 1.2 } });

    const lineLayout = { "line-cap": "round", "line-join": "round" } as const;
    m.addLayer({
      id: "roads-minor", type: "line", source: "roads", minzoom: 14, filter: ["<=", ["get", "c"], 1], layout: lineLayout,
      paint: { "line-color": t.road, "line-width": zoomWidth([14, 0.6], [17, 1.6], [19, 3]) },
    });
    m.addLayer({
      id: "roads-mid", type: "line", source: "roads", minzoom: 11, filter: ["==", ["get", "c"], 2], layout: lineLayout,
      paint: { "line-color": t.road, "line-width": zoomWidth([11, 0.5], [15, 1.5], [19, 4]) },
    });
    m.addLayer({
      id: "roads-major", type: "line", source: "roads", filter: [">=", ["get", "c"], 3], layout: lineLayout,
      paint: {
        "line-color": t.roadMajor,
        "line-width": zoomWidth([9, 0.4], [13, ["match", ["get", "c"], 5, 2.6, 4, 2.2, 1.6] as unknown as number], [17, ["match", ["get", "c"], 5, 6, 4, 5, 3.8] as unknown as number], [19, 12]),
      },
    });
    m.addLayer({
      id: "network-lines", type: "line", source: "network", minzoom: 9, layout: lineLayout,
      paint: { "line-color": ["get", "color"], "line-opacity": 0.5, "line-width": zoomWidth([9, 0.6], [14, 1.6], [18, 3.2]) },
    });
    m.addLayer({
      id: "troncales-lines", type: "line", source: "troncales", layout: lineLayout,
      paint: { "line-color": t.troncal, "line-opacity": 0.85, "line-width": zoomWidth([9, 1.5], [14, 3.4], [18, 6]) },
    });
    m.addLayer({
      id: "route-sel-line", type: "line", source: "route-sel", layout: lineLayout,
      paint: {
        "line-color": ["get", "color"], "line-opacity": ["case", ["get", "on"], 0.95, 0.35],
        "line-width": ["interpolate", ["linear"], ["zoom"], 9, ["case", ["get", "on"], 2.5, 2], 14, ["case", ["get", "on"], 5, 3], 18, ["case", ["get", "on"], 9, 4]] as unknown as number,
      },
    });

    m.addLayer({
      id: "localidad-names", type: "symbol", source: "localidad-labels", maxzoom: 13.5,
      layout: { "text-field": ["get", "name"], "text-font": FONT, "text-size": 11, "text-letter-spacing": 0.14, "text-allow-overlap": false, "symbol-z-order": "source" },
      paint: { "text-color": t.label, "text-halo-color": t.land, "text-halo-width": 1.6, "text-opacity": 0.8 },
    });
    const streetLayout = (size: number[]) => ({
      "text-field": ["get", "n"], "text-font": FONT, "text-size": zoomWidth([13, size[0]!], [19, size[1]!]),
      "text-rotate": ["get", "a"], "text-rotation-alignment": "map", "text-pitch-alignment": "map",
      "text-padding": 8, "text-max-angle": 30, "symbol-sort-key": ["get", "c"], "text-letter-spacing": 0.02,
    } as const);
    const streetPaint = { "text-color": t.label, "text-halo-color": t.halo, "text-halo-width": 1.5 };
    ([["street-0", ["<=", ["get", "c"], 1], 13.5, [10, 14]], ["street-2", ["==", ["get", "c"], 2], 14.5, [9.5, 13]],
      ["street-3", ["==", ["get", "c"], 3], 15, [9.5, 13]], ["street-4", ["==", ["get", "c"], 4], 16, [9, 12]]] as const).forEach(([id, filter, minzoom, size]) =>
      m.addLayer({ id, type: "symbol", source: "street-labels", minzoom, filter: filter as never, layout: streetLayout([...size]) as never, paint: streetPaint }));

    m.addLayer({
      id: "estaciones-circles", type: "circle", source: "estaciones", minzoom: 11,
      paint: { "circle-radius": zoomWidth([11, 2], [15, 4.2], [18, 6]), "circle-color": t.surface, "circle-stroke-color": t.troncal, "circle-stroke-width": 2 },
    });
    m.addLayer({
      id: "estaciones-labels", type: "symbol", source: "estaciones", minzoom: 14.5,
      layout: { "text-field": ["get", "name"], "text-font": FONT, "text-size": 11, "text-offset": [0, 1.1], "text-anchor": "top", "text-optional": true },
      paint: { "text-color": t.troncal, "text-halo-color": t.halo, "text-halo-width": 1.6 },
    });
    m.addLayer({
      id: "stops-circles", type: "circle", source: "stops", minzoom: 13.5,
      paint: { "circle-radius": zoomWidth([13.5, 2.2], [17, 4]), "circle-color": t.surface, "circle-stroke-color": t.label, "circle-stroke-width": 1 },
    });
    m.addLayer({
      id: "route-stops", type: "circle", source: "route-stops",
      paint: { "circle-radius": zoomWidth([10, 3], [15, 5.5], [18, 8]), "circle-color": t.surface, "circle-stroke-color": ["get", "color"], "circle-stroke-width": 2.5 },
    });
    m.addLayer({
      id: "alert-stops", type: "circle", source: "alert-stops",
      paint: { "circle-radius": 9, "circle-color": "#f59e0b", "circle-opacity": 0.4, "circle-stroke-color": "#f59e0b", "circle-stroke-width": 2.5 },
    });

    m.addLayer({ id: "stop-focus-halo", type: "circle", source: "stop-focus", paint: { "circle-radius": 22, "circle-color": ["get", "color"], "circle-opacity": 0.2 } });
    m.addLayer({ id: "stop-focus-dot", type: "circle", source: "stop-focus", paint: { "circle-radius": 8, "circle-color": ["get", "color"], "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 } });
    m.addLayer({
      id: "bus-dots", type: "circle", source: "buses", maxzoom: 13,
      paint: { "circle-radius": zoomWidth([9, 2.2], [13, 4.2]), "circle-color": ["get", "color"], "circle-stroke-color": "#ffffff", "circle-stroke-width": 1 },
    });
  }

  /** Datos que vienen incluidos en la app: se cargan en segundo plano. */
  private async loadStatic() {
    const set = (id: string, data: FeatureCollection) => (this.map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
    const [loc, tron, est] = await Promise.all([geo.loadLocalidades(), geo.loadTroncales(), geo.loadEstaciones()]);
    set("localidades", geo.localidadPolygons(loc)); set("localidad-labels", geo.localidadLabels(loc));
    set("troncales", geo.troncalLines(tron)); set("estaciones", geo.estacionPoints(est));
    set("roads", await geo.loadRoads());
    set("street-labels", await geo.loadStreetLabels());
  }

  private bindEvents() {
    const m = this.map;
    const pointer = (id: string) => {
      m.on("mouseenter", id, () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", id, () => (m.getCanvas().style.cursor = ""));
    };
    // arrastrar el mapa con el dedo o el mouse pausa el seguimiento (se detecta en el lienzo, antes de que MapLibre procese el gesto)
    const cv = m.getCanvas();
    let down: { x: number; y: number } | null = null, fired = false;
    cv.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; fired = false; this.events.onPointerHold?.(true); });
    window.addEventListener("pointermove", (e) => {
      if (!down || fired) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) { fired = true; this.events.onUserDrag?.(); }
    });
    const up = () => { down = null; this.events.onPointerHold?.(false); };
    window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);   // en la ventana: el dedo puede soltarse fuera del mapa
    pointer("bus-dots");
    m.on("click", "bus-dots", (e) => { const f = e.features?.[0]; if (f) { e.originalEvent.cancelBubble = true; this.events.onBusClick(String(f.properties?.id)); } });
    // los buses dibujados en canvas (zoom ≥ 13) tienen prioridad sobre paradas y estaciones
    m.on("click", (e) => { const id = this.busHit?.(e.point); if (id) this.events.onBusClick(id); });
    m.on("mousemove", (e) => { if (this.busHit?.(e.point)) m.getCanvas().style.cursor = "pointer"; else if (!m.queryRenderedFeatures(e.point, { layers: ["stops-circles", "estaciones-circles", "route-stops", "bus-dots"].filter((l) => m.getLayer(l)) }).length) m.getCanvas().style.cursor = ""; });
    for (const id of ["stops-circles", "route-stops"]) {
      pointer(id);
      m.on("click", id, (e) => {
        if (e.originalEvent.cancelBubble || this.busHit?.(e.point)) return;
        const f = e.features?.[0];
        if (f) { e.originalEvent.cancelBubble = true; this.events.onStopClick(String(f.properties?.id)); }
      });
    }
    pointer("estaciones-circles");
    m.on("click", "estaciones-circles", (e) => {
      if (e.originalEvent.cancelBubble || this.busHit?.(e.point)) return;
      const f = e.features?.[0];
      if (f && typeof f.id === "number") this.events.onStationClick(f.id);
    });
  }

  /* ---------- operaciones ---------- */
  setScheme(scheme: Scheme) {
    this.theme = themeOf(scheme);
    const t = this.theme, m = this.map;
    if (!m.getLayer("bg")) return;
    m.setPaintProperty("bg", "background-color", t.mapbg);
    m.setPaintProperty("localidades-fill", "fill-color", t.land);
    m.setPaintProperty("localidades-line", "line-color", t.landLine);
    for (const id of ["roads-minor", "roads-mid"]) m.setPaintProperty(id, "line-color", t.road);
    m.setPaintProperty("roads-major", "line-color", t.roadMajor);
    m.setPaintProperty("troncales-lines", "line-color", t.troncal);
    m.setPaintProperty("localidad-names", "text-color", t.label);
    m.setPaintProperty("localidad-names", "text-halo-color", t.land);
    for (const id of STREET_LAYERS) { m.setPaintProperty(id, "text-color", t.label); m.setPaintProperty(id, "text-halo-color", t.halo); }
    m.setPaintProperty("estaciones-circles", "circle-color", t.surface);
    m.setPaintProperty("estaciones-circles", "circle-stroke-color", t.troncal);
    m.setPaintProperty("estaciones-labels", "text-color", t.troncal);
    m.setPaintProperty("estaciones-labels", "text-halo-color", t.halo);
    m.setPaintProperty("stops-circles", "circle-color", t.surface);
    m.setPaintProperty("stops-circles", "circle-stroke-color", t.label);
    m.setPaintProperty("route-stops", "circle-color", t.surface);
  }

  setToggles(t: LayerToggles) {
    const m = this.map;
    const vis = (ids: string[], on: boolean) => ids.forEach((id) => m.getLayer(id) && m.setLayoutProperty(id, "visibility", on ? "visible" : "none"));
    vis(STREET_LAYERS, t.streets); vis(["stops-circles"], t.stops); vis(["network-lines"], t.network); vis(BUS_LAYERS, t.buses);
  }

  setBuses(data: FeatureCollection<Point>) { (this.map.getSource("buses") as GeoJSONSource | undefined)?.setData(data); }

  /** Dibuja la red de rutas y las paradas del GTFS. */
  setNetwork(net: TransitNetwork) {
    const t = this.theme;
    const lines: Feature<LineString>[] = [];
    for (const [rid, shapes] of net.shapes) {
      const sys: SystemType = net.routes.get(rid)?.system ?? "otro";
      for (const s of shapes)
        if (s.points.length > 1)
          lines.push({ type: "Feature", properties: { rid, color: t.system[sys] }, geometry: { type: "LineString", coordinates: s.points.map((p) => [p.lon, p.lat]) } });
    }
    (this.map.getSource("network") as GeoJSONSource).setData({ type: "FeatureCollection", features: lines });
    const stops: Feature<Point>[] = [];
    for (const s of net.stops.values())
      stops.push({ type: "Feature", properties: { id: s.id }, geometry: { type: "Point", coordinates: [s.position.lon, s.position.lat] } });
    (this.map.getSource("stops") as GeoJSONSource).setData({ type: "FeatureCollection", features: stops });
    this.networkLoaded = true;
    this.map.setLayoutProperty("troncales-lines", "visibility", "none");
  }
  /** Colores de la red según el tema (al cambiar de claro a oscuro). */
  recolorNetwork(net: TransitNetwork) { if (this.networkLoaded) this.setNetwork(net); }

  /** Resalta una ruta (todas sus direcciones; la elegida más gruesa) y sus paradas. */
  showRoute(shapes: readonly RouteShape[] | null, direction: string, color: string, stopsLookup: (id: string) => GeoPoint | undefined) {
    const sel = this.map.getSource("route-sel") as GeoJSONSource, stops = this.map.getSource("route-stops") as GeoJSONSource;
    if (!shapes || !shapes.length) {
      sel.setData(EMPTY); stops.setData(EMPTY);
      this.map.setPaintProperty("network-lines", "line-opacity", 0.5);
      return;
    }
    this.map.setPaintProperty("network-lines", "line-opacity", 0.1);
    sel.setData({
      type: "FeatureCollection",
      features: shapes.filter((s) => s.points.length > 1).map((s) => ({
        type: "Feature", properties: { color, on: s.direction === direction },
        geometry: { type: "LineString", coordinates: s.points.map((p) => [p.lon, p.lat]) },
      })),
    });
    const cur = shapes.find((s) => s.direction === direction) ?? shapes[0]!;
    const feats: Feature<Point>[] = [];
    for (const id of cur.stopIds) {
      const p = stopsLookup(id);
      if (p) feats.push({ type: "Feature", properties: { id, color }, geometry: { type: "Point", coordinates: [p.lon, p.lat] } });
    }
    stops.setData({ type: "FeatureCollection", features: feats });
  }

  /** Marca la parada elegida con un punto grande. */
  setFocusStop(p: GeoPoint | null, color = "#e11d2e") {
    (this.map.getSource("stop-focus") as GeoJSONSource | undefined)?.setData(!p ? EMPTY : { type: "FeatureCollection", features: [{ type: "Feature", properties: { color }, geometry: { type: "Point", coordinates: [p.lon, p.lat] } }] });
  }

  /** Resalta solo un tramo de una ruta (por ejemplo, por donde vienen los buses hacia una parada). */
  showSegment(points: readonly GeoPoint[], color: string, stops: readonly { id: string; p: GeoPoint }[]) {
    const sel = this.map.getSource("route-sel") as GeoJSONSource, st = this.map.getSource("route-stops") as GeoJSONSource;
    this.map.setPaintProperty("network-lines", "line-opacity", 0.1);
    sel.setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: { color, on: true }, geometry: { type: "LineString", coordinates: points.map((p) => [p.lon, p.lat]) } }] });
    st.setData({ type: "FeatureCollection", features: stops.map((s) => ({ type: "Feature", properties: { id: s.id, color }, geometry: { type: "Point", coordinates: [s.p.lon, s.p.lat] } })) });
  }

  setAlertStops(points: readonly GeoPoint[] | null) {
    (this.map.getSource("alert-stops") as GeoJSONSource).setData(!points ? EMPTY : {
      type: "FeatureCollection",
      features: points.map((p) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [p.lon, p.lat] } })),
    });
  }

  fit(points: readonly GeoPoint[], padding: maplibregl.PaddingOptions, maxZoom = 16.5) {
    if (!points.length) return;
    const b = new maplibregl.LngLatBounds();
    for (const p of points) b.extend([p.lon, p.lat]);
    this.map.fitBounds(b, { padding, maxZoom, duration: 700 });
  }
  flyTo(p: GeoPoint, zoom: number, padding?: maplibregl.PaddingOptions) {
    this.map.flyTo({ center: [p.lon, p.lat], zoom, duration: 800, padding, essential: true });
  }
  /** Acerca el centro del mapa a `p` una fracción `k` (0..1) del camino, sin animaciones que choquen con el dedo. */
  follow(p: GeoPoint, k = 1) {
    const c = this.map.getCenter();
    this.map.jumpTo({ center: [c.lng + (p.lon - c.lng) * k, c.lat + (p.lat - c.lat) * k] });
  }

  showPopup(p: GeoPoint, content: HTMLElement, onClose?: () => void): Popup {
    this.popup?.remove();
    const pop = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: "320px", offset: 14, anchor: "bottom", className: "tl-popup" })
      .setLngLat([p.lon, p.lat]).setDOMContent(content).addTo(this.map);
    pop.on("close", () => { if (this.popup === pop) this.popup = null; onClose?.(); });
    this.popup = pop;
    return pop;
  }
  closePopup() { this.popup?.remove(); this.popup = null; }
  showMe(p: GeoPoint) {
    if (!this.me) {
      const el = document.createElement("div");
      el.className = "me";
      this.me = new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(this.map);
    } else this.me.setLngLat([p.lon, p.lat]);
  }
  get zoom(): number { return this.map.getZoom(); }
  resize() { this.map.resize(); }
  destroy() { this.map.remove(); }
}
