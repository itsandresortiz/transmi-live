import { StyleSheet, Text, View } from "react-native";
import type { Route } from "@transmi/domain";
import { SYSTEM_COLOR } from "./theme";

export function RouteBadge({ route }: { route: Route }) {
  return (
    <View style={[styles.badge, { backgroundColor: SYSTEM_COLOR[route.system] }]} accessible={false}>
      <Text style={styles.text} numberOfLines={1}>{route.shortName}</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  badge: { minWidth: 52, paddingHorizontal: 8, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center", borderCurve: "continuous" },
  text: { color: "#fff", fontWeight: "700", fontSize: 14 },
});
