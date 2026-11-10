import React, { useEffect, useRef, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { Pressable } from "react-native";
import { useAccessibility } from "@/accessibility";
import { Glass } from "./kit";
import { space, type } from "./theme";

export interface Segment<K extends string> { key: K; label: string; dot?: string }

/** Selector de vidrio como la barra inferior de iOS: la opción elegida es una burbuja de cristal que se desliza de una a otra (con resorte), no un relleno que aparece.
 *  Pensado para ir sobre el mapa (vidrio claro, texto oscuro). */
export function GlassSegments<K extends string>({ items, value, onChange }: { items: Segment<K>[]; value: K; onChange(k: K): void }) {
  const { reduceMotion, reduceTransparency } = useAccessibility();
  const frames = useRef(new Map<string, { x: number; w: number }>());
  const [ready, setReady] = useState(false);
  const x = useSharedValue(0), w = useSharedValue(0), press = useSharedValue(1);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);

  const moveTo = (k: string, animate: boolean) => {
    const f = frames.current.get(k);
    if (!f) return;
    if (animate && !reduceMotion) { x.value = withSpring(f.x, { damping: 17, stiffness: 210, mass: 0.9 }); w.value = withSpring(f.w, { damping: 19, stiffness: 230 }); }
    else { x.value = f.x; w.value = f.w; }
    scroll.current?.scrollTo({ x: Math.max(0, f.x - 60), animated: animate });
  };
  useEffect(() => { moveTo(value, ready); }, [value]);   // eslint-disable-line react-hooks/exhaustive-deps
  const onItemLayout = (k: string) => (e: LayoutChangeEvent) => {
    const { x: fx, width } = e.nativeEvent.layout;
    frames.current.set(k, { x: fx, w: width });
    if (k === value) { moveTo(k, false); if (!ready) setReady(true); }
  };

  const bubble = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { scale: press.value }], width: w.value }));
  const glass = Platform.OS === "ios" && isLiquidGlassAvailable() && !reduceTransparency;

  return (
    <Glass scheme="light" style={styles.bar}>
      <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {/* la burbuja va debajo de los textos y se mueve con ellos al desplazar la fila */}
        <Animated.View pointerEvents="none" style={[styles.bubble, { opacity: ready ? 1 : 0 }, bubble]}>
          {glass ? <GlassView glassEffectStyle="regular" colorScheme="light" isInteractive style={styles.fill} /> : <View style={[styles.fill, { backgroundColor: "rgba(0,0,0,0.12)" }]} />}
        </Animated.View>
        {items.map((it) => {
          const on = it.key === value;
          return (
            <Pressable key={it.key} onLayout={onItemLayout(it.key)} hitSlop={6}
              onPressIn={() => { if (on && !reduceMotion) press.value = withSpring(1.06, { damping: 12, stiffness: 300 }); }}
              onPressOut={() => { press.value = withTiming(1, { duration: 180 }); }}
              onPress={() => { if (!on) { void Haptics.selectionAsync(); onChange(it.key); } }}
              accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={it.label} style={styles.item}>
              {it.dot ? <View style={[styles.dot, { backgroundColor: it.dot }]} /> : null}
              <Text style={[type.caption, { color: "#111114", fontSize: 14, fontWeight: on ? "700" : "500" }]}>{it.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </Glass>
  );
}

const styles = StyleSheet.create({
  bar: { borderRadius: 28, overflow: "hidden" },
  row: { padding: space[2], gap: space[1], alignItems: "center" },
  item: { flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[4], minHeight: 40, borderRadius: 20 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  bubble: { position: "absolute", left: 0, top: space[2], height: 40 },
  fill: { flex: 1, borderRadius: 20, borderCurve: "continuous", overflow: "hidden" },
});
