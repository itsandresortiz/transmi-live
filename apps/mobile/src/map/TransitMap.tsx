import { type ComponentProps, forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from "react";
import { StyleSheet } from "react-native";
import * as Location from "expo-location";
import { Camera, GeoJSONSource, Images, Layer, Map, UserLocation, type CameraRef } from "@maplibre/maplibre-react-native";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import type { SystemType } from "@transmi/domain";
import { transit } from "@/composition-root";
import { nowMs } from "@/clock";
import { useTransitVersion } from "@/hooks";
import { useColors } from "@/ui/theme";
import { useAccessibility } from "@/accessibility";
import { CORRIDORS, PORTALS, type TripGeo, buildStationGeometry, flowDashAt, hav, trafficBand, trafficSegments, trunkStations } from "@transmi/application";
import { TRUNK_LINES } from "@transmi/domain";
import { useSemaforos } from "./semaforos";
import lightStyle from "./style-light.json";
import darkStyle from "./style-dark.json";
import { BUS_SPRITES } from "./sprites";
import { sp } from "./styleProps";
import { useBusFeatures, type Viewport } from "./useBuses";
import { SYSTEM_COLOR } from "@/ui/theme";

/** Base de OpenStreetMap servida por OpenFreeMap (gratis, sin llave). */
/** Mapa base claro u oscuro, según la apariencia de la app. Son los estilos de OpenFreeMap con colores propios (más contraste entre calles, parques y agua);
 *  los genera `tools/map-styles.py`: no editar los .json a mano. */
const MAP_STYLE = { light: lightStyle as never, dark: darkStyle as never };
/** Dónde quedó el mapa la última vez: al cambiar de apariencia el mapa se vuelve a montar (no se cambia el estilo en caliente) y retoma desde ahí. */
const lastView: { center: [number, number]; zoom: number } = { center: BOGOTA_LL(), zoom: 11.6 };
function BOGOTA_LL(): [number, number] { return [-74.08, 4.65]; }
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
  /** Un viaje de «Cómo llegar» dibujado completo: caminatas punteadas, cada bus con su recorrido y los puntos donde se sube y se baja. */
  trip?: TripGeo | null;
  /** Solo se ven los buses de estas rutas (las del viaje). */
  onlyRoutes?: readonly string[] | null;
  /** Si es falso (otra pestaña al frente), los buses dejan de recalcularse para no gastar batería. */
  active?: boolean;
  /** Capas extra: semáforos y estaciones dibujadas con sus vagones. */
  showSignals?: boolean;
  showStations?: boolean;
  /** Velocidad de los buses en las calles (capa de tráfico). */
  showTraffic?: boolean;
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
export const TransitMap = forwardRef<TransitMapHandle, Props>(function TransitMap({ system = null, routeId = null, focusStopId = null, highlightIds = [], trip = null, onlyRoutes = null, active = true, showSignals = true, showStations = true, showTraffic = false, onView, compact = false, calm = false, attributionPosition = { bottom: 100, right: 8 }, onBus, onStop, children }, ref) {
  const c = useColors();
  const camera = useRef<CameraRef>(null);
  const lastCenter = useRef<[number, number]>(BOGOTA);      // el centro actual, para girar a norte sin moverse
  const [view, setView] = useState<Viewport | null>(null);
  useTransitVersion();

  useImperativeHandle(ref, () => ({
    resetNorth: () => camera.current?.easeTo({ center: lastCenter.current, bearing: 0, duration: 350 }),
    flyTo: (lat, lon, zoom = 15.5) => { if (Number.isFinite(lat) && Number.isFinite(lon)) camera.current?.flyTo({ center: [lon, lat], zoom, duration: 900 }); },
    fit: (pts, padding = 60, bottomExtra = 220) => {
      const ok = pts.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
      if (!ok.length) return;
      const lons = ok.map((p) => p.lon), lats = ok.map((p) => p.lat);
      const w = Math.min(...lons), s = Math.min(...lats), e = Math.max(...lons), n = Math.max(...lats);
      // un solo punto (o varios casi juntos) no es un recuadro válido: iOS rechaza el encuadre y la app se cae; se acerca a ese punto en su lugar
      if (e - w < 0.0006 && n - s < 0.0006) { camera.current?.flyTo({ center: [(w + e) / 2, (s + n) / 2], zoom: 16.3, duration: 900 }); return; }
      camera.current?.fitBounds([w, s, e, n], { padding: { top: padding, right: padding, bottom: padding + bottomExtra, left: padding }, duration: 900 });
    },
  }), []);


  const stops = useMemo<FeatureCollection<Point>>(() => {
    const features: Feature<Point>[] = [];
    if (view && view.zoom >= STOP_ZOOM) {
      for (const s of transit.network.stops.values()) {
        const { lat, lon } = s.position;
        if (lon < view.west || lon > view.east || lat < view.south || lat > view.north) continue;
        if (!transit.isServed(s.id)) continue;      // registros «de la estación» sin rutas (uno en medio de cada estación o portal): no son paradas reales
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

  /** Las troncales, cada una con el color de su línea (Suba amarillo, Norte verde, Caracas azul…), como en la web y en el plano oficial.
   *  Se dibuja el eje de cada avenida (una sola línea limpia), no el recorrido de cada ruta. No dependen de los datos en vivo. */
  const network = useMemo<FeatureCollection<LineString>>(() => ({
    type: "FeatureCollection",
    features: CORRIDORS.map((k) => ({ type: "Feature", properties: { l: k.l }, geometry: { type: "LineString", coordinates: k.p.map(([la, lo]) => [lo, la]) } })),
  }), []);

  /** Las estaciones de la troncal dibujadas como en la web: base, pasillo, vagones con puertas y su número. */
  const geo = useMemo(() => (transit.network.stops.size && transit.network.shapes.size ? buildStationGeometry(transit, trunkStations(transit), CORRIDORS) : null), [transit.network]);   // eslint-disable-line react-hooks/exhaustive-deps
  const stationGeo = useMemo(() => {
    const j = (x: unknown) => JSON.stringify(x ?? { type: "FeatureCollection", features: [] });
    return geo ? { bases: j(geo.bases), links: j(geo.links), capsules: j(geo.capsules), doors: j(geo.doors), labels: j(geo.labels), chips: j(geo.chips) } : null;
  }, [geo]);

  /** Estaciones y portales de la troncal: un punto en el centro de sus vagones, su nombre y la letra de su línea (A, B, C…), que le da el color. */
  const stations = useMemo<FeatureCollection<Point>>(() => {
    const features: Feature<Point>[] = [];
    const lineOfStop: Record<string, string> = {};
    for (const f of geo?.chips.features ?? []) for (const id of String(f.properties?.all ?? "").split(",")) lineOfStop[id] = String(f.properties?.l ?? "X");
    if (transit.network.stops.size) for (const st of trunkStations(transit)) {
      if (!st.stops.length) continue;
      const lat = st.stops.reduce((a, s) => a + s.position.lat, 0) / st.stops.length, lon = st.stops.reduce((a, s) => a + s.position.lon, 0) / st.stops.length;
      const portal = st.stops.some((s) => !!transit.labelOf(s).platform) || /^(portal|terminal)\b/i.test(st.title);
      const l = st.stops.map((s) => lineOfStop[s.id]).find((x) => !!x) ?? "X";
      features.push({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: { title: st.title, portal, l, letter: l === "X" ? "" : l } });
    }
    // los portales no tienen vagones (tienen plataformas): se agregan con su nombre y su línea, sin repetir los que ya estén
    for (const p of PORTALS) {
      if (features.some((f) => f.properties?.portal && hav({ lat: f.geometry.coordinates[1]!, lon: f.geometry.coordinates[0]! }, p) < 400)) continue;
      features.push({ type: "Feature", geometry: { type: "Point", coordinates: [p.lon, p.lat] }, properties: { title: p.name.replace(/\s+[–-]\s+.*$/, ""), portal: true, l: p.l, letter: p.l === "X" ? "" : p.l } });
    }
    return { type: "FeatureCollection", features };
  }, [geo]);   // eslint-disable-line react-hooks/exhaustive-deps

  const signalsJson = useSemaforos(showSignals);
  /** El viaje que se está siguiendo, como líneas y puntos. Las capas están siempre montadas: sin viaje, los datos van vacíos. */
  const tripLines = useMemo(() => JSON.stringify({
    type: "FeatureCollection",
    features: (trip?.legs ?? []).map((l) => ({ type: "Feature", properties: { kind: l.kind, color: l.kind === "ride" && l.system ? SYSTEM_COLOR[l.system] : "#8a8f98" }, geometry: { type: "LineString", coordinates: l.line.map((g) => [g.lon, g.lat]) } })),
  }), [trip]);
  const tripPoints = useMemo(() => JSON.stringify({
    type: "FeatureCollection",
    features: (trip?.points ?? []).map((pt) => ({ type: "Feature", properties: { kind: pt.kind, name: pt.name }, geometry: { type: "Point", coordinates: [pt.position.lon, pt.position.lat] } })),
  }), [trip]);
  /** Tráfico: el último tramo que recorrió cada bus, con su velocidad. Solo se calcula con la capa encendida y cuando llega un lote nuevo. */
  const version = transit.version;
  const trafficJson = useMemo(() => JSON.stringify({
    type: "FeatureCollection",
    features: showTraffic && active ? trafficSegments(transit, nowMs() / 1000).map((x) => ({ type: "Feature", properties: { b: trafficBand(x.speed) }, geometry: { type: "LineString", coordinates: (x.line ?? [x.a, x.b]).map((g) => [g.lon, g.lat]) } })) : [],
  }), [showTraffic, active, version]);
  /** Color de cada línea de la troncal (A, B, C…) para los bordes de las estaciones. */
  const lineColor = (fallback: string): unknown => ["match", ["get", "l"], ...Object.entries(TRUNK_LINES).flatMap(([k, v]) => [k, c.dark ? v.dark : v.light]), fallback];
  /** Sobre los colores claros (amarillo de Suba, beige de la 26, rosado del Eje Ambiental) la letra va oscura para que se lea. */
  const letterColor: unknown = ["match", ["get", "l"], ["C", "K", "J"], "#1c1c1e", c.dark ? "#0b0b0d" : "#ffffff"];
  const nameColor = c.dark ? "#f4f4f5" : "#1c1c1e", nameHalo = c.dark ? "#0b0b0d" : "#ffffff";
  const isPortal: unknown = ["==", ["get", "portal"], true];

  // el mapa recibe texto ya serializado: las capas fijas no se vuelven a convertir en cada actualización de los buses
  const networkJson = useMemo(() => JSON.stringify(network), [network]);
  const stationsJson = useMemo(() => JSON.stringify(stations), [stations]);
  const lineJson = useMemo(() => JSON.stringify(line), [line]);
  const stopsJson = useMemo(() => JSON.stringify(stops), [stops]);

  const focusJson = useMemo(() => {
    const st = focusStopId ? transit.stopById(focusStopId) : undefined;
    return JSON.stringify({ type: "FeatureCollection", features: st ? [{ type: "Feature", geometry: { type: "Point", coordinates: [st.position.lon, st.position.lat] }, properties: {} }] : [] });
  }, [focusStopId, transit.network]);   // eslint-disable-line react-hooks/exhaustive-deps

  const onRegion = useCallback((e: { nativeEvent: { bounds: [number, number, number, number]; zoom: number; bearing?: number } }) => {
    const { bounds, zoom, bearing } = e.nativeEvent;
    setView({ west: bounds[0], south: bounds[1], east: bounds[2], north: bounds[3], zoom });
    lastCenter.current = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
    if (!compact) { lastView.center = lastCenter.current; lastView.zoom = zoom; }
    onView?.({ lat: (bounds[1] + bounds[3]) / 2, lon: (bounds[0] + bounds[2]) / 2, zoom, bearing: bearing ?? 0 });
  }, [onView]);

  return (
    <Map key={c.dark ? "oscuro" : "claro"} style={StyleSheet.absoluteFill} mapStyle={c.dark ? MAP_STYLE.dark : MAP_STYLE.light} logo={false} attribution attributionPosition={attributionPosition} compass={false} onRegionDidChange={onRegion} onDidFinishLoadingMap={() => undefined}>
      <Camera ref={camera} initialViewState={compact ? { center: BOGOTA, zoom: 11.6 } : { center: lastView.center, zoom: lastView.zoom }} minZoom={9} maxZoom={19} />
      <Images images={BUS_SPRITES} />
      {/* debajo de tu punto, el haz que muestra hacia dónde apunta el teléfono (como en la web) */}
      <HeadingCone active={active} />
      <UserLocation />

      <GeoJSONSource id="network" data={networkJson}>
        <Layer id="network-line" type="line" {...sp({ lineColor: lineColor(c.dark ? "#ff5a5e" : "#e30613") as never, lineOpacity: showTraffic ? 0.25 : 0.7, lineWidth: ["interpolate", ["linear"], ["zoom"], 10, 1.2, 14, 3, 17, 6], lineCap: "round", lineJoin: "round" })} />
      </GeoJSONSource>
      <TrafficLayer json={trafficJson} show={showTraffic} moving={showTraffic && active && !calm && (view?.zoom ?? 0) >= 12.5} dark={c.dark} />
      <GeoJSONSource id="stations" data={stationsJson}>
        {/* cada estación es una ficha del color de su línea con su letra; los portales, más grandes y visibles desde más lejos */}
        <Layer id="portal-dot" type="circle" minzoom={10.5} maxzoom={14.5} filter={isPortal as never} {...sp({ circleRadius: ["interpolate", ["linear"], ["zoom"], 10.5, 6, 14.5, 11], circleColor: lineColor("#e11d2e") as never, circleStrokeColor: nameHalo, circleStrokeWidth: 2 })} />
        <Layer id="station-dot" type="circle" minzoom={11.8} maxzoom={14.5} filter={["!", isPortal] as never} {...sp({ circleRadius: ["interpolate", ["linear"], ["zoom"], 11.8, 4, 14.5, 8], circleColor: lineColor("#e11d2e") as never, circleStrokeColor: nameHalo, circleStrokeWidth: 1.8 })} />
        <Layer id="station-letter" type="symbol" minzoom={12.6} maxzoom={14.5} {...sp({ textField: ["get", "letter"], textFont: ["Noto Sans Bold"], textSize: ["case", ["get", "portal"], 12, 10], textAllowOverlap: true, textIgnorePlacement: true, textColor: letterColor as never })} />
        <Layer id="portal-label" type="symbol" minzoom={10.5} maxzoom={14.5} filter={isPortal as never} {...sp({ textField: ["get", "title"], textFont: ["Noto Sans Bold"], textSize: ["interpolate", ["linear"], ["zoom"], 10.5, 11.5, 14.5, 15], textVariableAnchor: ["top", "bottom", "left", "right"], textRadialOffset: 1.15, textJustify: "auto", textMaxWidth: 8, textColor: nameColor, textHaloColor: nameHalo, textHaloWidth: 2.2 })} />
        <Layer id="station-label" type="symbol" minzoom={12.6} maxzoom={14.5} filter={["!", isPortal] as never} {...sp({ textField: ["get", "title"], textFont: ["Noto Sans Bold"], textSize: ["interpolate", ["linear"], ["zoom"], 12.6, 11, 14.5, 13.5], textVariableAnchor: ["top", "bottom", "left", "right"], textRadialOffset: 1.05, textJustify: "auto", textMaxWidth: 8, textColor: nameColor, textHaloColor: nameHalo, textHaloWidth: 2 })} />
      </GeoJSONSource>
      {(
        <GeoJSONSource id="route-line" data={lineJson}>
          <Layer id="route-line-casing" type="line" {...sp({ lineColor: "#ffffff", lineWidth: 9, lineCap: "round", lineJoin: "round" })} />
          <Layer id="route-line-fill" type="line" {...sp({ lineColor: "#e11d2e", lineWidth: 5, lineCap: "round", lineJoin: "round" })} />
        </GeoJSONSource>
      )}


      {stationGeo ? (
        <>
          <GeoJSONSource id="station-bases" data={stationGeo.bases} onPress={(e) => { const ids = (e.nativeEvent.features[0]?.properties?.all as string | undefined)?.split(",")[0]; if (ids) onStop?.(ids); }}>
            <Layer id="station-base-fill" type="fill" minzoom={14.5} {...sp({ visibility: showStations ? "visible" : "none", fillColor: c.dark ? "#2b2e36" : "#dde2ea", fillOpacity: ["interpolate", ["linear"], ["zoom"], 14.5, 0.9, 17, 0.8] })} />
            <Layer id="station-base-line" type="line" minzoom={14.5} {...sp({ visibility: showStations ? "visible" : "none", lineColor: lineColor("#a9b2c1") as never, lineWidth: ["interpolate", ["linear"], ["zoom"], 14.5, 1.4, 18, 2.6] })} />
          </GeoJSONSource>
          <GeoJSONSource id="station-links" data={stationGeo.links}>
            <Layer id="station-links-fill" type="fill" minzoom={15.6} {...sp({ visibility: showStations ? "visible" : "none", fillColor: c.dark ? "#3a3e48" : "#c4ccd9" })} />
            <Layer id="station-links-line" type="line" minzoom={15.6} {...sp({ visibility: showStations ? "visible" : "none", lineColor: lineColor("#6f7a8d") as never, lineWidth: 1, lineOpacity: 0.75 })} />
          </GeoJSONSource>
          <GeoJSONSource id="station-capsules" data={stationGeo.capsules} onPress={(e) => { const ids = (e.nativeEvent.features[0]?.properties?.ids as string | undefined)?.split(",")[0]; if (ids) onStop?.(ids); }}>
            <Layer id="station-capsule-fill" type="fill" minzoom={15.6} {...sp({ visibility: showStations ? "visible" : "none", fillColor: c.dark ? "#4a4f5a" : "#ffffff", fillOpacity: 0.98 })} />
            <Layer id="station-capsule-line" type="line" minzoom={15.6} {...sp({ visibility: showStations ? "visible" : "none", lineColor: lineColor("#6f7a8d") as never, lineWidth: 1.8 })} />
          </GeoJSONSource>
          <GeoJSONSource id="station-doors" data={stationGeo.doors}>
            <Layer id="station-doors-line" type="line" minzoom={17} {...sp({ visibility: showStations ? "visible" : "none", lineColor: "#6f7a8d", lineWidth: 1, lineOpacity: 0.55 })} />
          </GeoJSONSource>
          <GeoJSONSource id="station-labels" data={stationGeo.labels}>
            <Layer id="station-wagon-labels" type="symbol" minzoom={16.3} {...sp({ visibility: showStations ? "visible" : "none", textField: ["step", ["zoom"], ["get", "text"], 17.3, ["concat", "Vagón ", ["get", "text"]]], textFont: ["Noto Sans Regular"], textSize: ["interpolate", ["linear"], ["zoom"], 16.3, 10, 18.5, 13], textAllowOverlap: true, textIgnorePlacement: true, textColor: c.dark ? "#f4f4f5" : "#1c1c1e" })} />
          </GeoJSONSource>
          <GeoJSONSource id="station-chips" data={stationGeo.chips}>
            <Layer id="station-chip-labels" type="symbol" minzoom={14.5} {...sp({ visibility: showStations ? "visible" : "none", textField: ["get", "title"], textFont: ["Noto Sans Bold"], textSize: ["interpolate", ["linear"], ["zoom"], 14.5, 13, 18, 17], textAnchor: "bottom", textOffset: [0, -0.5], textMaxWidth: 12, textColor: nameColor, textHaloColor: nameHalo, textHaloWidth: 2.4 })} />
          </GeoJSONSource>
        </>
      ) : null}
      {(
        <GeoJSONSource id="semaforos" data={signalsJson}>
          <Layer id="semaforos-dots" type="circle" minzoom={13.2} maxzoom={15.4} {...sp({ visibility: showSignals ? "visible" : "none", circleRadius: ["interpolate", ["linear"], ["zoom"], 13.2, 1.6, 15.4, 3.2], circleColor: "#e8503f", circleStrokeColor: "#ffffff", circleStrokeWidth: 1 })} />
          <Layer id="semaforos-icons" type="symbol" minzoom={15.4} {...sp({ visibility: showSignals ? "visible" : "none", iconImage: "semaforo", iconSize: ["interpolate", ["linear"], ["zoom"], 15.4, 0.2, 18, 0.36], iconAllowOverlap: true, iconIgnorePlacement: true })} />
          <Layer id="semaforos-labels" type="symbol" minzoom={17.2} {...sp({ visibility: showSignals ? "visible" : "none", textField: ["get", "dir"], textFont: ["Noto Sans Regular"], textSize: 10.5, textOffset: [0, 1.35], textAnchor: "top", textOptional: true, textColor: c.dark ? "#b4b4bb" : "#6c6c70", textHaloColor: c.dark ? "#0b0b0d" : "#eef0f3", textHaloWidth: 1.2 })} />
        </GeoJSONSource>
      )}
      <GeoJSONSource id="focus-stop" data={focusJson}>
        <Layer id="focus-stop-halo" type="circle" {...sp({ circleRadius: 20, circleColor: "#e11d2e", circleOpacity: 0.18 })} />
        <Layer id="focus-stop-dot" type="circle" {...sp({ circleRadius: 8, circleColor: "#e11d2e", circleStrokeColor: "#ffffff", circleStrokeWidth: 3 })} />
      </GeoJSONSource>
      <GeoJSONSource id="stops" data={stopsJson} onPress={(e) => { const id = e.nativeEvent.features[0]?.properties?.id as string | undefined; if (id) onStop?.(id); }}>
        <Layer id="stops-hit" type="circle" {...sp({ circleRadius: 16, circleColor: "#000000", circleOpacity: 0.01 })} />
        <Layer id="stops-dot" type="circle" {...sp({ circleRadius: 5.5, circleColor: "#ffffff", circleStrokeColor: c.dark ? "#d4d4d8" : "#3f3f46", circleStrokeWidth: 2 })} />
      </GeoJSONSource>

      <GeoJSONSource id="trip-lines" data={tripLines}>
        <Layer id="trip-casing" type="line" filter={["==", ["get", "kind"], "ride"] as never} {...sp({ lineColor: c.dark ? "#0b0b0d" : "#ffffff", lineWidth: 9, lineCap: "round", lineJoin: "round" })} />
        <Layer id="trip-ride" type="line" filter={["==", ["get", "kind"], "ride"] as never} {...sp({ lineColor: ["get", "color"], lineWidth: 5.5, lineCap: "round", lineJoin: "round" })} />
        <Layer id="trip-walk" type="line" filter={["==", ["get", "kind"], "walk"] as never} {...sp({ lineColor: c.dark ? "#c3c8d2" : "#4a4e57", lineWidth: 3.5, lineDasharray: [0.2, 1.8], lineCap: "round", lineJoin: "round" })} />
      </GeoJSONSource>
      <GeoJSONSource id="trip-points" data={tripPoints}>
        <Layer id="trip-dot" type="circle" {...sp({ circleRadius: ["match", ["get", "kind"], "dest", 8, "origin", 6, 6.5], circleColor: ["match", ["get", "kind"], "dest", "#e11d2e", "origin", "#3b82f6", "#ffffff"], circleStrokeColor: ["match", ["get", "kind"], "dest", "#ffffff", "origin", "#ffffff", "#1c1c1e"], circleStrokeWidth: 2.5 })} />
        <Layer id="trip-label" type="symbol" minzoom={12.5} {...sp({ textField: ["get", "name"], textFont: ["Noto Sans Bold"], textSize: 12, textVariableAnchor: ["top", "bottom", "left", "right"], textRadialOffset: 1.1, textJustify: "auto", textMaxWidth: 10, textColor: nameColor, textHaloColor: nameHalo, textHaloWidth: 2 })} />
      </GeoJSONSource>
      <BusLayer view={view} system={system} routeId={routeId} routeIds={onlyRoutes} active={active} calm={calm} highlightIds={highlightIds} dark={c.dark} onBus={onBus} />
      {children}
    </Map>
  );
});

/** Los buses, aparte del resto del mapa: se recalculan muchas veces por segundo y así solo se repinta esta capa (no las estaciones, la red ni los semáforos).
 *  Los estilos de las capas se crean una sola vez: en cada tanda lo único que cambia son los datos. */
const BusLayer = memo(function BusLayer({ view, system, routeId, routeIds = null, active, calm, highlightIds, dark, onBus }: { view: Viewport | null; system: SystemType | null; routeId: string | null; routeIds?: readonly string[] | null; active: boolean; calm: boolean; highlightIds: string[]; dark: boolean; onBus?: (id: string) => void }) {
  const { reduceMotion } = useAccessibility();
  const buses = useBusFeatures(view, { system, routeId, routeIds, enabled: active, everyMs: calm ? 2000 : reduceMotion ? 250 : 0 });
  const json = useMemo(() => JSON.stringify(buses), [buses]);
  const ringKey = highlightIds.join(",");
  const st = useMemo(() => ({
    ring: sp({ circleRadius: 22, circleColor: "#e11d2e", circleOpacity: 0.12, circleStrokeColor: "#e11d2e", circleStrokeWidth: 3 }),
    ringFilter: ["in", ["get", "id"], ["literal", highlightIds.length ? highlightIds : ["__ninguno__"]]] as never,
    hit: sp({ circleRadius: 20, circleColor: "#000000", circleOpacity: 0.01 }),
    dot: sp({ circleRadius: ["interpolate", ["linear"], ["zoom"], 9, 2.6, 11.8, 4], circleColor: ["get", "color"], circleStrokeColor: "#ffffff", circleStrokeWidth: 1, circleOpacity: ["get", "o"], circleStrokeOpacity: ["get", "o"] }),
    sprite: sp({
      iconOpacity: ["get", "o"],      // un bus que dejó de reportar hace rato se ve atenuado: sigue ahí, pero su dato es viejo
      iconImage: ["get", "sprite"], iconSize: ["interpolate", ["linear"], ["zoom"], 11.8, 0.115, 14, 0.19, 16, 0.3, 18, 0.45],
      iconRotate: ["get", "rot"], iconRotationAlignment: "map", iconPitchAlignment: "map", iconAllowOverlap: true, iconIgnorePlacement: true,
    }),
    label: sp({
      textField: ["get", "route"], textFont: ["Noto Sans Regular"], textSize: 11, textOffset: [0, -1.5], textColor: dark ? "#f4f4f5" : "#111827",
      textHaloColor: dark ? "#18181b" : "#ffffff", textHaloWidth: 1.6, textAllowOverlap: false,
    }),
  }), [dark, ringKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  const press = useCallback((e: { nativeEvent: { features: { properties?: Record<string, unknown> | null }[] } }) => { const id = e.nativeEvent.features[0]?.properties?.id as string | undefined; if (id) onBus?.(id); }, [onBus]);
  return (
    <GeoJSONSource id="buses" data={json} onPress={press as never}>
      <Layer id="bus-ring" type="circle" filter={st.ringFilter} {...st.ring} />
      <Layer id="bus-hit" type="circle" {...st.hit} />
      <Layer id="bus-dot" type="circle" maxzoom={11.8} {...st.dot} />
      <Layer id="bus-sprite" type="symbol" minzoom={11.8} {...st.sprite} />
      <Layer id="bus-label" type="symbol" minzoom={15} {...st.label} />
    </GeoJSONSource>
  );
});

/** El tráfico: cada tramo con el color de su velocidad y, encima, rayitas blancas que avanzan en el sentido de la marcha (rápidas donde fluye, casi quietas en el trancón).
 *  Va aparte para que la animación (unas 10 veces por segundo) solo repinte estas capas. Las capas están siempre montadas: solo cambian `visibility` y el patrón de las rayas. */
const BANDS = [0, 1, 2, 3] as const;
const TrafficLayer = memo(function TrafficLayer({ json, show, moving, dark }: { json: string; show: boolean; moving: boolean; dark: boolean }) {
  const { reduceMotion } = useAccessibility();
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!moving || reduceMotion) return;
    const id = setInterval(() => setT(Date.now()), 100);
    return () => clearInterval(id);
  }, [moving, reduceMotion]);
  const vis = show ? "visible" : "none";
  const base = useMemo(() => ({
    casing: sp({ visibility: vis, lineColor: dark ? "#0b0b0d" : "#ffffff", lineOpacity: 0.55, lineWidth: ["interpolate", ["linear"], ["zoom"], 11.5, 3, 16, 7.5, 18.5, 12], lineCap: "round", lineJoin: "round" }),
    lines: sp({ visibility: vis, lineColor: ["match", ["get", "b"], 0, "#e5484d", 1, "#f08a24", 2, "#f5c518", "#2fbf71"], lineOpacity: 0.92, lineWidth: ["interpolate", ["linear"], ["zoom"], 11.5, 1.8, 16, 5, 18.5, 8.5], lineCap: "round", lineJoin: "round" }),
    filters: BANDS.map((b) => ["==", ["get", "b"], b] as never),
  }), [vis, dark]);
  return (
    <GeoJSONSource id="trafico" data={json}>
      <Layer id="trafico-casing" type="line" minzoom={11.5} {...base.casing} />
      <Layer id="trafico-lines" type="line" minzoom={11.5} {...base.lines} />
      {BANDS.map((b) => (
        <Layer key={b} id={`trafico-flow-${b}`} type="line" minzoom={12.5} filter={base.filters[b]}
          {...sp({ visibility: vis, lineColor: "#ffffff", lineOpacity: b === 0 ? 0.65 : 0.88, lineWidth: ["interpolate", ["linear"], ["zoom"], 12.5, 0.9, 16, 2.6, 18.5, 4.6], lineDasharray: flowDashAt(b, t), lineCap: "butt", lineJoin: "round" })} />
      ))}
    </GeoJSONSource>
  );
});

/** El haz («linterna») que sale de tu punto hacia donde apunta el teléfono. Usa la brújula y tu ubicación solo si ya diste el permiso (no lo pide por su cuenta)
 *  y solo con el mapa al frente. La capa está siempre montada: sin dato, va vacía. */
const HeadingCone = memo(function HeadingCone({ active }: { active: boolean }) {
  const [at, setAt] = useState<{ lon: number; lat: number; rot: number } | null>(null);
  useEffect(() => {
    if (!active) return;
    let gone = false, pos: { lon: number; lat: number } | null = null, rot: number | null = null, shown = { lon: 0, lat: 0, rot: -999 };
    const subs: { remove(): void }[] = [];
    const push = () => {
      if (gone || !pos || rot == null) return;
      // solo se repinta si giraste al menos 3° o te moviste: la brújula avisa muchas veces por segundo
      const turn = Math.abs(((rot - shown.rot + 540) % 360) - 180);
      if (turn < 3 && Math.abs(pos.lon - shown.lon) < 0.00002 && Math.abs(pos.lat - shown.lat) < 0.00002) return;
      shown = { ...pos, rot };
      setAt(shown);
    };
    void (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted || gone) return;
        subs.push(await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, distanceInterval: 3 }, (p) => { pos = { lon: p.coords.longitude, lat: p.coords.latitude }; push(); }));
        subs.push(await Location.watchHeadingAsync((h) => { const v = h.trueHeading >= 0 ? h.trueHeading : h.magHeading; if (v >= 0) { rot = v; push(); } }));
        if (gone) subs.forEach((x) => x.remove());
      } catch { /* sin brújula (simulador) o sin permiso: no se dibuja el haz */ }
    })();
    return () => { gone = true; subs.forEach((x) => x.remove()); };
  }, [active]);
  const json = useMemo(() => JSON.stringify({ type: "FeatureCollection", features: at ? [{ type: "Feature", properties: { rot: at.rot }, geometry: { type: "Point", coordinates: [at.lon, at.lat] } }] : [] }), [at]);
  const style = useMemo(() => sp({ iconImage: "me-cone", iconSize: 0.5, iconRotate: ["get", "rot"], iconRotationAlignment: "map", iconPitchAlignment: "map", iconAllowOverlap: true, iconIgnorePlacement: true }), []);
  return (
    <GeoJSONSource id="me-heading" data={json}>
      <Layer id="me-cone" type="symbol" {...style} />
    </GeoJSONSource>
  );
});
