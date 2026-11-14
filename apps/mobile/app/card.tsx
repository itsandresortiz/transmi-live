import { useEffect, useMemo, useState } from "react";
import { AppState, Linking, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { SymbolView, type SFSymbol } from "@/ui/Symbol";
import { type CardMovement, type CardReading, type TuLlaveCard, NotTuLlaveError, groupCardNumber, movementsByMonth, parseTuLlave } from "@transmi/domain";
import { Tullave } from "../modules/tullave/src";
import { useAccessibility } from "@/accessibility";
import { Card, PrimaryButton, Tap } from "@/ui/kit";
import { CloseToolbar } from "@/ui/CloseToolbar";
import { lift, radius, space, type, useColors } from "@/ui/theme";

const pesos = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("es-CO")}`;
const KIND: Record<CardMovement["kind"], { label: string; symbol: SFSymbol }> = {
  trip: { label: "Viaje", symbol: "bus.fill" }, topup: { label: "Recarga", symbol: "arrow.down.circle.fill" },
  topupCancelled: { label: "Recarga anulada", symbol: "xmark.circle.fill" }, other: { label: "Movimiento", symbol: "circle.fill" },
};
const month = (m: string) => { const s = new Date(`${m}-15T12:00:00`).toLocaleDateString("es-CO", { month: "long", year: "numeric" }); return s.charAt(0).toUpperCase() + s.slice(1); };
const clock = (d: Date) => d.toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" });
/** «Hoy · 8:12 a. m.», «Ayer · 6:40 p. m.» o «3 nov · 6:40 p. m.». */
function whenText(at: string): string {
  const d = new Date(at), today = new Date(), days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
  const day = days === 0 ? "Hoy" : days === 1 ? "Ayer" : d.toLocaleDateString("es-CO", { day: "numeric", month: "short" }).replace(".", "");
  return `${day} · ${clock(d)}`;
}
const PROMPTS = { hold: "Acerca la tarjeta a la parte de arriba del teléfono", reading: "Leyendo… no la muevas", done: "Listo", notCard: "Esa tarjeta no parece una TuLlave", lost: "Se perdió la conexión con la tarjeta. Intenta de nuevo" };

/** El saldo sube hasta su valor en vez de aparecer de golpe. */
function useCount(target: number | null, still: boolean): number | null {
  const [n, setN] = useState<number | null>(target);
  useEffect(() => {
    if (target == null) { setN(null); return; }
    if (still) { setN(target); return; }
    const t0 = Date.now(), from = 0;
    const id = setInterval(() => { const u = Math.min(1, (Date.now() - t0) / 900); setN(Math.round(from + (target - from) * (1 - (1 - u) ** 3))); if (u >= 1) clearInterval(id); }, 33);
    return () => clearInterval(id);
  }, [target, still]);
  return n;
}

/** La tarjeta TuLlave: oscura, con el saldo grande. Mientras se lee, respira y el símbolo de pago sin contacto late. */
function TuLlaveFace({ balance, number, readAt, busy, still }: { balance: number | null; number?: string; readAt?: number; busy: boolean; still: boolean }) {
  const [reveal, setReveal] = useState(false);
  const shown = useCount(balance, still);
  const breathe = useSharedValue(1), wave = useSharedValue(1);
  useEffect(() => {
    if (still) return;
    breathe.value = busy ? withRepeat(withSequence(withTiming(1.025, { duration: 700 }), withTiming(1, { duration: 700 })), -1, false) : withTiming(1, { duration: 250 });
    wave.value = busy ? withRepeat(withSequence(withTiming(0.2, { duration: 500 }), withTiming(1, { duration: 500 })), -1, false) : 1;
  }, [busy, still, breathe, wave]);
  const cardStyle = useAnimatedStyle(() => ({ transform: [{ scale: breathe.value }] }));
  const waveStyle = useAnimatedStyle(() => ({ opacity: wave.value }));
  const last4 = number ? number.replace(/\D/g, "").slice(-4) : "";
  return (
    <Animated.View style={[styles.face, cardStyle]} accessible accessibilityLabel={balance == null ? "Tarjeta TuLlave sin leer" : `Tarjeta TuLlave, saldo ${pesos(balance)}`}>
      <View style={styles.glowA} /><View style={styles.glowB} />
      <View style={styles.faceTop}>
        <Text style={styles.brand}>TuLlave</Text>
        <Animated.View style={waveStyle}><SymbolView name="wave.3.right" tintColor="#ffffff" size={22} /></Animated.View>
      </View>
      <View>
        <Text style={styles.faceLabel}>SALDO</Text>
        <Text maxFontSizeMultiplier={1.2} style={[styles.amount, { opacity: shown == null ? 0.35 : 1 }]} adjustsFontSizeToFit numberOfLines={1}>{shown == null ? "$ ——" : pesos(shown)}</Text>
      </View>
      <View style={styles.faceBottom}>
        <Tap onPress={() => number && setReveal((r) => !r)} haptic={false} accessibilityRole="button" accessibilityLabel={number ? (reveal ? "Ocultar el número de la tarjeta" : "Mostrar el número de la tarjeta") : "Número de la tarjeta"} disabled={!number}>
          <Text style={styles.number}>{number ? (reveal ? groupCardNumber(number) : `•••• •••• •••• ${last4}`) : "•••• •••• •••• ••••"}</Text>
        </Tap>
        {readAt ? <Text style={styles.readAt}>{clock(new Date(readAt))}</Text> : null}
      </View>
    </Animated.View>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const c = useColors();
  return <Card style={styles.stat}><Text style={[type.caption, { color: c.muted }]}>{label}</Text><Text style={[type.title, { color: tone ?? c.text }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text></Card>;
}

/** Mi tarjeta TuLlave: el saldo se lee de la tarjeta en el teléfono; no se envía ni se guarda nada. */
export default function CardScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { reduceMotion } = useAccessibility();
  const [card, setCard] = useState<{ data: TuLlaveCard; at: number; raw: CardReading } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // al volver de Ajustes (p. ej. tras encender el NFC) se repinta para leer de nuevo el estado
  const [, setBack] = useState(0);
  useEffect(() => { const sub = AppState.addEventListener("change", (s) => { if (s === "active") setBack((n) => n + 1); }); return () => sub.remove(); }, []);
  const available = (() => { try { return Tullave?.isAvailable() ?? false; } catch { return false; } })();
  const nfc = (() => { try { return Tullave?.nfcState?.() ?? (available ? "on" : "none"); } catch { return "none" as const; } })();
  // en iPhone la antena está arriba; en Android casi siempre en el centro de la parte de atrás
  const where = Platform.OS === "android" ? "la parte de atrás del teléfono" : "la parte de arriba del teléfono";

  const read = async () => {
    if (!Tullave) return;
    setBusy(true); setError(null);
    try {
      const raw = await Tullave.read(PROMPTS);
      const data = parseTuLlave(raw);
      setCard({ data, at: Date.now(), raw });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      const code = (e as { code?: string }).code;
      setError(e instanceof NotTuLlaveError || code === "not_tullave" ? "Esa tarjeta no parece una TuLlave."
        : code === "cancelled" ? null
        : code === "timeout" ? `No alcanzamos a leer la tarjeta. Acércala a ${where} e intenta de nuevo.`
        : "No pudimos leer la tarjeta. Intenta de nuevo.");
    } finally { setBusy(false); }
  };

  // lo de este mes: cuánto se recargó y cuánto se gastó en viajes
  const thisMonth = useMemo(() => {
    const now = new Date(), key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    let topups = 0, spent = 0, trips = 0;
    for (const m of card?.data.movements ?? []) { if (!m.at?.startsWith(key)) continue; if (m.kind === "topup") topups += m.amount; else if (m.kind === "trip") { spent += m.amount; trips++; } }
    return { topups, spent, trips };
  }, [card]);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <CloseToolbar />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.screen, { paddingTop: space[4], paddingBottom: insets.bottom + space[10] * 2 }]} showsVerticalScrollIndicator={false}>
        {Platform.OS === "android" && (!Tullave || !available) ? (
          // Android: sin lector en esta compilación, sin NFC en el teléfono, o con el NFC apagado
          <Card style={{ gap: space[2] }}>
            <Text style={[type.headline, { color: c.text }]}>{!Tullave ? "Pronto en Android" : nfc === "off" ? "Enciende el NFC" : "Este teléfono no tiene NFC"}</Text>
            <Text style={[type.body, { color: c.muted }]}>{!Tullave ? "Consultar el saldo de tu TuLlave acercando la tarjeta al teléfono todavía no está disponible en esta versión."
              : nfc === "off" ? "Para leer tu tarjeta TuLlave, enciende el NFC en los ajustes del teléfono (Conexiones o Dispositivos conectados) y vuelve aquí."
              : "Para leer la tarjeta hace falta un teléfono con NFC. Puedes consultar tu saldo en los puntos de recarga y en las taquillas de las estaciones."}</Text>
            {Tullave && nfc === "off" ? <Tap onPress={() => void Linking.sendIntent("android.settings.NFC_SETTINGS").catch(() => Linking.openSettings())} accessibilityRole="button" accessibilityLabel="Abrir los ajustes de NFC"><Text style={[type.headline, { color: c.accent }]}>Abrir ajustes de NFC</Text></Tap> : null}
          </Card>
        ) : !Tullave || !available ? (
          <Card><Text style={[type.headline, { color: c.text }]}>{!Tullave ? "Esta versión no trae el lector de tarjetas" : "No pudimos activar el NFC"}</Text>
            <Text style={[type.body, { color: c.muted, marginTop: space[1] }]}>{!Tullave
              ? `El lector de tarjetas no quedó registrado en la app. Módulos nativos que sí hay: ${Object.keys((globalThis as { expo?: { modules?: object } }).expo?.modules ?? {}).filter((k) => !k.startsWith("Expo")).join(", ") || "ninguno"}.`
              : "iOS dice que no puede leer tarjetas ahora. Pasa si el teléfono es anterior al iPhone 7, si es un iPad o si la app se compiló sin el permiso «NFC Tag Reading» en developer.apple.com (Identifiers › com.transmilive.app). No funciona en el simulador."}</Text></Card>
        ) : (
          <>
            <TuLlaveFace balance={card ? card.data.balance : null} number={card?.data.number} readAt={card?.at} busy={busy} still={reduceMotion} />

            <Text style={[type.body, { color: c.muted, textAlign: "center" }]} accessibilityLiveRegion="polite">
              {busy ? `Acerca la tarjeta a ${where}` : card ? (card.data.balance < 0 ? `Debes ${pesos(-card.data.balance)}: se descuenta en tu próxima recarga.` : "Saldo leído de tu tarjeta") : `Toca el botón y apoya tu TuLlave en ${where}`}
            </Text>
            {error ? <Text style={[type.body, { color: "#dc2626", textAlign: "center" }]} accessibilityRole="alert">{error}</Text> : null}

            <PrimaryButton symbol="wave.3.right" disabled={busy} label={busy ? "Esperando la tarjeta…" : card ? "Leer de nuevo" : "Leer mi tarjeta"} onPress={() => void read()} />
            {busy && Tullave?.cancel ? <Tap onPress={() => Tullave?.cancel?.()} accessibilityRole="button" accessibilityLabel="Dejar de esperar la tarjeta" style={{ alignSelf: "center", minHeight: 40, justifyContent: "center" }}><Text style={[type.headline, { color: c.muted }]}>Cancelar</Text></Tap> : null}

            {card ? (
              <>
                <View style={styles.stats}>
                  <Stat label="Recargas este mes" value={thisMonth.topups ? `+${pesos(thisMonth.topups)}` : "$0"} tone={thisMonth.topups ? "#16a34a" : undefined} />
                  <Stat label={`${thisMonth.trips} ${thisMonth.trips === 1 ? "viaje" : "viajes"} este mes`} value={pesos(thisMonth.spent)} />
                </View>

                {movementsByMonth(card.data.movements).map((g) => (
                  <View key={g.month ?? "sin-fecha"} style={{ gap: space[2] }}>
                    <Text style={[type.eyebrow, { color: c.muted, marginTop: space[3] }]}>{(g.month ? month(g.month) : "Sin fecha").toUpperCase()}</Text>
                    <Card style={{ gap: 0, paddingVertical: space[1] }}>
                      {g.movements.map((m, i) => {
                        const k = KIND[m.kind], plus = m.kind === "topup", tone = plus ? "#16a34a" : m.kind === "topupCancelled" ? c.muted : c.text;
                        return (
                          <View key={i} style={[styles.mv, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.line }]}>
                            <View style={[styles.mvIcon, { backgroundColor: plus ? "rgba(22,163,74,0.14)" : c.cardAlt }]}><SymbolView name={k.symbol} tintColor={plus ? "#16a34a" : c.muted} size={17} /></View>
                            <View style={{ flex: 1 }}><Text style={[type.headline, { color: c.text }]}>{k.label}</Text>{m.at ? <Text style={[type.caption, { color: c.muted }]}>{whenText(m.at)}</Text> : null}</View>
                            <Text style={[type.headline, { color: tone }]}>{plus ? "+" : m.kind === "trip" ? "-" : ""}{pesos(m.amount)}</Text>
                          </View>
                        );
                      })}
                    </Card>
                  </View>
                ))}
              </>
            ) : null}

            <View style={styles.privacy}>
              <SymbolView name="lock.fill" tintColor={c.muted} size={13} />
              <Text style={[type.caption, { color: c.muted, flex: 1 }]}>El saldo se lee en tu teléfono. No se guarda, no se envía y no hace falta cuenta.</Text>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: space[5], gap: space[3] },
  face: { aspectRatio: 1.586, borderRadius: 26, borderCurve: "continuous", backgroundColor: "#16161a", padding: space[5], justifyContent: "space-between", overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.28, shadowRadius: 22, shadowOffset: { width: 0, height: 12 }, ...lift(12, 24, 0.28) },
  glowA: { position: "absolute", right: -70, top: -90, width: 260, height: 260, borderRadius: 130, backgroundColor: "#e11d2e", opacity: 0.55 },
  glowB: { position: "absolute", left: -90, bottom: -120, width: 260, height: 260, borderRadius: 130, backgroundColor: "#ffffff", opacity: 0.06 },
  faceTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  brand: { color: "#ffffff", fontSize: 20, fontWeight: "800", letterSpacing: -0.4 },
  faceLabel: { color: "#ffffff", opacity: 0.65, fontSize: 12, fontWeight: "700", letterSpacing: 1.2 },
  amount: { color: "#ffffff", fontSize: 46, fontWeight: "800", letterSpacing: -1.4, fontVariant: ["tabular-nums"] },
  faceBottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  number: { color: "#ffffff", opacity: 0.8, fontSize: 15, fontWeight: "600", letterSpacing: 1.5, fontVariant: ["tabular-nums"] },
  readAt: { color: "#ffffff", opacity: 0.55, fontSize: 12, fontWeight: "600" },
  btn: { minHeight: 56, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: space[2] },
  stats: { flexDirection: "row", gap: space[3], marginTop: space[1] },
  stat: { flex: 1, gap: space[1] },
  mv: { flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: space[3], paddingHorizontal: space[3] },
  mvIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  privacy: { flexDirection: "row", alignItems: "center", gap: space[2], marginTop: space[4], paddingHorizontal: space[2] },
});
