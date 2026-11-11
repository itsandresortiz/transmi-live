import type { ComponentProps } from "react";
import { Platform, type StyleProp, type TextStyle } from "react-native";
import { SymbolView as AppleSymbolView, type SFSymbol } from "expo-symbols";
import Ionicons from "@expo/vector-icons/Ionicons";

export type { SFSymbol };

/** Los iconos de la app son símbolos de Apple (SF Symbols), que solo existen en iOS. En Android se dibuja el equivalente de Ionicons.
 *  En iOS esto es exactamente `SymbolView` de expo-symbols, sin cambios. */
type IonName = ComponentProps<typeof Ionicons>["name"];
const ANDROID: Record<string, IonName> = {
  "arrow.down.circle.fill": "arrow-down-circle", "arrow.right": "arrow-forward", "arrow.triangle.2.circlepath": "refresh",
  "arrow.triangle.turn.up.right.diamond": "arrow-redo", "arrow.triangle.turn.up.right.diamond.fill": "arrow-redo",
  "arrow.up.arrow.down": "swap-vertical", "arrow.up.left.and.arrow.down.right": "expand", "arrow.up.right": "open-outline",
  bell: "notifications-outline", "bell.fill": "notifications", "bell.badge.fill": "notifications", "bell.slash": "notifications-off",
  "briefcase.fill": "briefcase", "building.2.fill": "business", bus: "bus", "bus.fill": "bus",
  "checkmark.circle.fill": "checkmark-circle", "chevron.down": "chevron-down", "chevron.left": "chevron-back", "chevron.right": "chevron-forward", "chevron.up": "chevron-up",
  "circle.fill": "ellipse", "dot.radiowaves.left.and.right": "radio", "ellipsis.circle": "ellipsis-horizontal-circle",
  "exclamationmark.bubble.fill": "chatbubble-ellipses", "figure.walk": "walk", "hand.raised.fill": "hand-left",
  house: "home-outline", "house.fill": "home", "info.circle": "information-circle", "info.circle.fill": "information-circle",
  "location.fill": "navigate", "location.slash.fill": "navigate-outline", "location.north.fill": "navigate", "location.north.line.fill": "navigate",
  "lock.fill": "lock-closed", magnifyingglass: "search", map: "map-outline", "map.fill": "map", mappin: "location-outline", "mappin.circle.fill": "location",
  pencil: "pencil", "person.crop.circle.badge.xmark": "person-remove", "play.fill": "play", "signpost.right.fill": "trail-sign",
  "slider.horizontal.3": "options", "square.3.layers.3d": "layers", "square.and.arrow.up": "share-outline", star: "star-outline", "star.fill": "star",
  "tram.fill": "train", "wave.3.right": "wifi", xmark: "close", "xmark.circle.fill": "close-circle",
};
export const ANDROID_ICONS = ANDROID;

export function SymbolView(props: ComponentProps<typeof AppleSymbolView>) {
  if (Platform.OS === "ios") return <AppleSymbolView {...props} />;
  const { name, tintColor, size = 24, style } = props;
  return <Ionicons name={ANDROID[name as string] ?? "ellipse-outline"} size={size} color={typeof tintColor === "string" ? tintColor : "#888888"} style={style as StyleProp<TextStyle>} />;
}
