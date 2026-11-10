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
        <Stack.Screen name="bus/[id]" options={{ presentation: "formSheet", contentStyle: { backgroundColor: c.bg }, sheetAllowedDetents: "fitToContents", sheetGrabberVisible: true, sheetLargestUndimmedDetentIndex: "last", sheetCornerRadius: 28, headerShown: false }} />
        <Stack.Screen name="ride/[id]" options={{ presentation: "formSheet", contentStyle: { backgroundColor: c.bg }, sheetAllowedDetents: [0.5, 0.92], sheetInitialDetentIndex: 1, sheetGrabberVisible: true, sheetLargestUndimmedDetentIndex: 0, sheetCornerRadius: 28, headerShown: false }} />
        <Stack.Screen name="stop/[id]" options={{ presentation: "formSheet", contentStyle: { backgroundColor: c.bg }, sheetAllowedDetents: [0.5, 0.92], sheetInitialDetentIndex: 0, sheetGrabberVisible: true, sheetLargestUndimmedDetentIndex: 0, sheetCornerRadius: 28, headerShown: false }} />
        <Stack.Screen name="avisos" options={{ presentation: "modal", headerShown: true, title: "Avisos del servicio", headerTintColor: "#e11d2e", headerRight: close }} />
        <Stack.Screen name="onboarding" options={{ presentation: "fullScreenModal", animation: "fade", gestureEnabled: false }} />
        <Stack.Screen name="card" options={{ presentation: "modal", headerShown: true, title: "Mi tarjeta", headerTintColor: "#e11d2e", headerRight: close }} />
      </Stack>
      <Launch />
    </>
  );
}
