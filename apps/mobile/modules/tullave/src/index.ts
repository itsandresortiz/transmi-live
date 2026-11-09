import { requireOptionalNativeModule } from "expo";
import type { CardReading } from "@transmi/domain";

export interface TullaveNative {
  isAvailable(): boolean;
  read(prompts: Record<string, string>): Promise<CardReading>;
}

/** El módulo nativo, o `null` donde no existe (web, Android por ahora, simulador sin NFC). */
export const Tullave = requireOptionalNativeModule<TullaveNative>("Tullave");
