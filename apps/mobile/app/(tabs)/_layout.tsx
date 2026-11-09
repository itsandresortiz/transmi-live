import type { ColorValue } from "react-native";
import { Tabs } from "expo-router";
import { SymbolView } from "expo-symbols";

const icon = (name: React.ComponentProps<typeof SymbolView>["name"]) => ({ color }: { color: ColorValue }) => <SymbolView name={name} tintColor={color} size={24} />;

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: "Rutas", tabBarIcon: icon("bus") }} />
      <Tabs.Screen name="buses" options={{ title: "Buses", tabBarIcon: icon("location.north.line") }} />
      <Tabs.Screen name="paradas" options={{ title: "Paradas", tabBarIcon: icon("mappin.and.ellipse") }} />
      <Tabs.Screen name="viaje" options={{ title: "Cómo llegar", tabBarIcon: icon("arrow.triangle.turn.up.right.diamond") }} />
    </Tabs>
  );
}
