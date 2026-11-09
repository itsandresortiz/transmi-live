import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { SymbolView } from "expo-symbols";
import { type CardReading, type TuLlaveCard, NotTuLlaveError, groupCardNumber, maskedReading, movementsByMonth, parseTuLlave } from "@transmi/domain";
import { Tullave } from "../modules/tullave/src";
import { Card, PAGE, SheetClose, Tap } from "@/ui/kit";
import { radius, space, type, useColors } from "@/ui/theme";

const pesos = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("es-CO")}`;
const KIND = { trip: "Viaje", topup: "Recarga", topupCancelled: "Recarga anulada", other: "Movimiento" } as const;
const when = (at: string) => new Date(at).toLocaleString("es-CO", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const month = (m: string) => { const s = new Date(`${m}-15T12:00:00`).toLocaleDateString("es-CO", { month: "long", year: "numeric" }); return s.charAt(0).toUpperCase() + s.slice(1); };

const PROMPTS = { hold: "Acerca la tarjeta a la parte de arriba del teléfono", reading: "Leyendo… no la muevas", done: "Listo", notCard: "Esa tarjeta no parece una TuLlave", lost: "Se perdió la conexión con la tarjeta. Intenta de nuevo" };

/** Mi tarjeta TuLlave: el saldo se lee de la tarjeta en el teléfono; no se envía ni se guarda nada. */
export default function CardScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [card, setCard] = useState<{ data: TuLlaveCard; at: number; raw: CardReading } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const available = (() => { try { return Tullave?.isAvailable() ?? false; } catch { return false; } })();

  const read = async () => {
    if (!Tullave) return;
    setBusy(true); setError(null); setCopied(false);
    try {
      const raw = await Tullave.read(PROMPTS);
      const data = parseTuLlave(raw);
      setCard({ data, at: Date.now(), raw });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      const code = (e as { code?: string }).code;
      setError(e instanceof NotTuLlaveError || code === "not_tullave" ? "Esa tarjeta no parece una TuLlave."
        : code === "cancelled" ? null
        : code === "timeout" ? "No alcanzamos a leer la tarjeta. Acércala a la parte de arriba del teléfono e intenta de nuevo."
        : "No pudimos leer la tarjeta. Intenta de nuevo.");
    } finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
    <SheetClose onPress={() => router.back()} />
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={[PAGE, styles.screen, { paddingTop: space[10], paddingBottom: insets.bottom + space[10] * 2 }]} showsVerticalScrollIndicator={false}>
      <Text style={[type.largeTitle, { color: c.text }]} accessibilityRole="header">Mi tarjeta</Text>
      {!Tullave || !available ? (
        <Card><Text style={[type.headline, { color: c.text }]}>{!Tullave ? "Esta versión no trae el lector de tarjetas" : "No pudimos activar el NFC"}</Text>
          <Text style={[type.body, { color: c.muted, marginTop: space[1] }]}>{!Tullave
            ? "Instala la última compilación desde TestFlight: el lector solo viene en las versiones nuevas."
            : "iOS dice que no puede leer tarjetas ahora. Pasa si el teléfono es anterior al iPhone 7, si es un iPad o si la app se compiló sin el permiso «NFC Tag Reading» en developer.apple.com (Identifiers › com.transmilive.app). No funciona en el simulador."}</Text></Card>

      ) : (
        <>
          <Card dark style={styles.hero}>
            <SymbolView name="creditcard.fill" tintColor={c.onInk} size={30} />
            <Text style={[type.eyebrow, { color: c.onInk, opacity: 0.7, marginTop: space[4] }]}>SALDO</Text>
            <Text style={[type.hero, { color: c.onInk }]}>{card ? pesos(card.data.balance) : "$ ——"}</Text>
            {card?.data.number ? <Text style={[type.caption, { color: c.onInk, opacity: 0.7 }]}>Tarjeta {groupCardNumber(card.data.number)}</Text> : <Text style={[type.caption, { color: c.onInk, opacity: 0.7 }]}>Acerca tu TuLlave al teléfono</Text>}
          </Card>
          <Tap onPress={() => void read()} disabled={busy} accessibilityRole="button" accessibilityLabel={card ? "Leer de nuevo" : "Leer mi tarjeta"} style={[styles.btn, { backgroundColor: c.accent, opacity: busy ? 0.6 : 1 }]}>
            <Text style={[type.headline, { color: c.onAccent }]}>{busy ? "Acerca la tarjeta…" : card ? "Leer de nuevo" : "Leer mi tarjeta"}</Text>
          </Tap>
          {error ? <Text style={[type.body, { color: "#dc2626" }]} accessibilityRole="alert">{error}</Text> : null}
          {card ? (
            <>
              {card.data.balance < 0 ? <Text style={[type.body, { color: c.muted }]}>Debes {pesos(-card.data.balance)}: se descuenta en tu próxima recarga.</Text> : null}
              <Text style={[type.caption, { color: c.muted }]}>Leído a las {new Date(card.at).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" })} (solo se muestra aquí, no se guarda)</Text>
              {movementsByMonth(card.data.movements).map((g) => (
                <View key={g.month ?? "sin-fecha"} style={{ gap: space[2] }}>
                  <Text style={[type.eyebrow, { color: c.muted, marginTop: space[3] }]}>{(g.month ? month(g.month) : "Sin fecha").toUpperCase()}</Text>
                  <Card style={{ gap: space[3] }}>
                    {g.movements.map((m, i) => (
                      <View key={i} style={styles.mv}>
                        <View style={{ flex: 1 }}><Text style={[type.headline, { color: c.text }]}>{KIND[m.kind]}</Text>{m.at ? <Text style={[type.caption, { color: c.muted }]}>{when(m.at)}</Text> : null}</View>
                        <Text style={[type.headline, { color: m.kind === "topup" ? "#16a34a" : c.text }]}>{m.kind === "topup" ? "+" : m.kind === "trip" ? "-" : ""}{pesos(m.amount)}</Text>
                      </View>
                    ))}
                  </Card>
                </View>
              ))}
              <Tap onPress={() => void Clipboard.setStringAsync(maskedReading(card.raw)).then(() => setCopied(true))} accessibilityRole="button" accessibilityLabel="Copiar lectura técnica" style={{ marginTop: space[3] }}>
                <Text style={[type.caption, { color: c.accent, fontSize: 14 }]}>{copied ? "Copiado" : "Copiar lectura técnica (sin el número de la tarjeta)"}</Text>
              </Tap>
            </>
          ) : null}
        </>
      )}
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: space[5], gap: space[3], paddingBottom: space[10] * 2 },
  hero: { padding: space[6], borderRadius: radius.xl },
  btn: { minHeight: 56, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  mv: { flexDirection: "row", alignItems: "center", gap: space[3] },
});
