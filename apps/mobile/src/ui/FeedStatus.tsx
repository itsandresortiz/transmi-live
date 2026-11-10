import { StyleSheet, Text, View } from "react-native";
import { connectionStatus } from "@transmi/application";
import { transit } from "@/composition-root";
import { nowMs } from "@/clock";
import { useNow, useTransitVersion } from "@/hooks";
import { agoShort } from "@/format";
import { Glass } from "./kit";
import { space, type, useColors } from "./theme";

/** Dice de dónde sale lo que se ve: «En vivo» o «Sin datos en vivo». Nunca se presenta un dato viejo como si fuera de ahora. */
export function FeedStatus({ tint, light = false }: { tint?: string; light?: boolean }) {
  const c = useColors();
  useTransitVersion(); useNow(5000);
  const st = connectionStatus(transit, nowMs());
  // hay buses reportando = en vivo; solo si el último dato tiene más de 5 min se avisa del retraso, y «sin datos» solo si casi no hay buses
  const hasBuses = transit.fleet.size >= 50, late = (st.ageSeconds ?? 0) > 300;
  const live = hasBuses && !late;
  const title = !hasBuses ? "Sin datos en vivo" : late ? "Datos con retraso" : "En vivo";
  const detail = st.ageSeconds != null ? (live ? `hace ${agoShort(st.ageSeconds)}` : `último dato hace ${agoShort(st.ageSeconds)}`) : "";
  return (
    <Glass tint={tint} scheme={light ? "light" : undefined} style={styles.glass}>
      <View accessible accessibilityLabel={`${title}${detail ? `, ${detail}` : ""}`} style={styles.pill}>
        <View style={[styles.dot, { backgroundColor: live ? "#22c55e" : "#f59e0b" }]} />
        <Text style={[type.caption, { color: light ? "#111114" : c.text }]}>{title}</Text>
        {detail ? <Text style={[type.caption, { color: light ? "#111114" : c.text, opacity: 0.7 }]} numberOfLines={1}>{detail}</Text> : null}
      </View>
    </Glass>
  );
}
const styles = StyleSheet.create({
  glass: { borderRadius: 20, overflow: "hidden", alignSelf: "flex-start" },
  pill: { flexDirection: "row", alignItems: "center", gap: space[2], paddingVertical: space[2], paddingHorizontal: space[3] },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
