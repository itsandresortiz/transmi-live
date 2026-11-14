import { useEffect, useMemo, useState } from "react";
import { liveDown, downText } from "@/lastService";
import { AppState, Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SymbolView } from "@/ui/Symbol";
import { nearestStops, siblingStops, upcomingAtStop, type UpcomingRoute } from "@transmi/application";
import { transit } from "@/composition-root";
import { nowSec } from "@/clock";
import { useNow, useTransitVersion } from "@/hooks";
import { etaText } from "@/format";
import { Eta } from "@/ui/Eta";
import { locateMe } from "@/location";
import { stopKind, stopTag } from "@/stopname";
import { useMapFocus } from "@/map/focus";
import { meters } from "@/planner/format";
import { Card, PrimaryButton, Tap } from "@/ui/kit";
import { CloseToolbar } from "@/ui/CloseToolbar";
import { RouteBadge } from "@/ui/RouteBadge";
import { radius, space, type, useColors } from "@/ui/theme";

/** Cerca de mí: las paradas y estaciones a menos de 1 km, con los próximos buses de cada una. La ubicación se usa solo aquí y no se guarda. */
export default function Cerca() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  useTransitVersion();
  const now = useNow(5000) / 1000;
  const [me, setMe] = useState<{ lat: number; lon: number } | null | undefined>(undefined);
  // se vuelve a ubicar al volver a la app (p. ej. después de dar el permiso en Ajustes) y cada minuto, por si la persona camina
  useEffect(() => {
    const again = () => void locateMe().then((p) => setMe((cur) => p ?? cur ?? null));
    again();
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") again(); });
    const t = setInterval(() => { if (AppState.currentState === "active") again(); }, 60_000);
    return () => { sub.remove(); clearInterval(t); };
  }, []);

  const rows = useMemo(() => {
    if (!me) return [];
    return nearestStops(transit, me, 8, 1000).map((n) => {
      // lo que viene a la parada y a sus vagones o plataformas hermanos: la más próxima de cada ruta
      const best = new Map<string, UpcomingRoute>();
      for (const s of siblingStops(transit, n.stop)) for (const u of upcomingAtStop(transit, s.id, nowSec(), 1)) { const cur = best.get(u.route.id); if (!cur || u.buses[0]!.etaAt < cur.buses[0]!.etaAt) best.set(u.route.id, u); }
      return { ...n, next: [...best.values()].sort((a, b) => a.buses[0]!.etaAt - b.buses[0]!.etaAt).slice(0, 3) };
    });
  }, [me, Math.floor(now / 10), transit.version]);   // eslint-disable-line react-hooks/exhaustive-deps

  // si la parada más cercana está a muchos kilómetros, la persona no está en Bogotá (o el teléfono da una ubicación que no es): se dice claro
  const far = useMemo(() => { if (!me || rows.length) return false; const n = nearestStops(transit, me, 1, 1e8)[0]; return !!n && n.meters > 30000; }, [me, rows.length, transit.version]);   // eslint-disable-line react-hooks/exhaustive-deps
  const loading = transit.network.stops.size === 0;

  const showOnMap = () => { useMapFocus.getState().set({ locate: true }); router.dismissAll(); router.navigate("/mapa"); };

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.screen, { paddingBottom: insets.bottom + space[10] * 2 }]} showsVerticalScrollIndicator={false}>
      <CloseToolbar />
      {me === undefined ? <Card><Text style={[type.headline, { color: c.text }]}>Buscando dónde estás</Text><Text style={[type.body, { color: c.muted, marginTop: space[1] }]}>Si es la primera vez, el teléfono te pide permiso para usar tu ubicación mientras tienes la app abierta.</Text></Card>
        : me === null ? (
          <Card style={{ gap: space[2] }}>
            <Text style={[type.headline, { color: c.text }]}>No pudimos ubicarte</Text>
            <Text style={[type.body, { color: c.muted }]}>Para mostrarte lo que tienes cerca, la app necesita usar tu ubicación mientras está abierta. No se guarda ni se envía a ningún lado.</Text>
            <Tap onPress={() => void Linking.openSettings()} accessibilityRole="button" accessibilityLabel="Abrir los ajustes del teléfono"><Text style={[type.headline, { color: c.accent }]}>Abrir Ajustes</Text></Tap>
          </Card>
        ) : loading ? <Card><Text style={[type.headline, { color: c.text }]}>Cargando las paradas</Text><Text style={[type.body, { color: c.muted, marginTop: space[1] }]}>Un momento: estamos trayendo las paradas y estaciones.</Text></Card>
        : far ? <Card><Text style={[type.headline, { color: c.text }]}>Parece que no estás en Bogotá</Text><Text style={[type.body, { color: c.muted, marginTop: space[1] }]}>Tu ubicación queda lejos de las paradas de TransMilenio y del SITP. Cuando estés en Bogotá aquí verás las paradas que tienes cerca.</Text></Card>
        : rows.length === 0 ? <Card><Text style={[type.headline, { color: c.text }]}>No hay paradas a menos de 1 km</Text><Text style={[type.body, { color: c.muted, marginTop: space[1] }]}>Prueba el mapa para ver los buses que pasan por la zona.</Text></Card>
        : (
          <>
            <Text style={[type.caption, { color: c.muted }]}>Paradas y estaciones a menos de 1 km, de la más cercana a la más lejana.</Text>
            {rows.map(({ stop, meters: m, next }) => {
              const tag = stopTag(stop);
              return (
                <Tap key={stop.id} onPress={() => router.push({ pathname: "/stop/[id]", params: { id: stop.id } })} accessibilityRole="button"
                  accessibilityLabel={`${transit.labelOf(stop).title}, a ${meters(m)}${next.length ? `, ${next.map((u) => `${u.route.shortName} llega ${etaText(u.buses[0]!.etaAt, now)}`).join(", ")}` : ", sin buses acercándose"}`}>
                  <Card style={{ gap: space[2] }}>
                    <View style={styles.top}>
                      <View style={[styles.icon, { backgroundColor: c.dark ? "#2a1114" : "#fde8ea" }]}><SymbolView name={stopKind(stop) === "Parada" ? "mappin" : "building.2.fill"} tintColor={c.accent} size={18} /></View>
                      <View style={{ flex: 1 }}>
                        <Text style={[type.headline, { color: c.text }]} numberOfLines={1}>{transit.labelOf(stop).title}</Text>
                        <Text style={[type.caption, { color: c.muted }]}>{stopKind(stop)}{tag ? ` · ${tag}` : ""} · a {meters(m)}</Text>
                      </View>
                      <SymbolView name="chevron.right" tintColor={c.muted} size={12} />
                    </View>
                    {next.length ? (
                      <View style={styles.next}>
                        {next.map((u) => <View key={u.route.id} style={styles.chip}><RouteBadge route={u.route} /><Text style={[type.caption, { color: c.muted, flex: 1 }]} numberOfLines={1}>{u.headsign ? `Hacia ${u.headsign}` : ""}</Text><Eta at={u.buses[0]!.etaAt} style={[type.headline, { color: c.text }]} /></View>)}
                      </View>
                    ) : <Text style={[type.caption, { color: c.muted }]}>{liveDown() ? downText().title : "Ningún bus viene ahora"}</Text>}
                  </Card>
                </Tap>
              );
            })}
            <PrimaryButton tone="ink" symbol="location.fill" label="Verme en el mapa" onPress={showOnMap} />
          </>
        )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: space[5], gap: space[3] },
  top: { flexDirection: "row", alignItems: "center", gap: space[3] },
  icon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  next: { gap: space[2] },      // una fila por ruta: recuadro, hacia dónde va y el tiempo
  chip: { flexDirection: "row", alignItems: "center", gap: space[2] },
  btn: { minHeight: 54, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: space[2], marginTop: space[2] },
});
