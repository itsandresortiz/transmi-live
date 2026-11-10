import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { startData } from "@/bootstrap";
import { RideWatcher } from "@/RideWatcher";
import { WidgetSync } from "@/widgetSync";
import { Launch, useLaunch } from "@/ui/Launch";
import { useColors } from "@/ui/theme";
import "@/appearance";      // aplica al abrir la apariencia que la persona eligió

/** Si la app se abre directo en una parada o una ruta (por el widget, por ejemplo), debajo siempre queda el inicio: así se puede cerrar y volver. */
export const unstable_settings = { anchor: "(tabs)", initialRouteName: "(tabs)" };

export default function RootLayout() {
  const c = useColors();
  useEffect(() => startData(), []);
  // la primera vez se explica qué es la app y qué hace con los datos
  const launched = useLaunch((s) => s.done);
  useEffect(() => { if (launched) void AsyncStorage.getItem("tm.onboarded.v1").then((v) => { if (!v) setTimeout(() => router.push("/onboarding"), 200); }).catch(() => undefined); }, [launched]);
  return (
    <>
      <StatusBar style="auto" />
      <RideWatcher />
      <WidgetSync />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="route/[id]" options={{ presentation: "modal", headerShown: true, title: "", headerShadowVisible: false, contentStyle: { backgroundColor: c.bg } }} />
        <Stack.Screen name="bus/[id]" options={{ presentation: "modal", headerShown: true, title: "", headerShadowVisible: false, headerTintColor: "#e11d2e", contentStyle: { backgroundColor: c.bg } }} />
        <Stack.Screen name="ride/[id]" options={{ presentation: "modal", headerShown: true, title: "", headerShadowVisible: false, headerTintColor: "#e11d2e", contentStyle: { backgroundColor: c.bg } }} />
        <Stack.Screen name="stop/[id]" options={{ presentation: "modal", headerShown: true, title: "", headerShadowVisible: false, headerTintColor: "#e11d2e", contentStyle: { backgroundColor: c.bg } }} />
        <Stack.Screen name="avisos" options={{ presentation: "modal", headerShown: true, title: "Avisos del servicio", headerTintColor: "#e11d2e" }} />
        <Stack.Screen name="onboarding" options={{ presentation: "fullScreenModal", animation: "fade", gestureEnabled: false }} />
        <Stack.Screen name="personalizar/[id]" options={{ presentation: "modal", headerShown: true, title: "Personalizar parada", headerShadowVisible: false, contentStyle: { backgroundColor: c.bg } }} />
        <Stack.Screen name="cerca" options={{ presentation: "modal", headerShown: true, title: "Cerca de mí", headerTintColor: "#e11d2e" }} />
        <Stack.Screen name="favoritos" options={{ presentation: "modal", headerShown: true, title: "Favoritos", headerTintColor: "#e11d2e" }} />
        <Stack.Screen name="card" options={{ presentation: "modal", headerShown: true, title: "Mi tarjeta", headerTintColor: "#e11d2e" }} />
      </Stack>
      <Launch />
    </>
  );
}
