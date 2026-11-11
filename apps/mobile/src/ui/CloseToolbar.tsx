import { Platform } from "react-native";
import { Stack, router } from "expo-router";

/** La X de cerrar de las ventanas: un botón nativo de iOS (cápsula de vidrio y toque inmediato), no uno dibujado por la app. Se pone dentro de cada pantalla modal. */
let closing = false;
export function CloseToolbar() {
  if (Platform.OS !== "ios") return null;      // en Android se cierra con la flecha del encabezado o el gesto de atrás del sistema
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Cerrar" onPress={() => { if (closing) return; closing = true; if (router.canGoBack()) router.back(); else router.replace("/"); setTimeout(() => { closing = false; }, 700); }} />
    </Stack.Toolbar>
  );
}
