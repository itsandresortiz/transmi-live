import { Alert, Linking } from "react-native";
import Constants from "expo-constants";

/** Correo público de contacto de TransMi LIVE. */
export const CONTACT = "info@transmilive.com";

/** Abre un correo ya redactado para reportar un problema o dar una idea (sin servidor ni cuenta). No lleva datos personales: solo lo que se estaba viendo. */
export function reportProblem(context: { what: string; lines?: string[] }): void {
  const body = [
    "¿Qué pasó o qué idea tienes? (cuéntalo con tus palabras)", "", "", "",
    "---", `Sobre: ${context.what}`, ...(context.lines ?? []),
    `App: TransMi LIVE ${Constants.expoConfig?.version ?? ""} (${Constants.nativeBuildVersion ?? "—"})`,
  ].join("\n");
  const url = `mailto:${CONTACT}?subject=${encodeURIComponent(`TransMi LIVE: ${context.what}`)}&body=${encodeURIComponent(body)}`;
  // si el teléfono no tiene una app de correo configurada, se muestra la dirección para escribir desde donde se pueda
  Linking.openURL(url).catch(() => Alert.alert("Escríbenos", `No pudimos abrir tu app de correo. Puedes escribirnos a ${CONTACT}.`));
}
