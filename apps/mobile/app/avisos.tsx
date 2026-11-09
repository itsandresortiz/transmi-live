import { ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ALERT_EFFECT_LABEL, alertTitle, alertValidity, describeAlert } from "@transmi/domain";
import { transit } from "@/composition-root";
import { useTransitVersion } from "@/hooks";
import { Card, PAGE, SheetClose } from "@/ui/kit";
import { RouteBadge } from "@/ui/RouteBadge";
import { radius, space, type, useColors } from "@/ui/theme";

/** Avisos del servicio vigentes (desvíos, cierres de estaciones, cambios de operación). */
export default function Avisos() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  useTransitVersion();
  const list = transit.alerts;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
    <SheetClose onPress={() => router.back()} />
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={[PAGE, styles.screen, { paddingTop: space[10], paddingBottom: insets.bottom + space[10] * 2 }]} showsVerticalScrollIndicator={false}>
      <Text style={[type.largeTitle, { color: c.text }]} accessibilityRole="header">Avisos del servicio</Text>
      {!list.length ? <Card><Text style={[type.headline, { color: c.text }]}>Sin avisos</Text><Text style={[type.body, { color: c.muted }]}>No hay novedades del servicio en este momento.</Text></Card> : null}
      {list.map((a, i) => {
        const tone = a.effect === "noService" ? "#dc2626" : a.effect === "additional" ? "#16a34a" : "#d97706";
        return (
          <Card key={i} style={{ gap: space[2] }}>
            <View style={[styles.pill, { backgroundColor: tone + "22" }]}><Text style={[type.caption, { color: tone }]}>{ALERT_EFFECT_LABEL[a.effect]}</Text></View>
            <Text style={[type.headline, { color: c.text }]}>{alertTitle(a)}</Text>
            <Text style={[type.body, { color: c.muted }]}>{describeAlert(a)}</Text>
            {alertValidity(a) ? <Text style={[type.caption, { color: c.muted }]}>{alertValidity(a)}</Text> : null}
            <View style={styles.routes}>{a.routeIds.slice(0, 10).map((id) => { const r = transit.routeById(id); return r ? <RouteBadge key={id} route={r} /> : null; })}</View>
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
