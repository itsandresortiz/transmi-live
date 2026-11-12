import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SymbolView } from "@/ui/Symbol";
import { router } from "expo-router";
import { transit } from "@/composition-root";
import { useNow, useTransitVersion } from "@/hooks";
import { upcomingAtStop } from "@transmi/application";
import type { Route } from "@transmi/domain";
import { clockOfDay, downText } from "@/lastService";
import { stopKind, stopTag } from "@/stopname";
import { stopLabelText } from "@transmi/domain";
import { nowSec } from "@/clock";
import { etaText } from "@/format";
import { Eta } from "@/ui/Eta";
import { useActiveMessages } from "@/messages";
import { useSaved } from "@/favorites";
import { liveDown } from "@/lastService";
import { useDemo } from "@/demo";
import { usePlanner } from "@/planner/store";
import { RouteBadge } from "@/ui/RouteBadge";
import { Card, IconDot, RoundButton, SectionTitle, Tap, PAGE } from "@/ui/kit";
import { TripBanner } from "@/ui/TripBanner";
import { lift, radius, space, type, useColors } from "@/ui/theme";

const greeting = () => {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "America/Bogota" }).format(new Date()));
  return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
};

export default function Inicio() {
  const c = useColors();
  const { width } = useWindowDimensions();
  const version = useTransitVersion();
  const now = useNow(5000) / 1000;
  // «en vivo» = hay buses reportando. TransMilenio publica con ~1–3 min de retraso, así que la edad del lote solo sirve para decir «hace X min», no para negar el servicio
  const live = !liveDown();      // pocos buses con dato reciente (madrugada) también es en vivo

  const saved = useSaved();
  const demo = useDemo((d) => d.on);
  const alerts = transit.alerts.length + useActiveMessages().length;      // los avisos de TransMilenio y los mensajes propios
  // tus paradas con los próximos buses de cada una (los 3 más cercanos, de cualquier ruta); sin buses, la próxima hora del horario
  const favStops = useMemo(() => saved.stops.slice(0, 6).flatMap((id) => {
    const stop = transit.stopById(id);
    if (!stop) return [];
    const arrivals = upcomingAtStop(transit, id, nowSec(), 2)
      .flatMap((u) => u.buses.map((b) => ({ key: `${u.route.id}|${u.direction}|${b.vehicle.id}`, route: u.route as Route, headsign: u.headsign, at: b.etaAt })))
      .sort((a, b) => a.at - b.at).slice(0, 3);
    let scheduled: { route: Route; time: number; first?: boolean } | undefined;
    if (!arrivals.length && transit.departures.size) {
      const day = transit.serviceEnds.dayAt(nowSec() * 1000);
      const nx = transit.departures.nextAt(id, day.type, day.secs, 1).filter((x) => x.times[0] != null).sort((a, b) => a.times[0]! - b.times[0]!)[0];
      const r = nx ? transit.routeById(nx.routeId) : undefined;
      if (nx && r) scheduled = { route: r, time: nx.times[0]! };
      // ya no pasa ninguno más hoy: el primero del siguiente día de servicio
      if (!scheduled) {
        const first = transit.departures.nextAt(id, transit.serviceEnds.nextDayType(nowSec() * 1000), 0, 1).filter((x) => x.times[0] != null).sort((p, q) => p.times[0]! - q.times[0]!)[0];
        const fr = first ? transit.routeById(first.routeId) : undefined;
        if (first && fr) scheduled = { route: fr, time: first.times[0]!, first: true };
      }
    }
    return [{ id, stop, name: saved.nicknames[id] || transit.labelOf(stop).title, sub: [stopKind(stop), stopTag(stop)].filter(Boolean).join(" · "), arrivals, scheduled }];
  }), [saved.stops, saved.nicknames, version, Math.floor(now / 5)]);   // eslint-disable-line react-hooks/exhaustive-deps
  const cardW = favStops.length > 1 ? Math.min(330, Math.round(width * 0.8)) : width - space[5] * 2;
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
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
            <Tap onPress={() => router.navigate("/mapa")} accessibilityRole="button" accessibilityLabel={live ? `${transit.fleet.size} buses en vivo. Abrir el mapa` : "Abrir el mapa"} style={[styles.livePill, { backgroundColor: c.card }]}>
              <View style={[styles.liveDot, { backgroundColor: demo ? "#8b5cf6" : live ? "#22c55e" : downText().offline ? "#dc2626" : downText().closed ? "#94a3b8" : "#f59e0b" }]} />
              <Text style={[type.caption, { color: c.text, fontVariant: ["tabular-nums"] }]}>{demo ? "Demostración" : live ? `${transit.fleet.size.toLocaleString("es-CO")} en vivo` : downText().short}</Text>
            </Tap>
            <View>
              <RoundButton symbol={alerts ? "bell.badge.fill" : "bell"} label={alerts ? `Avisos del servicio: ${alerts}` : "Avisos del servicio"} onPress={() => router.push("/avisos")} />
            </View>
          </View>
        </View>
        <Text style={[type.hero, styles.hero, { color: c.text }]} accessibilityRole="header">¿A dónde{"\n"}vamos hoy?</Text>

        <Tap onPress={() => router.navigate("/rutas")} accessibilityRole="search" accessibilityLabel="Buscar una ruta, parada o estación" style={styles.searchWrap}>
          <View style={[styles.search, { backgroundColor: c.card, shadowColor: c.shadow }]}>
            <SymbolView name="magnifyingglass" tintColor={c.muted} size={18} />
            <Text style={[type.body, { color: c.muted, flex: 1 }]}>Buscar ruta, parada o estación</Text>
            <View style={[styles.filter, { backgroundColor: c.ink }]}><SymbolView name="slider.horizontal.3" tintColor={c.onInk} size={16} /></View>
          </View>
        </Tap>


        <View style={{ paddingHorizontal: space[5], marginTop: space[4] }}><TripBanner /></View>
        <SectionTitle title="Tus paradas" action={favStops.length ? "Ver todas" : undefined} onAction={() => router.push("/favoritos")} />
        {favStops.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} decelerationRate="fast" snapToInterval={cardW + space[3]} contentContainerStyle={{ paddingHorizontal: space[5], gap: space[3] }}>
            {favStops.map((f) => (
              <Tap key={f.id} onPress={() => router.push({ pathname: "/stop/[id]", params: { id: f.id } })} accessibilityRole="button"
                accessibilityLabel={`${f.name}. ${f.arrivals.length ? f.arrivals.map((a) => `${a.route.shortName} ${etaText(a.at, now)}`).join(", ") : "sin buses acercándose"}`} style={{ width: cardW }}>
                <Card style={styles.favCard}>
                  <View style={styles.favHead}>
                    <View style={[styles.favIcon, { backgroundColor: c.dark ? "#2a1114" : "#fde8ea" }]}><SymbolView name="mappin" tintColor={c.accent} size={16} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={[type.headline, { color: c.text }]} numberOfLines={1}>{f.name}</Text>
                      <Text style={[type.caption, { color: c.muted }]} numberOfLines={1}>{f.sub}</Text>
                    </View>
                    <SymbolView name="chevron.right" tintColor={c.muted} size={12} />
                  </View>
                  <View style={[styles.favBody, { borderColor: c.line }]}>
                    {f.arrivals.length ? f.arrivals.map((a, i) => (
                      <View key={a.key} style={styles.arrival}>
                        <RouteBadge route={a.route} />
                        <Text style={[type.caption, { color: c.muted, flex: 1, fontSize: 14 }]} numberOfLines={1}>{a.headsign ? `Hacia ${a.headsign}` : ""}</Text>
                        <Eta at={a.at} style={[type.headline, { color: i === 0 ? c.accent : c.text }]} />
                      </View>
                    )) : f.scheduled ? (
                      <View style={styles.arrival}>
                        <RouteBadge route={f.scheduled.route} />
                        <Text style={[type.caption, { color: c.muted, flex: 1, fontSize: 14 }]} numberOfLines={1}>{f.scheduled.first ? "Primer bus" : "Según el horario"}</Text>
                        <Text style={[type.headline, { color: c.text }]}>{clockOfDay(f.scheduled.time)}</Text>
                      </View>
                    ) : <Text style={[type.caption, { color: c.muted, fontSize: 14 }]}>{live ? "Ningún bus viene ahora" : downText().title}</Text>}
                  </View>
                </Card>
              </Tap>
            ))}
          </ScrollView>
        ) : (
          <View style={{ paddingHorizontal: space[5] }}>
            <Card style={{ gap: space[2] }}>
              <View style={[styles.favIcon, { backgroundColor: c.dark ? "#2a1114" : "#fde8ea" }]}><SymbolView name="star.fill" tintColor={c.accent} size={16} /></View>
              <Text style={[type.headline, { color: c.text }]}>Tus paradas, a un vistazo</Text>
              <Text style={[type.body, { color: c.muted }]}>Marca una parada con la estrella y aquí verás qué buses llegan y en cuánto.</Text>
              <Tap onPress={() => router.push("/cerca")} accessibilityRole="button" accessibilityLabel="Buscar paradas cerca de mí"><Text style={[type.headline, { color: c.accent }]}>Buscar cerca de mí</Text></Tap>
            </Card>
          </View>
        )}

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
        {saved.routes.length ? (
          <>
            <SectionTitle title="Tus rutas" />
            <View style={[styles.favRoutes, { paddingHorizontal: space[5] }]}>
              {saved.routes.slice(0, 16).map((id) => { const r = transit.routeById(id); return r ? <Tap key={id} onPress={() => router.push({ pathname: "/route/[id]", params: { id } })} accessibilityRole="button" accessibilityLabel={`Ruta ${r.shortName}`}><RouteBadge route={r} /></Tap> : null; })}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space[5], paddingTop: space[2] },
  hero: { paddingHorizontal: space[5], marginTop: space[2] },
  searchWrap: { marginHorizontal: space[5], marginTop: space[5] },
  search: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: 58, borderRadius: radius.xl, borderCurve: "continuous", paddingLeft: space[4], paddingRight: space[2], shadowOpacity: 0.07, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, ...lift(6, 18, 0.08) },
  filter: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  quickRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: space[5] },
  quick: { alignItems: "center", gap: space[2], width: 76 },
  bigRow: { flexDirection: "row", gap: space[3], paddingHorizontal: space[5], marginTop: space[6] },
  big: { minHeight: 128, justifyContent: "space-between" },
  livePill: { flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[3], height: 34, borderRadius: 17 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  favCard: { gap: space[3], minHeight: 176 },
  favHead: { flexDirection: "row", alignItems: "center", gap: space[3] },
  favIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  favBody: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space[3], gap: space[3] },
  arrival: { flexDirection: "row", alignItems: "center", gap: space[3] },
  favRoutes: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
});
