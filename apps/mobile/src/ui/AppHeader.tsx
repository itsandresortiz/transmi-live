import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SymbolView } from "./Symbol";
import { WIDE, space, useColors } from "./theme";

/** Encabezado propio de las ventanas en Android. El del sistema es una barra blanca con una flecha que no va con el resto de la app:
 *  aquí va el título en la letra ancha, sobre el mismo fondo de la pantalla, y una X redonda para cerrar (igual que en iPhone).
 *  En iPhone no se usa: allá el encabezado y la X son los nativos (`CloseToolbar`). */
let closing = false;
function close() {
  if (closing) return;
  closing = true;
  if (router.canGoBack()) router.back(); else router.replace("/");
  setTimeout(() => { closing = false; }, 700);
}

export function AppHeader({ title }: { title?: string }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top + space[2], backgroundColor: c.bg }]}>
      <Text style={[styles.title, { color: c.text }]} numberOfLines={1} accessibilityRole="header">{title ?? ""}</Text>
      <Pressable onPress={close} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cerrar"
        android_ripple={{ color: c.dark ? "#ffffff22" : "#00000014", borderless: true, radius: 22 }}
        style={[styles.close, { backgroundColor: c.card, borderColor: c.dark ? "#ffffff1f" : "#0000000f" }]}>
        <SymbolView name="xmark" tintColor={c.text} size={18} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[5], paddingBottom: space[2] },
  title: { flex: 1, fontFamily: WIDE, fontSize: 20, lineHeight: 26, letterSpacing: -0.3 },
  close: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, elevation: 2 },
});
