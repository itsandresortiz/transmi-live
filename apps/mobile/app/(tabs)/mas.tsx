import { ScrollView, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import Constants from "expo-constants";
import { Linking } from "react-native";
import { reportProblem } from "@/report";
import { Card, Tap, PAGE } from "@/ui/kit";
import { space, type, useColors } from "@/ui/theme";

export default function Mas() {
  const c = useColors();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={["top"]}>
      <ScrollView contentContainerStyle={[PAGE, { gap: space[3], paddingBottom: space[10] * 3 }]}>
        <Text style={[type.largeTitle, { color: c.text, paddingHorizontal: space[5] }]} accessibilityRole="header">Más</Text>
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
const styles = StyleSheet.create({ screen: { flex: 1 } });
