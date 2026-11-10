import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import Constants from "expo-constants";
import { Linking } from "react-native";
import { connectionStatus } from "@transmi/application";
import { transit } from "@/composition-root";
import { nowMs } from "@/clock";
import { useNow, useTransitVersion } from "@/hooks";
import { reportProblem } from "@/report";
import { useAppearance, type AppearanceMode } from "@/appearance";
import { Card, Chip, Tap, PAGE } from "@/ui/kit";
import { space, type, useColors } from "@/ui/theme";

export default function Mas() {
  const c = useColors();
  const appearance = useAppearance();
  useTransitVersion(); useNow(15_000);
  const st = connectionStatus(transit, nowMs());
  const live = transit.fleet.size >= 50, ageMin = st.ageSeconds != null ? Math.round(st.ageSeconds / 60) : null;
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={["top"]}>
      <ScrollView contentContainerStyle={[PAGE, { gap: space[3], paddingBottom: space[10] * 3 }]}>
        <Text style={[type.largeTitle, { color: c.text, paddingHorizontal: space[5] }]} accessibilityRole="header">Más</Text>
        <View style={{ marginHorizontal: space[5] }}>
          <Card>
            <View style={styles.liveRow}>
              <View style={[styles.liveDot, { backgroundColor: live && (st.ageSeconds ?? 0) <= 300 ? "#22c55e" : "#f59e0b" }]} />
              <Text style={[type.headline, { color: c.text, flex: 1 }]}>{live ? `${transit.fleet.size.toLocaleString("es-CO")} buses en la calle` : "Sin datos en vivo por ahora"}</Text>
            </View>
            <Text style={[type.body, { color: c.muted, marginTop: space[2] }]}>
              {live ? `Se actualizan solos${ageMin != null && ageMin >= 2 ? ` · último dato hace ${ageMin} min` : ""}.`
                : "TransMilenio no está enviando la ubicación de los buses. Eso no significa que no haya servicio: puedes consultar horarios y planear viajes."}
            </Text>
          </Card>
        </View>
        <View style={{ marginHorizontal: space[5] }}>
          <Card style={{ gap: space[3] }}>
            <View><Text style={[type.headline, { color: c.text }]}>Apariencia</Text><Text style={[type.body, { color: c.muted }]}>Automático usa la del teléfono.</Text></View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
              {([["auto", "Automático"], ["light", "Claro"], ["dark", "Oscuro"]] as [AppearanceMode, string][]).map(([m, label]) => <Chip key={m} label={label} selected={appearance.mode === m} onPress={() => appearance.setMode(m)} />)}
            </View>
          </Card>
        </View>
        <Tap onPress={() => router.push("/avisos")} accessibilityRole="button" accessibilityLabel="Avisos del servicio" style={{ marginHorizontal: space[5] }}>
          <Card><Text style={[type.headline, { color: c.text }]}>Avisos del servicio</Text><Text style={[type.body, { color: c.muted }]}>Desvíos, cierres de estaciones y cambios de operación.</Text></Card>
        </Tap>
        <Tap onPress={() => router.push("/card")} accessibilityRole="button" accessibilityLabel="Mi tarjeta TuLlave" style={{ marginHorizontal: space[5] }}>
          <Card><Text style={[type.headline, { color: c.text }]}>Mi tarjeta TuLlave</Text><Text style={[type.body, { color: c.muted }]}>Lee tu saldo acercando la tarjeta al teléfono.</Text></Card>
        </Tap>
        <Tap onPress={() => reportProblem({ what: "la app en general" })} accessibilityRole="button" accessibilityLabel="Reportar un problema o dar una idea" style={{ marginHorizontal: space[5] }}>
          <Card><Text style={[type.headline, { color: c.text }]}>Reportar un problema o dar una idea</Text><Text style={[type.body, { color: c.muted }]}>Se abre un reporte ya redactado en GitHub.</Text></Card>
        </Tap>
        <Tap onPress={() => void Linking.openURL("https://transmilive.com/privacidad.html")} accessibilityRole="link" accessibilityLabel="Política de privacidad" style={{ marginHorizontal: space[5] }}>
          <Card><Text style={[type.headline, { color: c.text }]}>Política de privacidad</Text><Text style={[type.body, { color: c.muted }]}>Qué datos usamos y cuáles no.</Text></Card>
        </Tap>
        <Text style={[type.caption, { color: c.muted, textAlign: "center", marginTop: space[4] }]}>TransMi LIVE {Constants.expoConfig?.version} · compilación {Constants.nativeBuildVersion ?? "—"}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  liveRow: { flexDirection: "row", alignItems: "center", gap: space[3] },
  liveDot: { width: 10, height: 10, borderRadius: 5 },
});
