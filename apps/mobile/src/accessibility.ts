import { useSyncExternalStore } from "react";
import { AccessibilityInfo, Platform, useWindowDimensions } from "react-native";

/** Los ajustes de accesibilidad del teléfono, al día mientras la app corre. */
export interface Accessibility { moreContrast: boolean; boldText: boolean; reduceMotion: boolean; reduceTransparency: boolean; screenReader: boolean }

let state: Accessibility = { moreContrast: false, boldText: false, reduceMotion: false, reduceTransparency: false, screenReader: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<Accessibility>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };

if (Platform.OS !== "web") {
  const contrastEvent = Platform.OS === "android" ? "highTextContrastChanged" : "darkerSystemColorsChanged";
  const contrastNow = Platform.OS === "android" ? AccessibilityInfo.isHighTextContrastEnabled : AccessibilityInfo.isDarkerSystemColorsEnabled;
  void Promise.all([contrastNow(), AccessibilityInfo.isBoldTextEnabled(), AccessibilityInfo.isReduceMotionEnabled(), AccessibilityInfo.isReduceTransparencyEnabled(), AccessibilityInfo.isScreenReaderEnabled()])
    .then(([moreContrast, boldText, reduceMotion, reduceTransparency, screenReader]) => set({ moreContrast, boldText, reduceMotion, reduceTransparency, screenReader }))
    .catch(() => undefined);
  AccessibilityInfo.addEventListener(contrastEvent, (moreContrast: boolean) => set({ moreContrast }));
  AccessibilityInfo.addEventListener("boldTextChanged", (boldText: boolean) => set({ boldText }));
  AccessibilityInfo.addEventListener("reduceMotionChanged", (reduceMotion: boolean) => set({ reduceMotion }));
  AccessibilityInfo.addEventListener("reduceTransparencyChanged", (reduceTransparency: boolean) => set({ reduceTransparency }));
  AccessibilityInfo.addEventListener("screenReaderChanged", (screenReader: boolean) => set({ screenReader }));
}

export function useAccessibility(): Accessibility {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state);
}

/** Con los tamaños de texto de accesibilidad de iOS (desde ~1,35×), las filas se apilan en vez de apretarse. */
export const useLargeText = (): boolean => useWindowDimensions().fontScale >= 1.35;

/** Dice algo en voz alta a VoiceOver o TalkBack, para cambios que ocurren fuera del foco. */
export const announce = (message: string): void => AccessibilityInfo.announceForAccessibility(message);
