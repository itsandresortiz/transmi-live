import { useEffect, useState } from "react";
import { ScrollView, type StyleProp, Text, type TextStyle, View } from "react-native";
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { useAccessibility } from "@/accessibility";

/** Texto de una sola línea: si no cabe en `maxWidth`, se desliza despacio de un lado a otro para poder leerlo completo, sin saltar de renglón.
 *  Con «Reducir movimiento» se queda quieto y se corta con puntos suspensivos. */
export function Marquee({ text, style, maxWidth }: { text: string; style?: StyleProp<TextStyle>; maxWidth: number }) {
  const { reduceMotion } = useAccessibility();
  const [w, setW] = useState(0);
  const x = useSharedValue(0);
  const shift = Math.max(0, Math.ceil(w - maxWidth));
  const moving = shift > 4 && !reduceMotion;
  useEffect(() => {
    cancelAnimation(x); x.value = 0;
    if (!moving) return;
    const ms = Math.max(3500, (shift / 28) * 1000);      // ~28 puntos por segundo: se alcanza a leer
    x.value = withRepeat(withSequence(withDelay(1400, withTiming(-shift, { duration: ms, easing: Easing.inOut(Easing.quad) })), withDelay(1400, withTiming(0, { duration: ms, easing: Easing.inOut(Easing.quad) }))), -1, false);
    return () => cancelAnimation(x);
  }, [moving, shift, text, x]);
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  if (reduceMotion) return <Text style={[style, { maxWidth }]} numberOfLines={1}>{text}</Text>;
  return (
    <View style={{ maxWidth, overflow: "hidden" }}>
      {/* dentro de una fila que se desplaza el texto se mide con su ancho real, sin cortarse */}
      <ScrollView horizontal scrollEnabled={false} showsHorizontalScrollIndicator={false} pointerEvents="none">
        <Animated.View style={slide}><Text style={style} numberOfLines={1} onLayout={(e) => setW(e.nativeEvent.layout.width)}>{text}</Text></Animated.View>
      </ScrollView>
    </View>
  );
}
