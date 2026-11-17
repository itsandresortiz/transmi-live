import { ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ownerMessageUntil } from "@transmi/domain";
import { useActiveMessages } from "@/messages";
import { nowMs } from "@/clock";
import { alertView, searchAlerts } from "@transmi/application";
import { transit } from "@/composition-root";
import { useTransitVersion } from "@/hooks";
import { Card } from "@/ui/kit";
import { CloseToolbar } from "@/ui/CloseToolbar";
import { RouteBadge } from "@/ui/RouteBadge";
import { radius, space, type, useColors } from "@/ui/theme";

/** Avisos del servicio vigentes (desvíos, cierres de estaciones, cambios de operación). */
export default function Avisos() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  useTransitVersion();
  const list = searchAlerts(transit);      // sin repetidos, los más graves primero
  const own = useActiveMessages();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <CloseToolbar />
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.screen, { paddingTop: space[4], paddingBottom: insets.bottom + space[10] * 2 }]} showsVerticalScrollIndicator={false}>
      {/* lo que escribe el dueño de la app va primero y se distingue de los avisos de TransMilenio */}
      {own.map((m) => {
        const tone = m.important ? "#dc2626" : "#d97706", until = ownerMessageUntil(m, nowMs() / 1000);
        return (
          <Card key={m.id} style={{ gap: space[2] }}>
            <View style={[styles.pill, { backgroundColor: tone + "22" }]}><Text style={[type.caption, { color: tone }]}>Aviso de TransMi LIVE</Text></View>
            <Text style={[type.headline, { color: c.text }]}>{m.text}</Text>
            {until ? <Text style={[type.caption, { color: c.muted }]}>{until}</Text> : null}
          </Card>
        );
      })}
      {!list.length && !own.length ? <Card><Text style={[type.headline, { color: c.text }]}>Sin avisos</Text><Text style={[type.body, { color: c.muted }]}>No hay novedades del servicio en este momento.</Text></Card> : null}
      {list.map(({ alert: a, index }) => {
        const tone = a.effect === "noService" ? "#dc2626" : a.effect === "additional" ? "#16a34a" : a.title ? "#2563eb" : "#d97706", v = alertView(transit, a, nowMs() / 1000);
        return (
          <Card key={index} style={{ gap: space[2] }}>
            <View style={[styles.pill, { backgroundColor: tone + "22" }]}><Text style={[type.caption, { color: tone }]}>{v.tag}</Text></View>
            <Text style={[type.headline, { color: c.text }]}>{v.title}</Text>
            <Text style={[type.body, { color: c.muted }]}>{v.body}</Text>
            {v.reason || v.when ? <Text style={[type.caption, { color: c.muted }]}>{[v.reason, v.when].filter(Boolean).join(" · ")}</Text> : null}
            {v.routes.length ? <View style={styles.routes}>{v.routes.slice(0, 10).map((r) => <RouteBadge key={r.id} route={r} />)}</View> : null}
          </Card>
        );
      })}
    </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { padding: space[5], gap: space[3], paddingBottom: space[10] * 2 },
  pill: { alignSelf: "flex-start", paddingHorizontal: space[3], height: 26, borderRadius: radius.pill, justifyContent: "center" },
  routes: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
});
