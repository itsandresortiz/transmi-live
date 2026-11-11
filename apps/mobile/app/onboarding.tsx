import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SymbolView, type SFSymbol } from "@/ui/Symbol";
import { router } from "expo-router";
import { locateMe } from "@/location";
import { PAGE, Tap } from "@/ui/kit";
import { radius, space, type, useColors } from "@/ui/theme";

export const ONBOARDED_KEY = "tm.onboarded.v1";

const POINTS: { symbol: SFSymbol; title: string; text: string }[] = [
  { symbol: "person.crop.circle.badge.xmark", title: "Sin cuenta, sin publicidad", text: "Abres la app y ya. No te pedimos datos ni te mostramos anuncios." },
  { symbol: "location.fill", title: "Tu ubicación se queda en tu teléfono", text: "La usamos con la app abierta para mostrarte lo que tienes cerca. Si buscas una dirección, sale redondeada a unos 100 metros." },
  { symbol: "dot.radiowaves.left.and.right", title: "Siempre te decimos si es en vivo", text: "Si TransMilenio deja de publicar la posición de los buses, lo ves en pantalla y te mostramos el horario programado." },
  { symbol: "info.circle", title: "No es una app oficial", text: "Usa los datos abiertos de TransMilenio. No pertenece a la Alcaldía ni a TransMilenio S.A." },
];

/** Primera vez que se abre la app: qué es, qué hace con tus datos y por qué pide la ubicación. */
export default function Onboarding() {
  const c = useColors();
  const done = async (askLocation: boolean) => {
    await AsyncStorage.setItem(ONBOARDED_KEY, "1").catch(() => undefined);
    router.dismiss();
    if (askLocation) void locateMe();
  };
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]}>
      <ScrollView contentContainerStyle={[PAGE, styles.scroll]}>
        <Text style={[type.hero, { color: c.text }]} accessibilityRole="header">Bienvenido a TransMi <Text style={{ color: c.accent }}>LIVE</Text></Text>
        <Text style={[type.body, { color: c.muted }]}>Tus buses de TransMilenio y SITP en Bogotá, sin adivinar.</Text>
        <View style={{ gap: space[5], marginTop: space[6] }}>
          {POINTS.map((p) => (
            <View key={p.title} style={styles.point} accessible accessibilityLabel={`${p.title}. ${p.text}`}>
              <View style={[styles.ico, { backgroundColor: c.cardAlt }]}><SymbolView name={p.symbol} tintColor={c.accent} size={22} /></View>
              <View style={{ flex: 1 }}><Text style={[type.headline, { color: c.text }]}>{p.title}</Text><Text style={[type.body, { color: c.muted }]}>{p.text}</Text></View>
            </View>
          ))}
        </View>
      </ScrollView>
      <View style={styles.actions}>
        <Tap onPress={() => void done(true)} accessibilityRole="button" accessibilityLabel="Empezar y permitir la ubicación" style={[styles.btn, { backgroundColor: c.accent }]}><Text style={[type.headline, { color: c.onAccent }]}>Empezar y usar mi ubicación</Text></Tap>
        <Tap onPress={() => void done(false)} accessibilityRole="button" accessibilityLabel="Empezar sin ubicación" style={styles.btn}><Text style={[type.headline, { color: c.accent }]}>Ahora no</Text></Tap>
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { padding: space[6], paddingTop: space[10], gap: space[2] },
  point: { flexDirection: "row", gap: space[4], alignItems: "flex-start" },
  ico: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  actions: { padding: space[5], gap: space[2] },
  btn: { minHeight: 56, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
});
