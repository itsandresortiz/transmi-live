import { StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useColors, space, type } from "@/ui/theme";

export default function Mapa() {
  const c = useColors();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={["top"]}>
      <Text style={[type.largeTitle, { color: c.text, paddingHorizontal: space[5] }]} accessibilityRole="header">Mapa</Text>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({ screen: { flex: 1 } });
