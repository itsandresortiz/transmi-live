import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { startData } from "@/bootstrap";

export default function RootLayout() {
  useEffect(() => startData(), []);
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="route/[id]" options={{ headerShown: true, title: "Ruta", headerLargeTitle: false, headerTransparent: true, headerBlurEffect: "systemMaterial", presentation: "card" }} />
        <Stack.Screen name="bus/[id]" options={{ presentation: "formSheet", sheetAllowedDetents: [0.34, 0.7], sheetGrabberVisible: true, sheetLargestUndimmedDetentIndex: 1, sheetCornerRadius: 28, headerShown: false }} />
        <Stack.Screen name="stop/[id]" options={{ presentation: "formSheet", sheetAllowedDetents: [0.4, 0.92], sheetGrabberVisible: true, sheetLargestUndimmedDetentIndex: 0, sheetCornerRadius: 28, headerShown: false }} />
        <Stack.Screen name="avisos" options={{ headerShown: true, title: "Avisos del servicio", headerTransparent: true, headerBlurEffect: "systemMaterial" }} />
        <Stack.Screen name="card" options={{ headerShown: true, title: "Mi tarjeta", presentation: "modal" }} />
      </Stack>
    </>
  );
}
