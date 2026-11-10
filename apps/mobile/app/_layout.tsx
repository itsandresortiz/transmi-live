import { useEffect } from "react";
import { Text } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { startData } from "@/bootstrap";
import { RideWatcher } from "@/RideWatcher";
import { Launch, useLaunch } from "@/ui/Launch";
import { useColors } from "@/ui/theme";

const close = () => <Text onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Cerrar" style={{ color: "#e11d2e", fontSize: 17, fontWeight: "600" }}>Cerrar</Text>;

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
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="route/[id]" options={{ headerShown: true, title: "Ruta", headerBackTitle: "Atrás", headerTintColor: "#e11d2e", presentation: "card" }} />
        <Stack.Screen name="bus/[id]" options={{ presentation: "modal", headerShown: true, title: "", headerShadowVisible: false, headerTintColor: "#e11d2e", headerRight: close, contentStyle: { backgroundColor: c.bg } }} />
        <Stack.Screen name="ride/[id]" options={{ presentation: "modal", headerShown: true, title: "", headerShadowVisible: false, headerTintColor: "#e11d2e", headerRight: close, contentStyle: { backgroundColor: c.bg } }} />
        <Stack.Screen name="stop/[id]" options={{ presentation: "modal", headerShown: true, title: "", headerShadowVisible: false, headerTintColor: "#e11d2e", headerRight: close, contentStyle: { backgroundColor: c.bg } }} />
        <Stack.Screen name="avisos" options={{ presentation: "modal", headerShown: true, title: "Avisos del servicio", headerTintColor: "#e11d2e", headerRight: close }} />
        <Stack.Screen name="onboarding" options={{ presentation: "fullScreenModal", animation: "fade", gestureEnabled: false }} />
        <Stack.Screen name="cerca" options={{ presentation: "modal", headerShown: true, title: "Cerca de mí", headerTintColor: "#e11d2e", headerRight: close }} />
        <Stack.Screen name="favoritos" options={{ presentation: "modal", headerShown: true, title: "Favoritos", headerTintColor: "#e11d2e", headerRight: close }} />
        <Stack.Screen name="card" options={{ presentation: "modal", headerShown: true, title: "Mi tarjeta", headerTintColor: "#e11d2e", headerRight: close }} />
      </Stack>
      <Launch />
    </>
  );
}
