import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Location from "expo-location";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/ui/Symbol";
import { router, useIsFocused, usePathname } from "expo-router";
import { hav } from "@transmi/application";
import { SYSTEMS, SYSTEM_LABEL, routeTitle, type SystemType } from "@transmi/domain";
import { toGeo } from "@transmi/domain";
import { transit } from "@/composition-root";
import { motion } from "@/map/engine";
import { useMapFocus } from "@/map/focus";
import { useMapLayers } from "@/map/layers";
import { useRide } from "@/ride";
import { nowMs } from "@/clock";
import { useNow, useTransitVersion } from "@/hooks";
import { etaText } from "@/format";
import { stopText } from "@/stopname";
import { RouteBadge } from "@/ui/RouteBadge";
import { TransitMap, type TransitMapHandle } from "@/map/TransitMap";
import { locateMe } from "@/location";
import { FeedStatus } from "@/ui/FeedStatus";
import { Glass, RoundButton, Tap, Toggle } from "@/ui/kit";
import { GlassSegments } from "@/ui/GlassSegments";
import { SYSTEM_COLOR, space, type, useColors, useOnMap } from "@/ui/theme";

/** El mapa se centra en tu ubicación solo la primera vez que se abre en cada sesión (después respeta por dónde lo dejaste). */
let centeredOnce = false;
const BOGOTA = { lat: 4.65, lon: -74.08 };
const AWAY_METERS = 150;      // más lejos de esto, aparece el botón para volver

export default function Mapa() {
  const insets = useSafeAreaInsets();
  const map = useRef<TransitMapHandle>(null);
  const focused = useIsFocused();
  const c = useColors();
  const focus = useMapFocus();
  const om = useOnMap();
    const calm = usePathname() !== "/mapa";   // hay una hoja abierta encima del mapa

  // al llegar con una parada elegida: se encuadra la parada y los buses que se acercan; si se sigue un bus, el mapa lo acompaña
  useEffect(() => {
    if (!focused) return;
    const stop = focus.stopId ? transit.stopById(focus.stopId) : undefined;
    const pts = [...(stop ? [stop.position] : []), ...focus.busIds.flatMap((id) => { const v = transit.fleet.get(id); return v ? [v.position] : []; })];
    if (pts.length) setTimeout(() => map.current?.fit(pts, 80), 250);
  }, [focused, focus.stopId, focus.routeId]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!focused || !focus.followBusId) return;
    const t = setInterval(() => { const v = transit.fleet.get(focus.followBusId!); if (!v) return; const p = motion.peek(v.id); const g = p ? toGeo(p) : v.position; map.current?.flyTo(g.lat, g.lon, 16.5); }, 1500);
    return () => clearInterval(t);
  }, [focused, focus.followBusId]);
  const [system, setSystem] = useState<SystemType | null>(null);

  // tu ubicación mientras el mapa está a la vista (solo con la app abierta; no se guarda)
  const [me, setMe] = useState<{ lat: number; lon: number } | null>(null);
  const [center, setCenter] = useState<{ lat: number; lon: number; zoom: number; bearing: number } | null>(null);
  const [denied, setDenied] = useState(false);
  const [panel, setPanel] = useState(false);
  const layers = useMapLayers();
  // el bus que se sigue: su ruta y su próxima parada con la hora a la que llega
  useTransitVersion();
  const nowS = useNow(2000) / 1000;
  const followV = focus.followBusId ? transit.fleet.get(focus.followBusId) : undefined;
  const followRoute = followV ? transit.routeOf(followV) : undefined;
  const followNext = followV ? transit.nextStopOf(followV, nowMs()) : undefined;
  // si además marcaste «Voy en este bus», la tarjeta lo dice y recuerda dónde te bajas
  const rideBus = useRide((s) => s.busId), rideStop = useRide((s) => s.alightId);
  const riding = !!focus.followBusId && rideBus === focus.followBusId;
  const alight = riding && rideStop ? transit.stopById(rideStop) : undefined;
  const stopFollowing = () => { if (riding) useRide.getState().clear(); focus.clear(); };
  useEffect(() => {
    if (!focused) return;
    let sub: Location.LocationSubscription | undefined, gone = false;
    void (async () => {
      const first = await locateMe();
      if (gone) return;
      if (!first) { const p = await Location.getForegroundPermissionsAsync().catch(() => null); if (p && !p.granted) setDenied(true); return; }
      setDenied(false); setMe(first);
      sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, distanceInterval: 15, timeInterval: 4000 }, (p) => { if (!gone) setMe({ lat: p.coords.latitude, lon: p.coords.longitude }); }).catch(() => undefined);
      if (gone) sub?.remove();
    })();
    return () => { gone = true; sub?.remove(); };
  }, [focused]);

  // la primera vez, el mapa abre ya sobre ti con zoom de calle (si estás en Bogotá y no vienes a ver una parada, ruta o bus)
  useEffect(() => {
    if (centeredOnce || !me || !focused) return;
    if (focus.stopId || focus.routeId || focus.followBusId || focus.busIds.length || focus.locate) return;
    centeredOnce = true;
    if (hav(me, BOGOTA) < 60_000) setTimeout(() => map.current?.flyTo(me.lat, me.lon, 15.6), 250);
  }, [me, focused, focus.stopId, focus.routeId, focus.followBusId, focus.busIds.length, focus.locate]);

  const onView = useCallback((v: { lat: number; lon: number; zoom: number; bearing: number }) => setCenter(v), []);
  const rotated = !!center && Math.abs(((center.bearing + 180) % 360) - 180) > 1.5;      // la brújula solo se muestra cuando el mapa está girado
  const away = !me || !center || hav(center, me) > AWAY_METERS || center.zoom < 12.5;       // el botón solo hace falta cuando te alejaste (o aún no sabemos dónde estás)
  const locate = async () => {
    const here = me ?? (await locateMe());
    if (here) { setMe(here); map.current?.flyTo(here.lat, here.lon, 15.8); return; }
    Alert.alert("No pudimos ubicarte", "Activa la ubicación para TransMi LIVE en Ajustes y vuelve a intentarlo. Solo se usa con la app abierta y no se guarda.", [{ text: "Ahora no", style: "cancel" }, { text: "Abrir Ajustes", onPress: () => void Linking.openSettings() }]);
  };
  // «Cerca de mí» pide que el mapa te ubique al llegar
  useEffect(() => { if (focused && focus.locate) { useMapFocus.setState({ locate: false }); setTimeout(() => void locate(), 300); } }, [focused, focus.locate]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={styles.screen}>
      {focused ? <StatusBar style="dark" /> : null}
      {/* el mapa no se lee con VoiceOver: las pestañas Rutas y Cómo llegar dicen lo mismo con texto */}
      <View style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <TransitMap ref={map} system={system} active={focused} calm={calm} showSignals={layers.signals} showStations={layers.stations} showTraffic={layers.traffic} onView={onView} attributionPosition={{ bottom: insets.bottom + 72, right: 18 }} routeId={focus.routeId} focusStopId={focus.stopId} highlightIds={focus.busIds}
        onBus={(id) => { void Haptics.selectionAsync(); router.navigate({ pathname: "/bus/[id]", params: { id } }); }}
        onStop={(id) => router.navigate({ pathname: "/stop/[id]", params: { id } })} />
      </View>
      {/* velo bajo la hora y la batería: el mapa es claro y el texto del sistema no siempre contrasta */}
      <View pointerEvents="none" style={[styles.scrim, { height: insets.top + 6 }]}>
        {[0.3, 0.2, 0.12, 0.06].map((o, i) => <View key={i} style={{ flex: 1, backgroundColor: c.dark ? `rgba(0,0,0,${o})` : `rgba(255,255,255,${o + 0.2})` }} />)}
      </View>
      <View pointerEvents="box-none" style={[styles.top, { top: insets.top + space[2] }]}>
        <GlassSegments value={system ?? "todos"} onChange={(k) => setSystem(k === "todos" ? null : k)}
          items={[{ key: "todos", label: "Todos" }, ...SYSTEMS.map((x) => ({ key: x, label: SYSTEM_LABEL[x], dot: SYSTEM_COLOR[x] }))]} />
      </View>
      {panel ? (
        <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(140)} style={[styles.panel, { bottom: insets.bottom + (away ? 140 : 80) }]}>
          <Glass scheme="light" style={styles.panelGlass}>
            <View style={{ padding: space[4], gap: space[3] }}>
              <Text style={[type.eyebrow, { color: om.sub }]}>CAPAS DEL MAPA</Text>
              {([["signals", "Semáforos"], ["stations", "Estaciones con sus vagones"], ["traffic", "Tráfico (velocidad de los buses)"]] as const).map(([k, label]) => (
                <View key={k} style={styles.panelRow}>
                  <Text style={[type.body, { color: om.ink, flex: 1 }]}>{label}</Text>
                  <Toggle value={layers[k]} onChange={(v) => layers.set(k, v)} label={label} />
                </View>
              ))}
            </View>
          </Glass>
        </Animated.View>
      ) : null}
      {rotated ? (
        <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(160)} style={[styles.compass, { top: insets.top + (focus.followBusId ? (alight ? 227 : 205) : focus.stopId || focus.routeId ? 132 : 82) }]}>
          <Tap onPress={() => map.current?.resetNorth()} accessibilityRole="button" accessibilityLabel="Orientar el mapa hacia el norte">
            <Glass interactive scheme="light" style={styles.compassGlass}>
              <View style={{ transform: [{ rotate: `${-(center?.bearing ?? 0)}deg` }] }}><SymbolView name="location.north.fill" tintColor="#d4162a" size={20} /></View>
            </Glass>
          </Tap>
        </Animated.View>
      ) : null}
      {focus.followBusId ? (
        <View style={[styles.focusChip, { top: insets.top + 72 }]}>
          <Glass interactive scheme="light" style={styles.followGlass}>
            <View style={styles.followBox}>
              {followV ? (
                <>
                  <View style={styles.followTop}>
                    {followRoute ? <RouteBadge route={followRoute} /> : null}
                    <View style={{ flex: 1 }}>
                      <Text style={[type.caption, { color: om.sub }]} numberOfLines={1}>{riding ? "Vas en este bus" : "Siguiendo"} · {followV.plate || followV.label || followV.id}</Text>
                      <Text style={[type.eyebrow, { color: om.sub, marginTop: 2 }]}>PRÓXIMA PARADA</Text>
                    </View>
                    <RoundButton symbol="xmark" label={riding ? "Terminar el viaje y dejar de seguir este bus" : "Dejar de seguir este bus"} onPress={stopFollowing} size={32} light />
                  </View>
                  {followNext ? (
                    <View style={styles.followNext}>
                      <Text style={[type.headline, { color: om.ink, flex: 1 }]} numberOfLines={2}>{stopText(followNext.stop, followNext.stopId)}</Text>
                      {followNext.arrivalAt ? <Text style={[type.title, { color: om.accent }]}>{etaText(followNext.arrivalAt, nowS)}</Text> : null}
                    </View>
                  ) : <Text style={[type.body, { color: om.sub }]}>No podemos calcular su próxima parada ahora.</Text>}
                  {alight ? <Text style={[type.caption, { color: om.sub }]} numberOfLines={1}>Te bajas en {stopText(alight, rideStop ?? "")}</Text> : null}
                  <Tap onPress={() => router.push({ pathname: "/ride/[id]", params: { id: followV.id } })} accessibilityRole="button" accessibilityLabel="Ver todas las próximas paradas de este bus"><Text style={[type.caption, { color: om.accent, fontSize: 14 }]}>Ver todas las paradas ›</Text></Tap>
                </>
              ) : (
                <View style={styles.followTop}>
                  <Text style={[type.headline, { color: om.ink, flex: 1 }]}>Este bus dejó de reportar</Text>
                  <RoundButton symbol="xmark" label="Quitar la selección" onPress={stopFollowing} size={32} light />
                </View>
              )}
            </View>
          </Glass>
        </View>
      ) : focus.stopId || focus.routeId ? (
        <View style={[styles.focusChip, { top: insets.top + 72 }]}>
          <Glass interactive scheme="light" style={styles.focusGlass}>
            <View style={styles.focusRow}>
              {focus.stopId ? (
                <Tap style={{ flex: 1 }} onPress={() => router.push({ pathname: "/stop/[id]", params: { id: focus.stopId! } })} accessibilityRole="button" accessibilityLabel={`Parada ${stopText(transit.stopById(focus.stopId), "")}. Ver sus llegadas`}>
                  <Text style={[type.caption, { color: om.sub }]}>Parada · toca para ver llegadas</Text>
                  <Text style={[type.headline, { color: om.ink, fontSize: 15 }]} numberOfLines={1}>{stopText(transit.stopById(focus.stopId), "")}</Text>
                </Tap>
              ) : (() => {
                // qué ruta es, hacia dónde va y cuántos buses suyos hay en la calle; al tocar se abre su ficha
                const r = transit.routeById(focus.routeId!);
                const fam = new Set(transit.routeFamily(focus.routeId!)); let n = 0; for (const v of transit.fleet.values()) if (fam.has(v.routeId)) n++;      // los dos sentidos
                return (
                  <Tap style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: space[2] }} onPress={() => router.push({ pathname: "/route/[id]", params: { id: focus.routeId! } })} accessibilityRole="button"
                    accessibilityLabel={`Ruta ${r?.shortName ?? ""} ${r?.longName ?? ""}, ${n} ${n === 1 ? "bus" : "buses"} en la calle. Ver la ruta`}>
                    {r ? <RouteBadge route={r} /> : null}
                    <View style={{ flex: 1 }}>
                      <Text style={[type.headline, { color: om.ink, fontSize: 15 }]} numberOfLines={1}>{r ? routeTitle(r) : "Ruta seleccionada"}</Text>
                      <Text style={[type.caption, { color: om.sub }]} numberOfLines={1}>{n ? `${n} ${n === 1 ? "bus" : "buses"} en la calle` : "Sin buses en la calle ahora"} · toca para ver paradas</Text>
                    </View>
                  </Tap>
                );
              })()}
              <RoundButton symbol="xmark" label="Quitar la selección" onPress={() => focus.clear()} size={32} light />
            </View>
          </Glass>
        </View>
      ) : null}
      {/* el estado del servicio y el botón de ubicación van en una fila de vidrio justo encima de la barra inferior (en estas pantallas el margen de abajo ya cuenta la barra) */}
      <View pointerEvents="box-none" style={[styles.bottomRow, { bottom: insets.bottom + 12 }]}>
        <View pointerEvents="none"><FeedStatus light /></View>
        <View pointerEvents="box-none" style={styles.rightCol}>
          <RoundButton symbol="square.3.layers.3d" label="Capas del mapa" onPress={() => setPanel((p) => !p)} size={46} light />
          {away ? <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(180)}><RoundButton symbol={denied ? "location.slash.fill" : "location.fill"} label={denied ? "Activar mi ubicación" : "Volver a mi ubicación"} onPress={() => void locate()} size={52} light /></Animated.View> : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  top: { position: "absolute", left: space[4], right: space[4] },
  bottomRow: { position: "absolute", left: space[4], right: space[4], flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  rightCol: { alignItems: "center", gap: space[3] },
  panel: { position: "absolute", right: space[4], width: 270 },
  panelGlass: { borderRadius: 28, overflow: "hidden" },
  panelRow: { flexDirection: "row", alignItems: "center", gap: space[3] },
  compass: { position: "absolute", right: space[4] },
  compassGlass: { width: 46, height: 46, borderRadius: 23, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  scrim: { position: "absolute", top: 0, left: 0, right: 0 },
  focusChip: { position: "absolute", left: space[4], right: space[4] },
  focusGlass: { borderRadius: 24, overflow: "hidden" },       // fila de 40 de alto: píldora, concéntrica con su botón (radio 16 + margen 4)
  followGlass: { borderRadius: 28, overflow: "hidden" },      // margen 12 + botón de radio 16 en la esquina
  followBox: { padding: space[3], gap: space[2] },
  followTop: { flexDirection: "row", alignItems: "center", gap: space[2] },
  followNext: { flexDirection: "row", alignItems: "center", gap: space[3] },
  focusRow: { flexDirection: "row", alignItems: "center", gap: space[2], paddingLeft: space[4], paddingRight: space[1], paddingVertical: space[1] },
});
