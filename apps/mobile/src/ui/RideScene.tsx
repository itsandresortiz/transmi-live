import { useEffect, useMemo } from "react";
import { Image, Platform, StyleSheet, View, type ViewStyle } from "react-native";
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import type { SystemType } from "@transmi/domain";
import { useAccessibility } from "@/accessibility";

import { useColors } from "./theme";

/** Escena del viaje: una avenida en perspectiva que corre hacia ti con el bus visto desde atrás y arriba, y los bordes fundidos con el fondo.
 *  No es un mapa: es la sensación de ir andando. El suelo se mueve mientras el bus va en camino y se detiene al llegar. */
const H = 290, GROUND_W = 700, GROUND_H = 1500, PERIOD = 352, ROAD_W = 200, DASH = 88;
const STRIPS = 10;
/** Buses en 3D vistos desde atrás (tools/bus-sprites.ts los genera proyectando una caja con la misma cámara de esta escena: perspectiva 600, 56°).
 *  `s` = corto, `l` = articulado. META dice dónde va cada imagen: `left` desde el centro, `bottom` desde el borde inferior, y `nose` = dónde termina el bus sobre el suelo. */
const META = require("../../assets/sprites-rear/meta.json") as Record<"s" | "l", { left: number; bottom: number; width: number; height: number; nose: number }>;
const REAR: Record<string, number> = {
  "troncal-s": require("../../assets/sprites-rear/rear-troncal-s.png"), "troncal-l": require("../../assets/sprites-rear/rear-troncal-l.png"),
  "dual-s": require("../../assets/sprites-rear/rear-dual-s.png"), "dual-l": require("../../assets/sprites-rear/rear-dual-l.png"),
  "alimentador-s": require("../../assets/sprites-rear/rear-alimentador-s.png"), "alimentador-l": require("../../assets/sprites-rear/rear-alimentador-l.png"),
  "zonal-s": require("../../assets/sprites-rear/rear-zonal-s.png"), "zonal-l": require("../../assets/sprites-rear/rear-zonal-l.png"),
  "otro-s": require("../../assets/sprites-rear/rear-otro-s.png"), "otro-l": require("../../assets/sprites-rear/rear-otro-l.png"),
};

/** El suelo inclinado. En iPhone gira sobre su borde de abajo (`transformOrigin`), con la cámara encima de ese borde.
 *  Android no respeta ese punto de giro cuando hay perspectiva (gira sobre el centro y la vía queda chiquita y lejos del bus). Allá se arma la misma
 *  vista con lo que Android sí hace bien: girar sobre el centro con la cámara más lejos, y luego encoger a lo ancho y a lo alto. Da exactamente la misma
 *  imagen (comprobado con números: los puntos caen en el mismo sitio). */
const TILT = 56, CAM = 600;
const SIN = Math.sin((TILT * Math.PI) / 180), COS = Math.cos((TILT * Math.PI) / 180);
const CAM_CENTER = CAM + (GROUND_H / 2) * SIN, SHRINK = CAM / CAM_CENTER, HINGE = COS * (GROUND_H / 2) * SHRINK;
function groundStyles(width: number): { outer: ViewStyle; inner: ViewStyle } {
  const left = (width - GROUND_W) / 2;
  if (Platform.OS === "android") return {
    outer: { position: "absolute", left, top: H - HINGE - GROUND_H / 2, width: GROUND_W, height: GROUND_H, transform: [{ scaleX: SHRINK }, { scaleY: SHRINK * SHRINK }] },
    inner: { width: GROUND_W, height: GROUND_H, transform: [{ perspective: CAM_CENTER }, { rotateX: `${TILT}deg` }] },
  };
  return {
    outer: { position: "absolute", left, top: H - GROUND_H, width: GROUND_W, height: GROUND_H },
    inner: { width: GROUND_W, height: GROUND_H, transformOrigin: "bottom", transform: [{ perspective: CAM }, { rotateX: `${TILT}deg` }] },
  };
}

/** Manzanas y árboles a los lados: dos filas que se repiten cada PERIOD para que el bucle no tenga saltos. */
function useSides() {
  return useMemo(() => {
    let s = 7; const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    const base: { side: 0 | 1; top: number; w: number; h: number; tree: boolean }[] = [];
    for (let i = 0; i < 3; i++) for (const side of [0, 1] as const) base.push({ side, top: i * (PERIOD / 3) + rnd() * 14, w: 92 + rnd() * 70, h: 62 + rnd() * 36, tree: rnd() > 0.35 });
    return base;
  }, []);
}

export function RideScene({ system, color, moving = true, width }: { system: SystemType; color: string; moving?: boolean; width: number }) {
  const c = useColors();
  const { reduceMotion } = useAccessibility();
  const sides = useSides();
  const run = moving && !reduceMotion;
  const scroll = useSharedValue(0), sway = useSharedValue(0);
  useEffect(() => {
    if (!run) { cancelAnimation(scroll); cancelAnimation(sway); sway.value = withTiming(0, { duration: 300 }); return; }
    scroll.value = scroll.value % 1;
    scroll.value = withRepeat(withTiming(scroll.value + 1, { duration: 2100, easing: Easing.linear }), -1, false);
    sway.value = withRepeat(withSequence(withTiming(1, { duration: 1700, easing: Easing.inOut(Easing.sin) }), withTiming(-1, { duration: 1700, easing: Easing.inOut(Easing.sin) })), -1, true);
  }, [run, scroll, sway]);
  const scroller = useAnimatedStyle(() => ({ transform: [{ translateY: (scroll.value % 1) * PERIOD }] }));
  const busStyle = useAnimatedStyle(() => ({ transform: [{ translateX: sway.value * 1.4 }] }));

  const road = c.dark ? "#2b2e36" : "#dfe3ea", curb = c.dark ? "#4a4e58" : "#ffffff", block = c.dark ? "#1d2026" : "#e9ecf1", tree = c.dark ? "#20382a" : "#cfe6d6", dash = c.dark ? "#666a74" : "#ffffff";
  const roadX = (GROUND_W - ROAD_W) / 2, rows = Math.ceil(GROUND_H / PERIOD) + 1;
  const long = system === "troncal", sprite = REAR[`${system}-${long ? "l" : "s"}`];
  // el bus es una imagen ya proyectada con esta misma cámara: se pone donde dice META y calza con la vía
  const m = META[long ? "l" : "s"], busTop = GROUND_H - m.nose;
  const ground = useMemo(() => groundStyles(width), [width]);
  const fade = Array.from({ length: STRIPS }, (_, i) => 1 - i / STRIPS);

  return (
    <View style={{ width, height: H, overflow: "hidden" }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {/* el suelo, inclinado: lo de arriba queda lejos */}
      <View style={ground.outer}><View style={ground.inner}>
        <View style={{ position: "absolute", left: roadX, width: ROAD_W, top: 0, bottom: 0, backgroundColor: road }} />
        <View style={{ position: "absolute", left: roadX - 4, width: 5, top: 0, bottom: 0, backgroundColor: curb }} />
        <View style={{ position: "absolute", left: roadX + ROAD_W - 1, width: 5, top: 0, bottom: 0, backgroundColor: curb }} />
        {/* el carril por donde va el bus, con su color, perdiéndose a lo lejos */}
        {[0.06, 0.14, 0.24, 0.36, 0.5].map((o, i) => <View key={i} style={{ position: "absolute", left: roadX + ROAD_W / 2 + 16, width: 68, top: busTop - (5 - i) * 150, height: 150, backgroundColor: color, opacity: o }} />)}
        <Animated.View style={[{ position: "absolute", left: 0, right: 0, top: -PERIOD, height: GROUND_H + PERIOD }, scroller]}>
          {Array.from({ length: Math.ceil((GROUND_H + PERIOD) / DASH) }, (_, i) => <View key={"d" + i} style={{ position: "absolute", left: GROUND_W / 2 - 4, width: 8, height: 44, top: i * DASH + 20, borderRadius: 4, backgroundColor: dash }} />)}
          {Array.from({ length: rows }, (_, r) => sides.map((b, i) => (
            <View key={`b${r}-${i}`}>
              <View style={{ position: "absolute", top: r * PERIOD + b.top, left: b.side ? roadX + ROAD_W + 22 : roadX - 22 - b.w, width: b.w, height: b.h, borderRadius: 14, backgroundColor: block }} />
              {b.tree ? <View style={{ position: "absolute", top: r * PERIOD + b.top + b.h - 8, left: b.side ? roadX + ROAD_W + 8 : roadX - 42, width: 34, height: 34, borderRadius: 17, backgroundColor: tree }} /> : null}
            </View>
          )))}
        </Animated.View>
      </View></View>
      <Animated.View style={[{ position: "absolute", left: width / 2 + m.left, top: H - m.bottom - m.height, width: m.width, height: m.height }, busStyle]}>
        <Image source={sprite} style={{ width: m.width, height: m.height }} resizeMode="contain" />
      </Animated.View>
      {/* bordes fundidos con el fondo */}
      {fade.map((o, i) => <View key={"t" + i} pointerEvents="none" style={[styles.h, { top: i * 11, height: 11, opacity: Math.min(1, o * 1.35), backgroundColor: c.bg }]} />)}
      {fade.map((o, i) => <View key={"b" + i} pointerEvents="none" style={[styles.h, { bottom: i * 5, height: 5, opacity: o, backgroundColor: c.bg }]} />)}
      {fade.map((o, i) => <View key={"l" + i} pointerEvents="none" style={[styles.v, { left: i * 7, width: 7, opacity: o, backgroundColor: c.bg }]} />)}
      {fade.map((o, i) => <View key={"r" + i} pointerEvents="none" style={[styles.v, { right: i * 7, width: 7, opacity: o, backgroundColor: c.bg }]} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  h: { position: "absolute", left: 0, right: 0 },
  v: { position: "absolute", top: 0, bottom: 0 },
});
