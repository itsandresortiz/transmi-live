import maplibregl, { type ExpressionSpecification, type GeoJSONSource, type Map as MLMap, type Popup } from "maplibre-gl";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import type { GeoPoint, RouteShape, SystemType, TransitNetwork } from "@transmi/domain";
import { flowDash, trafficBand } from "@transmi/application";
import * as geo from "./geodata";
import { busSprite } from "./sprites";
import type { StationGeometry } from "./stations";
import { stationChipImage, trafficLightImage } from "./sprites";
import { type MapTheme, type Scheme, themeOf } from "./theme";

export interface MapEvents {
  onBusClick(id: string): void;
  onStopClick(id: string): void;
  onStationClick(index: number): void;
  /** Toque en la píldora de una estación de la troncal (vista media): abre la estación con todos sus vagones. */
  onGroupClick?(stopIds: string[]): void;
  onUserDrag?(): void;
  /** El dedo o el mouse está sobre el mapa (true) o se soltó (false). */
  onPointerHold?(hold: boolean): void;
  /** Toque en una parte vacía del mapa (no sobre un bus, parada ni estación). */
  onMapTap?(): void;
}
export interface LayerToggles { streets: boolean; stops: boolean; network: boolean; buses: boolean; signals: boolean; traffic: boolean }

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const FONT = ["Noto Sans Regular"];
const STREET_LAYERS = ["street-0", "street-2", "street-3", "street-4"];
const BUS_LAYERS = ["bus-dots", "bus-dots-minor"];
const BOGOTA: [number, number] = [-74.075, 4.65];

/** Las líneas de todas las rutas van tenues para que se lea la jerarquía de las calles; al elegir una ruta se resalta sola. */
const NETWORK_OPACITY = 0.2;
const TRONCAL_OPACITY = 0.85;
type RoadKey = "minor" | "tertiary" | "secondary" | "primary" | "trunk";
/** Ancho (px) de cada tipo de vía según el zoom. Las autopistas y avenidas se ven anchas, como en Google Maps. */
const ROAD_CLASSES: { id: string; key: RoadKey; filter: unknown[]; minzoom: number; casing: boolean; major: boolean; widths: [number, number][] }[] = [
  { id: "road-0", key: "minor", filter: ["<=", ["get", "c"], 1], minzoom: 12.5, casing: true, major: false, widths: [[12.5, 0.6], [14, 1.1], [15.5, 3], [17, 8], [19, 18]] },
  { id: "road-2", key: "tertiary", filter: ["==", ["get", "c"], 2], minzoom: 11.5, casing: true, major: false, widths: [[11.5, 0.5], [13, 1.4], [15, 4.5], [17, 10], [19, 22]] },
  { id: "road-3", key: "secondary", filter: ["==", ["get", "c"], 3], minzoom: 10.5, casing: true, major: false, widths: [[10.5, 0.6], [13, 2.2], [15, 6], [17, 13], [19, 28]] },
  { id: "road-4", key: "primary", filter: ["==", ["get", "c"], 4], minzoom: 9, casing: true, major: true, widths: [[9, 0.6], [12, 2.2], [14, 6], [16, 11], [18, 22], [19.5, 38]] },
  { id: "road-5", key: "trunk", filter: ["==", ["get", "c"], 5], minzoom: 8, casing: true, major: true, widths: [[8, 0.6], [12, 3], [14, 7.5], [16, 14], [18, 28], [19.5, 48]] },
];
/** Las paradas se dibujan a la derecha de la vía (donde para el bus), no en el eje. Ocho direcciones y un desplazamiento en píxeles según el zoom. */
const SECTORS = 8;
const SIDE_PX: [number, number][] = [[13.5, 0], [15, 2.5], [16, 4.2], [17, 7], [18, 11], [19, 16]];
const sideVec = (k: number): [number, number] => [Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)];
const sideExpr = (k: number): ExpressionSpecification => {
  const [ux, uy] = sideVec(k);
  return ["interpolate", ["linear"], ["zoom"], ...SIDE_PX.flatMap(([z, px]) => [z, ["literal", [Math.round(ux * px * 100) / 100, Math.round(uy * px * 100) / 100]]])] as unknown as ExpressionSpecification;
};
/** Desplazamiento en pantalla (px) de una parada con dirección `k` al zoom `z` y giro `bearing` del mapa. */
function sideScreen(k: number, z: number, bearing: number): [number, number] {
  let px = SIDE_PX[SIDE_PX.length - 1]![1];
  for (let i = 1; i < SIDE_PX.length; i++) if (z <= SIDE_PX[i]![0]) { const [z0, p0] = SIDE_PX[i - 1]!, [z1, p1] = SIDE_PX[i]!; px = z <= z0 ? p0 : p0 + ((p1 - p0) * (z - z0)) / (z1 - z0); break; }
  const [ux, uy] = sideVec(k), a = (-bearing * Math.PI) / 180;      // el desplazamiento «de mapa» gira con el mapa
  return [(ux * Math.cos(a) - uy * Math.sin(a)) * px, (ux * Math.sin(a) + uy * Math.cos(a)) * px];
}
const sidedIds = (id: string) => [id, ...Array.from({ length: SECTORS }, (_, k) => `${id}-${k}`)];
const casingWidth = (z: number) => (z < 12 ? 0.4 : z < 16 ? 0.4 + (z - 12) * 0.2 : 1.2 + Math.min(z - 16, 3) * 0.25);

/** Color según la línea de la troncal (propiedad `l` de cada elemento). */
const lineMatch = (t: MapTheme, fallback: string): ExpressionSpecification =>
  ["match", ["get", "l"], ...Object.entries(t.lines).flat(), fallback] as unknown as ExpressionSpecification;

const zoomWidth = (...pairs: [number, number][]): ExpressionSpecification =>
  ["interpolate", ["linear"], ["zoom"], ...pairs.flat()] as ExpressionSpecification;

/** Envuelve MapLibre: arma las capas del mapa de Bogotá y expone operaciones en el lenguaje de la aplicación. */
export class MapController {
  readonly map: MLMap;
  readonly ready: Promise<void>;
  private theme: MapTheme;
  private scheme: Scheme;
  private popup: Popup | null = null;
  private me: maplibregl.Marker | null = null;
  private networkLoaded = false;
  /** Lo asigna quien dibuja los buses en canvas: devuelve el bus bajo ese punto de la pantalla. */
  busHit: ((pt: { x: number; y: number }) => string | null) | null = null;

  constructor(container: HTMLElement, scheme: Scheme, private readonly events: MapEvents) {
    this.theme = themeOf(scheme); this.scheme = scheme;
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
      attributionControl: false, dragRotate: true, pitchWithRotate: false, maxPitch: 0,
      fadeDuration: 0, renderWorldCopies: false,
      // los rangos de tipografía que no incluimos (otros alfabetos) se resuelven en vacío, sin error
      transformRequest: (url, type) =>
        type === "Glyphs" && !/\/(0-255|256-511)\.pbf$/.test(url) ? { url: emptyGlyph } : undefined,
    });
    this.map.on("rotate", () => { if (this.meHeading != null) this.me?.getElement().style.setProperty("--h", `${this.meHeading - this.map.getBearing()}deg`); });
    this.map.touchZoomRotate.enableRotation();      // dos dedos giran el mapa (clic derecho + arrastrar en el computador)
    this.map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "© OpenStreetMap · TransMilenio · Bogotá" }), "bottom-right");
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    this.ready = new Promise((res) => this.map.once("load", () => { this.addLayers(); this.bindEvents(); void this.loadStatic(); res(); }));
  }

  /** Una capa de círculos y sus 8 variantes, cada una desplazada hacia el lado derecho de la vía en una dirección distinta. */
  private addSided(def: { id: string; source: string; minzoom?: number; paint: Record<string, unknown> }) {
    const base = { type: "circle", source: def.source, ...(def.minzoom != null ? { minzoom: def.minzoom } : {}) } as const;
    this.map.addLayer({ ...base, id: def.id, filter: ["!", ["has", "k"]], paint: def.paint } as never);
    for (let k = 0; k < SECTORS; k++)
      this.map.addLayer({ ...base, id: `${def.id}-${k}`, filter: ["==", ["get", "k"], k], paint: { ...def.paint, "circle-translate": sideExpr(k), "circle-translate-anchor": "map" } } as never);
  }
  /** Dirección (0-7) hacia donde se corre cada parada para quedar a la derecha de la vía. */
  private stopSector = new Map<string, number>();

  /* ---------- capas ---------- */
  private src(id: string, data: FeatureCollection = EMPTY, extra: Record<string, unknown> = {}) {
    this.map.addSource(id, { type: "geojson", data, ...extra });
  }

  private addLayers() {
    this.registerChip();
    const m = this.map, t = this.theme;
    this.src("localidades"); this.src("localidad-labels"); this.src("roads"); this.src("troncales");
    this.src("network"); this.src("street-labels"); this.src("estaciones"); this.src("stops");
    this.src("route-sel"); this.src("route-stops"); this.src("alert-stops"); this.src("buses"); this.src("stop-focus"); this.src("station-bases"); this.src("station-links"); this.src("station-capsules"); this.src("station-doors"); this.src("station-labels"); this.src("station-chips"); this.src("semaforos"); this.src("trafico"); this.src("network-portal"); this.src("trip-lines"); this.src("trip-pts");
    if (!m.hasImage("semaforo")) m.addImage("semaforo", trafficLightImage(), { pixelRatio: 2 });

    m.addLayer({ id: "localidades-fill", type: "fill", source: "localidades", paint: { "fill-color": t.land } });
    m.addLayer({ id: "localidades-line", type: "line", source: "localidades", paint: { "line-color": t.landLine, "line-width": 1.2 } });

    const lineLayout = { "line-cap": "round", "line-join": "round" } as const;
    // calles como en los mapas modernos: primero todos los bordes (de menor a mayor) y luego los rellenos, para que se unan limpiamente
    for (const cl of ROAD_CLASSES) if (cl.casing) m.addLayer({
      id: `${cl.id}-casing`, type: "line", source: "roads", minzoom: cl.minzoom, filter: cl.filter as never, layout: lineLayout,
      paint: { "line-color": cl.major ? t.roads.casingMajor : t.roads.casing, "line-width": ["interpolate", ["linear"], ["zoom"], ...cl.widths.flatMap(([z, w]) => [z, w + 2 * casingWidth(z)])] as never },
    });
    for (const cl of ROAD_CLASSES) m.addLayer({
      id: `${cl.id}-fill`, type: "line", source: "roads", minzoom: cl.minzoom, filter: cl.filter as never, layout: lineLayout,
      paint: { "line-color": t.roads[cl.key], "line-width": ["interpolate", ["linear"], ["zoom"], ...cl.widths.flat()] as never },
    });
    m.addLayer({
      id: "network-lines", type: "line", source: "network", minzoom: 9, layout: lineLayout,
      paint: { "line-color": ["get", "color"], "line-opacity": NETWORK_OPACITY, "line-width": zoomWidth([9, 0.5], [14, 1.3], [18, 2.6]) },
    });
    // dentro de los portales las rutas se ven siempre, en gris, aunque la capa «Líneas de rutas» esté apagada
    m.addLayer({
      id: "network-portal", type: "line", source: "network-portal", minzoom: 14.5, layout: lineLayout,
      paint: { "line-color": this.scheme === "dark" ? "#7d889c" : "#8c96a8", "line-opacity": 0.6, "line-width": zoomWidth([14.5, 0.8], [17, 1.8], [19, 3.2]) },
    });
    m.addLayer({
      id: "troncales-lines", type: "line", source: "troncales", layout: lineLayout,
      paint: { "line-color": lineMatch(t, t.troncal), "line-opacity": 0.9, "line-width": zoomWidth([9, 1.5], [14, 3.4], [18, 6]) },
    });
    m.addLayer({
      id: "route-sel-line", type: "line", source: "route-sel", layout: lineLayout,
      paint: {
        "line-color": ["get", "color"], "line-opacity": ["case", ["get", "on"], 0.95, 0.35],
        "line-width": ["interpolate", ["linear"], ["zoom"], 9, ["case", ["get", "on"], 2.5, 2], 14, ["case", ["get", "on"], 5, 3], 18, ["case", ["get", "on"], 9, 4]] as unknown as number,
      },
    });
    // viaje planeado: caminatas punteadas, tramos en bus con el color de la ruta
    m.addLayer({ id: "trip-casing", type: "line", source: "trip-lines", filter: ["==", ["get", "k"], "ride"], layout: lineLayout,
      paint: { "line-color": "#ffffff", "line-opacity": 0.95, "line-width": zoomWidth([9, 5], [14, 9], [18, 15]) } });
    m.addLayer({ id: "trip-ride", type: "line", source: "trip-lines", filter: ["==", ["get", "k"], "ride"], layout: lineLayout,
      paint: { "line-color": ["get", "color"], "line-width": zoomWidth([9, 3], [14, 5.5], [18, 9]) } });
    m.addLayer({ id: "trip-walk", type: "line", source: "trip-lines", filter: ["==", ["get", "k"], "walk"], layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": t.label, "line-width": zoomWidth([9, 2], [14, 3], [18, 4.5]), "line-dasharray": [0.1, 2.2] } });
    m.addLayer({ id: "trip-pts", type: "circle", source: "trip-pts",
      paint: { "circle-radius": ["match", ["get", "k"], "origin", 8, "dest", 9, 5.5], "circle-color": ["match", ["get", "k"], "origin", "#1f6fd1", "dest", "#e11d2e", "#ffffff"],
        "circle-stroke-color": ["match", ["get", "k"], "stop", ["get", "color"], "#ffffff"], "circle-stroke-width": ["match", ["get", "k"], "stop", 3, 3] } });
    m.addLayer({ id: "trip-labels", type: "symbol", source: "trip-pts", filter: ["!=", ["get", "k"], "stop"],
      layout: { "text-field": ["get", "name"], "text-font": FONT, "text-size": 12.5, "text-offset": [0, 1.2], "text-anchor": "top", "text-max-width": 11, "text-optional": true },
      paint: { "text-color": t.labelStrong, "text-halo-color": t.halo, "text-halo-width": 1.6 } });

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
      paint: { "circle-radius": zoomWidth([11, 2], [15, 4.2], [18, 6]), "circle-color": t.surface, "circle-stroke-color": lineMatch(t, t.troncal), "circle-stroke-width": 2 },
    });
    // portales y estaciones que no se dibujan completas: puntico con su nombre (como antes)
    m.addLayer({
      id: "estaciones-labels", type: "symbol", source: "estaciones", minzoom: 13.5, filter: ["!=", ["get", "portal"], true],
      layout: { "text-field": ["get", "name"], "text-font": FONT, "text-size": ["interpolate", ["linear"], ["zoom"], 13.5, 10.5, 17, 12.5], "text-offset": [0, 1.1], "text-anchor": "top", "text-optional": true },
      paint: { "text-color": lineMatch(t, t.troncal), "text-halo-color": t.halo, "text-halo-width": 1.8 },
    });
    // estaciones de la troncal: la estación completa (base), sus vagones (cápsulas, con puertas y número) y su nombre
    m.addLayer({ id: "station-base-fill", type: "fill", source: "station-bases", minzoom: 14.5, paint: { "fill-color": t.stationBase, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 14.5, 0.9, 17, 0.8] } });
    m.addLayer({ id: "station-base-line", type: "line", source: "station-bases", minzoom: 14.5, paint: { "line-color": lineMatch(t, t.stationEdge), "line-width": ["interpolate", ["linear"], ["zoom"], 14.5, 1.4, 18, 2.6] } });
    m.addLayer({ id: "station-links-fill", type: "fill", source: "station-links", minzoom: 15.6, paint: { "fill-color": t.stationLink } });
    m.addLayer({ id: "station-links-line", type: "line", source: "station-links", minzoom: 15.6, paint: { "line-color": lineMatch(t, t.capsuleEdge), "line-width": 1, "line-opacity": 0.75 } });
    m.addLayer({
      id: "station-capsule-fill", type: "fill", source: "station-capsules", minzoom: 15.6,
      paint: { "fill-color": ["case", ["==", ["get", "sel"], true], lineMatch(t, t.troncal), ["==", ["get", "hl"], true], ["get", "hlColor"], t.capsule], "fill-opacity": 0.98 },
    });
    m.addLayer({
      id: "station-capsule-line", type: "line", source: "station-capsules", minzoom: 15.6,
      paint: { "line-color": ["case", ["==", ["get", "hl"], true], ["get", "hlColor"], lineMatch(t, t.capsuleEdge)], "line-width": ["case", ["==", ["get", "sel"], true], 3, 1.8] },
    });
    m.addLayer({ id: "station-doors", type: "line", source: "station-doors", minzoom: 17, paint: { "line-color": t.capsuleEdge, "line-width": 1, "line-opacity": 0.55 } });
    m.addLayer({
      id: "station-capsule-labels", type: "symbol", source: "station-labels", minzoom: 16.3,
      layout: { "text-field": ["step", ["zoom"], ["get", "text"], 17.3, ["concat", "Vagón ", ["get", "text"]]], "text-font": FONT, "text-size": ["interpolate", ["linear"], ["zoom"], 16.3, 10, 18.5, 13], "text-allow-overlap": true, "text-ignore-placement": true },
      paint: { "text-color": ["case", ["any", ["==", ["get", "sel"], true], ["==", ["get", "hl"], true]], "#ffffff", t.labelStrong] },
    });
    m.addLayer({
      id: "station-chips", type: "symbol", source: "station-chips", minzoom: 14.5,
      layout: {
        "icon-image": this.chipImage(), "icon-text-fit": "both", "icon-text-fit-padding": [3, 6, 3, 3], "icon-allow-overlap": false,
        "text-field": ["get", "title"], "text-font": FONT, "text-size": ["interpolate", ["linear"], ["zoom"], 14.5, 11, 18, 14],
        "text-anchor": "bottom", "text-offset": [0, -0.45], "text-optional": false, "text-max-width": 14,
      },
      paint: { "text-color": t.labelStrong },
    });
    m.addLayer({
      id: "trafico-casing", type: "line", source: "trafico", minzoom: 11.5, layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#ffffff", "line-opacity": 0.55, "line-width": zoomWidth([11.5, 3], [16, 7.5], [18.5, 12]) },
    });
    m.addLayer({
      id: "trafico-lines", type: "line", source: "trafico", minzoom: 11.5, layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ["match", ["get", "b"], 0, "#e5484d", 1, "#f08a24", 2, "#f5c518", "#2fbf71"], "line-opacity": 0.92, "line-width": zoomWidth([11.5, 1.8], [16, 5], [18.5, 8.5]) },
    });
    // rayitas que avanzan sobre cada tramo, en el sentido de la marcha: rápidas donde fluye, casi quietas donde hay trancón
    for (let b = 0; b < 4; b++) m.addLayer({
      id: `trafico-flow-${b}`, type: "line", source: "trafico", minzoom: 12.5, filter: ["==", ["get", "b"], b], layout: { "line-cap": "butt", "line-join": "round" },
      paint: { "line-color": "#ffffff", "line-opacity": b === 0 ? 0.65 : 0.88, "line-width": zoomWidth([12.5, 0.9], [16, 2.6], [18.5, 4.6]), "line-dasharray": [1.5, 4.5] },
    });
    m.addLayer({
      id: "semaforos-dots", type: "circle", source: "semaforos", minzoom: 13.2, maxzoom: 15.4,
      paint: { "circle-radius": zoomWidth([13.2, 1.6], [15.4, 3.2]), "circle-color": "#e8503f", "circle-stroke-color": "#ffffff", "circle-stroke-width": 1 },
    });
    m.addLayer({
      id: "semaforos-icons", type: "symbol", source: "semaforos", minzoom: 15.4,
      layout: { "icon-image": "semaforo", "icon-size": ["interpolate", ["linear"], ["zoom"], 15.4, 0.55, 18, 0.95], "icon-allow-overlap": true, "icon-ignore-placement": true },
    });
    m.addLayer({
      id: "semaforos-labels", type: "symbol", source: "semaforos", minzoom: 17.2,
      layout: { "text-field": ["get", "dir"], "text-font": FONT, "text-size": 10.5, "text-offset": [0, 1.35], "text-anchor": "top", "text-optional": true },
      paint: { "text-color": t.label, "text-halo-color": t.halo, "text-halo-width": 1.2 },
    });
    m.addLayer({
      id: "portal-chips", type: "symbol", source: "estaciones", minzoom: 12.5, filter: ["==", ["get", "portal"], true],
      layout: {
        "icon-image": this.portalImage(), "icon-text-fit": "both", "icon-text-fit-padding": [3, 8, 3, 3], "icon-allow-overlap": false,
        "text-field": ["get", "name"], "text-font": FONT, "text-size": ["interpolate", ["linear"], ["zoom"], 12.5, 11, 18, 14.5],
        "text-anchor": "bottom", "text-offset": [0, -0.45], "text-optional": false, "text-max-width": 14, "symbol-sort-key": 0,
      },
      paint: { "text-color": t.labelStrong },
    });
    this.addSided({ id: "stops-circles", source: "stops", minzoom: 13.5,
      paint: { "circle-radius": zoomWidth([13.5, 2.2], [17, 4]), "circle-color": t.surface, "circle-stroke-color": t.label, "circle-stroke-width": 1 } });
    this.addSided({ id: "route-stops", source: "route-stops",
      paint: { "circle-radius": zoomWidth([10, 3], [15, 5.5], [18, 8]), "circle-color": t.surface, "circle-stroke-color": ["get", "color"], "circle-stroke-width": 2.5 } });
    m.addLayer({
      id: "alert-stops", type: "circle", source: "alert-stops",
      paint: { "circle-radius": 9, "circle-color": "#f59e0b", "circle-opacity": 0.4, "circle-stroke-color": "#f59e0b", "circle-stroke-width": 2.5 },
    });

    this.addSided({ id: "stop-focus-halo", source: "stop-focus", paint: { "circle-radius": 22, "circle-color": ["get", "color"], "circle-opacity": 0.2 } });
    this.addSided({ id: "stop-focus-dot", source: "stop-focus", paint: { "circle-radius": 8, "circle-color": ["get", "color"], "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 } });
    // vista de toda la ciudad: la columna vertebral (troncal y dual) siempre; zonales y alimentadores solo al acercarse, para que el mapa respire
    m.addLayer({
      id: "bus-dots-minor", type: "circle", source: "buses", minzoom: 11.8, maxzoom: 13, filter: ["==", ["get", "m"], 0],
      paint: { "circle-radius": zoomWidth([11.8, 1.7], [13, 3.4]), "circle-color": ["get", "color"], "circle-opacity": ["*", 0.85, ["coalesce", ["get", "o"], 1]], "circle-stroke-color": "#ffffff", "circle-stroke-width": 0.8, "circle-stroke-opacity": ["coalesce", ["get", "o"], 1] },
    });
    m.addLayer({
      id: "bus-dots", type: "circle", source: "buses", maxzoom: 13, filter: ["==", ["get", "m"], 1],
      paint: { "circle-radius": zoomWidth([9, 2.6], [13, 4.4]), "circle-color": ["get", "color"], "circle-opacity": ["coalesce", ["get", "o"], 1], "circle-stroke-color": "#ffffff", "circle-stroke-width": 1, "circle-stroke-opacity": ["coalesce", ["get", "o"], 1] },
    });
  }

  /** Datos que vienen incluidos en la app: se cargan en segundo plano. */
  private async loadStatic() {
    const set = (id: string, data: FeatureCollection) => (this.map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
    const [loc, tron, est] = await Promise.all([geo.loadLocalidades(), geo.loadTroncales(), geo.loadEstaciones()]);
    set("localidades", geo.localidadPolygons(loc)); set("localidad-labels", geo.localidadLabels(loc));
    set("troncales", geo.troncalLines(tron));
    this.estacionesAll = geo.estacionPoints(est); this.applyEstaciones(); this.rebuildPortalLines();
    set("roads", await geo.loadRoads());
    set("street-labels", await geo.loadStreetLabels());
  }

  private bindEvents() {
    const m = this.map;
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
    // Un solo manejador de toques, con tolerancia para el dedo: primero el bus que se toca (dibujado encima de todo);
    // si no, la parada o estación más cercana dentro de ~14 px; si no hay nada, es un toque al mapa vacío.
    const TOUCH_PAD = 14;
    type Hit = { kind: "bus" | "stop" | "station" | "group"; id: string | number };
    const pick = (pt: { x: number; y: number }): Hit | null => {
      const bus = this.busHit?.(pt);
      if (bus) return { kind: "bus", id: bus };
      const layers = [...sidedIds("route-stops"), "station-capsule-fill", "station-base-fill", ...sidedIds("stops-circles"), "estaciones-circles", "bus-dots", "bus-dots-minor"].filter((l) => m.getLayer(l));
      const feats = m.queryRenderedFeatures([[pt.x - TOUCH_PAD, pt.y - TOUCH_PAD], [pt.x + TOUCH_PAD, pt.y + TOUCH_PAD]], { layers });
      let best: Hit | null = null, bd = Infinity;
      for (const f of feats) {
        let lon: number, lat: number;
        if (f.geometry.type === "Point") [lon, lat] = f.geometry.coordinates as [number, number];
        else if (f.geometry.type === "Polygon") {                       // vagón o píldora: se mide al centro del dibujo
          const ring = f.geometry.coordinates[0]!.slice(0, -1);
          lon = ring.reduce((a, c) => a + c[0]!, 0) / ring.length; lat = ring.reduce((a, c) => a + c[1]!, 0) / ring.length;
        } else continue;
        const q = m.project([lon, lat]);
        const kk = f.properties?.k;
        if ((f.layer.id.startsWith("route-stops") || f.layer.id.startsWith("stops-circles")) && typeof kk === "number") { const [ox, oy] = sideScreen(kk, m.getZoom(), m.getBearing()); q.x += ox; q.y += oy; }   // el punto está dibujado a un lado de la vía
        // a igual distancia gana la parada de una ruta resaltada, luego la parada, luego la estación
        const rank = f.layer.id.startsWith("route-stops") ? 0 : f.layer.id.startsWith("stops-circles") ? 1 : f.layer.id === "station-capsule-fill" ? 5 : f.layer.id === "station-base-fill" ? 8 : 2;
        const d = Math.hypot(q.x - pt.x, q.y - pt.y) + rank * 3;
        if (d >= bd) continue;
        if (f.layer.id.startsWith("bus-dots")) { bd = d; best = { kind: "bus", id: String(f.properties?.id) }; }
        else if (f.layer.id === "station-capsule-fill" || f.layer.id === "station-base-fill") { bd = d; best = { kind: "group", id: String(f.properties?.all) }; }
        else if (f.layer.id === "estaciones-circles") { if (typeof f.id === "number") { bd = d; best = { kind: "station", id: f.id }; } }
        else { bd = d; best = { kind: "stop", id: String(f.properties?.id) }; }
      }
      return best;
    };
    m.on("click", (e) => {
      if (this.pickHandler) { const h = this.pickHandler; this.pickHandler = null; h({ lat: e.lngLat.lat, lon: e.lngLat.lng }); return; }
      const hit = pick(e.point);
      if (!hit) { this.events.onMapTap?.(); return; }
      if (hit.kind === "bus") this.events.onBusClick(String(hit.id));
      else if (hit.kind === "stop") this.events.onStopClick(String(hit.id));
      else if (hit.kind === "group") this.events.onGroupClick?.(String(hit.id).split(","));
      else this.events.onStationClick(Number(hit.id));
    });
    m.on("mousemove", (e) => { m.getCanvas().style.cursor = pick(e.point) ? "pointer" : ""; });
  }

  /* ---------- operaciones ---------- */
  setScheme(scheme: Scheme) {
    this.theme = themeOf(scheme); this.scheme = scheme;
    const t = this.theme, m = this.map;
    if (!m.getLayer("bg")) return;
    m.setPaintProperty("bg", "background-color", t.mapbg);
    m.setPaintProperty("localidades-fill", "fill-color", t.land);
    m.setPaintProperty("localidades-line", "line-color", t.landLine);
    for (const cl of ROAD_CLASSES) {
      m.setPaintProperty(`${cl.id}-fill`, "line-color", t.roads[cl.key]);
      if (cl.casing) m.setPaintProperty(`${cl.id}-casing`, "line-color", cl.major ? t.roads.casingMajor : t.roads.casing);
    }
    m.setPaintProperty("troncales-lines", "line-color", lineMatch(t, t.troncal));
    m.setPaintProperty("localidad-names", "text-color", t.label);
    m.setPaintProperty("localidad-names", "text-halo-color", t.land);
    for (const id of STREET_LAYERS) { m.setPaintProperty(id, "text-color", t.label); m.setPaintProperty(id, "text-halo-color", t.halo); }
    m.setPaintProperty("estaciones-circles", "circle-color", t.surface);
    m.setPaintProperty("estaciones-circles", "circle-stroke-color", lineMatch(t, t.troncal));
    m.setPaintProperty("estaciones-labels", "text-color", lineMatch(t, t.troncal));
    m.setPaintProperty("estaciones-labels", "text-halo-color", t.halo);
    m.setPaintProperty("station-base-fill", "fill-color", t.stationBase);
    m.setPaintProperty("station-base-line", "line-color", lineMatch(t, t.stationEdge));
    m.setPaintProperty("station-capsule-fill", "fill-color", ["case", ["==", ["get", "sel"], true], lineMatch(t, t.troncal), ["==", ["get", "hl"], true], ["get", "hlColor"], t.capsule]);
    m.setPaintProperty("station-capsule-line", "line-color", ["case", ["==", ["get", "hl"], true], ["get", "hlColor"], lineMatch(t, t.capsuleEdge)]);
    m.setPaintProperty("station-doors", "line-color", t.capsuleEdge);
    m.setPaintProperty("station-links-fill", "fill-color", t.stationLink);
    m.setPaintProperty("station-links-line", "line-color", lineMatch(t, t.capsuleEdge));
    m.setPaintProperty("station-capsule-labels", "text-color", ["case", ["any", ["==", ["get", "sel"], true], ["==", ["get", "hl"], true]], "#ffffff", t.labelStrong]);
    m.setPaintProperty("station-chips", "text-color", t.labelStrong);
    m.setPaintProperty("portal-chips", "text-color", t.labelStrong);
    this.registerChip();
    m.setLayoutProperty("station-chips", "icon-image", this.chipImage());
    m.setLayoutProperty("portal-chips", "icon-image", this.portalImage());
    m.setPaintProperty("network-portal", "line-color", this.scheme === "dark" ? "#7d889c" : "#8c96a8");
    for (const id of sidedIds("stops-circles")) { m.setPaintProperty(id, "circle-color", t.surface); m.setPaintProperty(id, "circle-stroke-color", t.label); }
    for (const id of sidedIds("route-stops")) m.setPaintProperty(id, "circle-color", t.surface);
  }

  setToggles(t: LayerToggles) {
    const m = this.map;
    const vis = (ids: string[], on: boolean) => ids.forEach((id) => m.getLayer(id) && m.setLayoutProperty(id, "visibility", on ? "visible" : "none"));
    vis(STREET_LAYERS, t.streets); vis([...sidedIds("stops-circles"), "station-base-fill", "station-base-line", "station-links-fill", "station-links-line", "station-capsule-fill", "station-capsule-line", "station-doors", "station-capsule-labels", "station-chips", "portal-chips"], t.stops); vis(["network-lines"], t.network); vis(["network-portal"], t.stops && !t.network); vis(["trafico-casing", "trafico-lines", "trafico-flow-0", "trafico-flow-1", "trafico-flow-2", "trafico-flow-3"], t.traffic); this.setFlow(t.traffic); vis(["semaforos-dots", "semaforos-icons", "semaforos-labels"], t.signals); vis(BUS_LAYERS, t.buses);
  }

  /** Velocidad de los buses en las calles (cada tramo con su banda de color). */
  setTraffic(segs: readonly { a: GeoPoint; b: GeoPoint; speed: number; line?: GeoPoint[] }[]) {
    (this.map.getSource("trafico") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: segs.map((x) => ({ type: "Feature", properties: { b: trafficBand(x.speed) }, geometry: { type: "LineString", coordinates: (x.line ?? [x.a, x.b]).map((p) => [p.lon, p.lat]) } })),
    });
  }
  /* ---------- animación del tráfico ---------- */
  private flowRaf = 0;
  /** Ciclos por segundo y cuadros por segundo de cada banda (0 = casi detenido … 3 = fluido). */
  private static readonly FLOW: { cycles: number; fps: number }[] = [{ cycles: 0.12, fps: 5 }, { cycles: 0.4, fps: 8 }, { cycles: 0.8, fps: 12 }, { cycles: 1.3, fps: 15 }];
  private static readonly DASH = 1.5; private static readonly GAP = 4.5;
  /** Arreglo de rayas del patrón «raya + hueco» visto desde la fase `phase` (en anchos de línea): al bajar la fase las rayas avanzan por la línea. */
  static dashAt(phase: number): number[] {
    return flowDash(phase);      // la cuenta vive en @transmi/application (la comparte la app)
  }
  private setFlow(on: boolean) {
    if (on === (this.flowRaf !== 0)) return;
    if (!on) { cancelAnimationFrame(this.flowRaf); this.flowRaf = 0; return; }
    if (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches) return;    // sin animación si el aparato pide menos movimiento
    const last = [0, 0, 0, 0], P = MapController.DASH + MapController.GAP;
    const tick = (t: number) => {
      this.flowRaf = requestAnimationFrame(tick);
      if (this.map.getZoom() < 12.5) return;
      for (let b = 0; b < 4; b++) {
        const f = MapController.FLOW[b]!;
        if (t - last[b]! < 1000 / f.fps) continue;
        last[b] = t;
        const phase = P - (((t / 1000) * f.cycles) % 1) * P;
        const id = `trafico-flow-${b}`;
        if (this.map.getLayer(id)) this.map.setPaintProperty(id, "line-dasharray", MapController.dashAt(phase));
      }
    };
    this.flowRaf = requestAnimationFrame(tick);
  }
  private signalsLoaded = false;
  /** Pone los semáforos en el mapa (se llama la primera vez que el usuario enciende la capa). */
  setSignals(rows: readonly (readonly [number, number, string, string, string])[]) {
    this.signalsLoaded = true;
    (this.map.getSource("semaforos") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: rows.map((r) => ({ type: "Feature", properties: { dir: r[2], loc: r[3], tipo: r[4] }, geometry: { type: "Point", coordinates: [r[0], r[1]] } })),
    });
  }
  get hasSignals(): boolean { return this.signalsLoaded; }

  private stationBase: StationGeometry | null = null;
  private estacionesAll: FeatureCollection<Point> | null = null;
  /** Los puniticos de estaciones del archivo propio se ocultan donde ya se dibuja la estación completa (a menos de 250 m de un vagón). */
  private applyEstaciones() {
    const all = this.estacionesAll; if (!all) return;
    const centers = this.stationBase?.labels.features.map((f) => f.geometry.coordinates as [number, number]) ?? [];
    const near = (lon: number, lat: number) => centers.some(([x, y]) => Math.abs(y - lat) < 0.0023 && Math.abs(x - lon) < 0.0023 && Math.hypot((y - lat) * 111_000, (x - lon) * 110_000) < 250);
    const features = all.features.filter((f) => { const [lon, lat] = f.geometry.coordinates as [number, number]; return !near(lon, lat); });
    (this.map.getSource("estaciones") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features });
  }
  private stationState = { hl: new Set<string>(), color: "#e11d2e", sel: null as string | null };

  private portalImage(): ExpressionSpecification {
    return ["concat", "portal-chip-", ["get", "l"], this.scheme === "dark" ? "-dark" : "-light"] as unknown as ExpressionSpecification;
  }
  private chipImage(): ExpressionSpecification {
    return ["concat", "station-chip-", ["get", "l"], this.scheme === "dark" ? "-dark" : "-light"] as unknown as ExpressionSpecification;
  }
  /** La etiqueta de cada estación: un fondo que se estira según el nombre, con el ícono de bus en el color de su línea. */
  private registerChip() {
    const colors: Record<string, string> = { ...this.theme.lines, X: this.theme.troncal };
    for (const [letter, color] of Object.entries(colors))
      for (const dark of [false, true]) {
        const name = `station-chip-${letter}${dark ? "-dark" : "-light"}`;
        if (this.map.hasImage(name)) this.map.removeImage(name);
        const { image, options } = stationChipImage(dark, color);
        this.map.addImage(name, image, options);
        const pname = `portal-chip-${letter}${dark ? "-dark" : "-light"}`;
        if (this.map.hasImage(pname)) this.map.removeImage(pname);
        const pc = stationChipImage(dark, color, true);
        this.map.addImage(pname, pc.image, pc.options);
      }
  }

  /** Dibuja las estaciones de la troncal. */
  setStations(g: StationGeometry) {
    this.stationBase = g;
    this.applyEstaciones();
    (this.map.getSource("station-bases") as GeoJSONSource | undefined)?.setData(g.bases);
    (this.map.getSource("station-doors") as GeoJSONSource | undefined)?.setData(g.doors);
    (this.map.getSource("station-links") as GeoJSONSource | undefined)?.setData(g.links);
    (this.map.getSource("station-chips") as GeoJSONSource | undefined)?.setData(g.chips);
    this.paintStations();
  }
  /** Ilumina los vagones donde se detiene la ruta elegida y marca el vagón de la parada abierta. */
  setStationState(hl: ReadonlySet<string>, color: string, sel: string | null) {
    this.stationState = { hl: new Set(hl), color, sel };
    this.paintStations();
  }
  private paintStations() {
    const g = this.stationBase; if (!g) return;
    const { hl, color, sel } = this.stationState;
    const mark = <T extends { properties: Record<string, unknown> | null }>(f: T): T => {
      const ids = String(f.properties?.ids ?? "").split(",");
      return { ...f, properties: { ...f.properties, hl: ids.some((i) => hl.has(i)), hlColor: color, sel: sel != null && ids.includes(sel) } };
    };
    (this.map.getSource("station-capsules") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: g.capsules.features.map(mark) });
    (this.map.getSource("station-labels") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: g.labels.features.map(mark) });
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
    this.computeSectors(net);
    this.netRef = net; this.rebuildPortalLines();
    const stops: Feature<Point>[] = [];
    // el GTFS trae un registro «de la estación» en medio de cada estación o portal, sin rutas: no es una parada real y no se dibuja
    const served = new Set<string>();
    for (const shapes of net.shapes.values()) for (const sh of shapes) for (const id of sh.stopIds) served.add(id);
    for (const s of net.stops.values()) {
      if (!served.has(s.id)) continue;
      const k = this.stopSector.get(s.id);
      stops.push({ type: "Feature", properties: k == null ? { id: s.id } : { id: s.id, k }, geometry: { type: "Point", coordinates: [s.position.lon, s.position.lat] } });
    }
    (this.map.getSource("stops") as GeoJSONSource).setData({ type: "FeatureCollection", features: stops });
    this.networkLoaded = true;
  }
  private netRef: TransitNetwork | null = null;
  /** Centros de los portales (de estaciones.json): lon, lat. */
  private portalCenters(): [number, number][] {
    const out: [number, number][] = [], seen = new Set<string>();
    for (const f of this.estacionesAll?.features ?? []) {
      if (f.properties?.portal !== true) continue;
      const [lon, lat] = f.geometry.coordinates as [number, number], key = `${lon.toFixed(3)},${lat.toFixed(3)}`;
      if (!seen.has(key)) { seen.add(key); out.push([lon, lat]); }
    }
    return out;
  }
  /** Los tramos de las rutas que quedan a menos de ~300 m de un portal: ahí se dibujan siempre, en gris. */
  private rebuildPortalLines() {
    const net = this.netRef, portals = this.portalCenters(), src = this.map.getSource("network-portal") as GeoJSONSource | undefined;
    if (!net || !portals.length || !src) return;
    const R = 300, kx = 111_320 * Math.cos((4.65 * Math.PI) / 180), ky = 110_540;
    const inside = (lon: number, lat: number) => {
      for (const [plon, plat] of portals) {
        const dy = (lat - plat) * ky; if (Math.abs(dy) > R) continue;
        const dx = (lon - plon) * kx; if (Math.abs(dx) > R) continue;
        if (dx * dx + dy * dy <= R * R) return true;
      }
      return false;
    };
    const feats: Feature<LineString>[] = [], seen = new Set<string>();
    for (const shapes of net.shapes.values()) for (const sh of shapes) {
      let run: [number, number][] = [];
      const flush = () => {
        if (run.length > 1) {
          const k = `${run.length}|${run[0]![0].toFixed(5)},${run[0]![1].toFixed(5)}|${run[run.length - 1]![0].toFixed(5)},${run[run.length - 1]![1].toFixed(5)}`;
          if (!seen.has(k)) { seen.add(k); feats.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: run } }); }
        }
        run = [];
      };
      for (const p of sh.points) { if (inside(p.lon, p.lat)) run.push([p.lon, p.lat]); else flush(); }
      flush();
    }
    src.setData({ type: "FeatureCollection", features: feats });
  }

  /** Para cada parada, hacia dónde queda la derecha de la vía según el sentido de la primera ruta que pasa por ella. */
  private computeSectors(net: TransitNetwork) {
    this.stopSector = new Map();
    for (const shapes of net.shapes.values()) for (const sh of shapes) {
      const pts = sh.points; if (pts.length < 2) continue;
      let ptr = 0;
      for (const id of sh.stopIds) {
        if (this.stopSector.has(id)) continue;
        const st = net.stops.get(id); if (!st) continue;
        // los puntos del recorrido y las paradas van en el mismo orden: se avanza sin volver atrás
        let best = ptr, bd = Infinity;
        for (let i = ptr; i < Math.min(pts.length, ptr + 400); i++) {
          const d = (pts[i]!.lon - st.position.lon) ** 2 + (pts[i]!.lat - st.position.lat) ** 2;
          if (d < bd) { bd = d; best = i; }
        }
        ptr = best;
        const a = pts[Math.max(0, best - 2)]!, b = pts[Math.min(pts.length - 1, best + 2)]!;
        const dx = (b.lon - a.lon) * 0.997, dy = -(b.lat - a.lat);          // x al este, y hacia abajo (pantalla)
        if (Math.hypot(dx, dy) < 1e-7) continue;
        const nx = -dy, ny = dx;                                             // derecha de la marcha
        this.stopSector.set(id, ((Math.round(Math.atan2(ny, nx) / (Math.PI / 4)) % SECTORS) + SECTORS) % SECTORS);
      }
    }
  }
  /** Colores de la red según el tema (al cambiar de claro a oscuro). */
  recolorNetwork(net: TransitNetwork) { if (this.networkLoaded) this.setNetwork(net); }

  /** Resalta una ruta (todas sus direcciones; la elegida más gruesa) y sus paradas. */
  showRoute(shapes: readonly RouteShape[] | null, direction: string, color: string, stopsLookup: (id: string) => GeoPoint | undefined) {
    const sel = this.map.getSource("route-sel") as GeoJSONSource, stops = this.map.getSource("route-stops") as GeoJSONSource;
    if (!shapes || !shapes.length) {
      sel.setData(EMPTY); stops.setData(EMPTY);
      this.map.setPaintProperty("network-lines", "line-opacity", NETWORK_OPACITY);
      this.map.setPaintProperty("troncales-lines", "line-opacity", TRONCAL_OPACITY);
      return;
    }
    this.map.setPaintProperty("network-lines", "line-opacity", 0.1);
    this.map.setPaintProperty("troncales-lines", "line-opacity", 0.3);
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
      if (p) feats.push({ type: "Feature", properties: this.withSector({ id, color }, id), geometry: { type: "Point", coordinates: [p.lon, p.lat] } });
    }
    stops.setData({ type: "FeatureCollection", features: feats });
  }

  private withSector<T extends Record<string, unknown>>(props: T, id?: string): T & { k?: number } {
    const k = id ? this.stopSector.get(id) : undefined;
    return k == null ? props : { ...props, k };
  }

  /** Dibuja (o borra) el viaje planeado. */
  setTrip(data: { lines: FeatureCollection; points: FeatureCollection } | null) {
    (this.map.getSource("trip-lines") as GeoJSONSource | undefined)?.setData(data?.lines ?? EMPTY);
    (this.map.getSource("trip-pts") as GeoJSONSource | undefined)?.setData(data?.points ?? EMPTY);
  }
  /** Si hay una función aquí, el próximo toque en el mapa se entrega a ella (elegir origen o destino) y no abre nada. */
  pickHandler: ((p: GeoPoint) => void) | null = null;

  /** Marca la parada elegida con un punto grande. */
  setFocusStop(p: GeoPoint | null, color = "#e11d2e", stopId?: string) {
    (this.map.getSource("stop-focus") as GeoJSONSource | undefined)?.setData(!p ? EMPTY : { type: "FeatureCollection", features: [{ type: "Feature", properties: this.withSector({ color }, stopId), geometry: { type: "Point", coordinates: [p.lon, p.lat] } }] });
  }

  /** Resalta solo un tramo de una ruta (por ejemplo, por donde vienen los buses hacia una parada). */
  showSegment(points: readonly GeoPoint[], color: string, stops: readonly { id: string; p: GeoPoint }[]) {
    const sel = this.map.getSource("route-sel") as GeoJSONSource, st = this.map.getSource("route-stops") as GeoJSONSource;
    this.map.setPaintProperty("network-lines", "line-opacity", 0.1);
    this.map.setPaintProperty("troncales-lines", "line-opacity", 0.3);
    sel.setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: { color, on: true }, geometry: { type: "LineString", coordinates: points.map((p) => [p.lon, p.lat]) } }] });
    st.setData({ type: "FeatureCollection", features: stops.map((s) => ({ type: "Feature", properties: this.withSector({ id: s.id, color }, s.id), geometry: { type: "Point", coordinates: [s.p.lon, s.p.lat] } })) });
  }

  setAlertStops(points: readonly GeoPoint[] | null) {
    (this.map.getSource("alert-stops") as GeoJSONSource).setData(!points ? EMPTY : {
      type: "FeatureCollection",
      features: points.map((p) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [p.lon, p.lat] } })),
    });
  }

  get bearing(): number { return this.map.getBearing(); }
  resetNorth() { this.map.easeTo({ bearing: 0, duration: 450 }); }

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
      el.innerHTML = '<i class="cone" aria-hidden="true"></i>';
      this.me = new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(this.map);
    } else this.me.setLngLat([p.lon, p.lat]);
  }
  private meHeading: number | null = null;
  /** Dibuja el haz de luz hacia donde apunta el celular (`null` lo oculta). Se ajusta al giro del mapa. */
  setMeHeading(deg: number | null) {
    this.meHeading = deg;
    const el = this.me?.getElement(); if (!el) return;
    const on = deg != null;
    el.classList.toggle("aim", on);
    if (on) el.style.setProperty("--h", `${deg - this.map.getBearing()}deg`);
  }
  get zoom(): number { return this.map.getZoom(); }
  resize() { this.map.resize(); }
  destroy() { this.setFlow(false); this.map.remove(); }
}
