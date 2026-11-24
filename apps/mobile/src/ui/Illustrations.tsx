import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { SymbolView, type SFSymbol } from "@/ui/Symbol";
import { useAccessibility } from "@/accessibility";
import { TRUNK_LINES, trunkLetterOf, type SystemType } from "@transmi/domain";
import { SYSTEM_COLOR, lift, space, useColors } from "./theme";

/** Ilustraciones de la app hechas solo con vistas (sin imágenes ni librerías nativas nuevas): Bogotá con sus cerros y Monserrate,
 *  la avenida con el carril del color de la línea y un bus visto de lado; o una estación de TransMilenio, o un paradero del SITP.
 *  Van en la bienvenida, en la cabecera de las fichas de ruta y de parada, y en las hojas de consejo. Los bordes se funden con el fondo,
 *  como la escena de «Voy en este bus» (`RideScene`). Con «Reducir movimiento» todo queda quieto. Es decoración: VoiceOver no la lee. */

export type SceneKind = "city" | "station" | "stop" | "cable";

const DASH = 46;      // separación de las rayas del carril: el bucle de la vía se repite cada DASH para que no tenga saltos

/** Bus visto de lado, mirando a la derecha: carrocería del color de su sistema, ventanas, puertas, ruedas y el letrero de la ruta. */
export function SideBus({ color, width, long = false, sign }: { color: string; width: number; long?: boolean; sign?: string }) {
  const h = Math.round(width * (long ? 0.25 : 0.36));
  const wheel = Math.round(h * 0.34), r = Math.round(h * 0.2);
  const winTop = Math.round(h * 0.2), winH = Math.round(h * 0.36);
  const front = Math.round(h * 0.42);                      // parabrisas
  const usable = width - front - h * 0.18;
  const n = long ? 7 : 4, gap = Math.max(3, Math.round(width * 0.012)), win = (usable - gap * (n - 1)) / n;
  const doors = long ? [0.2, 0.48, 0.74] : [0.24, 0.62];
  const wheels = long ? [0.13, 0.47, 0.84] : [0.17, 0.8];
  return (
    <View style={{ width, height: h + wheel * 0.35 }}>
      {/* sombra en el piso */}
      <View style={{ position: "absolute", left: width * 0.04, right: width * 0.02, bottom: -2, height: wheel * 0.5, borderRadius: wheel, backgroundColor: "rgba(0,0,0,0.22)" }} />
      <View style={{ position: "absolute", left: 0, top: 0, width, height: h, borderRadius: r, borderTopRightRadius: r * 1.6, backgroundColor: color, overflow: "hidden" }}>
        {/* techo un poco más claro y falda más oscura: le dan volumen */}
        <View style={{ position: "absolute", left: 0, right: 0, top: 0, height: h * 0.1, backgroundColor: "rgba(255,255,255,0.22)" }} />
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: h * 0.22, backgroundColor: "rgba(0,0,0,0.2)" }} />
        {Array.from({ length: n }, (_, i) => (
          <View key={i} style={{ position: "absolute", left: h * 0.18 + i * (win + gap), top: winTop, width: win, height: winH, borderRadius: Math.max(2, winH * 0.18), backgroundColor: "rgba(16,22,32,0.86)" }}>
            <View style={{ position: "absolute", left: 3, top: 3, width: win * 0.35, height: 2, borderRadius: 1, backgroundColor: "rgba(255,255,255,0.28)" }} />
          </View>
        ))}
        {/* puertas */}
        {doors.map((d) => <View key={d} style={{ position: "absolute", left: width * d, top: winTop - 2, width: Math.max(8, width * 0.06), height: h * 0.72, borderRadius: 3, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.55)" }} />)}
        {/* parabrisas y el letrero de la ruta encima */}
        <View style={{ position: "absolute", right: 0, top: winTop - 2, width: front, height: winH + h * 0.18, borderTopLeftRadius: 4, borderBottomLeftRadius: 4, borderTopRightRadius: r, backgroundColor: "rgba(16,22,32,0.9)" }} />
        {sign ? (
          <View style={{ position: "absolute", right: h * 0.08, top: Math.max(2, winTop * 0.18), height: Math.max(9, winTop * 0.8), minWidth: front * 0.8, paddingHorizontal: 3, borderRadius: 2, backgroundColor: "#141414", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#ffb21a", fontWeight: "800", fontSize: Math.max(7, winTop * 0.62), includeFontPadding: false }} numberOfLines={1} allowFontScaling={false}>{sign}</Text>
          </View>
        ) : null}
        {long ? <View style={{ position: "absolute", left: width * 0.4, top: 0, bottom: 0, width: Math.max(5, width * 0.028), backgroundColor: "rgba(0,0,0,0.32)" }} /> : null}
        {/* luces */}
        <View style={{ position: "absolute", right: 2, bottom: h * 0.26, width: Math.max(4, h * 0.09), height: Math.max(3, h * 0.07), borderRadius: 2, backgroundColor: "#fff3c4" }} />
        <View style={{ position: "absolute", left: 1, bottom: h * 0.26, width: Math.max(3, h * 0.06), height: Math.max(4, h * 0.1), borderRadius: 2, backgroundColor: "#ff4d4d" }} />
      </View>
      {wheels.map((x) => (
        <View key={x} style={{ position: "absolute", left: width * x - wheel / 2, top: h - wheel * 0.65, width: wheel, height: wheel, borderRadius: wheel / 2, backgroundColor: "#1b1d22", alignItems: "center", justifyContent: "center" }}>
          <View style={{ width: wheel * 0.42, height: wheel * 0.42, borderRadius: wheel, backgroundColor: "#9aa0aa" }} />
        </View>
      ))}
    </View>
  );
}

/** Cabina de TransMiCable colgando de su brazo (roja y negra, como `CableScene`). */
function Cabin({ size }: { size: number }) {
  const w = size, body = size * 0.72;
  return (
    <View style={{ width: w, alignItems: "center" }}>
      <View style={{ width: w * 0.18, height: w * 0.08, borderRadius: 3, backgroundColor: "#2b2e35" }} />
      <View style={{ width: 4, height: w * 0.26, backgroundColor: "#16181d" }} />
      <View style={{ width: w * 0.86, height: w * 0.09, borderTopLeftRadius: 8, borderTopRightRadius: 8, backgroundColor: "#16181d" }} />
      <View style={{ width: w, height: body, borderRadius: 12, borderTopLeftRadius: 5, borderTopRightRadius: 5, backgroundColor: "#e30613", paddingTop: body * 0.14, paddingHorizontal: w * 0.08, flexDirection: "row", gap: 5 }}>
        <View style={styles.win} /><View style={styles.win} /><View style={styles.win} />
      </View>
      <View style={{ width: w, height: w * 0.1, marginTop: -w * 0.07, borderBottomLeftRadius: 12, borderBottomRightRadius: 12, backgroundColor: "#16181d" }} />
    </View>
  );
}

/** Colores del paisaje: de día cielo claro y cerros verdes; de noche, azul oscuro con ventanas encendidas. */
function useSceneColors() {
  const c = useColors();
  return c.dark
    ? { bg: c.bg, sky: "#121826", far: "#1b2433", near: "#212c3c", city: "#273246", city2: "#2f3b51", win: "rgba(255,214,128,0.55)", road: "#2b2e36", walk: "#1d2026", dash: "#6a6e78", glass: "rgba(160,190,220,0.18)", roof: "#3a4150", sun: "#e9e4cf", church: "#d9dde6", stop: "#1f6fe0" }
    : { bg: c.bg, sky: "#dbe9f6", far: "#bccdbf", near: "#a5c1a9", city: "#c7d0dc", city2: "#b4bfcd", win: "rgba(255,255,255,0.75)", road: "#cfd4dc", walk: "#e9ecf1", dash: "#ffffff", glass: "rgba(255,255,255,0.55)", roof: "#8d96a5", sun: "#ffd66b", church: "#ffffff", stop: "#2563eb" };
}

/** Bordes fundidos con el fondo de la pantalla: franjas cada vez más transparentes (como en `RideScene`). */
function Fades({ color, top, bottom, side }: { color: string; top: number; bottom: number; side: number }) {
  const N = 12, o = Array.from({ length: N }, (_, i) => 1 - i / N);
  return (
    <>
      {top > 0 && o.map((a, i) => <View key={"t" + i} pointerEvents="none" style={[styles.h, { top: (i * top) / N, height: top / N + 0.5, opacity: Math.min(1, a * 1.3), backgroundColor: color }]} />)}
      {bottom > 0 && o.map((a, i) => <View key={"b" + i} pointerEvents="none" style={[styles.h, { bottom: (i * bottom) / N, height: bottom / N + 0.5, opacity: a, backgroundColor: color }]} />)}
      {side > 0 && o.map((a, i) => <View key={"l" + i} pointerEvents="none" style={[styles.v, { left: (i * side) / N, width: side / N + 0.5, opacity: a, backgroundColor: color }]} />)}
      {side > 0 && o.map((a, i) => <View key={"r" + i} pointerEvents="none" style={[styles.v, { right: (i * side) / N, width: side / N + 0.5, opacity: a, backgroundColor: color }]} />)}
    </>
  );
}

/** Los cerros orientales con Monserrate (y su iglesia blanca en la punta) y, delante, los edificios del centro con la torre Colpatria. */
function Skyline({ width, horizon, k }: { width: number; horizon: number; k: ReturnType<typeof useSceneColors> }) {
  const shapes = useMemo(() => {
    // picos: cuadrados redondeados girados 45°; solo asoma su punta sobre la ciudad
    const peaks = [{ x: 0.08, s: 0.95 }, { x: 0.3, s: 1.15 }, { x: 0.62, s: 1.5 }, { x: 0.86, s: 1.2 }, { x: 1.05, s: 0.9 }];
    let seed = 5; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    const n = Math.max(7, Math.round(width / 34));
    const blocks = Array.from({ length: n }, (_, i) => ({ x: (i / n) * width + rnd() * 6, w: 22 + rnd() * 18, h: 0.16 + rnd() * 0.2, alt: rnd() > 0.5 }));
    return { peaks, blocks };
  }, [width]);
  const unit = horizon * 0.55;
  const mons = shapes.peaks[2]!, ms = unit * mons.s, tip = horizon * 1.02 - (ms * Math.SQRT2) / 2 + 10 * (Math.SQRT2 - 1);
  return (
    <>
      {shapes.peaks.map((p, i) => {
        const s = unit * p.s;
        return <View key={"p" + i} style={{ position: "absolute", left: width * p.x - s / 2, top: horizon * 1.02 - s / 2, width: s, height: s, borderRadius: 10, backgroundColor: i % 2 ? k.near : k.far, transform: [{ rotate: "45deg" }] }} />;
      })}
      {/* la iglesia de Monserrate */}
      <View style={{ position: "absolute", left: width * mons.x - 6, top: tip - 7, width: 12, height: 6, borderRadius: 1, backgroundColor: k.church }} />
      <View style={{ position: "absolute", left: width * mons.x - 1.5, top: tip - 12, width: 3, height: 6, borderRadius: 1, backgroundColor: k.church }} />
      {/* edificios */}
      {shapes.blocks.map((b, i) => {
        const h = horizon * b.h;
        return (
          <View key={"b" + i} style={{ position: "absolute", left: b.x, top: horizon - h, width: b.w, height: h + 2, borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: b.alt ? k.city2 : k.city, flexDirection: "row", flexWrap: "wrap", gap: 4, padding: 5 }}>
            {Array.from({ length: Math.min(6, Math.floor(h / 12) * 2) }, (_, j) => <View key={j} style={{ width: 4, height: 4, borderRadius: 1, backgroundColor: k.win }} />)}
          </View>
        );
      })}
      {/* la torre Colpatria, alta y con su remate de luces */}
      <View style={{ position: "absolute", left: width * 0.22, top: horizon * 0.34, width: 18, height: horizon * 0.66 + 2, borderTopLeftRadius: 2, borderTopRightRadius: 2, backgroundColor: k.city2 }}>
        <View style={{ height: 5, backgroundColor: "#e5464f", borderTopLeftRadius: 2, borderTopRightRadius: 2 }} />
        <View style={{ height: 3, backgroundColor: "#3b82f6" }} />
      </View>
    </>
  );
}

/** Estación de TransMilenio vista de lado: plataforma, vidrios con columnas, puertas y el techo con la franja del color de su línea. */
function Station({ width, horizon, line, k }: { width: number; horizon: number; line: string; k: ReturnType<typeof useSceneColors> }) {
  const left = width * 0.1, w = width * 0.8, h = horizon * 0.55, top = horizon - h + 6;
  const cols = Math.max(4, Math.round(w / 46));
  return (
    <View style={{ position: "absolute", left, top, width: w, height: h + 10 }}>
      <View style={{ height: 7, borderRadius: 3, backgroundColor: line }} />
      <View style={{ height: 3, backgroundColor: k.roof, marginHorizontal: 4 }} />
      <View style={{ flex: 1, flexDirection: "row", backgroundColor: k.glass, marginHorizontal: 4 }}>
        {Array.from({ length: cols }, (_, i) => (
          <View key={i} style={{ flex: 1, borderLeftWidth: 2, borderColor: k.roof, alignItems: "center", justifyContent: "flex-end" }}>
            {i % 2 ? <View style={{ width: "46%", height: "78%", borderTopLeftRadius: 2, borderTopRightRadius: 2, backgroundColor: line, opacity: 0.35 }} /> : null}
          </View>
        ))}
      </View>
      <View style={{ height: 8, borderRadius: 2, backgroundColor: k.roof }} />
    </View>
  );
}

/** Paradero del SITP: el poste azul con su letrero y una caseta con techo. */
function StopPost({ x, horizon, k }: { x: number; horizon: number; k: ReturnType<typeof useSceneColors> }) {
  const h = horizon * 0.5;
  return (
    <>
      <View style={{ position: "absolute", left: x - 34, top: horizon - h * 0.62, width: 58, height: 4, borderRadius: 2, backgroundColor: k.roof }} />
      <View style={{ position: "absolute", left: x - 30, top: horizon - h * 0.62 + 4, width: 50, height: h * 0.62 - 2, backgroundColor: k.glass }} />
      <View style={{ position: "absolute", left: x + 30, top: horizon - h, width: 3, height: h + 4, backgroundColor: k.roof }} />
      <View style={{ position: "absolute", left: x + 22, top: horizon - h - 4, width: 19, height: 19, borderRadius: 5, backgroundColor: k.stop, alignItems: "center", justifyContent: "center" }}>
        <SymbolView name="bus.fill" tintColor="#ffffff" size={11} />
      </View>
    </>
  );
}

/** Una escena completa: cielo, cerros, ciudad, la vía con el carril del color de la línea y el bus (o la estación, o el cable).
 *  `moving`: el carril corre bajo el bus (va andando). `arrive`: el bus entra desde la izquierda y se detiene (una vez).
 *  `badge`: un símbolo en un círculo flotando sobre la escena (en las hojas de consejo). */
export function Scene({ height, kind = "city", busColor, laneColor, long = false, sign, moving = false, arrive = false, badge, fadeTop = true }: {
  height: number; kind?: SceneKind; busColor: string; laneColor?: string; long?: boolean; sign?: string; moving?: boolean; arrive?: boolean; badge?: SFSymbol; fadeTop?: boolean;
}) {
  const c = useColors();
  const k = useSceneColors();
  const { reduceMotion } = useAccessibility();
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => { const w = Math.round(e.nativeEvent.layout.width); if (w !== width) setWidth(w); };
  const horizon = Math.round(height * (kind === "cable" ? 0.78 : 0.6));
  const roadTop = horizon + 6;
  const busW = Math.min(width * (long ? 0.56 : 0.42), long ? 270 : 190, height * (long ? 1.45 : 1.05));
  const lane = laneColor ?? busColor;
  const busX = kind === "stop" ? width * 0.18 : (width - busW) / 2;

  const run = moving && !reduceMotion && width > 0;
  const roll = useSharedValue(0), bob = useSharedValue(0), enter = useSharedValue(arrive && !reduceMotion ? 0 : 1), float = useSharedValue(0);
  useEffect(() => {
    if (!run) { cancelAnimation(roll); cancelAnimation(bob); bob.value = withTiming(0, { duration: 250 }); return; }
    roll.value = 0;
    roll.value = withRepeat(withTiming(1, { duration: 520, easing: Easing.linear }), -1, false);
    bob.value = withRepeat(withSequence(withTiming(1, { duration: 380, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration: 380, easing: Easing.inOut(Easing.sin) })), -1, false);
  }, [run, roll, bob]);
  useEffect(() => {
    if (!arrive || reduceMotion || width === 0) { enter.value = 1; return; }
    enter.value = 0;
    enter.value = withDelay(180, withTiming(1, { duration: 1300, easing: Easing.out(Easing.cubic) }));
  }, [arrive, reduceMotion, width, enter]);
  useEffect(() => {
    if (!badge || reduceMotion) { cancelAnimation(float); float.value = 0; return; }
    float.value = withRepeat(withSequence(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration: 1600, easing: Easing.inOut(Easing.sin) })), -1, false);
  }, [badge, reduceMotion, float]);
  const dashes = useAnimatedStyle(() => ({ transform: [{ translateX: -roll.value * DASH }] }));
  const busStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -(1 - enter.value) * (busX + busW + 20) }, { translateY: -bob.value * 1.2 }] }));
  const badgeStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -float.value * 5 }] }));

  const busH = busW * (long ? 0.25 : 0.36);
  const busTop = height - Math.max(8, (height - roadTop) * 0.22) - busH;
  const side = Math.min(48, width * 0.1);
  const sunSize = height * 0.16;

  return (
    <View onLayout={onLayout} style={{ height, overflow: "hidden", backgroundColor: k.sky }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {width > 0 ? (
        <>
          <View style={{ position: "absolute", right: badge ? width * 0.62 : width * 0.16, top: height * 0.16, width: sunSize, height: sunSize, borderRadius: sunSize, backgroundColor: k.sun, opacity: c.dark ? 0.85 : 0.9 }} />
          {kind === "cable" ? (
            <>
              <Skyline width={width} horizon={horizon} k={k} />
              <View style={{ position: "absolute", left: 0, right: 0, top: horizon, bottom: 0, backgroundColor: k.near }} />
              <View style={{ position: "absolute", left: -20, width: width + 40, top: height * 0.2, height: 2, backgroundColor: c.dark ? "#c9ccd4" : "#111114", transform: [{ rotate: "-5deg" }] }} />
              <Animated.View style={[{ position: "absolute", left: width / 2 - height * 0.22, top: height * 0.2 - 4 }, busStyle]}><Cabin size={height * 0.44} /></Animated.View>
            </>
          ) : (
            <>
              <Skyline width={width} horizon={horizon} k={k} />
              {kind === "station" ? <Station width={width} horizon={horizon} line={lane} k={k} /> : null}
              {kind === "stop" ? <StopPost x={width * 0.72} horizon={horizon} k={k} /> : null}
              {/* andén y vía; el carril exclusivo lleva el color de la línea */}
              <View style={{ position: "absolute", left: 0, right: 0, top: horizon, height: 6, backgroundColor: k.walk }} />
              <View style={{ position: "absolute", left: 0, right: 0, top: roadTop, bottom: 0, backgroundColor: k.road }} />
              <View style={{ position: "absolute", left: 0, right: 0, top: roadTop, height: 4, backgroundColor: lane, opacity: 0.85 }} />
              <Animated.View style={[{ position: "absolute", left: 0, top: height - Math.max(6, (height - roadTop) * 0.16), width: width + DASH * 2, height: 3, flexDirection: "row" }, dashes]}>
                {Array.from({ length: Math.ceil(width / DASH) + 2 }, (_, i) => <View key={i} style={{ width: DASH * 0.55, height: 3, borderRadius: 2, marginRight: DASH * 0.45, backgroundColor: k.dash }} />)}
              </Animated.View>
              <Animated.View style={[{ position: "absolute", left: busX, top: busTop }, busStyle]}>
                <SideBus color={busColor} width={busW} long={long} sign={sign} />
              </Animated.View>
            </>
          )}
          {badge ? (
            <Animated.View style={[{ position: "absolute", left: width / 2 + Math.min(busW / 2, 110) - 6, top: height * 0.12 }, badgeStyle]}>
              <View style={[styles.badge, { backgroundColor: c.card, shadowColor: c.shadow }, lift(6, 16, 0.18)]}><SymbolView name={badge} tintColor={c.accent} size={26} /></View>
            </Animated.View>
          ) : null}
          <Fades color={k.bg} top={fadeTop ? height * 0.26 : 0} bottom={height * 0.14} side={side} />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  win: { flex: 1, height: "62%", borderRadius: 5, backgroundColor: "rgba(18,24,34,.88)" },
  h: { position: "absolute", left: 0, right: 0 },
  v: { position: "absolute", top: 0, bottom: 0 },
  badge: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
});

/** Color de la línea de una ruta (la letra de las troncales y duales: B = Norte, verde…) o, si no tiene, el de su sistema. */
export function laneColorOf(shortName: string, system: SystemType, dark: boolean): string {
  const l = trunkLetterOf(shortName);
  return l ? TRUNK_LINES[l]![dark ? "dark" : "light"] : SYSTEM_COLOR[system];
}

/** Cabecera ilustrada de una ficha (ruta o parada): la escena a lo ancho, baja (≈140 pt) para no empujar el contenido. */
export function SceneHeader(props: Omit<Parameters<typeof Scene>[0], "height"> & { height?: number }) {
  return <View style={{ marginHorizontal: -space[5], marginTop: -space[5], marginBottom: -space[2] }}><Scene {...props} height={props.height ?? 140} /></View>;
}
