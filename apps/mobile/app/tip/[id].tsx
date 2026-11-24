import { ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TIPS, type TipId } from "@/tips";
import { Scene } from "@/ui/Illustrations";
import { PAGE, PrimaryButton } from "@/ui/kit";
import { SymbolView } from "@/ui/Symbol";
import { CloseToolbar } from "@/ui/CloseToolbar";
import { SYSTEM_COLOR, radius, space, type, useColors } from "@/ui/theme";

/** Hoja de consejo: ilustración, título, dos o tres puntos y «Entendido». Se abre una sola vez por función (ver `tipOnce` en `src/tips.ts`).
 *  Es una ventana `modal` (no `formSheet`, que con listas sale en negro en iOS 27). */
export default function TipSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const tip = TIPS[id as TipId];
  const close = () => { if (router.canGoBack()) router.back(); else router.replace("/"); };
  if (!tip) return <View style={{ flex: 1, backgroundColor: c.bg, padding: space[6] }}><PrimaryButton label="Entendido" onPress={close} /></View>;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <CloseToolbar />
      <ScrollView contentContainerStyle={{ paddingBottom: space[6] }} showsVerticalScrollIndicator={false}>
        <Scene height={230} kind={tip.scene} busColor={SYSTEM_COLOR.troncal} long moving={tip.moving} arrive={!tip.moving} badge={tip.badge} />
        <View style={[PAGE, styles.body]}>
          <Text style={[type.largeTitle, { color: c.text }]} accessibilityRole="header">{tip.title}</Text>
          <Text style={[type.body, { color: c.muted }]}>{tip.text}</Text>
          <View style={{ gap: space[4], marginTop: space[4] }}>
            {tip.points.map((p) => (
              <View key={p.text} style={styles.point} accessible accessibilityLabel={p.text}>
                <View style={[styles.ico, { backgroundColor: c.cardAlt }]}><SymbolView name={p.symbol} tintColor={c.accent} size={20} /></View>
                <Text style={[type.body, { color: c.text, flex: 1 }]}>{p.text}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
      <View style={[PAGE, { paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: insets.bottom + space[4] }]}>
        <PrimaryButton label="Entendido" onPress={close} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: space[6], gap: space[2], marginTop: -space[2] },
  point: { flexDirection: "row", gap: space[4], alignItems: "center" },
  ico: { width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
});
