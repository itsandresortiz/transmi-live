import React, { useEffect, useRef, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { Pressable } from "react-native";
import { useAccessibility } from "@/accessibility";
import { Glass } from "./kit";
import { space, type, useColors } from "./theme";

export interface Segment<K extends string> { key: K; label: string; dot?: string }

/** Selector de vidrio como la barra inferior de iOS: la opción elegida es una burbuja de cristal que se desliza de una a otra (con resorte), no un relleno que aparece.
 *  Pensado para ir sobre el mapa (vidrio claro, texto oscuro). */
export function GlassSegments<K extends string>({ items, value, onChange, variant = "map" }: { items: Segment<K>[]; value: K; onChange(k: K): void; /** `map`: barra de vidrio claro que se desliza de lado (sobre el mapa). `plain`: sobre fondo liso, opciones de igual ancho y colores del tema. */ variant?: "map" | "plain" }) {
  const c = useColors();
  const plain = variant === "plain", ink = plain ? c.text : "#111114";
  const { reduceMotion, reduceTransparency } = useAccessibility();
  const frames = useRef(new Map<string, { x: number; w: number }>());
  const [ready, setReady] = useState(false);
  // lo elegido se pinta aquí al instante; el aviso hacia afuera (que recalcula el mapa) espera a que la burbuja termine de moverse
  const [sel, setSel] = useState<K>(value);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const x = useSharedValue(0), w = useSharedValue(0), press = useSharedValue(1);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);

  const moveTo = (k: string, animate: boolean) => {
    const f = frames.current.get(k);
    if (!f) return;
    if (animate && !reduceMotion) { x.value = withSpring(f.x, { damping: 20, stiffness: 180, mass: 1 }); w.value = withSpring(f.w, { damping: 22, stiffness: 180, mass: 1 }); }
    else { x.value = f.x; w.value = f.w; }
    scroll.current?.scrollTo({ x: Math.max(0, f.x - 60), animated: animate });
  };
  useEffect(() => { if (value !== sel && !pending.current) { setSel(value); moveTo(value, ready); } }, [value]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (pending.current) clearTimeout(pending.current); }, []);
  const choose = (k: K) => {
    void Haptics.selectionAsync();
    moveTo(k, true);                      // la animación arranca ya, en el hilo de la interfaz
    setSel(k);
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => { pending.current = null; onChange(k); }, reduceMotion ? 0 : 260);
  };
  const onItemLayout = (k: string) => (e: LayoutChangeEvent) => {
    const { x: fx, width } = e.nativeEvent.layout;
    frames.current.set(k, { x: fx, w: width });
    if (k === sel && !ready) { moveTo(k, false); setReady(true); }
  };

  const bubble = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { scale: press.value }], width: w.value }));
  const glass = Platform.OS === "ios" && isLiquidGlassAvailable() && !reduceTransparency;

  const bubbleView = (
    <Animated.View pointerEvents="none" style={[styles.bubble, { opacity: ready ? 1 : 0 }, bubble]}>
      {glass ? <GlassView glassEffectStyle="regular" colorScheme={plain ? "auto" : "light"} isInteractive style={styles.fill} />
        : <View style={[styles.fill, { backgroundColor: plain ? c.card : "rgba(0,0,0,0.12)" }]} />}
    </Animated.View>
  );
  const options = items.map((it) => {
    const on = it.key === sel;
    return (
      <Pressable key={it.key} onLayout={onItemLayout(it.key)} hitSlop={6}
        onPressIn={() => { if (on && !reduceMotion) press.value = withSpring(1.06, { damping: 12, stiffness: 300 }); }}
        onPressOut={() => { press.value = withTiming(1, { duration: 180 }); }}
        onPress={() => { if (!on) choose(it.key); }}
        accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={it.label} style={[styles.item, plain && { flex: 1, justifyContent: "center", paddingHorizontal: space[2] }]}>
        {it.dot ? <View style={[styles.dot, { backgroundColor: it.dot }]} /> : null}
        <Text numberOfLines={1} style={[type.caption, { color: ink, fontSize: 14, fontWeight: "600", opacity: on ? 1 : 0.72 }]}>{it.label}</Text>
      </Pressable>
    );
  });

  // sobre fondo liso: una pista del color del tema con la burbuja de vidrio encima; las opciones se reparten el ancho
  if (plain) return <View style={[styles.bar, styles.row, { flexDirection: "row", backgroundColor: c.dark ? c.card : "#e3e3e8" }]}>{bubbleView}{options}</View>;
  return (
    <Glass scheme="light" style={styles.bar}>
      <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {/* la burbuja va debajo de los textos y se mueve con ellos al desplazar la fila */}
        {bubbleView}{options}
      </ScrollView>
    </Glass>
  );
}

const styles = StyleSheet.create({
  // pista de 56 de alto con radio 28 y margen 8; burbuja de 40 con radio 20: las dos curvas comparten centro
  bar: { borderRadius: 28, overflow: "hidden" },
  row: { padding: space[2], gap: space[1], alignItems: "center" },
  item: { flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[4], minHeight: 40, borderRadius: 20 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  bubble: { position: "absolute", left: 0, top: space[2], height: 40 },
  fill: { flex: 1, borderRadius: 20, overflow: "hidden" },
});
