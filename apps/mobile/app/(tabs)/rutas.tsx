import { useMemo, useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SymbolView } from "expo-symbols";
import { router } from "expo-router";
import { searchRoutes } from "@transmi/application";
import { SYSTEM_LABEL, routeCodes, routeTitle, routeVariant } from "@transmi/domain";
import { transit } from "@/composition-root";
import { useTransitVersion } from "@/hooks";
import { Card, PAGE, Tap } from "@/ui/kit";
import { RouteBadge } from "@/ui/RouteBadge";
import { radius, space, type, useColors } from "@/ui/theme";

export default function Rutas() {
  const c = useColors();
  const version = useTransitVersion();
  const [query, setQuery] = useState("");
  const routes = useMemo(() => searchRoutes(transit, { query }), [version, query]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={["top"]}>
      <Text style={[type.largeTitle, styles.title, { color: c.text }]} accessibilityRole="header">Rutas</Text>
      <View style={[styles.search, { backgroundColor: c.card, shadowColor: c.shadow }]}>
        <SymbolView name="magnifyingglass" tintColor={c.muted} size={17} />
        <TextInput
          value={query} onChangeText={setQuery} placeholder="Buscar ruta o destino" placeholderTextColor={c.muted}
          autoCorrect={false} autoCapitalize="none" clearButtonMode="while-editing" returnKeyType="search"
          accessibilityLabel="Buscar ruta o destino" style={[type.body, styles.input, { color: c.text }]}
        />
      </View>
      <FlatList
        data={routes}
        keyExtractor={(r) => r.id}
        keyboardDismissMode="on-drag"
        contentContainerStyle={[PAGE, { paddingBottom: space[10] * 3 }]}
        ListEmptyComponent={<Text style={[type.body, styles.empty, { color: c.muted }]}>{transit.network.routes.size ? "No encontramos esa ruta." : "Cargando rutas…"}</Text>}
        renderItem={({ item: r }) => {
          const codes = routeCodes(r);
          const sub = [SYSTEM_LABEL[r.system], codes.length > 1 ? codes.join(" y ") : "", routeVariant(r) ?? ""].filter(Boolean).join(" · ");
          return (
            <Tap onPress={() => router.push({ pathname: "/route/[id]", params: { id: r.id } })} accessibilityRole="button"
              accessibilityLabel={`Ruta ${r.shortName}, ${sub}${r.longName ? `, ${routeTitle(r)}` : ""}`} style={styles.rowWrap}>
              <Card style={styles.row}>
                <RouteBadge route={r} />
                <View style={styles.rowText}>
                  <Text style={[type.headline, { color: c.text }]} numberOfLines={2}>{r.longName ? routeTitle(r) : SYSTEM_LABEL[r.system]}</Text>
                  <Text style={[type.caption, { color: c.muted }]} numberOfLines={1}>{sub}</Text>
                </View>
                <SymbolView name="chevron.right" tintColor={c.muted} size={14} />
              </Card>
            </Tap>
          );
        }}
        initialNumToRender={16} windowSize={9}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  title: { paddingHorizontal: space[5], paddingTop: space[2] },
  search: { flexDirection: "row", alignItems: "center", gap: space[2], marginHorizontal: space[5], marginVertical: space[4], minHeight: 48, borderRadius: radius.lg, borderCurve: "continuous", paddingHorizontal: space[4], shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
  input: { flex: 1, minHeight: 48 },
  rowWrap: { marginHorizontal: space[5], marginBottom: space[3] },
  row: { flexDirection: "row", alignItems: "center", gap: space[3], padding: space[3] },
  rowText: { flex: 1, gap: 2 },
  empty: { textAlign: "center", marginTop: space[10] },
});
