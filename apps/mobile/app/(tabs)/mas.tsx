import { useState, type ReactNode } from "react";
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { liveDown } from "@/lastService";
import Constants from "expo-constants";
import { SymbolView, type SFSymbol } from "@/ui/Symbol";
import { connectionStatus } from "@transmi/application";
import { transit } from "@/composition-root";
import { nowMs } from "@/clock";
import { useNow, useTransitVersion } from "@/hooks";
import { reportProblem } from "@/report";
import { useAppearance, type AppearanceMode } from "@/appearance";
import { useSaved } from "@/favorites";
import { useDemo } from "@/demo";
import { usePlanner } from "@/planner/store";
import { Tap, PAGE, Toggle } from "@/ui/kit";
import { GlassSegments } from "@/ui/GlassSegments";
import { radius, space, type, useColors } from "@/ui/theme";

/** Una fila de lista al estilo de Ajustes de iOS: icono en un cuadro de color, título, un valor opcional a la derecha y la flecha. */
function Row({ symbol, tint, title, value, onPress, last = false, link = false }: { symbol: SFSymbol; tint: string; title: string; value?: string; onPress(): void; last?: boolean; link?: boolean }) {
  const c = useColors();
  return (
    <Tap onPress={onPress} accessibilityRole={link ? "link" : "button"} accessibilityLabel={value ? `${title}, ${value}` : title}>
      <View style={styles.row}>
        <View style={[styles.tile, { backgroundColor: tint }]}><SymbolView name={symbol} tintColor="#ffffff" size={17} /></View>
        <View style={[styles.rowBody, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.line }]}>
          <Text style={[type.body, { color: c.text, flex: 1 }]} numberOfLines={1}>{title}</Text>
          {value ? <Text style={[type.body, { color: c.muted, flexShrink: 1, maxWidth: "55%", textAlign: "right" }]} numberOfLines={1}>{value}</Text> : null}
          <SymbolView name={link ? "arrow.up.right" : "chevron.right"} tintColor={c.muted} size={12} />
        </View>
      </View>
    </Tap>
  );
}

function Group({ title, children, footer, bare = false }: { title: string; children: ReactNode; footer?: string; /** Sin tarjeta alrededor (el contenido ya trae su propia forma). */ bare?: boolean }) {
  const c = useColors();
  return (
    <View style={styles.group}>
      <Text style={[type.eyebrow, { color: c.muted, marginLeft: space[4] }]}>{title}</Text>
      {bare ? children : <View style={[styles.groupCard, { backgroundColor: c.card }]}>{children}</View>}
      {footer ? <Text style={[type.caption, { color: c.muted, marginHorizontal: space[4] }]}>{footer}</Text> : null}
    </View>
  );
}

/** «Más»: la tarjeta TuLlave arriba, con su propio lugar, y lo demás agrupado como en Ajustes (servicio, tus cosas, apariencia, ayuda). */
/** Se recuerda mientras la app siga abierta. */
let testsShown = false, secretTaps = 0;

export default function Mas() {
  const c = useColors();
  const appearance = useAppearance();
  const saved = useSaved();
  const demo = useDemo();
  // casa y trabajo: si no hay, se busca el lugar; si ya hay, se puede cambiar o quitar
  const editPlace = (slot: "home" | "work") => {
    const label = slot === "home" ? "casa" : "trabajo", cur = saved[slot];
    const pick = () => { usePlanner.getState().setSaveAs(slot); router.navigate("/viaje"); };
    if (!cur) { pick(); return; }
    Alert.alert(slot === "home" ? "Casa" : "Trabajo", cur.name, [
      { text: `Cambiar ${label}`, onPress: pick },
      { text: `Quitar ${label}`, style: "destructive", onPress: () => saved.setPlace(slot, null) },
      { text: "Cancelar", style: "cancel" },
    ]);
  };
  // «Buses de ejemplo» es una herramienta de pruebas: queda escondida y aparece al tocar 8 veces la fila de buses en la calle
  const [tests, setTests] = useState(testsShown);
  const secretTap = () => { if (tests) return; if (++secretTaps >= 8) { testsShown = true; setTests(true); void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } };
  useTransitVersion(); useNow(15_000);
  const st = connectionStatus(transit, nowMs());
  const hasBuses = !liveDown(), late = (st.ageSeconds ?? 0) > 300, ageMin = st.ageSeconds != null ? Math.round(st.ageSeconds / 60) : null;
  const alerts = transit.alerts.length, favs = saved.stops.length + saved.routes.length;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={["top"]}>
      <ScrollView contentContainerStyle={[PAGE, styles.content]} showsVerticalScrollIndicator={false}>
        <Text style={[type.largeTitle, { color: c.text }]} accessibilityRole="header">Más</Text>

        {/* la tarjeta TuLlave: lo más útil de esta pestaña, con su propia tarjeta */}
        <Tap onPress={() => router.push("/card")} accessibilityRole="button" accessibilityLabel="Mi tarjeta TuLlave. Consultar el saldo acercando la tarjeta al teléfono">
          <View style={styles.hero}>
            <View style={styles.glowA} /><View style={styles.glowB} />
            <View style={styles.heroTop}>
              <Text style={styles.brand}>TuLlave</Text>
              <SymbolView name="wave.3.right" tintColor="#ffffff" size={22} />
            </View>
            <View style={{ gap: 2 }}>
              <Text style={styles.heroTitle}>Consulta tu saldo</Text>
              <Text style={styles.heroSub}>Acerca la tarjeta al teléfono. Se lee aquí y no se guarda.</Text>
            </View>
            <View style={styles.heroBtn}><Text style={styles.heroBtnText}>Leer mi tarjeta</Text><SymbolView name="arrow.right" tintColor="#111114" size={13} /></View>
          </View>
        </Tap>

        <Group title="SERVICIO" footer={!hasBuses ? "TransMilenio no está enviando la ubicación de los buses. Eso no significa que no haya servicio: puedes consultar horarios y planear viajes." : late && ageMin != null ? `El último dato de los buses tiene ${ageMin} min.` : undefined}>
          <Pressable onPress={secretTap} accessible={false}>
          <View style={styles.row}>
            <View style={[styles.tile, { backgroundColor: hasBuses && !late ? "#22c55e" : "#f59e0b" }]}><SymbolView name="dot.radiowaves.left.and.right" tintColor="#ffffff" size={17} /></View>
            <View style={[styles.rowBody, { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.line }]} accessible accessibilityLabel={hasBuses ? `${transit.fleet.size} buses en la calle` : "Sin datos en vivo por ahora"}>
              <Text style={[type.body, { color: c.text, flex: 1 }]}>{demo.on ? "Buses de ejemplo" : hasBuses ? "Buses en la calle" : "Datos en vivo"}</Text>
              <Text style={[type.body, { color: c.muted, fontVariant: ["tabular-nums"] }]}>{hasBuses ? transit.fleet.size.toLocaleString("es-CO") : "Sin datos por ahora"}</Text>
            </View>
          </View>
          </Pressable>
          <Row last symbol="bell.fill" tint="#ef4444" title="Avisos del servicio" value={alerts ? String(alerts) : "Ninguno"} onPress={() => router.push("/avisos")} />
        </Group>

        <Group title="TUS COSAS">
          <Row symbol="star.fill" tint="#f59e0b" title="Favoritos" value={favs ? String(favs) : undefined} onPress={() => router.push("/favoritos")} />
          <Row symbol="location.fill" tint="#3b82f6" title="Cerca de mí" onPress={() => router.push("/cerca")} />
          <Row symbol="house.fill" tint="#10b981" title="Casa" value={saved.home?.name ?? "Agregar"} onPress={() => editPlace("home")} />
          <Row last symbol="briefcase.fill" tint="#6366f1" title="Trabajo" value={saved.work?.name ?? "Agregar"} onPress={() => editPlace("work")} />
        </Group>

        <Group bare title="APARIENCIA" footer="Automático usa la del teléfono.">
          <View>
            <GlassSegments variant="plain" value={appearance.mode} onChange={(m) => appearance.setMode(m)}
              items={[{ key: "auto", label: "Automático" }, { key: "light", label: "Claro" }, { key: "dark", label: "Oscuro" }] as { key: AppearanceMode; label: string }[]} />
          </View>
        </Group>

{tests || demo.on ? (
        <Group title="PRUEBAS" footer={demo.error ?? (demo.on ? "Estás viendo buses de ejemplo (lotes reales de una noche anterior). No son datos en vivo: apágalo para volver a los datos reales." : "Muestra buses de ejemplo para probar el mapa, las paradas y «Voy en este bus» cuando no hay servicio. No son datos en vivo.")}>
          <View style={styles.row}>
            <View style={[styles.tile, { backgroundColor: "#8b5cf6" }]}><SymbolView name="play.fill" tintColor="#ffffff" size={15} /></View>
            <View style={styles.rowBody}>
              <Text style={[type.body, { color: c.text, flex: 1 }]}>{demo.loading ? "Descargando buses de ejemplo…" : "Buses de ejemplo"}</Text>
              <Toggle value={demo.on} disabled={demo.loading} onChange={(v) => { if (v) void demo.start(); else demo.stop(); }} label="Buses de ejemplo (demostración)" />
            </View>
          </View>
        </Group>
        ) : null}

        <Group title="AYUDA">
          <Row symbol="exclamationmark.bubble.fill" tint="#8b5cf6" title="Reportar un problema o dar una idea" onPress={() => reportProblem({ what: "la app en general" })} link />
          <Row last symbol="hand.raised.fill" tint="#64748b" title="Política de privacidad" onPress={() => void Linking.openURL("https://transmilive.com/privacidad.html")} link />
        </Group>

        <Text style={[type.caption, { color: c.muted, textAlign: "center", marginTop: space[2] }]}>TransMi LIVE {Constants.expoConfig?.version} · compilación {Constants.nativeBuildVersion ?? "—"}{"\n"}Con datos abiertos de TransMilenio. No es una app oficial.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: space[5], gap: space[5], paddingBottom: space[10] * 3 },
  hero: { borderRadius: 26, borderCurve: "continuous", backgroundColor: "#16161a", padding: space[5], gap: space[4], overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.22, shadowRadius: 18, shadowOffset: { width: 0, height: 10 } },
  glowA: { position: "absolute", right: -70, top: -90, width: 260, height: 260, borderRadius: 130, backgroundColor: "#e11d2e", opacity: 0.55 },
  glowB: { position: "absolute", left: -90, bottom: -120, width: 260, height: 260, borderRadius: 130, backgroundColor: "#ffffff", opacity: 0.06 },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  brand: { color: "#ffffff", fontSize: 20, fontWeight: "800", letterSpacing: -0.4 },
  heroTitle: { color: "#ffffff", fontSize: 26, fontWeight: "800", letterSpacing: -0.6 },
  heroSub: { color: "#ffffff", opacity: 0.72, fontSize: 14, fontWeight: "500" },
  heroBtn: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: space[2], backgroundColor: "#ffffff", paddingHorizontal: space[4], minHeight: 40, borderRadius: radius.pill },
  heroBtnText: { color: "#111114", fontSize: 15, fontWeight: "700" },
  group: { gap: space[2] },
  groupCard: { borderRadius: radius.lg, borderCurve: "continuous", overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", paddingLeft: space[4], gap: space[3] },
  tile: { width: 30, height: 30, borderRadius: 8, borderCurve: "continuous", alignItems: "center", justifyContent: "center" },
  rowBody: { flex: 1, flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 50, paddingRight: space[4] },
});
