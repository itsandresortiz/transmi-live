import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SymbolView } from "expo-symbols";
import { upcomingAtStop } from "@transmi/application";
import { routeTitle, stopLabelText } from "@transmi/domain";
import { transit } from "@/composition-root";
import { nowSec } from "@/clock";
import { useNow, useTransitVersion } from "@/hooks";
import { etaText } from "@/format";
import { useSaved } from "@/favorites";
import { Card, Tap } from "@/ui/kit";
import { CloseToolbar } from "@/ui/CloseToolbar";
import { RouteBadge } from "@/ui/RouteBadge";
import { space, type, useColors } from "@/ui/theme";

/** Tus favoritos: las paradas y rutas que marcaste con la estrella, con lo que viene a cada parada. Viven solo en este teléfono. */
export default function Favoritos() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  useTransitVersion();
  const now = useNow(5000) / 1000;
  const saved = useSaved();
  const routes = saved.routes.map((id) => transit.routeById(id)).filter((r) => !!r);
  // lo que viene a cada parada se calcula cada pocos segundos, no en cada pintada: así los toques (cerrar, abrir) responden al instante
  const version = transit.version;
  const stops = useMemo(() => saved.stops.map((id) => transit.stopById(id)).filter((s) => !!s).map((stop) => ({ stop: stop!, next: upcomingAtStop(transit, stop!.id, nowSec(), 1).slice(0, 3) })), [saved.stops, version, Math.floor(now / 5)]);   // eslint-disable-line react-hooks/exhaustive-deps
  const live = transit.fleet.size >= 50;

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.screen, { paddingBottom: insets.bottom + space[10] * 2 }]} showsVerticalScrollIndicator={false}>
      <CloseToolbar />
      {!stops.length && !routes.length ? (
        <Card style={{ gap: space[2] }}>
          <SymbolView name="star" tintColor={c.accent} size={26} />
          <Text style={[type.headline, { color: c.text }]}>Aún no tienes favoritos</Text>
          <Text style={[type.body, { color: c.muted }]}>Abre una parada o una ruta y toca la estrella. Aquí las verás con lo que viene a cada una, y puedes ponerles un nombre, como «La del colegio».</Text>
        </Card>
      ) : null}

      {stops.length ? <Text style={[type.eyebrow, { color: c.muted }]}>PARADAS</Text> : null}
      {stops.map(({ stop, next }) => {
        return (
          <Tap key={stop.id} onPress={() => router.push({ pathname: "/stop/[id]", params: { id: stop.id } })} accessibilityRole="button" accessibilityLabel={saved.nicknames[stop.id] || stopLabelText(transit.labelOf(stop))}>
            <Card style={{ gap: space[2] }}>
              <View style={styles.top}>
                <SymbolView name="mappin.circle.fill" tintColor={c.accent} size={24} />
                <View style={{ flex: 1 }}>
                  <Text style={[type.headline, { color: c.text }]} numberOfLines={1}>{saved.nicknames[stop.id] || stopLabelText(transit.labelOf(stop))}</Text>
                  {saved.nicknames[stop.id] ? <Text style={[type.caption, { color: c.muted }]} numberOfLines={1}>{stopLabelText(transit.labelOf(stop))}</Text> : null}
                </View>
                <SymbolView name="chevron.right" tintColor={c.muted} size={12} />
              </View>
              {next.length ? <View style={styles.next}>{next.map((u) => <View key={u.route.id} style={styles.chip}><RouteBadge route={u.route} /><Text style={[type.headline, { color: c.text }]}>{etaText(u.buses[0]!.etaAt, now)}</Text></View>)}</View>
                : <Text style={[type.caption, { color: c.muted }]}>{live ? "Ningún bus viene ahora" : "Sin datos en vivo por ahora"}</Text>}
            </Card>
          </Tap>
        );
      })}

      {routes.length ? <Text style={[type.eyebrow, { color: c.muted, marginTop: space[3] }]}>RUTAS</Text> : null}
      {routes.map((r) => r ? (
        <Tap key={r.id} onPress={() => router.push({ pathname: "/route/[id]", params: { id: r.id } })} accessibilityRole="button" accessibilityLabel={`Ruta ${r.shortName}${r.longName ? `, ${routeTitle(r)}` : ""}`}>
          <Card style={styles.top}>
            <RouteBadge route={r} />
            <Text style={[type.headline, { color: c.text, flex: 1 }]} numberOfLines={2}>{r.longName ? routeTitle(r) : r.shortName}</Text>
            <SymbolView name="chevron.right" tintColor={c.muted} size={12} />
          </Card>
        </Tap>
      ) : null)}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: space[5], gap: space[3] },
  top: { flexDirection: "row", alignItems: "center", gap: space[3] },
  next: { flexDirection: "row", flexWrap: "wrap", gap: space[3] },
  chip: { flexDirection: "row", alignItems: "center", gap: space[2] },
});
