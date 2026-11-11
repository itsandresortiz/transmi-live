import { Text, View } from "react-native";
import { router } from "expo-router";
import { SymbolView } from "@/ui/Symbol";
import { guideNow } from "@transmi/application";
import { placeText, useTrip } from "@/trip";
import { Card, Tap } from "./kit";
import { space, type, useColors } from "./theme";

/** Si estás siguiendo un viaje, lo recuerda con el paso actual; al tocarlo abre el viaje. No ocupa lugar cuando no hay viaje. */
export function TripBanner() {
  const c = useColors();
  const it = useTrip((s) => s.it), guide = useTrip((s) => s.guide);
  if (!it) return null;
  const nowDo = guideNow(it, guide, placeText);
  return (
    <Tap onPress={() => router.push("/trip")} accessibilityRole="button" accessibilityLabel={`Viaje en curso. ${nowDo.title}. Abrir el viaje`}>
      <Card dark style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
        <SymbolView name="location.north.line.fill" tintColor={c.onInk} size={20} />
        <View style={{ flex: 1 }}>
          <Text style={[type.eyebrow, { color: c.onInk, opacity: 0.7 }]}>VIAJE EN CURSO</Text>
          <Text style={[type.headline, { color: c.onInk }]} numberOfLines={2}>{nowDo.title}</Text>
        </View>
        <SymbolView name="chevron.right" tintColor={c.onInk} size={14} />
      </Card>
    </Tap>
  );
}
