import { type ComponentProps, forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from "react";
import { StyleSheet } from "react-native";
import { Camera, GeoJSONSource, Images, Layer, Map, UserLocation, type CameraRef } from "@maplibre/maplibre-react-native";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import type { SystemType } from "@transmi/domain";
import { transit } from "@/composition-root";
import { useTransitVersion } from "@/hooks";
import { useColors } from "@/ui/theme";
import { trunkStations } from "@transmi/application";
import { BUS_SPRITES } from "./sprites";
import { useBusFeatures, type Viewport } from "./useBuses";
import { SYSTEM_COLOR } from "@/ui/theme";

/** Base de OpenStreetMap servida por OpenFreeMap (gratis, sin llave). */
const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
const BOGOTA: [number, number] = [-74.075, 4.65];
const STOP_ZOOM = 15.2;

export interface TransitMapHandle { flyTo(lat: number, lon: number, zoom?: number): void; resetNorth(): void; fit(points: { lat: number; lon: number }[], padding?: number, bottomExtra?: number): void }
interface Props {
  system?: SystemType | null;
  /** Si se da, solo se ven los buses de esa ruta y se dibuja su trazado. */
  routeId?: string | null;
  /** Parada destacada y buses que se acercan a ella (con un aro). */
  focusStopId?: string | null;
  highlightIds?: string[];
  /** Si es falso (otra pestaña al frente), los buses dejan de recalcularse para no gastar batería. */
  active?: boolean;
  /** Avisa dónde quedó el centro del mapa y su zoom cada vez que termina de moverse. */
  onView?(v: { lat: number; lon: number; zoom: number; bearing: number }): void;
  /** Mapa pequeño dentro de otra pantalla: sin brújula. */
  compact?: boolean;
  attributionPosition?: ComponentProps<typeof Map>["attributionPosition"];
  /** Mientras una hoja se abre encima, los buses se recalculan más despacio para que la hoja salga al instante. */
  calm?: boolean;
  onBus?(id: string): void;
  onStop?(id: string): void;
  children?: ReactNode;
}

/** El mapa de buses en vivo: base, trazado de la ruta, paradas (al acercarse), buses y tu ubicación. */
export const TransitMap = forwardRef<TransitMapHandle, Props>(function TransitMap({ system = null, routeId = null, focusStopId = null, highlightIds = [], active = true, onView, compact = false, calm = false, attributionPosition = { bottom: 100, right: 8 }, onBus, onStop, children }, ref) {
  const c = useColors();
  const camera = useRef<CameraRef>(null);
  const lastCenter = useRef<[number, number]>(BOGOTA);      // el centro actual, para girar a norte sin moverse
  const [view, setView] = useState<Viewport | null>(null);
  useTransitVersion();

  useImperativeHandle(ref, () => ({
    resetNorth: () => camera.current?.easeTo({ center: lastCenter.current, bearing: 0, duration: 350 }),
    flyTo: (lat, lon, zoom = 15.5) => camera.current?.flyTo({ center: [lon, lat], zoom, duration: 900 }),
    fit: (pts, padding = 60, bottomExtra = 220) => {
      if (!pts.length) return;
      const lons = pts.map((p) => p.lon), lats = pts.map((p) => p.lat);
      camera.current?.fitBounds([Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)], { padding: { top: padding, right: padding, bottom: padding + bottomExtra, left: padding }, duration: 900 });
    },
  }), []);

  const buses = useBusFeatures(view, { system, routeId, enabled: active, everyMs: calm ? 2000 : 250 });

  const stops = useMemo<FeatureCollection<Point>>(() => {
    const features: Feature<Point>[] = [];
    if (view && view.zoom >= STOP_ZOOM) {
      for (const s of transit.network.stops.values()) {
        const { lat, lon } = s.position;
        if (lon < view.west || lon > view.east || lat < view.south || lat > view.north) continue;
        features.push({ type: "Feature", id: s.id, geometry: { type: "Point", coordinates: [lon, lat] }, properties: { id: s.id } });
        if (features.length >= 700) break;
      }
    }
    return { type: "FeatureCollection", features };
  }, [view, transit.network]);   // eslint-disable-line react-hooks/exhaustive-deps

  const line = useMemo<FeatureCollection<LineString>>(() => ({
    type: "FeatureCollection",
    features: routeId ? (transit.network.shapes.get(routeId) ?? []).filter((sh) => sh.points.length > 1).map((sh) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: sh.points.map((p) => [p.lon, p.lat]) } })) : [],
  }), [routeId, transit.network]);   // eslint-disable-line react-hooks/exhaustive-deps

  /** Las líneas de las troncales y duales, apenas visibles: dan contexto sin tapar los buses. */
  const network = useMemo<FeatureCollection<LineString>>(() => {
    const features: Feature<LineString>[] = [];
    for (const r of transit.network.routes.values()) {
      if (r.system !== "troncal" && r.system !== "dual") continue;
      const sh = transit.network.shapes.get(r.id)?.[0];
      if (!sh || sh.points.length < 2) continue;
      const step = Math.max(1, Math.ceil(sh.points.length / 120));
      const pts = sh.points.filter((_, i) => i % step === 0 || i === sh.points.length - 1);
      features.push({ type: "Feature", properties: { color: SYSTEM_COLOR[r.system] }, geometry: { type: "LineString", coordinates: pts.map((p) => [p.lon, p.lat]) } });
    }
    return { type: "FeatureCollection", features };
  }, [transit.network]);   // eslint-disable-line react-hooks/exhaustive-deps

  /** Estaciones de la troncal: un punto en el centro de sus vagones y su nombre. */
  const stations = useMemo<FeatureCollection<Point>>(() => {
    const features: Feature<Point>[] = [];
    if (transit.network.stops.size) for (const st of trunkStations(transit)) {
      if (!st.stops.length) continue;
      const lat = st.stops.reduce((a, s) => a + s.position.lat, 0) / st.stops.length, lon = st.stops.reduce((a, s) => a + s.position.lon, 0) / st.stops.length;
      const portal = st.stops.some((s) => !!transit.labelOf(s).platform);
      features.push({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: { title: st.title, portal } });
    }
    return { type: "FeatureCollection", features };
  }, [transit.network]);   // eslint-disable-line react-hooks/exhaustive-deps

  // el mapa recibe texto ya serializado: las capas fijas no se vuelven a convertir en cada actualización de los buses
  const networkJson = useMemo(() => JSON.stringify(network), [network]);
  const stationsJson = useMemo(() => JSON.stringify(stations), [stations]);
  const lineJson = useMemo(() => JSON.stringify(line), [line]);
  const stopsJson = useMemo(() => JSON.stringify(stops), [stops]);
  const busesJson = useMemo(() => JSON.stringify(buses), [buses]);

  const focusJson = useMemo(() => {
    const st = focusStopId ? transit.stopById(focusStopId) : undefined;
    return JSON.stringify({ type: "FeatureCollection", features: st ? [{ type: "Feature", geometry: { type: "Point", coordinates: [st.position.lon, st.position.lat] }, properties: {} }] : [] });
  }, [focusStopId, transit.network]);   // eslint-disable-line react-hooks/exhaustive-deps

  const onRegion = useCallback((e: { nativeEvent: { bounds: [number, number, number, number]; zoom: number; bearing?: number } }) => {
    const { bounds, zoom, bearing } = e.nativeEvent;
    setView({ west: bounds[0], south: bounds[1], east: bounds[2], north: bounds[3], zoom });
    lastCenter.current = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
    onView?.({ lat: (bounds[1] + bounds[3]) / 2, lon: (bounds[0] + bounds[2]) / 2, zoom, bearing: bearing ?? 0 });
  }, [onView]);

  return (
    <Map style={StyleSheet.absoluteFill} mapStyle={MAP_STYLE} logo={false} attribution attributionPosition={attributionPosition} compass={false} onRegionDidChange={onRegion} onDidFinishLoadingMap={() => undefined}>
      <Camera ref={camera} initialViewState={{ center: BOGOTA, zoom: 11.6 }} minZoom={9} maxZoom={19} />
      <Images images={BUS_SPRITES} />
      <UserLocation />

      <GeoJSONSource id="network" data={networkJson}>
        <Layer id="network-line" type="line" style={{ lineColor: ["get", "color"], lineOpacity: 0.45, lineWidth: ["interpolate", ["linear"], ["zoom"], 10, 1.2, 14, 3, 17, 6], lineCap: "round", lineJoin: "round" }} />
      </GeoJSONSource>
      <GeoJSONSource id="stations" data={stationsJson}>
        <Layer id="station-dot" type="circle" minzoom={11.5} style={{ circleRadius: ["case", ["get", "portal"], 7, 4.5], circleColor: "#ffffff", circleStrokeColor: "#e11d2e", circleStrokeWidth: 2.2 }} />
        <Layer id="station-label" type="symbol" minzoom={12.8} style={{ textField: ["get", "title"], textFont: ["Noto Sans Regular"], textSize: ["interpolate", ["linear"], ["zoom"], 12.8, 10, 16, 13], textOffset: [0, 1.1], textAnchor: "top", textColor: c.dark ? "#f4f4f5" : "#1f2430", textHaloColor: c.dark ? "#18181b" : "#ffffff", textHaloWidth: 1.8, textMaxWidth: 7 }} />
      </GeoJSONSource>
      {routeId && (
        <GeoJSONSource id="route-line" data={lineJson}>
          <Layer id="route-line-casing" type="line" style={{ lineColor: "#ffffff", lineWidth: 9, lineCap: "round", lineJoin: "round" }} />
          <Layer id="route-line-fill" type="line" style={{ lineColor: "#e11d2e", lineWidth: 5, lineCap: "round", lineJoin: "round" }} />
        </GeoJSONSource>
      )}

      <GeoJSONSource id="focus-stop" data={focusJson}>
        <Layer id="focus-stop-halo" type="circle" style={{ circleRadius: 20, circleColor: "#e11d2e", circleOpacity: 0.18 }} />
        <Layer id="focus-stop-dot" type="circle" style={{ circleRadius: 8, circleColor: "#e11d2e", circleStrokeColor: "#ffffff", circleStrokeWidth: 3 }} />
      </GeoJSONSource>
      <GeoJSONSource id="stops" data={stopsJson} onPress={(e) => { const id = e.nativeEvent.features[0]?.properties?.id as string | undefined; if (id) onStop?.(id); }}>
        <Layer id="stops-hit" type="circle" style={{ circleRadius: 16, circleColor: "#000000", circleOpacity: 0.01 }} />
        <Layer id="stops-dot" type="circle" style={{ circleRadius: 5.5, circleColor: "#ffffff", circleStrokeColor: c.dark ? "#d4d4d8" : "#3f3f46", circleStrokeWidth: 2 }} />
      </GeoJSONSource>

      <GeoJSONSource id="buses" data={busesJson} onPress={(e) => { const id = e.nativeEvent.features[0]?.properties?.id as string | undefined; if (id) onBus?.(id); }}>
        {highlightIds.length ? <Layer id="bus-ring" type="circle" filter={["in", ["get", "id"], ["literal", highlightIds]]} style={{ circleRadius: 22, circleColor: "#e11d2e", circleOpacity: 0.12, circleStrokeColor: "#e11d2e", circleStrokeWidth: 3 }} /> : null}
        <Layer id="bus-hit" type="circle" style={{ circleRadius: 20, circleColor: "#000000", circleOpacity: 0.01 }} />
        <Layer id="bus-dot" type="circle" maxzoom={11.8} style={{ circleRadius: ["interpolate", ["linear"], ["zoom"], 9, 2.6, 11.8, 4], circleColor: ["get", "color"], circleStrokeColor: "#ffffff", circleStrokeWidth: 1 }} />
        <Layer id="bus-sprite" type="symbol" minzoom={11.8} style={{
          iconImage: ["get", "sprite"], iconSize: ["interpolate", ["linear"], ["zoom"], 11.8, 0.3, 14, 0.5, 16, 0.78, 18, 1.15],
          iconRotate: ["get", "rot"], iconRotationAlignment: "map", iconPitchAlignment: "map", iconAllowOverlap: true, iconIgnorePlacement: true,
        }} />
        <Layer id="bus-label" type="symbol" minzoom={15} style={{
          textField: ["get", "route"], textFont: ["Noto Sans Regular"], textSize: 11, textOffset: [0, -1.5], textColor: c.dark ? "#f4f4f5" : "#111827",
          textHaloColor: c.dark ? "#18181b" : "#ffffff", textHaloWidth: 1.6, textAllowOverlap: false,
        }} />
      </GeoJSONSource>
      {children}
    </Map>
  );
});
