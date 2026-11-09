import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { SYSTEM_LABEL, routeOfficialName, routeTitle } from "@transmi/domain";
import { transit } from "@/composition-root";
import { useTransitVersion } from "@/hooks";
import { RouteBadge } from "@/ui/RouteBadge";
import { useColors } from "@/ui/theme";
import { useSaved } from "@/favorites";
import { RoundButton } from "@/ui/kit";

export default function RouteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  useTransitVersion();
  const route = transit.routeById(id);
  const fav = useSaved((f) => f.routes.includes(id)), toggle = useSaved((f) => f.toggleRoute);
  if (!route) return <View style={[styles.screen, { backgroundColor: c.bg }]}><Text style={[styles.sub, { color: c.muted }]}>Esa ruta ya no aparece en el servicio.</Text></View>;
  const stops = (transit.network.shapes.get(id)?.[0]?.stopIds ?? []).map((s) => transit.stopById(s)?.name ?? s);
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.screen} contentInsetAdjustmentBehavior="automatic">
      <Stack.Screen options={{ title: route.shortName }} />
      <View style={styles.head}><RouteBadge route={route} /><Text style={[styles.title, { color: c.text }]}>{routeTitle(route)}</Text><RoundButton symbol={fav ? "star.fill" : "star"} label={fav ? "Quitar de favoritos" : "Guardar en favoritos"} onPress={() => toggle(id)} /></View>
      <Text style={[styles.sub, { color: c.muted }]}>{SYSTEM_LABEL[route.system]}</Text>
      {route.longName ? <Text style={[styles.sub, { color: c.muted }]}>Nombre oficial: {routeOfficialName(route)}</Text> : null}
      <Text style={[styles.section, { color: c.muted }]}>PARADAS</Text>
      {stops.map((name, i) => <Text key={i} style={[styles.stop, { color: c.text, borderColor: c.line }]}>{name}</Text>)}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  screen: { padding: 20, gap: 8 }, head: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { flex: 1, fontSize: 22, fontWeight: "700" }, sub: { fontSize: 14 },
  section: { marginTop: 16, fontSize: 13, fontWeight: "600", letterSpacing: 0.5 },
  stop: { paddingVertical: 10, fontSize: 16, borderBottomWidth: StyleSheet.hairlineWidth },
});
