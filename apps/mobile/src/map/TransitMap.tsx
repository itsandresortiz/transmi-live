import { type ComponentProps, forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, StyleSheet } from "react-native";
import * as Location from "expo-location";
import { Camera, GeoJSONSource, Images, Layer, Map, RasterDEMSource, UserLocation, type CameraRef } from "@maplibre/maplibre-react-native";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import type { SystemType } from "@transmi/domain";
import { transit } from "@/composition-root";
import { nowMs } from "@/clock";
import { useTransitVersion } from "@/hooks";
import { useColors } from "@/ui/theme";
import { useAccessibility } from "@/accessibility";
import { BUILDINGS_3D_FILTER, BUS_3D_MIN_ZOOM, SIGNAL_3D_MIN_ZOOM, STATION_3D_MIN_ZOOM, busVolumes, signalVolumes, stationVolumes, CORRIDORS, PORTALS, type TripGeo, simulatedCabins, upcomingCablesGeo, alertStretch, buildStationGeometry, routeAlertViews, flowDashAt, hav, trafficBand, trafficSegments, trunkStations } from "@transmi/application";
import { TRUNK_LINES } from "@transmi/domain";
import { useSemaforos } from "./semaforos";
import { useTestsMode } from "@/tests";
import { useLiveSignals } from "./liveSignals";
import lightStyle from "./style-light.json";
import darkStyle from "./style-dark.json";
import { BUS_SPRITES } from "./sprites";
import { sp } from "./styleProps";
import { useBusFeatures, type Viewport } from "./useBuses";
import { SYSTEM_COLOR } from "@/ui/theme";
import { router } from "expo-router";
import { useRide } from "@/ride";
import { virtualRideId } from "@/virtualRide";

/** Base de OpenStreetMap servida por OpenFreeMap (gratis, sin llave). */
/** Mapa base claro u oscuro, según la apariencia de la app. Son los estilos de OpenFreeMap con colores propios (más contraste entre calles, parques y agua);
 *  los genera `tools/map-styles.py`: no editar los .json a mano. */
const MAP_STYLE = { light: lightStyle as never, dark: darkStyle as never };
/** Dónde quedó el mapa la última vez: al cambiar de apariencia el mapa se vuelve a montar (no se cambia el estilo en caliente) y retoma desde ahí. */
const lastView: { center: [number, number]; zoom: number; pitch: number } = { center: BOGOTA_LL(), zoom: 11.6, pitch: 0 };
function BOGOTA_LL(): [number, number] { return [-74.08, 4.65]; }
const BOGOTA: [number, number] = [-74.075, 4.65];
const STOP_ZOOM = 15.2;
/** Vista 3D: inclinación al encenderla y zoom desde el que salen los edificios con volumen (como en la web). */
const PITCH_3D = 58, BUILD_MIN_Z = 15;
/** Relieve: teselas de elevación abiertas «Terrain Tiles» (Mapzen) en AWS, gratis y sin llave (SRTM/NASA, de dominio público).
 *  MapLibre nativo aún no levanta el terreno en 3D (eso solo lo hace la web): aquí se usa para sombrear las laderas. Mientras la
 *  capa está oculta no se descarga ninguna tesela. */
const RELIEF_TILES = ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"];

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
  /** Vista 3D: cámara inclinada, se puede inclinar con dos dedos, edificios con volumen y sombra de los cerros. */
  view3d?: boolean;
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
/** TransMiCable en obra (no cambia mientras corre la app). */
const UPCOMING = upcomingCablesGeo();

export const TransitMap = forwardRef<TransitMapHandle, Props>(function TransitMap({ system = null, routeId = null, focusStopId = null, highlightIds = [], trip = null, onlyRoutes = null, active = true, showSignals = true, showStations = true, showTraffic = false, view3d = false, onView, compact = false, calm = false, attributionPosition = { bottom: 100, right: 8 }, onBus, onStop, children }, ref) {
  const c = useColors();
  const { reduceMotion } = useAccessibility();
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

  // el tramo de la ruta que toca cada aviso vigente (desvío, cierre), pintado encima del recorrido en ámbar; se quita solo cuando el aviso vence
  const alertsKey = transit.alerts;
  const alertLinesJson = useMemo(() => {
    const features: Feature<LineString>[] = [];
    if (routeId) {
      const shapes = transit.routeFamily(routeId).flatMap((id) => transit.network.shapes.get(id) ?? []);
      for (const { alert, view } of routeAlertViews(transit, routeId, nowMs() / 1000)) for (const sh of shapes) {
        const pts = alertStretch(transit, alert, sh);
        if (pts) features.push({ type: "Feature", properties: { tag: view.tag }, geometry: { type: "LineString", coordinates: pts.map((p) => [p.lon, p.lat]) } });
      }
    }
    return JSON.stringify({ type: "FeatureCollection", features });
  }, [routeId, transit.network, alertsKey]);   // eslint-disable-line react-hooks/exhaustive-deps

  /** Las troncales, cada una con el color de su línea (Suba amarillo, Norte verde, Caracas azul…), como en la web y en el plano oficial.
   *  Se dibuja el eje de cada avenida (una sola línea limpia), no el recorrido de cada ruta. No dependen de los datos en vivo. */
  const network = useMemo<FeatureCollection<LineString>>(() => ({
    type: "FeatureCollection",
    features: CORRIDORS.map((k) => ({ type: "Feature", properties: { l: k.l }, geometry: { type: "LineString", coordinates: k.p.map(([la, lo]) => [lo, la]) } })),
  }), []);

  /** TransMiCable: su línea y sus 4 estaciones (cabina roja con negro). Las cabinas no envían su ubicación: no hay nada en vivo que mover. */
  const cable = useMemo(() => {
    const lines: Feature<LineString>[] = [], stops = new globalThis.Map<string, Feature<Point>>();
    for (const [rid, shapes] of transit.network.shapes) {
      if (transit.network.routes.get(rid)?.system !== "cable") continue;
      const sh = shapes[0];
      if (sh && sh.points.length > 1) lines.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: sh.points.map((p) => [p.lon, p.lat]) } });
      // la cabina se gira como va el cable (como en la web)
      const a = sh?.points[0], b = sh?.points[Math.floor((sh?.points.length ?? 1) / 2)];
      const rot = a && b ? (Math.atan2((b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180), b.lat - a.lat) * 180) / Math.PI : 0;
      for (const s2 of shapes) for (const id of s2.stopIds) { const st = transit.network.stops.get(id); if (st && !stops.has(id)) stops.set(id, { type: "Feature", properties: { id, name: st.name, rot }, geometry: { type: "Point", coordinates: [st.position.lon, st.position.lat] } }); }
    }
    return { lines: { type: "FeatureCollection", features: lines } as FeatureCollection<LineString>, stops: { type: "FeatureCollection", features: [...stops.values()] } as FeatureCollection<Point> };
  }, [transit.network]);   // eslint-disable-line react-hooks/exhaustive-deps

  /** Cabinas del cable SIMULADAS según el horario oficial (TransMilenio no envía su ubicación): solo con el cable en pantalla, una vez por
   *  segundo, más suaves que los buses. Al tocar una se puede empezar «Voy en esta cabina». */
  const cableId = useMemo(() => [...transit.network.routes.values()].find((r) => r.system === "cable")?.id ?? null, [transit.network]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [cabins, setCabins] = useState<FeatureCollection<Point>>({ type: "FeatureCollection", features: [] });
  const cableOnScreen = !!view && view.zoom >= 12.5 && view.west < -74.135 && view.east > -74.165 && view.south < 4.572 && view.north > 4.547;
  useEffect(() => {
    if (!cableId || !active || !cableOnScreen) { setCabins((x) => (x.features.length ? { type: "FeatureCollection", features: [] } : x)); return; }
    const tick = () => setCabins({ type: "FeatureCollection", features: simulatedCabins(transit, cableId, nowMs()).map((cb) => ({ type: "Feature", properties: { from: cb.lastIndex, rot: cb.bearing }, geometry: { type: "Point", coordinates: [cb.lon, cb.lat] } })) });
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [cableId, active, cableOnScreen]);
  const onCabin = (from: number) => {
    if (!cableId) return;
    Alert.alert("Cabina de TransMiCable", "Es una cabina aproximada según el horario oficial: TransMilenio no envía la ubicación de las cabinas.", [
      { text: "Cerrar", style: "cancel" },
      { text: "Voy en esta cabina", onPress: () => { const id = virtualRideId(cableId, 0, from); useRide.getState().set(id, null); router.push({ pathname: "/ride/[id]", params: { id } }); } },
    ]);
  };

  /** Las estaciones de la troncal dibujadas como en la web: base, pasillo, vagones con puertas y su número. */
  const geo = useMemo(() => (transit.network.stops.size && transit.network.shapes.size ? buildStationGeometry(transit, trunkStations(transit), CORRIDORS) : null), [transit.network]);   // eslint-disable-line react-hooks/exhaustive-deps
  const stationGeo = useMemo(() => {
    const j = (x: unknown) => JSON.stringify(x ?? { type: "FeatureCollection", features: [] });
    // siempre con datos (vacíos mientras cargan las rutas): las capas quedan montadas desde el principio, porque agregarlas con el mapa ya abierto puede cerrar la app
    const g: Partial<NonNullable<typeof geo>> = geo ?? {};
    return { bases: j(g.bases), links: j(g.links), capsules: j(g.capsules), doors: j(g.doors), labels: j(g.labels), chips: j(g.chips) };
  }, [geo]);

  /** Vista 3D: las mismas estaciones levantadas (plataforma, vagones de vidrio con el techo del color de su línea). Se arman una vez al encender el 3D. */
  // Se arman DESPUÉS de la animación de inclinar (son ~1.500 piezas y ~2 MB de texto: armarlas en el mismo toque trababa el botón) y se
  // conservan al apagar el 3D (la capa solo se oculta), así volver a encenderlo es inmediato.
  const [stations3dJson, setStations3d] = useState(EMPTY_FC);
  const stations3dFor = useRef<unknown>(null), stations3dKey = useRef("");
  useEffect(() => {
    if (!view3d || !geo) return;
    const key = `${c.dark}`;
    if (stations3dFor.current === geo && stations3dKey.current === key) return;
    const id = setTimeout(() => {
      stations3dFor.current = geo; stations3dKey.current = key;
      setStations3d(JSON.stringify(stationVolumes(geo, (l) => (TRUNK_LINES as Record<string, { light: string; dark: string } | undefined>)[l]?.[c.dark ? "dark" : "light"] ?? "#e11d2e", { dark: c.dark })));
    }, reduceMotion ? 80 : 760);
    return () => clearTimeout(id);
  }, [view3d, geo, c.dark]);   // eslint-disable-line react-hooks/exhaustive-deps

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
  // vista 3D de cerca: los semáforos de la pantalla como poste y caja, sin luces de color (el color en vivo no se muestra al público)
  const signalPts = useMemo(() => {
    if (!view3d) return null;
    try { return (JSON.parse(signalsJson) as FeatureCollection<Point>).features.map((f) => ({ lon: f.geometry.coordinates[0]!, lat: f.geometry.coordinates[1]! })); } catch { return null; }
  }, [view3d, signalsJson]);
  const signals3dJson = useMemo(() => {
    const pts = signalPts && view && view.zoom >= SIGNAL_3D_MIN_ZOOM - 0.3 ? signalPts.filter((p) => p.lon > view.west && p.lon < view.east && p.lat > view.south && p.lat < view.north).slice(0, 400) : [];
    return JSON.stringify(signalVolumes(pts));
  }, [signalPts, view]);
  const testsOn = useTestsMode((t) => t.on);
  const liveSignalsJson = useLiveSignals(testsOn && showSignals && active);
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

  const onRegion = useCallback((e: { nativeEvent: { bounds: [number, number, number, number]; zoom: number; bearing?: number; center?: [number, number]; pitch?: number } }) => {
    const { bounds, zoom, bearing, center, pitch } = e.nativeEvent;
    setView({ west: bounds[0], south: bounds[1], east: bounds[2], north: bounds[3], zoom });
    // con el mapa inclinado el recuadro visible se alarga hacia el horizonte: el centro de verdad es el de la cámara
    lastCenter.current = center && Number.isFinite(center[0]) && Number.isFinite(center[1]) ? [center[0], center[1]] : [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
    if (!compact) { lastView.center = lastCenter.current; lastView.zoom = zoom; lastView.pitch = pitch ?? 0; }
    onView?.({ lat: lastCenter.current[1], lon: lastCenter.current[0], zoom, bearing: bearing ?? 0 });
  }, [onView]);

  // 3D: se inclina o se endereza la cámara sin moverla de sitio (el primer render ya sale con la inclinación guardada)
  const was3d = useRef(view3d);
  useEffect(() => {
    if (was3d.current === view3d) return;
    was3d.current = view3d;
    camera.current?.easeTo({ center: lastCenter.current, pitch: view3d ? PITCH_3D : 0, duration: reduceMotion ? 0 : 650 });
  }, [view3d]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Map key={c.dark ? "oscuro" : "claro"} style={StyleSheet.absoluteFill} mapStyle={c.dark ? MAP_STYLE.dark : MAP_STYLE.light} logo={false} attribution attributionPosition={attributionPosition} compass={false} touchPitch={view3d} onRegionDidChange={onRegion} onDidFinishLoadingMap={() => undefined}>
      <Camera ref={camera} initialViewState={compact ? { center: BOGOTA, zoom: 11.6 } : { center: lastView.center, zoom: lastView.zoom, pitch: view3d ? (lastView.pitch > 1 ? lastView.pitch : PITCH_3D) : 0 }} minZoom={9} maxZoom={19} />
      {/* vista 3D: sombra de los cerros y edificios con volumen. Siempre montadas (no se agregan ni quitan capas en caliente): se
          muestran u ocultan con `visibility`. Van debajo de los nombres de calles del mapa base y de todo lo de TransMi LIVE. */}
      <RasterDEMSource id="relieve" tiles={RELIEF_TILES} tileSize={256} maxzoom={14} encoding="terrarium" attribution="Relieve: Terrain Tiles (Mapzen, AWS) · SRTM">
        <Layer id="relieve-sombra" type="hillshade" beforeId="building" {...sp({ visibility: view3d ? "visible" : "none", hillshadeExaggeration: c.dark ? 0.35 : 0.3, hillshadeShadowColor: c.dark ? "#000000" : "#6b6455", hillshadeHighlightColor: c.dark ? "#2a2e36" : "#ffffff", hillshadeAccentColor: c.dark ? "#000000" : "#8a8270" })} />
      </RasterDEMSource>
      <Layer id="edificios-3d" type="fill-extrusion" source="openmaptiles" source-layer="building" minzoom={BUILD_MIN_Z} beforeId={c.dark ? "highway_name_other" : "highway-name-path"} filter={BUILDINGS_3D_FILTER as never}
        {...sp({ visibility: view3d ? "visible" : "none", fillExtrusionColor: c.dark ? "#353943" : "#dcd7cc",
          fillExtrusionHeight: ["interpolate", ["linear"], ["zoom"], BUILD_MIN_Z, 0, BUILD_MIN_Z + 0.6, ["coalesce", ["get", "render_height"], 6]],
          fillExtrusionBase: ["interpolate", ["linear"], ["zoom"], BUILD_MIN_Z, 0, BUILD_MIN_Z + 0.6, ["coalesce", ["get", "render_min_height"], 0]],
          fillExtrusionOpacity: c.dark ? 0.8 : 0.72, fillExtrusionVerticalGradient: true })} />
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
      {/* TransMiCable: siempre montado (agregar capas en caliente cierra la app) */}
      <GeoJSONSource id="cable-line" data={cable.lines}>
        <Layer id="cable-line" type="line" {...sp({ lineColor: c.dark ? "#e8e8ed" : "#1c1c1e", lineOpacity: 0.9, lineWidth: ["interpolate", ["linear"], ["zoom"], 10, 1.5, 14, 3, 17, 5], lineDasharray: [2, 1.2], lineCap: "butt", lineJoin: "round" })} />
      </GeoJSONSource>
      {/* TransMiCable en obra (San Cristóbal): tenue, punteado y con «Próximamente»; siempre montado */}
      <GeoJSONSource id="cable-upcoming-line" data={UPCOMING.lines as never}>
        <Layer id="cable-upcoming-line" type="line" {...sp({ lineColor: c.dark ? "#e8e8ed" : "#1c1c1e", lineOpacity: 0.35, lineWidth: ["interpolate", ["linear"], ["zoom"], 10, 1.2, 14, 2.6, 17, 4], lineDasharray: [1, 1.6], lineCap: "butt", lineJoin: "round" })} />
      </GeoJSONSource>
      <GeoJSONSource id="cable-upcoming-stations" data={UPCOMING.stations as never} onPress={(e) => { const p = e.nativeEvent.features[0]?.properties; if (p?.name) Alert.alert(`${String(p.line)}: ${String(p.name)}`, `${String(p.note)}. Todavía no presta servicio: cuando TransMilenio lo abra, aparecerá aquí con su horario.`); }}>
        <Layer id="cable-upcoming-station" type="symbol" minzoom={11} {...sp({ iconImage: "cabina", iconSize: ["interpolate", ["linear"], ["zoom"], 11, 0.18, 15, 0.3], iconRotate: ["get", "rot"], iconRotationAlignment: "map", iconAllowOverlap: true, iconIgnorePlacement: true, iconOpacity: 0.35, textField: ["step", ["zoom"], "", 12.5, ["concat", ["get", "name"], "\nPróximamente"]], textFont: ["Noto Sans Regular"], textSize: 11.5, textOffset: [0, 1.6], textAnchor: "top", textOptional: true, textColor: c.dark ? "#b4b4bb" : "#6c6c70", textHaloColor: nameHalo, textHaloWidth: 2 })} />
      </GeoJSONSource>
      <GeoJSONSource id="cable-cabins" data={cabins} onPress={(e) => { const f = e.nativeEvent.features[0]?.properties?.from; if (typeof f === "number") onCabin(f); }}>
        <Layer id="cable-cabin" type="symbol" minzoom={12.5} {...sp({ iconImage: "cabina", iconSize: ["interpolate", ["linear"], ["zoom"], 12.5, 0.14, 15, 0.22, 18, 0.34], iconRotate: ["get", "rot"], iconRotationAlignment: "map", iconAllowOverlap: true, iconIgnorePlacement: true, iconOpacity: 0.72 })} />
      </GeoJSONSource>
      <GeoJSONSource id="cable-stations" data={cable.stops} onPress={(e) => { const id = e.nativeEvent.features[0]?.properties?.id as string | undefined; if (id) onStop?.(id); }}>
        <Layer id="cable-station" type="symbol" minzoom={11} {...sp({ iconImage: "cabina", iconSize: ["interpolate", ["linear"], ["zoom"], 11, 0.2, 14, 0.25, 16, 0.32, 18, 0.45], iconRotate: ["get", "rot"], iconRotationAlignment: "map", iconAllowOverlap: true, iconIgnorePlacement: true, textField: ["step", ["zoom"], "", 13, ["get", "name"]], textFont: ["Noto Sans Regular"], textSize: 12, textOffset: [0, 1.8], textAnchor: "top", textOptional: true, textColor: nameColor, textHaloColor: nameHalo, textHaloWidth: 2 })} />
      </GeoJSONSource>
      {(
        <GeoJSONSource id="route-line" data={lineJson}>
          <Layer id="route-line-casing" type="line" {...sp({ lineColor: "#ffffff", lineWidth: 9, lineCap: "round", lineJoin: "round" })} />
          <Layer id="route-line-fill" type="line" {...sp({ lineColor: "#e11d2e", lineWidth: 5, lineCap: "round", lineJoin: "round" })} />
        </GeoJSONSource>
      )}
      {/* siempre montada (agregar capas en caliente cierra la app): vacía si la ruta no tiene avisos */}
      <GeoJSONSource id="alert-lines" data={alertLinesJson}>
        <Layer id="alert-line-casing" type="line" {...sp({ lineColor: "#ffffff", lineWidth: 10, lineCap: "round", lineJoin: "round" })} />
        <Layer id="alert-line" type="line" {...sp({ lineColor: "#f59e0b", lineWidth: 6, lineDasharray: [1.4, 1], lineCap: "butt", lineJoin: "round" })} />
        <Layer id="alert-line-label" type="symbol" minzoom={12} {...sp({ symbolPlacement: "line", textField: ["get", "tag"], textFont: ["Noto Sans Bold"], textSize: 12, textColor: "#92400e", textHaloColor: "#ffffff", textHaloWidth: 2, textOffset: [0, -1.1] })} />
      </GeoJSONSource>


      {(
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
          {/* vista 3D: vidrio translúcido (capa aparte, porque la opacidad no cambia por pieza) y plataforma y techos opacos */}
          <GeoJSONSource id="stations-3d" data={stations3dJson}>
            <Layer id="stations-3d" type="fill-extrusion" minzoom={STATION_3D_MIN_ZOOM} filter={["!", ["has", "g"]] as never} {...sp({ visibility: view3d && showStations ? "visible" : "none", fillExtrusionColor: ["get", "c"], fillExtrusionBase: ["get", "b"], fillExtrusionHeight: ["get", "h"], fillExtrusionOpacity: 0.95 })} />
            <Layer id="stations-3d-glass" type="fill-extrusion" minzoom={STATION_3D_MIN_ZOOM} filter={["has", "g"] as never} {...sp({ visibility: view3d && showStations ? "visible" : "none", fillExtrusionColor: ["get", "c"], fillExtrusionBase: ["get", "b"], fillExtrusionHeight: ["get", "h"], fillExtrusionOpacity: 0.45, fillExtrusionVerticalGradient: false })} />
          </GeoJSONSource>
          <GeoJSONSource id="station-labels" data={stationGeo.labels}>
            <Layer id="station-wagon-labels" type="symbol" minzoom={16.3} {...sp({ visibility: showStations ? "visible" : "none", textField: ["step", ["zoom"], ["get", "text"], 17.3, ["concat", "Vagón ", ["get", "text"]]], textFont: ["Noto Sans Regular"], textSize: ["interpolate", ["linear"], ["zoom"], 16.3, 10, 18.5, 13], textAllowOverlap: true, textIgnorePlacement: true, textColor: c.dark ? "#f4f4f5" : "#1c1c1e" })} />
          </GeoJSONSource>
          <GeoJSONSource id="station-chips" data={stationGeo.chips}>
            <Layer id="station-chip-labels" type="symbol" minzoom={14.5} {...sp({ visibility: showStations ? "visible" : "none", textField: ["get", "title"], textFont: ["Noto Sans Bold"], textSize: ["interpolate", ["linear"], ["zoom"], 14.5, 13, 18, 17], textAnchor: "bottom", textOffset: [0, -0.5], textMaxWidth: 12, textColor: nameColor, textHaloColor: nameHalo, textHaloWidth: 2.4 })} />
          </GeoJSONSource>
        </>
      )}
      {(
        <GeoJSONSource id="semaforos" data={signalsJson} onPress={(e) => { if (!useTestsMode.getState().on) return; const pr = e.nativeEvent.features[0]?.properties; if (pr?.title) Alert.alert(String(pr.title), String(pr.text ?? "")); }}>
          <Layer id="semaforos-dots" type="circle" minzoom={13.2} maxzoom={15.4} {...sp({ visibility: showSignals ? "visible" : "none", circleRadius: ["interpolate", ["linear"], ["zoom"], 13.2, 1.6, 15.4, 3.2], circleColor: "#e8503f", circleStrokeColor: "#ffffff", circleStrokeWidth: 1 })} />
          <Layer id="semaforos-icons" type="symbol" minzoom={15.4} {...sp({ visibility: showSignals ? "visible" : "none", iconImage: "semaforo", iconSize: ["interpolate", ["linear"], ["zoom"], 15.4, 0.2, 18, 0.36], iconAllowOverlap: true, iconIgnorePlacement: true, iconOpacity: view3d ? ["step", ["zoom"], 1, SIGNAL_3D_MIN_ZOOM, 0] : 1 })} />
          <Layer id="semaforos-labels" type="symbol" minzoom={17.2} {...sp({ visibility: showSignals ? "visible" : "none", textField: ["get", "dir"], textFont: ["Noto Sans Regular"], textSize: 10.5, textOffset: [0, 1.35], textAnchor: "top", textOptional: true, textColor: c.dark ? "#b4b4bb" : "#6c6c70", textHaloColor: c.dark ? "#0b0b0d" : "#eef0f3", textHaloWidth: 1.2 })} />
        </GeoJSONSource>
      )}
      <GeoJSONSource id="semaforos-3d" data={signals3dJson}>
        <Layer id="semaforos-3d" type="fill-extrusion" minzoom={SIGNAL_3D_MIN_ZOOM} {...sp({ visibility: view3d && showSignals ? "visible" : "none", fillExtrusionColor: ["get", "c"], fillExtrusionBase: ["get", "b"], fillExtrusionHeight: ["get", "h"], fillExtrusionOpacity: 0.95 })} />
      </GeoJSONSource>
      {/* solo en modo de pruebas: los semáforos medidos a mano con el color que deberían tener ahora (siempre montada, vacía si no) */}
      <GeoJSONSource id="signal-live" data={liveSignalsJson}>
        <Layer id="signal-live-dot" type="circle" minzoom={13} {...sp({ circleRadius: ["interpolate", ["linear"], ["zoom"], 13, 5, 18, 11], circleColor: ["get", "color"], circleStrokeColor: "#ffffff", circleStrokeWidth: 2, circleTranslate: [14, -14] })} />
      </GeoJSONSource>
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
      <BusLayer view={view} system={system} routeId={routeId} routeIds={onlyRoutes} active={active} calm={calm} highlightIds={highlightIds} dark={c.dark} view3d={view3d} onBus={onBus} />
      {children}
    </Map>
  );
});

const EMPTY_FC = JSON.stringify({ type: "FeatureCollection", features: [] });
/** Los buses, aparte del resto del mapa: se recalculan muchas veces por segundo y así solo se repinta esta capa (no las estaciones, la red ni los semáforos).
 *  Los estilos de las capas se crean una sola vez: en cada tanda lo único que cambia son los datos. */
const BusLayer = memo(function BusLayer({ view, system, routeId, routeIds = null, active, calm, highlightIds, dark, view3d = false, onBus }: { view: Viewport | null; system: SystemType | null; routeId: string | null; routeIds?: readonly string[] | null; active: boolean; calm: boolean; highlightIds: string[]; dark: boolean; view3d?: boolean; onBus?: (id: string) => void }) {
  const { reduceMotion } = useAccessibility();
  const buses = useBusFeatures(view, { system, routeId, routeIds, enabled: active, everyMs: calm ? 2000 : reduceMotion ? 250 : 0, keepIds: highlightIds });
  const json = useMemo(() => JSON.stringify(buses), [buses]);
  // vista 3D de cerca: cada bus con volumen (carrocería, vidrios, techo; la troncal con fuelle), armado con la misma cuenta que la web.
  // Solo los de la pantalla y solo desde un poco antes del zoom en que se ven; la capa está siempre montada.
  const solid = view3d && !!view && view.zoom >= BUS_3D_MIN_ZOOM - 0.5;
  const volumesJson = useMemo(() => {
    if (!solid || !view) return EMPTY_FC;
    const px = (view.east - view.west) * 0.15, py = (view.north - view.south) * 0.15;      // margen: buses que entran a la pantalla entre un movimiento y otro
    const inView = buses.features.filter((f) => { const [lon, lat] = f.geometry.coordinates as [number, number]; return lon > view.west - px && lon < view.east + px && lat > view.south - py && lat < view.north + py; });
    return JSON.stringify(busVolumes(inView.map((f) => {
      const p = f.properties ?? {}, [lon, lat] = f.geometry.coordinates as [number, number];
      return { id: String(p.id), lon, lat, heading: typeof p.rot === "number" ? p.rot : null, color: String(p.color), long: String(p.sprite).endsWith("-l"), stale: typeof p.o === "number" && p.o < 1 };
    }), { dark }));
  }, [solid, buses, dark]);   // eslint-disable-line react-hooks/exhaustive-deps
  const ringKey = highlightIds.join(",");
  const st = useMemo(() => ({
    ring: sp({ circleRadius: 22, circleColor: "#e11d2e", circleOpacity: 0.12, circleStrokeColor: "#e11d2e", circleStrokeWidth: 3 }),
    ringFilter: ["in", ["get", "id"], ["literal", highlightIds.length ? highlightIds : ["__ninguno__"]]] as never,
    hit: sp({ circleRadius: 20, circleColor: "#000000", circleOpacity: 0.01 }),
    alert: sp({ circleRadius: ["interpolate", ["linear"], ["zoom"], 13, 4.5, 17, 7], circleColor: "#f59e0b", circleStrokeColor: "#ffffff", circleStrokeWidth: 1.5, circleTranslate: [9, -9], circleOpacity: ["get", "o"], circleStrokeOpacity: ["get", "o"] }),
    alertMark: sp({ textField: "!", textFont: ["Noto Sans Bold"], textSize: ["interpolate", ["linear"], ["zoom"], 13, 8, 17, 11], textColor: "#ffffff", textTranslate: [9, -9], textAllowOverlap: true, textIgnorePlacement: true, textOpacity: ["get", "o"] }),
    dot: sp({ circleRadius: ["interpolate", ["linear"], ["zoom"], 9, 2.6, 11.8, 4], circleColor: ["get", "color"], circleStrokeColor: "#ffffff", circleStrokeWidth: 1, circleOpacity: ["get", "o"], circleStrokeOpacity: ["get", "o"] }),
    sprite: sp({
      // un bus que dejó de reportar hace rato se ve atenuado: sigue ahí, pero su dato es viejo. En 3D de cerca lo reemplaza el bus con volumen
      iconOpacity: view3d ? ["step", ["zoom"], ["get", "o"], BUS_3D_MIN_ZOOM, 0] : ["get", "o"],
      iconImage: ["get", "sprite"], iconSize: ["interpolate", ["linear"], ["zoom"], 11.8, 0.115, 14, 0.19, 16, 0.3, 18, 0.45],
      iconRotate: ["get", "rot"], iconRotationAlignment: "map", iconPitchAlignment: "map", iconAllowOverlap: true, iconIgnorePlacement: true,
    }),
    label: sp({
      textField: ["get", "route"], textFont: ["Noto Sans Regular"], textSize: 11, textOffset: [0, -1.5], textColor: dark ? "#f4f4f5" : "#111827",
      textHaloColor: dark ? "#18181b" : "#ffffff", textHaloWidth: 1.6, textAllowOverlap: false,
    }),
  }), [dark, ringKey, view3d]);   // eslint-disable-line react-hooks/exhaustive-deps
  const press = useCallback((e: { nativeEvent: { features: { properties?: Record<string, unknown> | null }[] } }) => { const id = e.nativeEvent.features[0]?.properties?.id as string | undefined; if (id) onBus?.(id); }, [onBus]);
  return (
    <>
    <GeoJSONSource id="buses-3d" data={volumesJson} onPress={press as never}>
      <Layer id="buses-3d" type="fill-extrusion" minzoom={BUS_3D_MIN_ZOOM} {...sp({ visibility: view3d ? "visible" : "none", fillExtrusionColor: ["get", "c"], fillExtrusionBase: ["get", "b"], fillExtrusionHeight: ["get", "h"], fillExtrusionOpacity: 1, fillExtrusionVerticalGradient: true })} />
    </GeoJSONSource>
    <GeoJSONSource id="buses" data={json} onPress={press as never}>
      <Layer id="bus-ring" type="circle" filter={st.ringFilter} {...st.ring} />
      <Layer id="bus-hit" type="circle" {...st.hit} />
      <Layer id="bus-dot" type="circle" maxzoom={11.8} {...st.dot} />
      <Layer id="bus-sprite" type="symbol" minzoom={11.8} {...st.sprite} />
      <Layer id="bus-label" type="symbol" minzoom={15} {...st.label} />
      {/* marca ámbar «!» en los buses de una ruta con aviso vigente (desvío, cierre); siempre montada, filtrada por la propiedad `al` */}
      <Layer id="bus-alert" type="circle" minzoom={13} filter={["==", ["get", "al"], 1] as never} {...st.alert} />
      <Layer id="bus-alert-mark" type="symbol" minzoom={13} filter={["==", ["get", "al"], 1] as never} {...st.alertMark} />
    </GeoJSONSource>
    </>
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
