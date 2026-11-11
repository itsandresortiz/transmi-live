import { requireOptionalNativeModule } from "expo";
import type { CardReading } from "@transmi/domain";

export interface TullaveNative {
  isAvailable(): boolean;
  read(prompts: Record<string, string>): Promise<CardReading>;
  /** Solo Android: «on» = listo; «off» = el teléfono tiene NFC pero está apagado; «none» = no tiene. */
  nfcState?(): "on" | "off" | "none";
  /** Solo Android: deja de esperar la tarjeta (en iPhone la ventana del sistema ya trae su «Cancelar»). */
  cancel?(): void;
}

/** El módulo nativo, o `null` donde no existe (web, o una compilación que no lo incluyó). */
export const Tullave = requireOptionalNativeModule<TullaveNative>("Tullave");
