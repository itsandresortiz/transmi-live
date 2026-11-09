import { ScrollView, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Card, Tap } from "@/ui/kit";
import { space, type, useColors } from "@/ui/theme";

export default function Mas() {
  const c = useColors();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={["top"]}>
      <ScrollView contentContainerStyle={{ gap: space[3], paddingBottom: space[10] * 3 }}>
        <Text style={[type.largeTitle, { color: c.text, paddingHorizontal: space[5] }]} accessibilityRole="header">Más</Text>
        <Tap onPress={() => router.push("/card")} accessibilityRole="button" accessibilityLabel="Mi tarjeta TuLlave" style={{ marginHorizontal: space[5] }}>
          <Card><Text style={[type.headline, { color: c.text }]}>Mi tarjeta TuLlave</Text><Text style={[type.body, { color: c.muted }]}>Lee tu saldo acercando la tarjeta al teléfono.</Text></Card>
        </Tap>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({ screen: { flex: 1 } });
