import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { liveDown } from "@/lastService";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import Animated, { LinearTransition } from "react-native-reanimated";
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
  const live = !liveDown();
  const [sorting, setSorting] = useState(false);
  const move = (id: string, by: -1 | 1) => { void Haptics.selectionAsync(); saved.moveStop(id, by); };

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

      {stops.length ? (
        <View style={styles.sectionRow}>
          <Text style={[type.eyebrow, { color: c.muted }]}>PARADAS</Text>
          {stops.length > 1 ? <Tap onPress={() => setSorting((x) => !x)} accessibilityRole="button" accessibilityLabel={sorting ? "Terminar de ordenar" : "Ordenar las paradas"}><Text style={[type.caption, { color: c.accent, fontSize: 15, fontWeight: "600" }]}>{sorting ? "Listo" : "Ordenar"}</Text></Tap> : null}
        </View>
      ) : null}
      {sorting ? <Text style={[type.caption, { color: c.muted }]}>Sube las que más usas: en Inicio se muestran en este orden (y la primera es la del widget).</Text> : null}
      {stops.map(({ stop, next }, i) => {
        return (
          <Animated.View key={stop.id} layout={LinearTransition.springify().damping(18).stiffness(220)}>
          <Tap onPress={() => { if (!sorting) router.push({ pathname: "/stop/[id]", params: { id: stop.id } }); }} haptic={!sorting} accessibilityRole="button" accessibilityLabel={saved.nicknames[stop.id] || stopLabelText(transit.labelOf(stop))}>
            <Card style={{ gap: space[2] }}>
              <View style={styles.top}>
                <SymbolView name="mappin.circle.fill" tintColor={c.accent} size={24} />
                <View style={{ flex: 1 }}>
                  <Text style={[type.headline, { color: c.text }]} numberOfLines={1}>{saved.nicknames[stop.id] || stopLabelText(transit.labelOf(stop))}</Text>
                  {saved.nicknames[stop.id] ? <Text style={[type.caption, { color: c.muted }]} numberOfLines={1}>{stopLabelText(transit.labelOf(stop))}</Text> : null}
                </View>
                {sorting ? (
                  <View style={styles.arrows}>
                    <Tap onPress={() => move(stop.id, -1)} disabled={i === 0} haptic={false} accessibilityRole="button" accessibilityLabel="Subir" style={[styles.arrow, { backgroundColor: c.cardAlt, opacity: i === 0 ? 0.35 : 1 }]}><SymbolView name="chevron.up" tintColor={c.text} size={14} /></Tap>
                    <Tap onPress={() => move(stop.id, 1)} disabled={i === stops.length - 1} haptic={false} accessibilityRole="button" accessibilityLabel="Bajar" style={[styles.arrow, { backgroundColor: c.cardAlt, opacity: i === stops.length - 1 ? 0.35 : 1 }]}><SymbolView name="chevron.down" tintColor={c.text} size={14} /></Tap>
                  </View>
                ) : <SymbolView name="chevron.right" tintColor={c.muted} size={12} />}
              </View>
              {sorting ? null : next.length ? <View style={styles.next}>{next.map((u) => <View key={u.route.id} style={styles.chip}><RouteBadge route={u.route} /><Text style={[type.headline, { color: c.text }]}>{etaText(u.buses[0]!.etaAt, now)}</Text></View>)}</View>
                : <Text style={[type.caption, { color: c.muted }]}>{live ? "Ningún bus viene ahora" : "Sin datos en vivo por ahora"}</Text>}
            </Card>
          </Tap>
          </Animated.View>
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
  sectionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  arrows: { flexDirection: "row", gap: space[2] },
  arrow: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  top: { flexDirection: "row", alignItems: "center", gap: space[3] },
  next: { flexDirection: "row", flexWrap: "wrap", gap: space[3] },
  chip: { flexDirection: "row", alignItems: "center", gap: space[2] },
});
