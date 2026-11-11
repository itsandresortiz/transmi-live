import { useMemo, useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { router } from "expo-router";
import { describeStopGroup, searchRoutes, searchStopGroups } from "@transmi/application";
import { SYSTEM_LABEL, routeCodes, routeTitle, routeVariant, stopLabelText, type Route } from "@transmi/domain";
import { transit } from "@/composition-root";
import { useTransitVersion } from "@/hooks";
import { useSaved } from "@/favorites";
import { Card, PAGE, Tap } from "@/ui/kit";
import { GlassSegments } from "@/ui/GlassSegments";
import { RouteBadge } from "@/ui/RouteBadge";
import { SYSTEM_COLOR, radius, space, type, useColors } from "@/ui/theme";

type Kind = "rutas" | "paradas";
/** Una parada, estación o portal en la lista: a cuál abrir, cómo se llama y una línea que dice qué es. */
interface StopRow { key: string; id: string; name: string; detail: string; symbol: SFSymbol; tint: string }
const ICON: Record<"Estación" | "Portal" | "Paradero", SFSymbol> = { Estación: "tram.fill", Portal: "building.2.fill", Paradero: "signpost.right.fill" };

/** Buscador: un solo campo para rutas y para paradas, estaciones y portales (por nombre o por el código del paradero). */
export default function Buscar() {
  const c = useColors();
  const version = useTransitVersion();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind>("rutas");
  const saved = useSaved();
  const q = query.trim();

  const routes = useMemo(() => searchRoutes(transit, { query }), [version, query]);   // eslint-disable-line react-hooks/exhaustive-deps
  const stops = useMemo<StopRow[]>(() => {
    if (q.length >= 2) return searchStopGroups(transit, q, 40).map((g) => {
      const d = describeStopGroup(transit, g);
      return { key: g.key + g.stops[0]!.id, id: g.stops[0]!.id, name: d.name, detail: d.detail, symbol: ICON[d.kind], tint: d.kind === "Paradero" ? SYSTEM_COLOR.zonal : SYSTEM_COLOR.troncal };
    });
    // sin texto: tus paradas guardadas, para entrar rápido
    return saved.stops.flatMap((id) => {
      const stop = transit.stopById(id);
      if (!stop) return [];
      const label = transit.labelOf(stop);
      return [{ key: "fav" + id, id, name: saved.nicknames[id] || stopLabelText(label), detail: saved.nicknames[id] ? stopLabelText(label) : "Guardada en favoritos", symbol: "star.fill" as SFSymbol, tint: "#f59e0b" }];
    });
  }, [version, q, saved.stops, saved.nicknames]);   // eslint-disable-line react-hooks/exhaustive-deps

  const loading = !transit.network.routes.size;
  const count = (n: number) => (q.length >= 2 && n ? ` (${n})` : "");
  const header = (
    <View>
      {kind === "paradas" && q.length < 2 ? (
        <View style={styles.hintWrap}>
          <Text style={[type.caption, { color: c.muted }]}>Escribe el nombre de la parada, estación o portal, o el código que sale en el paradero.</Text>
          <Tap onPress={() => router.push("/cerca")} accessibilityRole="button" accessibilityLabel="Ver las paradas cerca de mí" style={styles.rowWrap0}>
            <Card style={styles.row}>
              <View style={[styles.ico, { backgroundColor: c.accent }]}><SymbolView name="location.fill" tintColor="#ffffff" size={16} /></View>
              <View style={styles.rowText}><Text style={[type.headline, { color: c.text }]}>Paradas cerca de mí</Text><Text style={[type.caption, { color: c.muted }]}>Con los buses que vienen</Text></View>
              <SymbolView name="chevron.right" tintColor={c.muted} size={14} />
            </Card>
          </Tap>
          {stops.length ? <Text style={[type.eyebrow, { color: c.muted, marginTop: space[2] }]}>TUS PARADAS</Text> : null}
        </View>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={["top"]}>
      <Text style={[type.largeTitle, styles.title, { color: c.text }]} accessibilityRole="header">Buscar</Text>
      <View style={[styles.search, { backgroundColor: c.card, shadowColor: c.shadow }]}>
        <SymbolView name="magnifyingglass" tintColor={c.muted} size={17} />
        <TextInput
          value={query} onChangeText={setQuery} placeholder={kind === "rutas" ? "Ruta o destino (C15, Portal Norte…)" : "Parada, estación o código"} placeholderTextColor={c.muted}
          autoCorrect={false} autoCapitalize="none" clearButtonMode="while-editing" returnKeyType="search"
          accessibilityLabel={kind === "rutas" ? "Buscar una ruta" : "Buscar una parada, estación o portal"} style={[type.body, styles.input, { color: c.text }]}
        />
      </View>
      <View style={styles.segments}>
        <GlassSegments<Kind> variant="plain" value={kind} onChange={setKind}
          items={[{ key: "rutas", label: `Rutas${count(routes.length)}` }, { key: "paradas", label: `Paradas${count(stops.length)}` }]} />
      </View>

      {kind === "rutas" ? (
        <FlatList<Route>
          key="rutas"
          data={routes}
          keyExtractor={(r) => r.id}
          keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled"
          contentContainerStyle={[PAGE, { paddingBottom: space[10] * 3 }]}
          ListEmptyComponent={<Text style={[type.body, styles.empty, { color: c.muted }]}>{loading ? "Cargando rutas…" : stops.length && q.length >= 2 ? `No hay rutas con «${q}». Mira en Paradas: hay ${stops.length}.` : "No encontramos esa ruta."}</Text>}
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
      ) : (
        <FlatList<StopRow>
          key="paradas"
          data={stops}
          keyExtractor={(s) => s.key}
          keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled"
          contentContainerStyle={[PAGE, { paddingBottom: space[10] * 3 }]}
          ListHeaderComponent={header}
          ListEmptyComponent={q.length >= 2 ? <Text style={[type.body, styles.empty, { color: c.muted }]}>{loading ? "Cargando paradas…" : routes.length ? `No hay paradas con «${q}». Mira en Rutas: hay ${routes.length}.` : `No encontramos «${q}». Prueba con otro nombre o con el código del paradero.`}</Text> : undefined}
          renderItem={({ item: s }) => (
            <Tap onPress={() => router.push({ pathname: "/stop/[id]", params: { id: s.id } })} accessibilityRole="button" accessibilityLabel={`${s.name}, ${s.detail}`} style={styles.rowWrap}>
              <Card style={styles.row}>
                <View style={[styles.ico, { backgroundColor: s.tint }]}><SymbolView name={s.symbol} tintColor="#ffffff" size={16} /></View>
                <View style={styles.rowText}>
                  <Text style={[type.headline, { color: c.text }]} numberOfLines={2}>{s.name}</Text>
                  <Text style={[type.caption, { color: c.muted }]} numberOfLines={1}>{s.detail}</Text>
                </View>
                <SymbolView name="chevron.right" tintColor={c.muted} size={14} />
              </Card>
            </Tap>
          )}
          initialNumToRender={14} windowSize={9}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  title: { paddingHorizontal: space[5], paddingTop: space[2] },
  search: { flexDirection: "row", alignItems: "center", gap: space[2], marginHorizontal: space[5], marginTop: space[4], marginBottom: space[3], minHeight: 48, borderRadius: radius.lg, borderCurve: "continuous", paddingHorizontal: space[4], shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 4 } },
  input: { flex: 1, minHeight: 48 },
  segments: { marginHorizontal: space[5], marginBottom: space[3] },
  hintWrap: { marginHorizontal: space[5], marginBottom: space[3], gap: space[3] },
  rowWrap: { marginHorizontal: space[5], marginBottom: space[3] },
  rowWrap0: {},
  row: { flexDirection: "row", alignItems: "center", gap: space[3], padding: space[3] },
  rowText: { flex: 1, gap: 2 },
  ico: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  empty: { textAlign: "center", marginTop: space[10], marginHorizontal: space[5] },
});
