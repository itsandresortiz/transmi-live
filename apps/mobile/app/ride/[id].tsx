import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { allowAlerts } from "@/notify";
import { useRide } from "@/ride";
import { SymbolView } from "expo-symbols";
import { arrivalAtIndex } from "@transmi/application";
import { SYSTEM_LABEL, routeTitle } from "@transmi/domain";
import { transit } from "@/composition-root";
import { nowMs } from "@/clock";
import { useNow, useTransitVersion } from "@/hooks";
import { etaText } from "@/format";
import { hm } from "@/planner/format";
import { stopText } from "@/stopname";
import { useMapFocus } from "@/map/focus";
import { Card, PrimaryButton, Tap } from "@/ui/kit";
import { CloseToolbar } from "@/ui/CloseToolbar";
import { RouteBadge } from "@/ui/RouteBadge";
import { RideScene } from "@/ui/RideScene";
import { SYSTEM_COLOR, radius, space, type, useColors } from "@/ui/theme";

const MAX_STOPS = 30;

/** «Voy en este bus»: las próximas paradas del bus con la hora estimada de llegada a cada una. Tocando una se marca donde bajas y la app avisa (vibración) antes de llegar. */
export default function Ride() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  useTransitVersion();
  const now = useNow() / 1000;
  const rideBus = useRide((st) => st.busId), rideStop = useRide((st) => st.alightId);
  const alightId = rideBus === id ? rideStop : null;      // el destino marcado solo cuenta si es para este bus
  const rideTotal = useRide((st) => st.total);
  const setAlightId = (stop: string | null, total = 0) => { if (stop) { void allowAlerts(); useRide.getState().set(id, stop, total); } else useRide.getState().clear(); };
  const v = transit.fleet.get(id);
  const r = v ? transit.routeOf(v) : undefined;
  const seq = v ? transit.sequenceForDisplay(v) : undefined;
  const color = v ? SYSTEM_COLOR[v.system] : c.accent;

  const stops = useMemo(() => {
    if (!v || !seq) return [];
    const out: { id: string; index: number; at: number }[] = [];
    const last = Math.min(seq.shape.stopIds.length - 1, seq.index + MAX_STOPS);
    for (let j = seq.index + 1; j <= last; j++) out.push({ id: seq.shape.stopIds[j]!, index: j, at: arrivalAtIndex(transit, v, seq.shape, seq.index, j, nowMs()) });
    return out;
  }, [v, seq?.shape, seq?.index, Math.floor(now / 5)]);   // eslint-disable-line react-hooks/exhaustive-deps

  const left = alightId && seq ? seq.shape.stopIds.indexOf(alightId, Math.max(0, seq.index)) - seq.index : null;
  const showOnMap = () => { useMapFocus.getState().set({ stopId: null, routeId: r?.id ?? null, busIds: v ? [v.id] : [], followBusId: v?.id ?? null }); router.dismissAll(); router.navigate("/mapa"); };

  if (!v) return <View style={[styles.screen, { backgroundColor: c.bg }]}><Text style={[type.headline, { color: c.text, marginTop: space[6] }]}>Este bus dejó de reportar</Text><Text style={[type.body, { color: c.muted }]}>Puede haber terminado su recorrido. Revisa por la ventana del bus.</Text></View>;
  const silent = now - v.reportedAt > 120;
  const next = stops[0];
  const nextStop = next ? transit.stopById(next.id) : undefined;
  const arrived = left != null && left <= 0;
  // barra de avance: paradas desde que marcaste dónde bajas (como mucho 14 segmentos a la vista)
  const segments = Math.max(rideTotal, left ?? 0), done = Math.max(0, segments - Math.max(0, left ?? 0)), shown = Math.min(14, segments);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <CloseToolbar />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.screen, { paddingTop: space[4], paddingBottom: insets.bottom + space[10] * 2 }]} showsVerticalScrollIndicator={false}>
        {!seq || !next ? (
          <>
            <View style={styles.head}>
              {r ? <RouteBadge route={r} /> : null}
              <Text style={[type.title, { color: c.text, flex: 1 }]} numberOfLines={2}>{r ? routeTitle(r) : SYSTEM_LABEL[v.system]}</Text>
            </View>
            <Card><Text style={[type.headline, { color: c.text }]}>No podemos ubicar este bus en su ruta</Text><Text style={[type.body, { color: c.muted, marginTop: space[1] }]}>TransMilenio no nos da suficiente información de este viaje para calcular sus próximas paradas.</Text></Card>
          </>
        ) : (
          <>
            {/* como un tablero de a bordo: a dónde llegas, la vía corriendo y lo que falta */}
            <View style={{ alignItems: "center", gap: 4 }}>
              <Text style={[type.title, { color: c.text, textAlign: "center" }]} numberOfLines={2}>{arrived ? "¡Llegaste!" : `Llegando a ${transit.labelOf(nextStop ?? { id: next.id, code: "", name: next.id, position: v.position }).title}`}</Text>
              <View style={styles.sub}>
                {r ? <RouteBadge route={r} /> : null}
                <Text style={[type.body, { color: c.muted }]} numberOfLines={1}>{seq.shape.headsign ? `hacia ${seq.shape.headsign} · ` : ""}<Text style={{ color: c.accent, fontWeight: "700" }}>{etaText(next.at, now)}</Text></Text>
              </View>
            </View>

            <View style={{ marginHorizontal: -space[5], marginTop: -space[2] }}>
              <RideScene system={v.system} color={color} moving={!arrived && !silent} width={width} />
            </View>

            {silent ? <Card><Text style={[type.headline, { color: "#d97706" }]}>Perdimos la señal de este bus</Text><Text style={[type.body, { color: c.muted }]}>Hace {Math.round((now - v.reportedAt) / 60)} min que no reporta. Los tiempos son aproximados.</Text></Card> : null}

            <View style={[styles.info, { backgroundColor: c.cardAlt }]}>
              <SymbolView name="info.circle.fill" tintColor={c.muted} size={22} />
              <Text style={[type.body, { color: c.text, flex: 1 }]}>
                {alightId && left != null
                  ? left <= 0 ? "Es tu parada. Prepárate para bajar." : left === 1 ? `La siguiente es la tuya: ${stopText(transit.stopById(alightId), alightId)}.` : `Bajas en ${stopText(transit.stopById(alightId), alightId)}: faltan ${left} paradas, ${etaText(arrivalAtIndex(transit, v, seq.shape, seq.index, seq.index + left, nowMs()), now)}.`
                  : `${stopText(nextStop, next.id)} es la próxima parada. Toca en la lista la parada donde bajas y te avisamos antes de llegar.`}
              </Text>
            </View>

            {alightId && left != null && segments > 0 ? (
              <View style={{ gap: space[2] }}>
                <View style={styles.progressTop}>
                  <Text style={[type.headline, { color: c.text }]}>Trayecto</Text>
                  <Text style={[type.headline, { color: c.text, fontVariant: ["tabular-nums"] }]}>{done} / {segments} paradas</Text>
                </View>
                <View style={styles.segments} accessible accessibilityLabel={`Llevas ${done} de ${segments} paradas`}>
                  {Array.from({ length: shown }, (_, i) => <View key={i} style={[styles.segment, { backgroundColor: i < Math.round((done / segments) * shown) ? color : c.cardAlt }]} />)}
                </View>
                <Tap onPress={() => setAlightId(null)} accessibilityRole="button" accessibilityLabel="Quitar mi parada de bajada" style={[styles.pillBtn, { backgroundColor: c.cardAlt }]}>
                  <SymbolView name="bell.slash" tintColor={c.text} size={16} /><Text style={[type.headline, { color: c.text }]}>Quitar el aviso</Text>
                </Tap>
              </View>
            ) : null}

            <Text style={[type.eyebrow, { color: c.muted, marginTop: space[2] }]}>PRÓXIMAS PARADAS</Text>
            <View>
              {stops.map((s, i) => {
                const lastRow = i === stops.length - 1, mine = s.id === alightId;
                const stop = transit.stopById(s.id);
                return (
                  <Tap key={s.id + s.index} onPress={() => { setAlightId(mine ? null : s.id, i + 1); void Haptics.selectionAsync(); }} accessibilityRole="button" accessibilityState={{ selected: mine }}
                    accessibilityLabel={`${stopText(stop, s.id)}, ${etaText(s.at, now)}${mine ? ", aquí bajas" : ", tocar para marcarla como donde bajas"}`} style={styles.tl}>
                    <View style={styles.tlRail}>
                      <View style={[styles.tlLine, { backgroundColor: color, top: i === 0 ? "50%" : 0, bottom: lastRow ? "50%" : 0 }]} />
                      <View style={[styles.tlDot, { backgroundColor: mine ? color : c.card, borderColor: color }]} />
                    </View>
                    <View style={{ flex: 1, paddingVertical: space[2] }}>
                      <Text style={[type.body, { color: c.text, fontWeight: mine || i === 0 ? "700" : "400" }]} numberOfLines={2}>{stopText(stop, s.id)}</Text>
                      {mine ? <Text style={[type.caption, { color }]}>aquí bajas</Text> : null}
                    </View>
                    <View style={{ alignItems: "flex-end", justifyContent: "center", paddingLeft: space[2] }}>
                      <Text style={[type.headline, { color: i === 0 ? c.accent : c.text }]}>{etaText(s.at, now)}</Text>
                      <Text style={[type.caption, { color: c.muted }]}>{hm(s.at)}</Text>
                    </View>
                  </Tap>
                );
              })}
            </View>
            <Text style={[type.caption, { color: c.muted }]}>Tiempos estimados con la posición de este bus y lo que tardan los buses en cada parada; pueden cambiar.</Text>
          </>
        )}

        <PrimaryButton tone="ink" symbol="location.fill" label="Seguir en el mapa" onPress={showOnMap} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: space[5], gap: space[3] },
  head: { flexDirection: "row", alignItems: "center", gap: space[3] },
  sub: { flexDirection: "row", alignItems: "center", gap: space[2] },
  info: { flexDirection: "row", alignItems: "center", gap: space[3], padding: space[4], borderRadius: radius.lg, borderCurve: "continuous" },
  progressTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  segments: { flexDirection: "row", gap: 5 },
  segment: { flex: 1, height: 26, borderRadius: 7, borderCurve: "continuous" },
  pillBtn: { minHeight: 50, borderRadius: radius.pill, flexDirection: "row", gap: space[2], alignItems: "center", justifyContent: "center", marginTop: space[1] },
  btn: { minHeight: 54, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: space[2], marginTop: space[2] },
  tl: { flexDirection: "row", gap: space[3], minHeight: 52 },
  tlRail: { width: 18, alignItems: "center" },
  tlLine: { position: "absolute", width: 3, left: 7.5 },
  tlDot: { position: "absolute", top: "50%", marginTop: -7, width: 14, height: 14, borderRadius: 7, borderWidth: 3 },
});
