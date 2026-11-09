import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { StatusBar } from "expo-status-bar";
import { router, useIsFocused, usePathname } from "expo-router";
import { SYSTEMS, SYSTEM_LABEL, type SystemType } from "@transmi/domain";
import { toGeo } from "@transmi/domain";
import { transit } from "@/composition-root";
import { motion } from "@/map/engine";
import { useMapFocus } from "@/map/focus";
import { TransitMap, type TransitMapHandle } from "@/map/TransitMap";
import { locateMe } from "@/location";
import { FeedStatus } from "@/ui/FeedStatus";
import { Chip, Glass, RoundButton } from "@/ui/kit";
import { space, type, useColors } from "@/ui/theme";

export default function Mapa() {
  const insets = useSafeAreaInsets();
  const map = useRef<TransitMapHandle>(null);
  const focused = useIsFocused();
  const c = useColors();
  const focus = useMapFocus();
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

  const locate = async () => { const me = await locateMe(); if (me) map.current?.flyTo(me.lat, me.lon, 15.8); };

  return (
    <View style={styles.screen}>
      {focused ? <StatusBar style="dark" /> : null}
      {/* el mapa no se lee con VoiceOver: las pestañas Rutas y Cómo llegar dicen lo mismo con texto */}
      <View style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <TransitMap ref={map} system={system} active={focused} calm={calm} routeId={focus.routeId} focusStopId={focus.stopId} highlightIds={focus.busIds}
        onBus={(id) => { void Haptics.selectionAsync(); router.navigate({ pathname: "/bus/[id]", params: { id } }); }}
        onStop={(id) => router.navigate({ pathname: "/stop/[id]", params: { id } })} />
      </View>
      <View pointerEvents="box-none" style={[styles.top, { top: insets.top + space[2] }]}>
        <Glass style={styles.chipsGlass}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            <Chip label="Todos" selected={!system} onPress={() => setSystem(null)} />
            {SYSTEMS.map((s) => <Chip key={s} label={SYSTEM_LABEL[s]} selected={system === s} onPress={() => setSystem(system === s ? null : s)} />)}
          </ScrollView>
        </Glass>
      </View>
      {focus.stopId || focus.routeId || focus.followBusId ? (
        <View style={[styles.focusChip, { top: insets.top + 72 }]}>
          <Glass interactive style={styles.focusGlass}>
            <View style={styles.focusRow}>
              <Text style={[type.caption, { color: c.text, flex: 1 }]} numberOfLines={1}>
                {focus.followBusId ? "Siguiendo un bus" : focus.stopId ? `Parada: ${transit.stopById(focus.stopId)?.name ?? ""}` : "Ruta seleccionada"}
              </Text>
              <RoundButton symbol="xmark" label="Quitar la selección" onPress={() => focus.clear()} size={32} />
            </View>
          </Glass>
        </View>
      ) : null}
      <View pointerEvents="none" style={[styles.status, { bottom: insets.bottom + 118 }]}><FeedStatus /></View>
      <View pointerEvents="box-none" style={[styles.side, { bottom: insets.bottom + 110 }]}>
        <RoundButton symbol="location.fill" label="Mi ubicación" onPress={() => void locate()} size={52} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  top: { position: "absolute", left: space[4], right: space[4] },
  chipsGlass: { borderRadius: 28, overflow: "hidden" },
  chips: { gap: space[2], padding: space[2] },
  side: { position: "absolute", right: space[4] },
  status: { position: "absolute", left: space[4] },
  focusChip: { position: "absolute", left: space[4], right: space[4] },
  focusGlass: { borderRadius: 24, overflow: "hidden" },
  focusRow: { flexDirection: "row", alignItems: "center", gap: space[2], paddingLeft: space[4], paddingRight: space[1], paddingVertical: space[1] },
});
