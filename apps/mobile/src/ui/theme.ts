import { useColorScheme } from "react-native";
import type { SystemType } from "@transmi/domain";

export const SYSTEM_COLOR: Record<SystemType, string> = {
  troncal: "#e11d2e", dual: "#8b5cf6", alimentador: "#16a34a", zonal: "#2563eb", otro: "#64748b",
};

export function useColors() {
  const dark = useColorScheme() === "dark";
  return {
    dark,
    bg: dark ? "#000000" : "#f2f2f7",
    card: dark ? "#1c1c1e" : "#ffffff",
    text: dark ? "#ffffff" : "#111111",
    muted: dark ? "#9a9aa0" : "#6b6b70",
    line: dark ? "#2c2c2e" : "#e5e5ea",
    accent: "#e11d2e",
  };
}
