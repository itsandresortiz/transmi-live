import { StyleSheet, Text, View } from "react-native";
import { connectionStatus, liveLevel } from "@transmi/application";
import { transit } from "@/composition-root";
import { nowMs } from "@/clock";
import { useNow, useTransitVersion } from "@/hooks";
import { agoShort } from "@/format";
import { useDemo } from "@/demo";
import { Glass } from "./kit";
import { space, type, useColors } from "./theme";

/** Dice de dónde sale lo que se ve: «En vivo» o «Sin datos en vivo». Nunca se presenta un dato viejo como si fuera de ahora. */
export function FeedStatus({ tint, light = false }: { tint?: string; light?: boolean }) {
  const c = useColors();
  useTransitVersion(); useNow(5000);
  const st = connectionStatus(transit, nowMs());
  // hay buses reportando = en vivo; solo si el último dato tiene más de 5 min se avisa del retraso, y «sin datos» solo si casi no hay buses
  // de madrugada reportan pocos buses, pero si su dato es reciente sigue siendo en vivo: se dice cuántos, no «sin datos»
  const level = liveLevel(transit, nowMs()), n = transit.fleet.size;
  const live = level === "live" || level === "few";
  const demo = useDemo((d) => d.on);
  const title = demo ? "Demostración" : level === "none" ? "Sin datos en vivo" : level === "late" ? "Datos con retraso" : "En vivo";
  const detail = demo ? "buses de ejemplo" : level === "few" ? `${n} ${n === 1 ? "bus" : "buses"} a esta hora` : st.ageSeconds != null ? (live ? `hace ${agoShort(st.ageSeconds)}` : `último dato hace ${agoShort(st.ageSeconds)}`) : "";
  return (
    <Glass tint={tint} scheme={light ? "light" : undefined} style={styles.glass}>
      <View accessible accessibilityLabel={`${title}${detail ? `, ${detail}` : ""}`} style={styles.pill}>
        <View style={[styles.dot, { backgroundColor: demo ? "#8b5cf6" : live ? "#22c55e" : "#f59e0b" }]} />
        <Text style={[type.caption, { color: c.text }]}>{title}</Text>
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
