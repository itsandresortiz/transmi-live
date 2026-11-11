import { Platform } from "react-native";
import { NativeTabs } from "expo-router/native-tabs";
import { useColors } from "@/ui/theme";

/** Barra inferior nativa de iOS: en iOS 26 es de vidrio líquido . */
export default function TabsLayout() {
  const c = useColors();
  return (
    <NativeTabs tintColor={Platform.OS === "android" ? c.accent : "#e11d2e"} {...(Platform.OS === "android" ? { backgroundColor: c.card, indicatorColor: c.dark ? "#3a1519" : "#fde3e6", rippleColor: c.dark ? "#ffffff14" : "#d4162a1f", iconColor: { default: c.muted, selected: c.accent }, labelStyle: { default: { color: c.muted, fontSize: 11, fontWeight: "600" as const }, selected: { color: c.text, fontSize: 11, fontWeight: "700" as const } } } : {})}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf={{ default: "house", selected: "house.fill" }} md="home" />
        <NativeTabs.Trigger.Label>Inicio</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="mapa">
        <NativeTabs.Trigger.Icon sf={{ default: "map", selected: "map.fill" }} md="map" />
        <NativeTabs.Trigger.Label>Mapa</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="rutas">
        <NativeTabs.Trigger.Icon sf="magnifyingglass" md="search" />
        <NativeTabs.Trigger.Label>Buscar</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="viaje">
        <NativeTabs.Trigger.Icon sf="arrow.triangle.turn.up.right.diamond" md="directions" />
        <NativeTabs.Trigger.Label>Cómo llegar</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="mas">
        <NativeTabs.Trigger.Icon sf="ellipsis.circle" md="more_horiz" />
        <NativeTabs.Trigger.Label>Más</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
