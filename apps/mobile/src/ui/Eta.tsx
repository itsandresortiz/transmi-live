import { memo, useEffect, useRef } from "react";
import { StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import Animated, { Easing, type SharedValue, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useAccessibility } from "@/accessibility";
import { etaText } from "@/format";
import { useNow } from "@/hooks";

/** Tiempo de llegada que corre segundo a segundo por su cuenta. Las listas (inicio, favoritos, cerca) se recalculan cada 5 s porque es
 *  costoso; si el texto usara ese mismo reloj, los segundos saltarían de a cinco y se vería trabado. Aquí solo se repinta este texto,
 *  y solo «ruedan» las cifras que cambian (casi siempre los segundos; los minutos cuando les toca). */
export const Eta = memo(function Eta({ at, style, prefix = "", containerStyle }: { at: number; style?: StyleProp<TextStyle>; prefix?: string; containerStyle?: StyleProp<ViewStyle> }) {
  const now = useNow(1000) / 1000;
  return <RollingText text={`${prefix}${etaText(at, now)}`} style={style} containerStyle={containerStyle} />;
});

/** Texto que cambia con efecto de rodillo: cada letra que cambia sube y sale, y la nueva entra desde abajo; las que no cambian quedan
 *  quietas. Si el texto cambia de largo (p. ej. de «10 min» a «9 min», o a «llegando») no hay cifra con la cual alinear: cambia de una vez.
 *  Con «Reducir movimiento» el texto cambia sin animación. */
export const RollingText = memo(function RollingText({ text, style, containerStyle }: { text: string; style?: StyleProp<TextStyle>; containerStyle?: StyleProp<ViewStyle> }) {
  const { reduceMotion } = useAccessibility();
  const chars = [...text];
  return (
    <View style={[styles.row, containerStyle]} accessible accessibilityRole="text" accessibilityLabel={text}>
      {chars.map((ch, i) => <Cell key={`${chars.length}-${i}`} ch={ch} style={style} roll={!reduceMotion} />)}
    </View>
  );
});

const Cell = memo(function Cell({ ch, style, roll }: { ch: string; style?: StyleProp<TextStyle>; roll: boolean }) {
  // la altura de la letra se guarda aquí (no en `Roll`, que se vuelve a crear en cada cambio) para que el desplazamiento valga desde el primer cuadro
  const h = useSharedValue(0);
  const st = useRef({ cur: ch, prev: null as string | null, n: 0 });
  if (st.current.cur !== ch) st.current = { cur: ch, prev: roll ? st.current.cur : null, n: st.current.n + 1 };
  const { cur, prev, n } = st.current;
  return (
    <View style={styles.cell} onLayout={(e) => { h.value = e.nativeEvent.layout.height; }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Roll key={n} cur={cur} prev={prev} h={h} style={style} />
    </View>
  );
});

/** Un cambio de letra. Se crea de nuevo en cada cambio, así arranca ya en su posición inicial (sin un cuadro con la letra nueva en su sitio). */
function Roll({ cur, prev, h, style }: { cur: string; prev: string | null; h: SharedValue<number>; style?: StyleProp<TextStyle> }) {
  const p = useSharedValue(prev == null ? 1 : 0);
  useEffect(() => {
    if (prev != null) p.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) });
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const enter = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ translateY: (1 - p.value) * h.value * 0.75 }] }));
  const leave = useAnimatedStyle(() => ({ opacity: 1 - p.value, transform: [{ translateY: -p.value * h.value * 0.75 }] }));
  return (
    <>
      <Animated.Text style={[styles.digits, style, enter]}>{cur}</Animated.Text>
      {prev != null ? <Animated.Text style={[styles.digits, style, styles.over, leave]}>{prev}</Animated.Text> : null}
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "baseline" },
  cell: { overflow: "hidden" },
  digits: { fontVariant: ["tabular-nums"] },
  over: { position: "absolute", left: 0, top: 0 },
});
