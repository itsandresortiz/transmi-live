import { StyleSheet, Text, View } from "react-native";
import { connectionStatus } from "@transmi/application";
import { transit } from "@/composition-root";
import { nowMs } from "@/clock";
import { useNow, useTransitVersion } from "@/hooks";
import { agoShort } from "@/format";
import { Glass } from "./kit";
import { space, type, useColors } from "./theme";

/** Dice de dónde sale lo que se ve: «En vivo» o «Sin datos en vivo». Nunca se presenta un dato viejo como si fuera de ahora. */
export function FeedStatus({ tint }: { tint?: string }) {
  const c = useColors();
  useTransitVersion(); useNow(5000);
  const st = connectionStatus(transit, nowMs());
  const live = st.connection === "live" || st.connection === "waiting";
  const title = live ? "En vivo" : "Sin datos en vivo";
  const detail = live ? (st.ageSeconds != null ? `hace ${agoShort(st.ageSeconds)}` : "") : (st.ageSeconds != null ? `último dato hace ${agoShort(st.ageSeconds)}` : "");
  return (
    <Glass tint={tint} style={styles.glass}>
      <View accessible accessibilityLabel={`${title}${detail ? `, ${detail}` : ""}`} style={styles.pill}>
        <View style={[styles.dot, { backgroundColor: live ? "#22c55e" : "#f59e0b" }]} />
        <Text style={[type.caption, { color: c.text }]}>{title}</Text>
        {detail ? <Text style={[type.caption, { color: c.muted }]} numberOfLines={1}>{detail}</Text> : null}
      </View>
    </Glass>
  );
}
const styles = StyleSheet.create({
  glass: { borderRadius: 20, overflow: "hidden", alignSelf: "flex-start" },
  pill: { flexDirection: "row", alignItems: "center", gap: space[2], paddingVertical: space[2], paddingHorizontal: space[3] },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
