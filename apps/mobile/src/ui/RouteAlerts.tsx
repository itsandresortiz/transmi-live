import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { routeAlertViews } from "@transmi/application";
import { transit } from "@/composition-root";
import { nowMs } from "@/clock";
import { useTransitVersion } from "@/hooks";
import { SymbolView } from "./Symbol";
import { Card, Tap } from "./kit";
import { radius, space, type, useColors } from "./theme";

const AMBER = "#d97706";

/** Los avisos vigentes de una ruta (desvío, cierre de un vagón) como tarjeta ámbar, para la ficha del bus, del viaje y de la ruta.
 *  Se quita sola cuando el aviso vence. Al tocarla abre todos los avisos. */
export const RouteAlerts = memo(function RouteAlerts({ routeId, max = 2 }: { routeId: string; max?: number }) {
  const c = useColors();
  useTransitVersion();
  const list = routeAlertViews(transit, routeId, nowMs() / 1000);
  if (!list.length) return null;
  return (
    <>
      {list.slice(0, max).map(({ alert, view }) => (
        <Tap key={`${alert.id}-${alert.startsAt ?? 0}`} still onPress={() => router.push("/avisos")} accessibilityRole="button" accessibilityLabel={`Aviso: ${view.title}. ${view.body}${view.untilText ? ` Vigente ${view.untilText}.` : ""}`}>
          <Card style={[styles.card, { borderColor: AMBER + "55", backgroundColor: c.dark ? "#2a1f0a" : "#fff8eb" }]}>
            <View style={[styles.icon, { backgroundColor: AMBER }]}><SymbolView name="exclamationmark.triangle.fill" tintColor="#ffffff" size={15} /></View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[type.caption, { color: AMBER }]}>{view.tag}{view.untilText ? ` · ${view.untilText}` : ""}</Text>
              <Text style={[type.headline, { color: c.text }]} numberOfLines={2}>{view.title}</Text>
              <Text style={[type.body, { color: c.muted }]} numberOfLines={3}>{view.body}</Text>
            </View>
          </Card>
        </Tap>
      ))}
      {list.length > max ? <Tap onPress={() => router.push("/avisos")} accessibilityRole="button" accessibilityLabel="Ver todos los avisos"><Text style={[type.caption, { color: c.accent }]}>{list.length - max} aviso{list.length - max === 1 ? "" : "s"} más ›</Text></Tap> : null}
    </>
  );
});

const styles = StyleSheet.create({
  card: { flexDirection: "row", gap: space[3], alignItems: "flex-start", borderWidth: 1 },
  icon: { width: 28, height: 28, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", marginTop: 2 },
});
