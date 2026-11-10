import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SymbolView } from "expo-symbols";
import { router } from "expo-router";
import { connectionStatus } from "@transmi/application";
import { transit } from "@/composition-root";
import { nowMs } from "@/clock";
import { useNow, useTransitVersion } from "@/hooks";
import { upcomingAtStop } from "@transmi/application";
import { stopLabelText } from "@transmi/domain";
import { nowSec } from "@/clock";
import { etaText } from "@/format";
import { useSaved } from "@/favorites";
import { usePlanner } from "@/planner/store";
import { RouteBadge } from "@/ui/RouteBadge";
import { Card, IconDot, RoundButton, SectionTitle, Tap, PAGE } from "@/ui/kit";
import { radius, space, type, useColors } from "@/ui/theme";

const greeting = () => {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "America/Bogota" }).format(new Date()));
  return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
};

export default function Inicio() {
  const c = useColors();
  useTransitVersion(); useNow(15_000);
  const st = connectionStatus(transit, nowMs());
  const live = st.connection === "live" || st.connection === "waiting";

  const saved = useSaved();
  const askPlace = (slot: "home" | "work") => { usePlanner.getState().setSaveAs(slot); router.navigate("/viaje"); };
  const goTo = (p: typeof saved.home) => { if (p) usePlanner.getState().setDest(p); router.navigate("/viaje"); };
  const quick: { symbol: Parameters<typeof IconDot>[0]["symbol"]; label: string; go: () => void }[] = [
    { symbol: "location.fill", label: "Cerca de mí", go: () => router.push("/cerca") },
    { symbol: "house.fill", label: saved.home ? "Casa" : "Guardar casa", go: () => (saved.home ? goTo(saved.home) : askPlace("home")) },
    { symbol: "briefcase.fill", label: saved.work ? "Trabajo" : "Guardar trabajo", go: () => (saved.work ? goTo(saved.work) : askPlace("work")) },
    { symbol: "star.fill", label: "Favoritos", go: () => router.push("/favoritos") },
  ];

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={["top"]}>
      <ScrollView contentContainerStyle={[PAGE, { paddingBottom: space[10] * 3 }]} contentInsetAdjustmentBehavior="automatic" showsVerticalScrollIndicator={false}>
        <View style={styles.topRow}>
          <Text style={[type.body, { color: c.muted }]}>{greeting()}</Text>
          <RoundButton symbol="bell" label="Avisos del servicio" onPress={() => router.push("/avisos")} />
        </View>
        <Text style={[type.hero, styles.hero, { color: c.text }]} accessibilityRole="header">¿A dónde{"\n"}vamos hoy?</Text>

        <Tap onPress={() => router.navigate("/viaje")} accessibilityRole="search" accessibilityLabel="Buscar un destino" style={styles.searchWrap}>
          <View style={[styles.search, { backgroundColor: c.card, shadowColor: c.shadow }]}>
            <SymbolView name="magnifyingglass" tintColor={c.muted} size={18} />
            <Text style={[type.body, { color: c.muted, flex: 1 }]}>Buscar ruta, parada o destino</Text>
            <View style={[styles.filter, { backgroundColor: c.ink }]}><SymbolView name="slider.horizontal.3" tintColor={c.onInk} size={16} /></View>
          </View>
        </Tap>

        <SectionTitle title="Acceso rápido" />
        <View style={styles.quickRow}>
          {quick.map((q) => (
            <Tap key={q.label} onPress={q.go} accessibilityRole="button" accessibilityLabel={q.label} style={styles.quick}>
              <IconDot symbol={q.symbol} tint={c.accent} bg={c.dark ? "#2a1114" : "#fde8ea"} />
              <Text style={[type.caption, { color: c.text }]} numberOfLines={1}>{q.label}</Text>
            </Tap>
          ))}
        </View>

        <View style={styles.bigRow}>
          <Tap onPress={() => router.navigate("/viaje")} accessibilityRole="button" accessibilityLabel="Cómo llegar. Salir ahora" style={{ flex: 1 }}>
            <Card style={styles.big}>
              <SymbolView name="arrow.triangle.turn.up.right.diamond.fill" tintColor={c.accent} size={26} />
              <View><Text style={[type.caption, { color: c.muted }]}>Cómo llegar</Text><Text style={[type.headline, { color: c.text }]}>Salir ahora</Text></View>
            </Card>
          </Tap>
          <Tap onPress={() => router.navigate("/rutas")} accessibilityRole="button" accessibilityLabel="Todas las rutas" style={{ flex: 1 }}>
            <Card dark style={styles.big}>
              <SymbolView name="bus.fill" tintColor={c.onInk} size={26} />
              <View><Text style={[type.caption, { color: c.onInk, opacity: 0.7 }]}>Rutas</Text><Text style={[type.headline, { color: c.onInk }]}>{transit.network.routes.size ? `${transit.network.routes.size.toLocaleString("es-CO")} rutas` : "Cargando…"}</Text></View>
            </Card>
          </Tap>
        </View>

        {saved.stops.length || saved.routes.length ? (
          <>
            <SectionTitle title="Tus favoritos" />
            <View style={{ paddingHorizontal: space[5], gap: space[3] }}>
              {saved.stops.slice(0, 4).map((id) => {
                const stop = transit.stopById(id); if (!stop) return null;
                const next = upcomingAtStop(transit, id, nowSec(), 1)[0];
                return (
                  <Tap key={id} onPress={() => router.push({ pathname: "/stop/[id]", params: { id } })} accessibilityRole="button" accessibilityLabel={stopLabelText(transit.labelOf(stop))}>
                    <Card style={styles.favRow}>
                      <SymbolView name="mappin.circle.fill" tintColor={c.accent} size={24} />
                      <View style={{ flex: 1 }}><Text style={[type.headline, { color: c.text }]} numberOfLines={1}>{saved.nicknames[id] || stopLabelText(transit.labelOf(stop))}</Text>
                        <Text style={[type.caption, { color: c.muted }]}>{next ? `${next.route.shortName} · ${etaText(next.buses[0]!.etaAt, nowSec())}` : live ? "Ningún bus viene ahora" : "Sin datos en vivo"}</Text></View>
                    </Card>
                  </Tap>
                );
              })}
              {saved.routes.length ? <View style={styles.favRoutes}>{saved.routes.slice(0, 12).map((id) => { const r = transit.routeById(id); return r ? <Tap key={id} onPress={() => router.push({ pathname: "/route/[id]", params: { id } })} accessibilityRole="button" accessibilityLabel={`Ruta ${r.shortName}`}><RouteBadge route={r} /></Tap> : null; })}</View> : null}
            </View>
          </>
        ) : null}

        <SectionTitle title="En vivo" />
        <View style={{ paddingHorizontal: space[5] }}>
          <Card>
            <View style={styles.liveRow}>
              <View style={[styles.liveDot, { backgroundColor: live ? "#22c55e" : "#f59e0b" }]} />
              <Text style={[type.headline, { color: c.text, flex: 1 }]}>{live ? `${transit.fleet.size.toLocaleString("es-CO")} buses en la calle` : "Sin datos en vivo por ahora"}</Text>
            </View>
            <Text style={[type.body, { color: c.muted, marginTop: space[2] }]}>
              {live ? "Se actualizan solos. Abre el mapa para verlos moverse."
                : "TransMilenio no está enviando la ubicación de los buses. Eso no significa que no haya servicio: puedes consultar horarios y planear viajes."}
            </Text>
          </Card>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space[5], paddingTop: space[2] },
  hero: { paddingHorizontal: space[5], marginTop: space[2] },
  searchWrap: { marginHorizontal: space[5], marginTop: space[5] },
  search: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: 58, borderRadius: radius.xl, borderCurve: "continuous", paddingLeft: space[4], paddingRight: space[2], shadowOpacity: 0.07, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
  filter: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  quickRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: space[5] },
  quick: { alignItems: "center", gap: space[2], width: 76 },
  bigRow: { flexDirection: "row", gap: space[3], paddingHorizontal: space[5], marginTop: space[6] },
  big: { minHeight: 128, justifyContent: "space-between" },
  favRow: { flexDirection: "row", alignItems: "center", gap: space[3] },
  favRoutes: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  liveRow: { flexDirection: "row", alignItems: "center", gap: space[3] },
  liveDot: { width: 10, height: 10, borderRadius: 5 },
});
