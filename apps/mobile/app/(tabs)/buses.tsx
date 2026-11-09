import { StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useColors } from "@/ui/theme";

export default function Screen() {
  const c = useColors();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={["top"]}>
      <Text style={[styles.title, { color: c.text }]} accessibilityRole="header">Buses</Text>
      <Text style={[styles.hint, { color: c.muted }]}>Próximamente en la app nativa.</Text>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({ screen: { flex: 1 }, title: { fontSize: 34, fontWeight: "800", paddingHorizontal: 20, paddingTop: 8 }, hint: { padding: 20, fontSize: 16 } });
