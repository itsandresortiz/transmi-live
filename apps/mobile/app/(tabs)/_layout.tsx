import { NativeTabs } from "expo-router/native-tabs";

/** Barra inferior nativa de iOS: en iOS 26 es de vidrio líquido . */
export default function TabsLayout() {
  return (
    <NativeTabs tintColor="#e11d2e">
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
