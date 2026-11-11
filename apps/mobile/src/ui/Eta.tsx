import { memo, useEffect } from "react";
import { type StyleProp, type TextStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useAccessibility } from "@/accessibility";
import { etaText } from "@/format";
import { useNow } from "@/hooks";

/** Tiempo de llegada que corre segundo a segundo por su cuenta. Las listas (inicio, favoritos, cerca) se recalculan cada 5 s porque es
 *  costoso; si el texto usara ese mismo reloj, los segundos saltarían de a cinco y se vería trabado. Aquí solo se repinta este texto.
 *  Cada cambio entra con un fundido muy corto, para que el número no «salte» en seco (se omite con «Reducir movimiento»). */
export const Eta = memo(function Eta({ at, style }: { at: number; style?: StyleProp<TextStyle> }) {
  const now = useNow(1000) / 1000;
  const text = etaText(at, now);
  const { reduceMotion } = useAccessibility();
  const o = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion) return;
    o.value = 0.45;
    o.value = withTiming(1, { duration: 320 });
  }, [text, reduceMotion, o]);
  const fade = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.Text style={[{ fontVariant: ["tabular-nums"] }, style, fade]}>{text}</Animated.Text>;
});
