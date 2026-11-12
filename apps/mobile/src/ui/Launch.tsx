import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { downText } from "@/lastService";
import { Image, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SymbolView } from "@/ui/Symbol";
import Animated, { Easing, FadeInDown, FadeOutUp, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { create } from "zustand";
import { useAccessibility } from "@/accessibility";
import { transit } from "@/composition-root";
import { BUS_SPRITES } from "@/map/sprites";
import { radius, space, type, useColors } from "./theme";

/** Avisa al resto de la app cuándo terminó la pantalla de arranque (p. ej. para no mostrar la bienvenida encima). */
export const useLaunch = create<{ done: boolean }>(() => ({ done: false }));

const MIN_MS = 1500;       // no parpadea si todo carga muy rápido
const MAX_MS = 8000;       // si ni siquiera cargan las rutas, igual se entra a la app
const WAIT_LIVE_MS = 4500; // con las rutas ya cargadas, cuánto se espera a los primeros buses antes de entrar (se cuenta desde que cargan las rutas)
const BUSES = [
  { sprite: "top-troncal-l", dir: "R", lane: 3, dur: 5200, offset: 0.1 },
  { sprite: "top-dual-l", dir: "R", lane: 3, dur: 6400, offset: 0.62 },
  { sprite: "top-troncal-l", dir: "L", lane: 0, dur: 5800, offset: 0.35 },
  { sprite: "top-alimentador-s", dir: "L", lane: 1, dur: 4300, offset: 0.8 },
  { sprite: "top-zonal-s", dir: "R", lane: 2, dur: 4800, offset: 0.45 },
  { sprite: "top-troncal-s", dir: "R", lane: 2, dur: 7000, offset: 0.9 },
] as const;
const LANE_H = 50, LANES = 4, EDGE = 9;

/** Un bus visto desde arriba que cruza la avenida una y otra vez. El desfase inicial reparte los buses para que no salgan todos juntos. */
function RoadBus({ sprite, dir, lane, dur, offset, width, still }: { sprite: string; dir: "R" | "L"; lane: number; dur: number; offset: number; width: number; still: boolean }) {
  const p = useSharedValue(offset);
  const long = sprite.endsWith("-l"), len = long ? 100 : 64, wid = len * (114 / (long ? 318 : 204));
  useEffect(() => {
    if (still) return;
    p.value = withRepeat(withTiming(offset + 1, { duration: dur, easing: Easing.linear }), -1, false);   // al terminar vuelve a «offset», que es lo mismo que offset + 1: sin saltos
  }, [still, dur, offset, p]);
  const toRight = dir === "R";
  const style = useAnimatedStyle(() => {
    const t = p.value % 1, span = width + len * 2;
    return { transform: [{ translateX: toRight ? -len + t * span : width + len - t * span }] };
  });
  return (
    <Animated.View style={[styles.bus, { top: lane * LANE_H + (LANE_H - wid) / 2, width: len, height: wid, alignItems: "center", justifyContent: "center" }, style]}>
      <Image source={BUS_SPRITES[sprite]} style={{ position: "absolute", width: wid, height: len, transform: [{ rotate: toRight ? "90deg" : "-90deg" }] }} resizeMode="contain" />
    </Animated.View>
  );
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

/** El número sube hasta su valor en vez de aparecer de golpe. */
function useCount(target: number, ms = 700): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!target) { setN(0); return; }
    const t0 = Date.now();
    const id = setInterval(() => { const u = Math.min(1, (Date.now() - t0) / ms); setN(Math.round(target * (1 - (1 - u) ** 3))); if (u >= 1) clearInterval(id); }, 33);
    return () => clearInterval(id);
  }, [target, ms]);
  return n;
}

/** «LIVE»: una cápsula roja con un punto que late, como el indicador de una transmisión en directo. */
function LivePill({ still }: { still: boolean }) {
  const c = useColors();
  const beat = useSharedValue(1);
  useEffect(() => { if (!still) beat.value = withRepeat(withSequence(withTiming(0.25, { duration: 700 }), withTiming(1, { duration: 700 })), -1, false); }, [still, beat]);
  const dot = useAnimatedStyle(() => ({ opacity: beat.value }));
  return (
    <View style={[styles.live, { backgroundColor: c.accent }]}>
      <Animated.View style={[styles.liveDot, dot]} />
      <Text maxFontSizeMultiplier={1.1} style={styles.liveText}>LIVE</Text>
    </View>
  );
}

/** Pantalla de arranque: la marca, una avenida con buses y una sola línea que dice qué pasa. Cuando todo está listo, una insignia roja se abre como una ventana y revela la app. */
export function Launch() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { reduceMotion } = useAccessibility();
  useSyncExternalStore((l) => transit.subscribe(l), () => transit.version);
  const [elapsed, setElapsed] = useState(0);
  const [phase, setPhase] = useState<"on" | "leaving" | "gone">("on");
  const t = useSharedValue(0);

  useEffect(() => { const t0 = Date.now(), id = setInterval(() => setElapsed(Date.now() - t0), 200); return () => clearInterval(id); }, []);

  const routes = transit.network.routes.size > 0, buses = transit.fleet.size;
  const count = useCount(routes ? buses : 0);
  // El tiempo de espera de los buses se cuenta desde que cargan las rutas, no desde que abrió la app: al procesar las rutas el teléfono se ocupa unos segundos
  // y el reloj de la pantalla saltaba de golpe pasando el límite, antes de que alcanzaran a llegar los buses (y decía «sin datos en vivo» habiéndolos).
  const routesAt = useRef<number | null>(null);
  if (routes && routesAt.current == null) routesAt.current = Date.now();
  const sinceRoutes = routesAt.current == null ? 0 : Date.now() - routesAt.current;
  const ready = (routes && (buses > 0 || sinceRoutes >= WAIT_LIVE_MS) && elapsed >= MIN_MS) || (!routes && elapsed >= MAX_MS);
  useEffect(() => {
    if (!ready || phase !== "on") return;
    setPhase("leaving");
    const ms = reduceMotion ? 350 : TOTAL_MS;
    t.value = withTiming(1, { duration: ms, easing: Easing.linear });
    const buzz = reduceMotion ? undefined : setTimeout(() => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), ms * OPEN_AT);   // un toque justo cuando la ventana se abre
    const id = setTimeout(() => { setPhase("gone"); useLaunch.setState({ done: true }); }, ms + 40);
    return () => { clearTimeout(id); if (buzz) clearTimeout(buzz); };
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

  // «Sin datos en vivo» solo si el servidor ya contestó y de verdad no trajo buses; mientras no se sepa, sigue «Buscando buses en vivo»
  const answeredEmpty = transit.lastPollOkAt != null && sinceRoutes >= 3000;
  const stage = !routes ? "rutas" : buses > 0 ? "buses" : answeredEmpty ? "sin" : "buscando";
  const line = stage === "rutas" ? "Preparando rutas y paradas" : stage === "buscando" ? "Buscando buses en vivo" : stage === "sin" ? (downText().closed ? "Servicio finalizado; puedes ver rutas y horarios" : "Sin datos en vivo; usamos los horarios") : `${count.toLocaleString("es-CO")} buses en la calle ahora`;
  const mid = { left: width / 2 - R0, top: height / 2 - R0, width: R0 * 2, height: R0 * 2, borderRadius: R0 } as const;
  const strips = Array.from({ length: EDGE }, (_, i) => 1 - i / EDGE);      // 1 → casi 0: el borde se funde con el fondo
  return (
    <View style={styles.overlay} pointerEvents={phase === "on" ? "auto" : "none"} accessibilityViewIsModal accessibilityLabel={`Abriendo TransMi LIVE. ${line}`}>
      {/* el hueco por donde se ve la app: un anillo enorme del color del fondo con un círculo vacío al centro */}
      <Animated.View pointerEvents="none" style={[{ position: "absolute", left: width / 2 - DIAMETER / 2, top: height / 2 - DIAMETER / 2, width: DIAMETER, height: DIAMETER, borderRadius: DIAMETER / 2, borderWidth: BORDER, borderColor: c.bg }, grow]} />
      <Animated.View pointerEvents="none" style={[{ position: "absolute", ...mid, borderWidth: 3, borderColor: c.accent }, rim]} />
      {/* mientras carga, el fondo es sólido; cuando la insignia se abre, deja ver la app por el hueco */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }, solid]} />
      <Animated.View style={[styles.center, scene]}>
        <View style={styles.brand}>
          <Text maxFontSizeMultiplier={1.15} style={[styles.wordmark, { color: c.text }]} accessibilityRole="header">TransMi</Text>
          <LivePill still={reduceMotion} />
        </View>
        <Text maxFontSizeMultiplier={1.2} style={[type.body, { color: c.muted, marginTop: space[1] }]}>Bogotá, en tiempo real</Text>

        {/* la avenida: sin caja, de lado a lado, con los bordes fundidos en el fondo */}
        <View style={[styles.road, { width, height: LANE_H * LANES }]}>
          {[1, 3].map((i) => <View key={i} style={[styles.laneLine, { top: i * LANE_H, backgroundColor: c.line }]} />)}
          <Dashes width={width} y={LANE_H * 2 - 1} still={reduceMotion} />
          {BUSES.map((b) => <RoadBus key={b.sprite + b.lane + b.dir} {...b} width={width} still={reduceMotion} />)}
          {strips.map((o, i) => <View key={"l" + i} pointerEvents="none" style={[styles.strip, { left: i * 7, opacity: o, backgroundColor: c.bg }]} />)}
          {strips.map((o, i) => <View key={"r" + i} pointerEvents="none" style={[styles.strip, { right: i * 7, opacity: o, backgroundColor: c.bg }]} />)}
        </View>

        <View style={styles.statusBox}>
          <Animated.Text key={stage} entering={reduceMotion ? undefined : FadeInDown.duration(380)} exiting={reduceMotion ? undefined : FadeOutUp.duration(240)} maxFontSizeMultiplier={1.2}
            style={[type.headline, { color: c.text, textAlign: "center", fontVariant: ["tabular-nums"] }]} accessibilityLiveRegion="polite">{line}</Animated.Text>
        </View>
      </Animated.View>
      <Animated.View pointerEvents="none" style={[styles.footer, { bottom: insets.bottom + space[5] }, scene]}>
        <Text maxFontSizeMultiplier={1.2} style={[type.caption, { color: c.muted, opacity: 0.8 }]}>Con datos abiertos de TransMilenio</Text>
      </Animated.View>
      <Animated.View pointerEvents="none" style={[{ position: "absolute", ...mid, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" }, badge]}>
        <SymbolView name="bus.fill" tintColor="#ffffff" size={40} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, zIndex: 100, elevation: 100 },
  center: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  brand: { flexDirection: "row", alignItems: "center", gap: space[2] },
  wordmark: { fontSize: 46, fontWeight: "800", letterSpacing: -1.6 },
  live: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, height: 26, borderRadius: 13, borderCurve: "continuous", marginTop: 6 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#ffffff" },
  liveText: { color: "#ffffff", fontSize: 13, fontWeight: "800", letterSpacing: 1.2 },
  road: { marginTop: space[8], marginBottom: space[8], overflow: "hidden" },
  laneLine: { position: "absolute", left: 0, right: 0, height: StyleSheet.hairlineWidth },
  strip: { position: "absolute", top: 0, bottom: 0, width: 7 },
  statusBox: { height: 30, justifyContent: "center", alignItems: "center", paddingHorizontal: space[5] },
  footer: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  bus: { position: "absolute", left: 0 },
  dashes: { position: "absolute", left: 0, flexDirection: "row", gap: 28, height: 3 },
  dash: { width: 28, height: 3, borderRadius: 2 },
});
