import { useEffect, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { useAccessibility } from "@/accessibility";
import { useColors } from "./theme";

/** Escena de «Voy en el cable» (TransMiCable): la cabina roja y negra colgando del cable, meciéndose, con los cerros y las casas de
 *  Ciudad Bolívar pasando por detrás. Es la versión del cable de `RideScene` (la del bus es una avenida con el bus visto desde atrás).
 *  El fondo se mueve mientras vas en camino y se detiene al llegar; con «Reducir movimiento» queda quieto. */
const H = 290, PERIOD = 420;

/** Cerros y casas: se repiten cada PERIOD para que el bucle no tenga saltos. */
function useHills() {
  return useMemo(() => {
    let s = 11; const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    const far = Array.from({ length: 4 }, (_, i) => ({ x: i * (PERIOD / 4) + rnd() * 20, w: 170 + rnd() * 90, h: 70 + rnd() * 40 }));
    const near = Array.from({ length: 7 }, (_, i) => ({ x: i * (PERIOD / 7) + rnd() * 18, w: 34 + rnd() * 26, h: 22 + rnd() * 26, y: 18 + rnd() * 30 }));
    return { far, near };
  }, []);
}

export function CableScene({ moving = true, width }: { moving?: boolean; width: number }) {
  const c = useColors();
  const { reduceMotion } = useAccessibility();
  const { far, near } = useHills();
  const run = moving && !reduceMotion;
  const slow = useSharedValue(0), fast = useSharedValue(0), sway = useSharedValue(0);
  useEffect(() => {
    if (!run) { cancelAnimation(slow); cancelAnimation(fast); cancelAnimation(sway); sway.value = withTiming(0, { duration: 400 }); return; }
    slow.value = slow.value % 1; fast.value = fast.value % 1;
    slow.value = withRepeat(withTiming(slow.value + 1, { duration: 14000, easing: Easing.linear }), -1, false);
    fast.value = withRepeat(withTiming(fast.value + 1, { duration: 6000, easing: Easing.linear }), -1, false);
    sway.value = withRepeat(withSequence(withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.sin) }), withTiming(-1, { duration: 2200, easing: Easing.inOut(Easing.sin) })), -1, true);
  }, [run, slow, fast, sway]);
  const farStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -(slow.value % 1) * PERIOD }] }));
  const nearStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -(fast.value % 1) * PERIOD }] }));
  // la cabina se mece colgada de su brazo (gira sobre el punto donde se agarra al cable)
  const cabinStyle = useAnimatedStyle(() => ({ transform: [{ translateY: 46 }, { rotate: `${sway.value * 2.2}deg` }, { translateY: -46 }] }));

  const sky = c.dark ? "#121826" : "#dbe9f6", hillFar = c.dark ? "#1b2433" : "#c3d3c4", hillNear = c.dark ? "#232e3f" : "#a9c2ab";
  const house = c.dark ? "#2d384b" : "#e9dccb", roof = c.dark ? "#3c4a60" : "#c46b4f", wire = c.dark ? "#c9ccd4" : "#111114";
  const copies = Math.ceil(width / PERIOD) + 2, cx = width / 2;
  const fade = Array.from({ length: 10 }, (_, i) => 1 - i / 10);

  return (
    <View style={{ width, height: H, overflow: "hidden", backgroundColor: sky }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {/* cerros lejanos (lentos) y casas en la ladera (más rápidas): da la sensación de avanzar por el aire */}
      <Animated.View style={[StyleSheet.absoluteFill, farStyle]}>
        {Array.from({ length: copies }, (_, k) => far.map((f, i) => (
          <View key={`f${k}-${i}`} style={{ position: "absolute", left: k * PERIOD + f.x, bottom: 40, width: f.w, height: f.h * 2, borderRadius: f.w, backgroundColor: hillFar, transform: [{ scaleY: 0.5 }] }} />
        )))}
      </Animated.View>
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 70, backgroundColor: hillNear }} />
      <Animated.View style={[StyleSheet.absoluteFill, nearStyle]}>
        {Array.from({ length: copies }, (_, k) => near.map((n, i) => (
          <View key={`n${k}-${i}`} style={{ position: "absolute", left: k * PERIOD + n.x, bottom: n.y, width: n.w, height: n.h }}>
            <View style={{ position: "absolute", left: -3, right: -3, top: -7, height: 9, borderRadius: 2, backgroundColor: roof }} />
            <View style={{ flex: 1, backgroundColor: house, borderRadius: 2 }} />
          </View>
        )))}
      </Animated.View>
      {/* el cable, cruzando de lado a lado un poco inclinado */}
      <View style={{ position: "absolute", left: -20, width: width + 40, top: 62, height: 2.5, backgroundColor: wire, transform: [{ rotate: "-6deg" }] }} />
      {/* la cabina: brazo negro, techo negro, cuerpo rojo con ventanas oscuras y la base negra */}
      <Animated.View style={[{ position: "absolute", left: cx - 62, top: 50, width: 124, height: 170, alignItems: "center" }, cabinStyle]}>
        <View style={{ width: 22, height: 10, borderRadius: 4, backgroundColor: "#2b2e35" }} />
        <View style={{ width: 5, height: 36, backgroundColor: "#16181d" }} />
        <View style={{ width: 96, height: 12, borderTopLeftRadius: 10, borderTopRightRadius: 10, backgroundColor: "#16181d" }} />
        <View style={{ width: 112, height: 84, borderRadius: 14, borderTopLeftRadius: 6, borderTopRightRadius: 6, backgroundColor: "#e30613", paddingTop: 12, paddingHorizontal: 10, flexDirection: "row", gap: 6 }}>
          <View style={styles.win} /><View style={styles.win} /><View style={styles.win} />
        </View>
        <View style={{ width: 112, height: 14, marginTop: -10, borderBottomLeftRadius: 14, borderBottomRightRadius: 14, backgroundColor: "#16181d" }} />
      </Animated.View>
      {/* bordes fundidos con el fondo, como en la escena del bus */}
      {fade.map((o, i) => <View key={"t" + i} pointerEvents="none" style={[styles.h, { top: i * 11, height: 11, opacity: Math.min(1, o * 1.35), backgroundColor: c.bg }]} />)}
      {fade.map((o, i) => <View key={"b" + i} pointerEvents="none" style={[styles.h, { bottom: i * 5, height: 5, opacity: o, backgroundColor: c.bg }]} />)}
      {fade.map((o, i) => <View key={"l" + i} pointerEvents="none" style={[styles.v, { left: i * 7, width: 7, opacity: o, backgroundColor: c.bg }]} />)}
      {fade.map((o, i) => <View key={"r" + i} pointerEvents="none" style={[styles.v, { right: i * 7, width: 7, opacity: o, backgroundColor: c.bg }]} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  win: { flex: 1, height: 40, borderRadius: 6, backgroundColor: "rgba(18,24,34,.88)" },
  h: { position: "absolute", left: 0, right: 0 },
  v: { position: "absolute", top: 0, bottom: 0 },
});
