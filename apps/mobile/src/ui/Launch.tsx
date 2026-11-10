import { useEffect, useState, useSyncExternalStore } from "react";
import { Image, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SymbolView } from "expo-symbols";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { create } from "zustand";
import { useAccessibility } from "@/accessibility";
import { transit } from "@/composition-root";
import { BUS_SPRITES } from "@/map/sprites";
import { radius, space, type, useColors } from "./theme";

/** Avisa al resto de la app cuándo terminó la pantalla de arranque (p. ej. para no mostrar la bienvenida encima). */
export const useLaunch = create<{ done: boolean }>(() => ({ done: false }));

const MIN_MS = 1500;       // no parpadea si todo carga muy rápido
const MAX_MS = 7000;       // si no hay datos en vivo, igual se entra a la app
const BUSES = [
  { sprite: "troncal-l-R", lane: 3, dur: 5200, offset: 0.1 },
  { sprite: "dual-l-R", lane: 3, dur: 6400, offset: 0.62 },
  { sprite: "troncal-l-L", lane: 0, dur: 5800, offset: 0.35 },
  { sprite: "alimentador-s-L", lane: 1, dur: 4300, offset: 0.8 },
  { sprite: "zonal-s-R", lane: 2, dur: 4800, offset: 0.45 },
  { sprite: "troncal-s-R", lane: 2, dur: 7000, offset: 0.9 },
] as const;
const LANE_H = 52, LANES = 4, BUS_W = 104;

/** Un bus que cruza la pantalla una y otra vez. El desfase inicial reparte los buses para que no salgan todos juntos. */
function RoadBus({ sprite, lane, dur, offset, width, still }: { sprite: string; lane: number; dur: number; offset: number; width: number; still: boolean }) {
  const p = useSharedValue(offset);
  useEffect(() => {
    if (still) return;
    p.value = withRepeat(withTiming(offset + 1, { duration: dur, easing: Easing.linear }), -1, false);   // al terminar vuelve a «offset», que es lo mismo que offset + 1: sin saltos
  }, [still, dur, offset, p]);
  const toRight = sprite.endsWith("-R");
  const style = useAnimatedStyle(() => {
    const t = p.value % 1, span = width + BUS_W * 2;
    return { transform: [{ translateX: toRight ? -BUS_W + t * span : width + BUS_W - t * span }] };
  });
  return <Animated.View style={[styles.bus, { top: lane * LANE_H + 4 }, style]}><Image source={BUS_SPRITES[sprite]} style={{ width: BUS_W, height: 44 }} resizeMode="contain" /></Animated.View>;
}

/** Rayas de la calle que corren, para que el piso también se sienta en movimiento. */
function Dashes({ width, y, still }: { width: number; y: number; still: boolean }) {
  const c = useColors();
  const p = useSharedValue(0);
  useEffect(() => { if (!still) p.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.linear }), -1, false); }, [still, p]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: -p.value * 56 }] }));
  const n = Math.ceil(width / 56) + 2;
  return <Animated.View style={[styles.dashes, { top: y }, style]}>{Array.from({ length: n }, (_, i) => <View key={i} style={[styles.dash, { backgroundColor: c.line }]} />)}</Animated.View>;
}

const R0 = 44, BORDER = 520, DIAMETER = 2 * (R0 + BORDER), TOTAL_MS = 1700, OPEN_AT = 0.45;
const clamp01 = (x: number) => { "worklet"; return x < 0 ? 0 : x > 1 ? 1 : x; };

/** Pantalla de arranque: una avenida con buses en movimiento mientras cargan las rutas y los buses en vivo. Al estar listo, la avenida deja solo una insignia roja con el bus,
 *  que se abre como una ventana por donde aparece la app y crece hasta llenar la pantalla (sin desvanecer ni barra de carga). */
export function Launch() {
  const c = useColors();
  const { width, height } = useWindowDimensions();
  const { reduceMotion } = useAccessibility();
  useSyncExternalStore((l) => transit.subscribe(l), () => transit.version);
  const [elapsed, setElapsed] = useState(0);
  const [phase, setPhase] = useState<"on" | "leaving" | "gone">("on");
  const t = useSharedValue(0);

  useEffect(() => { const t0 = Date.now(), id = setInterval(() => setElapsed(Date.now() - t0), 200); return () => clearInterval(id); }, []);

  const routes = transit.network.routes.size > 0, buses = transit.fleet.size;
  const ready = routes && (buses > 0 || elapsed > MAX_MS - 2000) && elapsed >= MIN_MS || elapsed >= MAX_MS;
  useEffect(() => {
    if (!ready || phase !== "on") return;
    setPhase("leaving");
    const ms = reduceMotion ? 350 : TOTAL_MS;
    t.value = withTiming(1, { duration: ms, easing: Easing.linear });
    const id = setTimeout(() => { setPhase("gone"); useLaunch.setState({ done: true }); }, ms + 40);
    return () => clearTimeout(id);
  }, [ready, phase, reduceMotion, t]);

  // 1) la avenida y los textos se van; 2) queda la insignia; 3) la insignia se abre y el hueco crece mostrando la app
  const scene = useAnimatedStyle(() => ({ opacity: reduceMotion ? 1 - t.value : 1 - clamp01(t.value / 0.17) }));
  const solid = useAnimatedStyle(() => ({ opacity: reduceMotion ? 1 - t.value : t.value < OPEN_AT ? 1 : 0 }));
  const badge = useAnimatedStyle(() => {
    const pop = clamp01((t.value - 0.1) / 0.2), open = clamp01((t.value - OPEN_AT) / 0.1);
    return { opacity: reduceMotion ? 0 : pop * (1 - open), transform: [{ scale: 0.5 + 0.5 * pop + 0.12 * Math.sin(pop * Math.PI) }] };
  });
  const grow = useAnimatedStyle(() => { const u = clamp01((t.value - OPEN_AT) / (1 - OPEN_AT)); return { transform: [{ scale: 1 + 13 * u * u * u }] }; });
  const rim = useAnimatedStyle(() => { const u = clamp01((t.value - OPEN_AT) / (1 - OPEN_AT)); return { opacity: t.value < OPEN_AT ? 0 : 1 - u, transform: [{ scale: 1 + 13 * u * u * u }] }; });
  if (phase === "gone") return null;

  const line = !routes ? "Cargando rutas y paradas…" : buses > 0 ? `${buses.toLocaleString("es-CO")} buses en la calle ahora` : elapsed < MAX_MS ? "Buscando buses en vivo…" : "Sin datos en vivo por ahora";
  const roadW = width - space[5] * 2;
  const mid = { left: width / 2 - R0, top: height / 2 - R0, width: R0 * 2, height: R0 * 2, borderRadius: R0 } as const;
  return (
    <View style={styles.overlay} pointerEvents={phase === "on" ? "auto" : "none"} accessibilityViewIsModal accessibilityLabel={`Abriendo TransMi LIVE. ${line}`}>
      {/* el hueco por donde se ve la app: un anillo enorme del color del fondo con un círculo vacío al centro */}
      <Animated.View pointerEvents="none" style={[{ position: "absolute", left: width / 2 - DIAMETER / 2, top: height / 2 - DIAMETER / 2, width: DIAMETER, height: DIAMETER, borderRadius: DIAMETER / 2, borderWidth: BORDER, borderColor: c.bg }, grow]} />
      <Animated.View pointerEvents="none" style={[{ position: "absolute", ...mid, borderWidth: 3, borderColor: c.accent }, rim]} />
      {/* mientras carga, el fondo es sólido; cuando la insignia se abre, deja ver la app por el hueco */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }, solid]} />
      <Animated.View style={[styles.center, scene]}>
        <Text style={[type.eyebrow, { color: c.accent }]}>BOGOTÁ EN VIVO</Text>
        <Text style={[type.largeTitle, { color: c.text }]} accessibilityRole="header">TransMi LIVE</Text>
        <View style={[styles.road, { backgroundColor: c.card, width: roadW, height: LANE_H * LANES + 8 }]}>
          <Dashes width={width} y={LANE_H * 2 + 2} still={reduceMotion} />
          {BUSES.map((b) => <RoadBus key={b.sprite + b.lane} {...b} width={roadW} still={reduceMotion} />)}
        </View>
        <Text style={[type.body, { color: c.muted, textAlign: "center" }]} accessibilityLiveRegion="polite">{line}</Text>
      </Animated.View>
      <Animated.View pointerEvents="none" style={[{ position: "absolute", ...mid, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" }, badge]}>
        <SymbolView name="bus.fill" tintColor="#ffffff" size={40} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, zIndex: 100, elevation: 100 },
  center: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", gap: space[4], paddingHorizontal: space[5] },
  road: { borderRadius: radius.xl, borderCurve: "continuous", overflow: "hidden", marginVertical: space[4] },
  bus: { position: "absolute", left: 0 },
  dashes: { position: "absolute", left: 0, flexDirection: "row", gap: 28, height: 3 },
  dash: { width: 28, height: 3, borderRadius: 2 },
});
