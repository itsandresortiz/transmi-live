import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SymbolView } from "expo-symbols";
import { guideNow, guideSteps } from "@transmi/application";
import { transit } from "@/composition-root";
import { useNow, useTransitVersion } from "@/hooks";
import { etaText } from "@/format";
import { hm } from "@/planner/format";
import { placeText, useTrip } from "@/trip";
import { Card, PrimaryButton, Tap } from "@/ui/kit";
import { CloseToolbar } from "@/ui/CloseToolbar";
import { RouteBadge } from "@/ui/RouteBadge";
import { space, type, useColors } from "@/ui/theme";

/** El viaje que estás siguiendo, paso a paso: qué hacer ahora, qué sigue y a qué hora llegas. Los avisos salen aunque cierres esta ventana. */
export default function Trip() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  useTransitVersion();
  const now = useNow() / 1000;
  const it = useTrip((s) => s.it), dest = useTrip((s) => s.dest), guide = useTrip((s) => s.guide), shift = useTrip((s) => s.shift);

  if (!it) return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <CloseToolbar />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.screen}>
        <Card>
          <Text style={[type.headline, { color: c.text }]}>No estás siguiendo ningún viaje</Text>
          <Text style={[type.body, { color: c.muted, marginTop: space[1] }]}>En «Cómo llegar», elige una opción y toca «Seguir este viaje» para que te avisemos en cada paso.</Text>
        </Card>
        <PrimaryButton label="Ir a Cómo llegar" onPress={() => { router.back(); router.navigate("/viaje"); }} />
      </ScrollView>
    </View>
  );

  const steps = guideSteps(it, placeText), nowDo = guideNow(it, guide, placeText);
  const leg = it.legs[guide.leg];
  // hora que más importa en este momento: cuándo llega el bus (esperando) o cuándo te bajas (a bordo)
  const key = leg?.kind === "ride" ? (guide.phase === "wait" ? leg.departAt : leg.arriveAt) + shift : null;
  const end = () => Alert.alert("¿Terminar el viaje?", "Dejaremos de avisarte los pasos de este viaje.", [
    { text: "Seguir", style: "cancel" },
    { text: "Terminar", style: "destructive", onPress: () => { useTrip.getState().stop(); router.back(); } },
  ]);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <CloseToolbar />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.screen, { paddingBottom: insets.bottom + space[10] * 2 }]} showsVerticalScrollIndicator={false}>
        <View>
          <Text style={[type.eyebrow, { color: c.muted }]}>VAS HACIA</Text>
          <Text style={[type.title, { color: c.text }]} numberOfLines={2} accessibilityRole="header">{dest || "tu destino"}</Text>
          <Text style={[type.caption, { color: c.muted, marginTop: 2 }]}>Llegas a las {hm(it.arriveAt + shift)}{Math.abs(shift) >= 60 ? ` · ${shift > 0 ? "vas" : "vas"} ${Math.round(Math.abs(shift) / 60)} min ${shift > 0 ? "más tarde" : "antes"} de lo previsto` : ""}</Text>
        </View>

        <Card dark style={{ gap: space[2] }}>
          <Text style={[type.eyebrow, { color: c.onInk, opacity: 0.7 }]}>AHORA</Text>
          <Text style={[type.title, { color: c.onInk }]}>{nowDo.title}</Text>
          <Text style={[type.body, { color: c.onInk, opacity: 0.85 }]}>{nowDo.body}</Text>
          {key && key > now ? <Text style={[type.headline, { color: c.onInk, fontVariant: ["tabular-nums"] }]}>{guide.phase === "wait" ? "El bus llega en " : "Te bajas en "}{etaText(key, now)}{leg?.kind === "ride" && leg.waitKind !== "live" && guide.phase === "wait" ? " (aprox.)" : ""}</Text> : null}
        </Card>

        <Card style={{ gap: space[4] }}>
          {steps.map((s) => {
            const done = s.leg < guide.leg, current = s.leg === guide.leg;
            const l = it.legs[s.leg]!, route = l.kind === "ride" ? transit.routeById(l.routeId) : undefined;
            const row = (
              <View style={[styles.step, { opacity: done ? 0.45 : 1 }]}>
                <View style={styles.icon}>
                  {done ? <SymbolView name="checkmark.circle.fill" tintColor="#22c55e" size={20} />
                    : route ? <RouteBadge route={route} />
                    : <SymbolView name="figure.walk" tintColor={current ? c.accent : c.muted} size={20} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[type.headline, { color: c.text }]}>{s.title}</Text>
                  <Text style={[type.caption, { color: c.muted }]}>{s.detail}</Text>
                  <Text style={[type.caption, { color: current ? c.accent : c.muted, marginTop: 2 }]}>{current ? "Vas aquí" : `${hm(s.start + shift)} – ${hm(s.end + shift)}`}</Text>
                </View>
              </View>
            );
            return l.kind === "ride"
              ? <Tap key={s.leg} onPress={() => router.push({ pathname: "/stop/[id]", params: { id: l.board.id, route: l.routeId } })} accessibilityRole="button" accessibilityLabel={`${s.title}. ${s.detail}. Ver el bus en vivo`}>{row}</Tap>
              : <View key={s.leg} accessible accessibilityLabel={`${s.title}. ${s.detail}`}>{row}</View>;
          })}
          <View style={styles.step}>
            <View style={styles.icon}><SymbolView name="mappin.circle.fill" tintColor={c.accent} size={20} /></View>
            <Text style={[type.headline, { color: c.text, flex: 1 }]}>Llegas a las {hm(it.arriveAt + shift)}</Text>
          </View>
        </Card>

        <Text style={[type.caption, { color: c.muted }]}>Te avisamos cuando tu bus esté por llegar, cuando te toque bajar y qué sigue. Con la app abierta usamos tu ubicación y el bus en vivo; con la app cerrada los avisos salen a la hora estimada y pueden variar.</Text>
        <PrimaryButton label="Terminar viaje" tone="ink" onPress={end} a11y="Terminar el viaje y quitar los avisos" />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: space[5], paddingTop: space[4], gap: space[4] },
  step: { flexDirection: "row", alignItems: "flex-start", gap: space[3] },
  icon: { minWidth: 34, alignItems: "center", paddingTop: 2 },
});
