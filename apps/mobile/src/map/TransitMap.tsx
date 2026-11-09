import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from "react";
import { StyleSheet } from "react-native";
import { Camera, GeoJSONSource, Images, Layer, Map, UserLocation, type CameraRef } from "@maplibre/maplibre-react-native";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import type { SystemType } from "@transmi/domain";
import { transit } from "@/composition-root";
import { useTransitVersion } from "@/hooks";
import { useColors } from "@/ui/theme";
import { useBusFeatures, type Viewport } from "./useBuses";

/** Base de OpenStreetMap servida por OpenFreeMap (gratis, sin llave). */
const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
const BOGOTA: [number, number] = [-74.075, 4.65];
const STOP_ZOOM = 15.2;

export interface TransitMapHandle { flyTo(lat: number, lon: number, zoom?: number): void; fit(points: { lat: number; lon: number }[], padding?: number): void }
interface Props {
  system?: SystemType | null;
  /** Si se da, solo se ven los buses de esa ruta y se dibuja su trazado. */
  routeId?: string | null;
  highlightBusId?: string | null;
  onBus?(id: string): void;
  onStop?(id: string): void;
  children?: ReactNode;
}

/** El mapa de buses en vivo: base, trazado de la ruta, paradas (al acercarse), buses y tu ubicación. */
export const TransitMap = forwardRef<TransitMapHandle, Props>(function TransitMap({ system = null, routeId = null, highlightBusId = null, onBus, onStop, children }, ref) {
  const c = useColors();
  const camera = useRef<CameraRef>(null);
  const [view, setView] = useState<Viewport | null>(null);
  useTransitVersion();

  useImperativeHandle(ref, () => ({
    flyTo: (lat, lon, zoom = 15.5) => camera.current?.flyTo({ center: [lon, lat], zoom, duration: 900 }),
    fit: (pts, padding = 60) => {
      if (!pts.length) return;
      const lons = pts.map((p) => p.lon), lats = pts.map((p) => p.lat);
      camera.current?.fitBounds([Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)], { padding: { top: padding, right: padding, bottom: padding + 220, left: padding }, duration: 900 });
    },
  }), []);

  const buses = useBusFeatures(view, { system, routeId });

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

  const onRegion = useCallback((e: { nativeEvent: { bounds: [number, number, number, number]; zoom: number } }) => {
    const { bounds, zoom } = e.nativeEvent;
    setView({ west: bounds[0], south: bounds[1], east: bounds[2], north: bounds[3], zoom });
  }, []);

  return (
    <Map style={StyleSheet.absoluteFill} mapStyle={MAP_STYLE} logo={false} attribution attributionPosition={{ bottom: 100, right: 8 }} compass compassPosition={{ top: 120, right: 12 }} onRegionDidChange={onRegion} onDidFinishLoadingMap={() => undefined}>
      <Camera ref={camera} initialViewState={{ center: BOGOTA, zoom: 11.6 }} minZoom={9} maxZoom={19} />
      <Images images={{ "bus-arrow": require("../../assets/bus-arrow.png") }} />
      <UserLocation />

      {routeId && (
        <GeoJSONSource id="route-line" data={line}>
          <Layer id="route-line-casing" type="line" style={{ lineColor: "#ffffff", lineWidth: 9, lineCap: "round", lineJoin: "round" }} />
          <Layer id="route-line-fill" type="line" style={{ lineColor: "#e11d2e", lineWidth: 5, lineCap: "round", lineJoin: "round" }} />
        </GeoJSONSource>
      )}

      <GeoJSONSource id="stops" data={stops} onPress={(e) => { const id = e.nativeEvent.features[0]?.properties?.id as string | undefined; if (id) onStop?.(id); }}>
        <Layer id="stops-dot" type="circle" style={{ circleRadius: 5.5, circleColor: "#ffffff", circleStrokeColor: c.dark ? "#d4d4d8" : "#3f3f46", circleStrokeWidth: 2 }} />
      </GeoJSONSource>

      <GeoJSONSource id="buses" data={buses} onPress={(e) => { const id = e.nativeEvent.features[0]?.properties?.id as string | undefined; if (id) onBus?.(id); }}>
        <Layer id="bus-dot" type="circle" style={{
          circleRadius: ["interpolate", ["linear"], ["zoom"], 10, 4, 14, 7, 17, 12],
          circleColor: ["get", "color"], circleStrokeColor: "#ffffff", circleStrokeWidth: 1.6,
        }} />
        <Layer id="bus-arrow" type="symbol" style={{
          iconImage: "bus-arrow", iconSize: ["interpolate", ["linear"], ["zoom"], 10, 0.14, 14, 0.24, 17, 0.4],
          iconRotate: ["get", "h"], iconRotationAlignment: "map", iconAllowOverlap: true, iconIgnorePlacement: true,
        }} />
      </GeoJSONSource>
      {children}
    </Map>
  );
});
