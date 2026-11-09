import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { searchRoutes } from "@transmi/application";
import { SYSTEM_LABEL, routeCodes, routeTitle, routeVariant } from "@transmi/domain";
import { transit } from "@/composition-root";
import { useTransitVersion } from "@/hooks";
import { RouteBadge } from "@/ui/RouteBadge";
import { useColors } from "@/ui/theme";

export default function Rutas() {
  const c = useColors();
  const version = useTransitVersion();
  const [query, setQuery] = useState("");
  const routes = useMemo(() => searchRoutes(transit, { query }), [version, query]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={["top"]}>
      <Text style={[styles.title, { color: c.text }]} accessibilityRole="header">Rutas</Text>
      <TextInput
        value={query} onChangeText={setQuery} placeholder="Buscar ruta o destino" placeholderTextColor={c.muted}
        autoCorrect={false} autoCapitalize="none" clearButtonMode="while-editing" returnKeyType="search"
        accessibilityLabel="Buscar ruta o destino"
        style={[styles.search, { backgroundColor: c.card, color: c.text }]}
      />
      <FlatList
        data={routes}
        keyExtractor={(r) => r.id}
        keyboardDismissMode="on-drag"
        contentInsetAdjustmentBehavior="automatic"
        ListEmptyComponent={<Text style={[styles.empty, { color: c.muted }]}>{transit.network.routes.size ? "No encontramos esa ruta." : "Cargando rutas…"}</Text>}
        renderItem={({ item: r }) => {
          const codes = routeCodes(r);
          const sub = [SYSTEM_LABEL[r.system], codes.length > 1 ? codes.join(" y ") : "", routeVariant(r) ?? ""].filter(Boolean).join(" · ");
          return (
            <Pressable
              onPress={() => router.push({ pathname: "/route/[id]", params: { id: r.id } })}
              accessibilityRole="button" accessibilityLabel={`Ruta ${r.shortName}, ${sub}${r.longName ? `, ${routeTitle(r)}` : ""}`}
              style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.line : c.card }]}
            >
              <RouteBadge route={r} />
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, { color: c.text }]} numberOfLines={2}>{r.longName ? routeTitle(r) : SYSTEM_LABEL[r.system]}</Text>
                <Text style={[styles.rowSub, { color: c.muted }]} numberOfLines={1}>{sub}</Text>
              </View>
            </Pressable>
          );
        }}
        initialNumToRender={20} windowSize={9}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  title: { fontSize: 34, fontWeight: "800", paddingHorizontal: 20, paddingTop: 8 },
  search: { marginHorizontal: 16, marginVertical: 12, height: 44, borderRadius: 12, paddingHorizontal: 14, fontSize: 17, borderCurve: "continuous" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 16, marginBottom: 8, padding: 12, borderRadius: 14, borderCurve: "continuous" },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 16, fontWeight: "600" },
  rowSub: { fontSize: 13 },
  empty: { textAlign: "center", marginTop: 40, fontSize: 16 },
});
