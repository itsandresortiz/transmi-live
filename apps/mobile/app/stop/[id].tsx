import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { upcomingAtStop } from "@transmi/application";
import { routeTitle, stopLabelText } from "@transmi/domain";
import { transit } from "@/composition-root";
import { nowSec } from "@/clock";
import { useNow, useTransitVersion } from "@/hooks";
import { etaText } from "@/format";
import { clockOfDay, liveDown } from "@/lastService";
import { stopKind } from "@/stopname";
import { useSaved } from "@/favorites";
import { reportProblem } from "@/report";
import { Card, RoundButton, SheetClose, Tap } from "@/ui/kit";
import { RouteBadge } from "@/ui/RouteBadge";
import { space, type, useColors } from "@/ui/theme";

/** Hoja de una parada: los buses que vienen (en vivo) o, si no hay datos, los horarios programados. */
export default function StopSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const insets = useSafeAreaInsets();
  useTransitVersion();
  const now = useNow() / 1000;
  const stop = transit.stopById(id);
  const fav = useSaved((f) => f.stops.includes(id)), toggle = useSaved((f) => f.toggleStop);
  const nick = useSaved((f) => f.nicknames[id]), setNick = useSaved((f) => f.setNickname);
  if (!stop) return <View style={[styles.screen, { backgroundColor: c.bg }]}><SheetClose onPress={() => router.back()} /><Text style={[type.headline, { color: c.text, marginTop: space[6] }]}>No encontramos esa parada</Text></View>;
  const rows = upcomingAtStop(transit, id, nowSec(), 3);
  const down = liveDown(transit.fleet.size);
  const day = transit.serviceEnds.dayAt(nowSec() * 1000);
  const scheduled = transit.departures.size ? transit.departures.nextAt(id, day.type, day.secs, 3).slice(0, 8) : [];

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
    <SheetClose onPress={() => router.back()} />
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={[styles.screen, { paddingTop: space[10], paddingBottom: insets.bottom + space[10] * 2 }]} showsVerticalScrollIndicator={false}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={[type.eyebrow, { color: c.accent }]}>{stopKind(stop).toUpperCase()}</Text>
          <Text style={[type.largeTitle, { color: c.text }]}>{nick || stopLabelText(transit.labelOf(stop))}</Text>
          {nick ? <Text style={[type.caption, { color: c.muted }]}>{stopLabelText(transit.labelOf(stop))}</Text> : null}
        </View>
        <View style={{ marginRight: space[10] + 2 }}><RoundButton symbol={fav ? "star.fill" : "star"} label={fav ? "Quitar de favoritos" : "Guardar en favoritos"} onPress={() => toggle(id)} /></View>
      </View>

      {fav ? <Tap onPress={() => Alert.prompt("Ponerle nombre", "Por ejemplo: «La del colegio»", (t) => setNick(id, t ?? ""), "plain-text", nick ?? "")} accessibilityRole="button" accessibilityLabel={nick ? "Cambiar el nombre de esta parada" : "Ponerle nombre a esta parada"}><Text style={[type.caption, { color: c.accent, fontSize: 14 }]}>{nick ? "Cambiar nombre" : "Ponerle nombre"}</Text></Tap> : null}

      {rows.length ? rows.map((r) => (
        <Tap key={r.route.id + r.direction} onPress={() => router.push({ pathname: "/route/[id]", params: { id: r.route.id } })} accessibilityRole="button" accessibilityLabel={`Ruta ${r.route.shortName}`}>
          <Card style={styles.row}>
            <RouteBadge route={r.route} />
            <View style={{ flex: 1 }}>
              <Text style={[type.headline, { color: c.text }]} numberOfLines={1}>{r.headsign ? `Hacia ${r.headsign}` : routeTitle(r.route)}</Text>
              <Text style={[type.caption, { color: c.muted }]}>{r.buses[0]!.official ? "En vivo" : "Aproximado"}</Text>
            </View>
            <Text style={[type.title, { color: c.text }]}>{etaText(r.buses[0]!.etaAt, now)}</Text>
          </Card>
        </Tap>
      )) : (
        <Card>
          <Text style={[type.headline, { color: c.text }]}>{down ? "Sin datos en vivo por ahora" : "Ningún bus viene ahora"}</Text>
          <Text style={[type.body, { color: c.muted, marginTop: space[1] }]}>
            {down ? "TransMilenio no está enviando la ubicación de los buses. Eso no significa que no haya servicio: abajo ves el horario programado."
              : "Cuando un bus se acerque a esta parada aparecerá aquí."}
          </Text>
        </Card>
      )}

      {!rows.length && scheduled.length ? (
        <>
          <Text style={[type.eyebrow, { color: c.muted, marginTop: space[4] }]}>PRÓXIMOS SEGÚN EL HORARIO</Text>
          {scheduled.map((s) => {
            const r = transit.routeById(s.routeId);
            return (
              <Card key={s.routeId + s.direction} style={styles.row}>
                {r ? <RouteBadge route={r} /> : null}
                <View style={{ flex: 1 }}>
                  <Text style={[type.headline, { color: c.text }]} numberOfLines={1}>{r ? routeTitle(r) : s.routeId}</Text>
                  <Text style={[type.caption, { color: c.muted }]}>{s.times.map(clockOfDay).join(" · ")}</Text>
                </View>
              </Card>
            );
          })}
          <Text style={[type.caption, { color: c.muted }]}>Son horas programadas, no buses en vivo: la hora real puede variar.</Text>
        </>
      ) : null}
      <Tap onPress={() => reportProblem({ what: `parada ${stopLabelText(transit.labelOf(stop))}`, lines: [`ID de la parada: ${id}`, down ? "Estado: sin datos en vivo" : "Estado: en vivo"] })} accessibilityRole="button" accessibilityLabel="Reportar un problema con esta parada" style={{ marginTop: space[4] }}>
        <Text style={[type.caption, { color: c.muted, fontSize: 14 }]}>¿Algo no cuadra? Reportar un problema con esta parada</Text>
      </Tap>
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: space[5], gap: space[3], paddingBottom: space[10] },
  head: { flexDirection: "row", alignItems: "flex-start", gap: space[3] },
  row: { flexDirection: "row", alignItems: "center", gap: space[3] },
});
