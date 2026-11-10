import type { ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useAccessibility } from "@/accessibility";
import { radius, space, type, useColors } from "./theme";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Cualquier cosa tocable se hunde un poco al presionarla y vuelve con un resorte, como en iOS. */
export function Tap({ children, style, haptic = true, onPress, ...rest }: PressableProps & { children: ReactNode; style?: StyleProp<ViewStyle>; haptic?: boolean }) {
  const { reduceMotion } = useAccessibility();
  const scale = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressable
      hitSlop={12}
      {...rest}
      onPressIn={() => { if (!reduceMotion) scale.value = withSpring(0.96, { damping: 18, stiffness: 420 }); }}
      onPressOut={() => { if (!reduceMotion) scale.value = withSpring(1, { damping: 14, stiffness: 300 }); }}
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

/** Superficie de vidrio líquido en iOS 26; en lo demás, un fondo translúcido. Con «Reducir transparencia» del teléfono, un fondo sólido. */
export function Glass({ children, style, interactive = false, tint }: { children?: ReactNode; style?: StyleProp<ViewStyle>; interactive?: boolean; tint?: string }) {
  const c = useColors();
  const { reduceTransparency } = useAccessibility();
  if (reduceTransparency) return <View style={[{ backgroundColor: c.card }, style]}>{children}</View>;
  if (Platform.OS === "ios" && isLiquidGlassAvailable()) return <GlassView glassEffectStyle="regular" isInteractive={interactive} tintColor={tint} style={style}>{children}</GlassView>;
  return <View style={[{ backgroundColor: tint ?? (c.dark ? "rgba(40,40,44,0.82)" : "rgba(255,255,255,0.86)") }, style]}>{children}</View>;
}

/** Botón redondo de vidrio con un símbolo de iOS (volver, ubicación, avisos…). */
export function RoundButton({ symbol, label, onPress, size = 46, tint }: { symbol: SFSymbol; label: string; onPress: () => void; size?: number; tint?: string }) {
  const c = useColors();
  return (
    <Tap onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={{ width: size, height: size }}>
      <Glass interactive tint={tint} style={[styles.round, { width: size, height: size, borderRadius: size / 2 }]}>
        <SymbolView name={symbol} tintColor={c.text} size={size * 0.42} />
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

/** Etiqueta redonda para elegir (ordenar, filtrar). */
export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Tap onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!selected }} accessibilityLabel={label}
      style={[styles.chip, { backgroundColor: selected ? c.ink : c.card, borderColor: c.line }]}>
      <Text style={[type.caption, { color: selected ? c.onInk : c.text, fontSize: 14 }]}>{label}</Text>
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
  round: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  chip: { paddingHorizontal: space[4], minHeight: 44, borderRadius: radius.pill, borderCurve: "continuous", alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  sectionRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: space[6], marginBottom: space[3], paddingHorizontal: space[5] },
  close: { position: "absolute", top: space[3], right: space[4], zIndex: 5 },
  dot: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});
