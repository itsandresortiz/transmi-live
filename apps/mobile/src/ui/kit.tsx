import { useEffect, useState, type ReactNode } from "react";
import { AppState, Platform, Pressable, StyleSheet, Switch, Text, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useAccessibility } from "@/accessibility";
import { radius, space, type, useColors } from "./theme";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Cualquier cosa tocable se hunde un poco al presionarla y vuelve con un resorte, como en iOS. */
export function Tap({ children, style, haptic = true, still = false, onPress, ...rest }: PressableProps & { children: ReactNode; style?: StyleProp<ViewStyle>; haptic?: boolean; /** Para tarjetas grandes con mucho texto: al tocarlas se atenúan un instante en vez de encogerse (encoger un bloque grande deja las letras borrosas un momento). */ still?: boolean }) {
  const { reduceMotion } = useAccessibility();
  const scale = useSharedValue(1);
  const anim = useAnimatedStyle(() => (still ? { opacity: 0.55 + 0.45 * ((scale.value - 0.96) / 0.04) } : { transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressable
      hitSlop={12}
      {...rest}
      onPressIn={() => { if (!reduceMotion) scale.value = still ? withTiming(0.96, { duration: 80 }) : withSpring(0.96, { damping: 18, stiffness: 420 }); }}
      onPressOut={() => { if (!reduceMotion) scale.value = still ? withTiming(1, { duration: 180 }) : withSpring(1, { damping: 14, stiffness: 300 }); }}
      onPress={(e) => { if (haptic && Platform.OS === "ios") void Haptics.selectionAsync(); onPress?.(e); }}
      style={[style, anim]}
    >
      {children}
    </AnimatedPressable>
  );
}

/** Tarjeta blanca con sombra suave y esquinas continuas. */
export function Card({ children, style, dark = false }: { children: ReactNode; style?: StyleProp<ViewStyle>; dark?: boolean }) {
  const c = useColors();
  return (
    <View style={[styles.card, { backgroundColor: dark ? c.ink : c.card, shadowColor: c.shadow }, style]}>{children}</View>
  );
}

/** Sobre el mapa (`scheme="light"`) se usa el vidrio «claro» de iOS: deja ver el mapa a través y lo refracta, en vez del esmerilado casi blanco. */
/** Superficie de vidrio líquido en iOS 26; en lo demás, un fondo translúcido. Con «Reducir transparencia» del teléfono, un fondo sólido. */
export function Glass({ children, style, interactive = false, tint, scheme }: { children?: ReactNode; style?: StyleProp<ViewStyle>; interactive?: boolean; tint?: string; /** Fuerza vidrio claro u oscuro (sobre el mapa, que es claro, conviene claro con texto oscuro). */ scheme?: "light" | "dark" }) {
  const c = useColors();
  const { reduceTransparency } = useAccessibility();
  // iOS 26 a veces pierde el efecto de vidrio tras volver del segundo plano: se vuelve a crear la superficie
  const [fresh, setFresh] = useState(0);
  useEffect(() => { const sub = AppState.addEventListener("change", (st) => { if (st === "active") setFresh((n) => n + 1); }); return () => sub.remove(); }, []);
  const onMap = scheme === "light", mapDark = onMap && c.dark;      // «light» = va sobre el mapa, que en apariencia oscura también es oscuro
  if (reduceTransparency) return <View style={[{ backgroundColor: onMap ? (mapDark ? "rgba(28,28,30,0.94)" : "rgba(255,255,255,0.94)") : c.card }, style]}>{children}</View>;
  if (Platform.OS === "ios" && isLiquidGlassAvailable()) return <GlassView key={fresh} glassEffectStyle={scheme === "light" && !tint ? "clear" : "regular"} colorScheme={onMap ? (mapDark ? "dark" : "light") : scheme ?? "auto"} isInteractive={interactive} tintColor={tint} style={style}>{children}</GlassView>;
  return <View style={[{ backgroundColor: tint ?? (onMap ? (mapDark ? "rgba(28,28,30,0.82)" : "rgba(255,255,255,0.86)") : c.dark ? "rgba(40,40,44,0.82)" : "rgba(255,255,255,0.86)") }, style]}>{children}</View>;
}

/** Botón redondo de vidrio con un símbolo de iOS (volver, ubicación, avisos…). */
/** Interruptor del sistema, centrado en su fila. En iOS 26 el interruptor nativo mide 63×28 (antes 51×31) y React Native le sigue reservando
 *  el tamaño viejo, así que queda corrido; aquí se le da su caja real y se centra dentro de un espacio fijo. */
export function Toggle({ value, onChange, label, disabled = false }: { value: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  const glass = Platform.OS === "ios" && isLiquidGlassAvailable();
  const w = glass ? 63 : 51, h = glass ? 28 : 31;
  return (
    <View style={{ width: w, height: 44, alignItems: "center", justifyContent: "center" }}>
      <Switch value={value} disabled={disabled} onValueChange={onChange} accessibilityLabel={label} style={{ width: w, height: h }} />
    </View>
  );
}

export function RoundButton({ symbol, label, onPress, size = 46, tint, light = false }: { symbol: SFSymbol; label: string; onPress: () => void; size?: number; tint?: string; light?: boolean }) {
  const c = useColors();
  return (
    <Tap onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={{ width: size, height: size }}>
      <Glass interactive tint={tint} scheme={light ? "light" : undefined} style={[styles.round, { width: size, height: size, borderRadius: size / 2 }]}>
        <SymbolView name={symbol} tintColor={c.text} size={size * 0.42} />
      </Glass>
    </Tap>
  );
}

/** Botón principal: una cápsula de vidrio líquido teñida (como los botones prominentes de iOS 26); sin vidrio, una cápsula sólida. */
export function PrimaryButton({ label, onPress, symbol, tone = "accent", disabled = false, a11y }: { label: string; onPress: () => void; symbol?: SFSymbol; tone?: "accent" | "ink"; disabled?: boolean; a11y?: string }) {
  const c = useColors();
  const bg = tone === "accent" ? c.accent : c.ink, fg = tone === "accent" ? c.onAccent : c.onInk;
  return (
    <Tap onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={a11y ?? label} accessibilityState={{ disabled }} style={{ opacity: disabled ? 0.6 : 1 }}>
      <Glass interactive tint={bg} style={styles.primary}>
        <View style={styles.primaryRow}>{symbol ? <SymbolView name={symbol} tintColor={fg} size={17} /> : null}<Text style={[type.headline, { color: fg }]}>{label}</Text></View>
      </Glass>
    </Tap>
  );
}

/** Botón de cerrar de una hoja: arriba a la derecha, de vidrio, con área de toque grande. */
export function SheetClose({ onPress }: { onPress: () => void }) {
  return <View style={styles.close}><RoundButton symbol="xmark" label="Cerrar" onPress={onPress} size={40} /></View>;
}

/** En pantallas anchas (iPad) el contenido no se estira de lado a lado: se centra en una columna. */
export const PAGE: StyleProp<ViewStyle> = { width: "100%", maxWidth: 680, alignSelf: "center" };

/** Etiqueta redonda para elegir (ordenar, filtrar). Con `glass` va sobre una superficie de vidrio (como en el mapa): sin fondo propio, y la elegida se marca con un relleno suave. `dot` pone un punto de color antes del texto. */
export function Chip({ label, selected, onPress, glass = false, dot, onLight = false }: { label: string; selected?: boolean; onPress: () => void; glass?: boolean; dot?: string; /** Sobre vidrio claro: texto oscuro. */ onLight?: boolean }) {
  const c = useColors();
  const bg = glass ? (selected ? (c.dark && !onLight ? "rgba(255,255,255,0.26)" : "rgba(0,0,0,0.12)") : "transparent") : selected ? c.ink : c.card;
  const fg = glass ? (onLight ? "#111114" : c.text) : selected ? c.onInk : c.text;
  return (
    <Tap onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!selected }} accessibilityLabel={label}
      style={[styles.chip, glass ? { minHeight: 40, borderWidth: 0 } : { borderColor: c.line }, { backgroundColor: bg }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        {dot ? <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: dot }} /> : null}
        <Text style={[type.caption, { color: fg, fontSize: 14, fontWeight: selected || !glass ? "700" : "500" }]}>{label}</Text>
      </View>
    </Tap>
  );
}

export function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  const c = useColors();
  return (
    <View style={styles.sectionRow}>
      <Text style={[type.title, { color: c.text }]} accessibilityRole="header">{title}</Text>
      {action ? <Tap onPress={onAction} haptic={false}><Text style={[type.caption, { color: c.accent, fontSize: 15 }]}>{action}</Text></Tap> : null}
    </View>
  );
}

/** Círculo con un símbolo, para las tarjetas de acceso rápido. */
export function IconDot({ symbol, tint, bg }: { symbol: SFSymbol; tint: string; bg: string }) {
  return <View style={[styles.dot, { backgroundColor: bg }]}><SymbolView name={symbol} tintColor={tint} size={22} /></View>;
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderCurve: "continuous", padding: space[4], shadowOpacity: 0.07, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
  primary: { minHeight: 54, borderRadius: radius.pill, borderCurve: "continuous", overflow: "hidden", justifyContent: "center", alignItems: "center" },
  primaryRow: { flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[5], minHeight: 54 },
  round: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  chip: { paddingHorizontal: space[4], minHeight: 44, borderRadius: radius.pill, borderCurve: "continuous", alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  sectionRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: space[6], marginBottom: space[3], paddingHorizontal: space[5] },
  close: { position: "absolute", top: space[3], right: space[4], zIndex: 5 },
  dot: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});
