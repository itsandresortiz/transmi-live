import { useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useIsFocused } from "expo-router";
import { SYSTEMS, SYSTEM_LABEL, type SystemType } from "@transmi/domain";
import { TransitMap, type TransitMapHandle } from "@/map/TransitMap";
import { locateMe } from "@/location";
import { Chip, Glass, RoundButton } from "@/ui/kit";
import { space } from "@/ui/theme";

export default function Mapa() {
  const insets = useSafeAreaInsets();
  const map = useRef<TransitMapHandle>(null);
  const focused = useIsFocused();
  const [system, setSystem] = useState<SystemType | null>(null);

  const locate = async () => { const me = await locateMe(); if (me) map.current?.flyTo(me.lat, me.lon, 15.8); };

  return (
    <View style={styles.screen}>
      <TransitMap ref={map} system={system} active={focused}
        onBus={(id) => router.push({ pathname: "/bus/[id]", params: { id } })}
        onStop={(id) => router.push({ pathname: "/stop/[id]", params: { id } })} />
      <View pointerEvents="box-none" style={[styles.top, { top: insets.top + space[2] }]}>
        <Glass style={styles.chipsGlass}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            <Chip label="Todos" selected={!system} onPress={() => setSystem(null)} />
            {SYSTEMS.map((s) => <Chip key={s} label={SYSTEM_LABEL[s]} selected={system === s} onPress={() => setSystem(system === s ? null : s)} />)}
          </ScrollView>
        </Glass>
      </View>
      <View pointerEvents="box-none" style={[styles.side, { bottom: insets.bottom + 110 }]}>
        <RoundButton symbol="location.fill" label="Mi ubicación" onPress={() => void locate()} size={52} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  top: { position: "absolute", left: space[4], right: space[4] },
  chipsGlass: { borderRadius: 28, overflow: "hidden" },
  chips: { gap: space[2], padding: space[2] },
  side: { position: "absolute", right: space[4] },
});
