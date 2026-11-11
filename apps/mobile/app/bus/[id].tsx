import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { SYSTEM_LABEL, routeTitle } from "@transmi/domain";
import { transit } from "@/composition-root";
import { nowMs } from "@/clock";
import { useNow, useTransitVersion } from "@/hooks";
import { delayClass, delayText, untilText } from "@/format";
import { stopText } from "@/stopname";
import { reportProblem } from "@/report";
import { Card, PrimaryButton, Tap } from "@/ui/kit";
import { CloseToolbar } from "@/ui/CloseToolbar";
import { RouteBadge } from "@/ui/RouteBadge";
import { radius, space, type, useColors } from "@/ui/theme";

/** Hoja de un bus: a qué ruta pertenece, si va a tiempo y cuál es su próxima parada. */
export default function BusSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const insets = useSafeAreaInsets();
  useTransitVersion();
  const now = useNow() / 1000;
  const v = transit.fleet.get(id);
  if (!v) return <View style={[styles.screen, { flex: 1, backgroundColor: c.bg, paddingTop: space[4], paddingBottom: insets.bottom + space[6] }]}><Text style={[type.headline, { color: c.text, marginTop: space[6] }]}>{transit.lastBatchAt == null ? "Cargando el bus…" : "Este bus dejó de reportar"}</Text><Text style={[type.body, { color: c.muted }]}>Puede haber terminado su recorrido.</Text></View>;
  const r = transit.routeOf(v), d = transit.delayOf(v), ns = transit.nextStopOf(v, nowMs());
  const headsign = transit.sequenceForDisplay(v)?.shape.headsign;
  const tone = delayClass(d) === "bad" ? "#dc2626" : delayClass(d) === "warn" ? "#d97706" : delayClass(d) === "ok" ? "#16a34a" : c.muted;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <CloseToolbar />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.screen, { paddingTop: space[4], paddingBottom: insets.bottom + space[10] }]} showsVerticalScrollIndicator={false}>
      <View style={styles.head}>
        {r ? <RouteBadge route={r} /> : null}
        <View style={{ flex: 1 }}>
          <Text style={[type.title, { color: c.text, paddingRight: space[10] }]} numberOfLines={2}>{r ? routeTitle(r) : SYSTEM_LABEL[v.system]}</Text>
          <Text style={[type.caption, { color: c.muted }]}>{SYSTEM_LABEL[v.system]} · {v.plate || v.label || v.id}</Text>
          {headsign ? <Text style={[type.body, { color: c.text, marginTop: 2 }]} numberOfLines={1}>Hacia {headsign}</Text> : null}
        </View>
      </View>
      <Card>
        <Text style={[type.eyebrow, { color: c.muted }]}>ESTADO</Text>
        <Text style={[type.title, { color: tone }]}>{d.kind === "unknown" ? "Sin dato de puntualidad" : delayText(d)}</Text>
        {Math.round(now - v.reportedAt) > 90 ? <Text style={[type.caption, { color: c.muted }]}>Último reporte hace {Math.round((now - v.reportedAt) / 60)} min</Text> : null}
      </Card>
      <Card>
        <Text style={[type.eyebrow, { color: c.muted }]}>PRÓXIMA PARADA</Text>
        <Text style={[type.title, { color: c.text }]}>{ns?.stop ? stopText(ns.stop) : "—"}</Text>
        {ns?.arrivalAt ? <Text style={[type.body, { color: c.muted }]}>{untilText(ns.arrivalAt, now)}</Text> : null}
      </Card>
      <PrimaryButton label="Voy en este bus" a11y="Voy en este bus: ver sus próximas paradas y tiempos" onPress={() => router.replace({ pathname: "/ride/[id]", params: { id } })} />
      {r ? <PrimaryButton tone="ink" label="Ver la ruta" onPress={() => router.replace({ pathname: "/route/[id]", params: { id: r.id } })} /> : null}
      <Tap onPress={() => reportProblem({ what: `bus ${v.plate || v.label || v.id} (ruta ${r?.shortName ?? v.routeId})` })} accessibilityRole="button" accessibilityLabel="Reportar un problema con este bus" style={{ alignSelf: "center", marginTop: space[2] }}>
        <Text style={[type.caption, { color: c.muted, fontSize: 14 }]}>Reportar un problema con este bus</Text>
      </Tap>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: space[5], gap: space[3], paddingTop: space[6] },
  head: { flexDirection: "row", alignItems: "center", gap: space[3], marginBottom: space[2] },
  btn: { minHeight: 54, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", marginTop: space[2] },
});
