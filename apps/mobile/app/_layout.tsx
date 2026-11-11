import { useEffect } from "react";
import { Platform } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { startData } from "@/bootstrap";
import { RideWatcher } from "@/RideWatcher";
import { TripWatcher } from "@/TripWatcher";
import { WidgetSync } from "@/widgetSync";
import { Launch, useLaunch } from "@/ui/Launch";
import { AppHeader } from "@/ui/AppHeader";
import { useColors } from "@/ui/theme";
import "@/appearance";      // aplica al abrir la apariencia que la persona eligió

/** Si la app se abre directo en una parada o una ruta (por el widget, por ejemplo), debajo siempre queda el inicio: así se puede cerrar y volver. */
export const unstable_settings = { anchor: "(tabs)", initialRouteName: "(tabs)" };

/** En Android las ventanas llevan un encabezado propio (título en la letra ancha y una X redonda) en vez de la barra blanca del sistema. */
const ANDROID_HEADER = Platform.OS === "android" ? { header: ({ options }: { options: { title?: string } }) => <AppHeader title={options.title} /> } : {};

export default function RootLayout() {
  const c = useColors();
  // La carga de rutas ocupa el hilo de la app por un momento. Desde que las rutas se guardan en el teléfono, esa carga arrancaba de inmediato y tapaba
  // el primer cuadro: la pantalla de arranque no alcanzaba a pintarse y se veía negro. Se le da primero un instante a la animación para que aparezca
  // (una vez andando sigue sola, aunque la app esté ocupada).
  useEffect(() => {
    let stop: (() => void) | undefined;
    const id = setTimeout(() => { stop = startData(); }, 650);
    return () => { clearTimeout(id); stop?.(); };
  }, []);
  // la primera vez se explica qué es la app y qué hace con los datos
  const launched = useLaunch((s) => s.done);
  useEffect(() => { if (launched) void AsyncStorage.getItem("tm.onboarded.v1").then((v) => { if (!v) setTimeout(() => router.push("/onboarding"), 200); }).catch(() => undefined); }, [launched]);
  return (
    <>
      <StatusBar style="auto" />
      <RideWatcher />
      <TripWatcher />
      <WidgetSync />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="route/[id]" options={{ presentation: "modal", headerShown: true, ...ANDROID_HEADER, title: "", headerShadowVisible: false, contentStyle: { backgroundColor: c.bg } }} />
        <Stack.Screen name="bus/[id]" options={{ presentation: "modal", headerShown: true, ...ANDROID_HEADER, title: "", headerShadowVisible: false, headerTintColor: "#e11d2e", contentStyle: { backgroundColor: c.bg } }} />
        <Stack.Screen name="ride/[id]" options={{ presentation: "modal", headerShown: true, ...ANDROID_HEADER, title: "", headerShadowVisible: false, headerTintColor: "#e11d2e", contentStyle: { backgroundColor: c.bg } }} />
        <Stack.Screen name="stop/[id]" options={{ presentation: "modal", headerShown: true, ...ANDROID_HEADER, title: "", headerShadowVisible: false, headerTintColor: "#e11d2e", contentStyle: { backgroundColor: c.bg } }} />
        <Stack.Screen name="trip" options={{ presentation: "modal", headerShown: true, ...ANDROID_HEADER, title: "Tu viaje", headerShadowVisible: false, headerTintColor: "#e11d2e", contentStyle: { backgroundColor: c.bg } }} />
        <Stack.Screen name="avisos" options={{ presentation: "modal", headerShown: true, ...ANDROID_HEADER, title: "Avisos del servicio", headerTintColor: "#e11d2e" }} />
        <Stack.Screen name="onboarding" options={{ presentation: "fullScreenModal", animation: "fade", gestureEnabled: false }} />
        <Stack.Screen name="personalizar/[id]" options={{ presentation: "modal", headerShown: true, ...ANDROID_HEADER, title: "Personalizar parada", headerShadowVisible: false, contentStyle: { backgroundColor: c.bg } }} />
        <Stack.Screen name="cerca" options={{ presentation: "modal", headerShown: true, ...ANDROID_HEADER, title: "Cerca de mí", headerTintColor: "#e11d2e" }} />
        <Stack.Screen name="favoritos" options={{ presentation: "modal", headerShown: true, ...ANDROID_HEADER, title: "Favoritos", headerTintColor: "#e11d2e" }} />
        <Stack.Screen name="card" options={{ presentation: "modal", headerShown: true, ...ANDROID_HEADER, title: "Mi tarjeta", headerTintColor: "#e11d2e" }} />
      </Stack>
      <Launch />
    </>
  );
}
