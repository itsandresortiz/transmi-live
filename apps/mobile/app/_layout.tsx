import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { startData } from "@/bootstrap";

export default function RootLayout() {
  useEffect(() => startData(), []);
  // la primera vez se explica qué es la app y qué hace con los datos
  useEffect(() => { void AsyncStorage.getItem("tm.onboarded.v1").then((v) => { if (!v) setTimeout(() => router.push("/onboarding"), 400); }).catch(() => undefined); }, []);
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="route/[id]" options={{ headerShown: true, title: "Ruta", headerLargeTitle: false, headerTransparent: true, headerBlurEffect: "systemMaterial", presentation: "card" }} />
        <Stack.Screen name="bus/[id]" options={{ presentation: "formSheet", sheetAllowedDetents: "fitToContents", sheetGrabberVisible: true, sheetLargestUndimmedDetentIndex: "last", sheetCornerRadius: 28, headerShown: false }} />
        <Stack.Screen name="stop/[id]" options={{ presentation: "formSheet", sheetAllowedDetents: [0.5, 0.92], sheetInitialDetentIndex: 0, sheetGrabberVisible: true, sheetLargestUndimmedDetentIndex: 0, sheetCornerRadius: 28, headerShown: false }} />
        <Stack.Screen name="avisos" options={{ headerShown: true, title: "Avisos del servicio", headerTransparent: true, headerBlurEffect: "systemMaterial" }} />
        <Stack.Screen name="onboarding" options={{ presentation: "fullScreenModal", animation: "fade", gestureEnabled: false }} />
        <Stack.Screen name="card" options={{ headerShown: true, title: "Mi tarjeta", presentation: "modal" }} />
      </Stack>
    </>
  );
}
