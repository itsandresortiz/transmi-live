import { ScrollView, StyleSheet, Text } from "react-native";
import { useColors } from "@/ui/theme";

/** Mi tarjeta TuLlave: necesita el módulo nativo de NFC (siguiente paso). El analizador de la tarjeta ya vive en `@transmi/domain`. */
export default function CardScreen() {
  const c = useColors();
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.screen}>
      <Text style={[styles.title, { color: c.text }]}>Tu saldo, en tu teléfono</Text>
      <Text style={[styles.sub, { color: c.muted }]}>La lectura por NFC llega con el módulo nativo. El saldo se leerá de la tarjeta y no se enviará a ningún lado.</Text>
    </ScrollView>
  );
}
const styles = StyleSheet.create({ screen: { padding: 20, gap: 12 }, title: { fontSize: 24, fontWeight: "700" }, sub: { fontSize: 16 } });
