import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { SymbolView } from "@/ui/Symbol";
import { stopLabelText } from "@transmi/domain";
import { transit } from "@/composition-root";
import { useSaved } from "@/favorites";
import { Card, Chip, PrimaryButton, Tap } from "@/ui/kit";
import { CloseToolbar } from "@/ui/CloseToolbar";
import { radius, space, type, useColors } from "@/ui/theme";

const SUGGESTIONS = ["Casa", "Trabajo", "Colegio", "Universidad", "Gimnasio", "Mamá"];

/** Personalizar una parada: ponerle tu propio nombre. Al guardar, la parada queda también en tus favoritos. */
export default function Personalizar() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const stop = transit.stopById(id);
  const saved = useSaved();
  const [name, setName] = useState(saved.nicknames[id] ?? "");
  if (!stop) return <View style={{ flex: 1, backgroundColor: c.bg, padding: space[5] }}><Text style={[type.headline, { color: c.text }]}>{transit.network.stops.size ? "No encontramos esa parada" : "Cargando la parada…"}</Text></View>;
  const real = stopLabelText(transit.labelOf(stop));
  const shown = name.trim() || real;

  const save = () => {
    const clean = name.trim();
    saved.setNickname(id, clean);
    if (clean && !saved.stops.includes(id)) saved.toggleStop(id);      // con nombre, la parada también queda en favoritos
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (router.canGoBack()) router.back(); else router.replace("/");
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: c.bg }}>
      <CloseToolbar />
      <ScrollView keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.screen, { paddingBottom: insets.bottom + space[8] }]} showsVerticalScrollIndicator={false}>
        <Text style={[type.eyebrow, { color: c.muted }]}>ASÍ SE VERÁ EN TUS FAVORITOS</Text>
        <Card style={styles.preview}>
          <View style={[styles.icon, { backgroundColor: c.dark ? "#2a1114" : "#fde8ea" }]}><SymbolView name="mappin.circle.fill" tintColor={c.accent} size={26} /></View>
          <View style={{ flex: 1 }}>
            <Text style={[type.title, { color: c.text }]} numberOfLines={1}>{shown}</Text>
            {name.trim() ? <Text style={[type.caption, { color: c.muted }]} numberOfLines={1}>{real}</Text> : <Text style={[type.caption, { color: c.muted }]}>Nombre original de la parada</Text>}
          </View>
        </Card>

        <Text style={[type.eyebrow, { color: c.muted, marginTop: space[3] }]}>NOMBRE</Text>
        <View style={[styles.field, { backgroundColor: c.card, borderColor: c.line }]}>
          <SymbolView name="pencil" tintColor={c.muted} size={16} />
          <TextInput selectionColor={c.accent} cursorColor={c.accent} underlineColorAndroid="transparent" value={name} onChangeText={setName} autoFocus maxLength={40} placeholder="Por ejemplo: La del colegio" placeholderTextColor={c.muted} returnKeyType="done" onSubmitEditing={save}
            autoCapitalize="sentences" clearButtonMode="while-editing" accessibilityLabel="Nombre de la parada" style={[type.body, styles.input, { color: c.text }]} />
        </View>

        <Text style={[type.eyebrow, { color: c.muted, marginTop: space[3] }]}>SUGERENCIAS</Text>
        <View style={styles.chips}>
          {SUGGESTIONS.map((s) => <Chip key={s} label={s} selected={name.trim() === s} onPress={() => { setName(s); void Haptics.selectionAsync(); }} />)}
        </View>

        <View style={{ marginTop: space[4], gap: space[3] }}>
          <PrimaryButton label={name.trim() ? "Guardar" : saved.nicknames[id] ? "Quitar el nombre" : "Listo"} onPress={save} />
          {saved.nicknames[id] && name.trim() ? (
            <Tap onPress={() => { setName(""); }} accessibilityRole="button" accessibilityLabel="Quitar el nombre personalizado" style={{ alignSelf: "center" }}><Text style={[type.caption, { color: c.muted, fontSize: 14 }]}>Volver al nombre original</Text></Tap>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: space[5], gap: space[2] },
  preview: { flexDirection: "row", alignItems: "center", gap: space[3] },
  icon: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  field: { flexDirection: "row", alignItems: "center", gap: space[2], borderRadius: radius.lg, borderCurve: "continuous", borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space[4], minHeight: 52 },
  input: { flex: 1, minHeight: 52 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
});
