import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SymbolView, type SFSymbol } from "@/ui/Symbol";
import { router } from "expo-router";
import { locateMe } from "@/location";
import { PAGE, PrimaryButton, Tap } from "@/ui/kit";
import { Scene } from "@/ui/Illustrations";
import { SYSTEM_COLOR, radius, space, type, useColors } from "@/ui/theme";

export const ONBOARDED_KEY = "tm.onboarded.v1";

const POINTS: { symbol: SFSymbol; title: string; text: string }[] = [
  { symbol: "person.crop.circle.badge.xmark", title: "Sin cuenta, sin publicidad", text: "Abres la app y ya. No te pedimos datos ni te mostramos anuncios." },
  { symbol: "location.fill", title: "Tu ubicación se queda en tu teléfono", text: "La usamos con la app abierta para mostrarte lo que tienes cerca. Si buscas una dirección, sale redondeada a unos 100 metros." },
  { symbol: "dot.radiowaves.left.and.right", title: "Siempre te decimos si es en vivo", text: "Si TransMilenio deja de publicar la posición de los buses, lo ves en pantalla y te mostramos el horario programado." },
  { symbol: "info.circle", title: "No es una app oficial", text: "Usa los datos abiertos de TransMilenio. No pertenece a la Alcaldía ni a TransMilenio S.A." },
];

/** Primera vez que se abre la app: qué es, qué hace con tus datos y por qué pide la ubicación.
 *  Arriba, Bogotá ilustrada (los cerros con Monserrate, la ciudad y un bus rojo andando por su carril); con «Reducir movimiento», quieta. */
export default function Onboarding() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const done = async (askLocation: boolean) => {
    await AsyncStorage.setItem(ONBOARDED_KEY, "1").catch(() => undefined);
    router.dismiss();
    if (askLocation) void locateMe();
  };
  return (
    <View style={[styles.screen, { backgroundColor: c.bg }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: space[4] }} showsVerticalScrollIndicator={false}>
        <Scene height={insets.top + 250} busColor={SYSTEM_COLOR.troncal} long sign="B11" moving fadeTop={false} />
        <View style={[PAGE, styles.scroll]}>
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
        </View>
      </ScrollView>
      <View style={[PAGE, styles.actions, { paddingBottom: insets.bottom + space[3] }]}>
        <PrimaryButton label="Empezar y usar mi ubicación" a11y="Empezar y permitir la ubicación" onPress={() => void done(true)} />
        <Tap onPress={() => void done(false)} accessibilityRole="button" accessibilityLabel="Empezar sin ubicación" style={styles.btn}><Text style={[type.headline, { color: c.accent }]}>Ahora no</Text></Tap>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { paddingHorizontal: space[6], marginTop: -space[4], gap: space[2] },
  point: { flexDirection: "row", gap: space[4], alignItems: "flex-start" },
  ico: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  actions: { paddingHorizontal: space[5], paddingTop: space[3], gap: space[2] },
  btn: { minHeight: 56, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
});
