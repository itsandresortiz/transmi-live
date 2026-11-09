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
        <Stack.Screen name="card" options={{ headerShown: true, title: "Mi tarjeta", presentation: "modal" }} />
      </Stack>
    </>
  );
}
