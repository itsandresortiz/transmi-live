import { Stack, router } from "expo-router";

/** La X de cerrar de las ventanas: un botón nativo de iOS (cápsula de vidrio y toque inmediato), no uno dibujado por la app. Se pone dentro de cada pantalla modal. */
let closing = false;
export function CloseToolbar() {
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Cerrar" onPress={() => { if (closing) return; closing = true; router.back(); setTimeout(() => { closing = false; }, 700); }} />
    </Stack.Toolbar>
  );
}
