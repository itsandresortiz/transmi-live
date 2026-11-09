import { Linking } from "react-native";
import Constants from "expo-constants";

/** Abre un reporte ya redactado en GitHub (sin servidor ni cuenta propia de la app). No lleva datos personales: solo lo que se estaba viendo. */
export function reportProblem(context: { what: string; lines?: string[] }): void {
  const body = [
    "**¿Qué pasó?** (cuéntalo con tus palabras)", "", "",
    "---", `Sobre: ${context.what}`, ...(context.lines ?? []),
    `App: TransMi LIVE ${Constants.expoConfig?.version ?? ""} (${Constants.nativeBuildVersion ?? "—"})`,
  ].join("\n");
  const url = `https://github.com/itsandresortiz/transmi-live/issues/new?title=${encodeURIComponent(`Reporte: ${context.what}`)}&body=${encodeURIComponent(body)}`;
  void Linking.openURL(url);
}
