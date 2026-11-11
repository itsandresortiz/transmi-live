import { useMemo } from "react";
import { create } from "zustand";
import { type OwnerMessage, activeOwnerMessages, parseOwnerMessages } from "@transmi/domain";
import { CONFIG } from "./config";
import { nowMs } from "./clock";
import { useNow } from "./hooks";

/** Mensajes del dueño de la app (accidentes, manifestaciones, novedades propias). Se leen de `mensajes.json` del repositorio cada par de minutos. */
export const useMessages = create<{ all: OwnerMessage[] }>(() => ({ all: [] }));

let busy = false;
export async function refreshMessages(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const r = await fetch(`${CONFIG.messagesUrl}?t=${Math.floor(Date.now() / 60_000)}`, { cache: "no-store" });
    // si falla la consulta se deja lo que había: los que ya vencieron se dejan de mostrar solos por su hora
    if (r.ok) useMessages.setState({ all: parseOwnerMessages(await r.json()) });
  } catch { /* sin conexión: se intenta en la próxima */ } finally { busy = false; }
}

/** Los mensajes que toca mostrar ahora (se revisa cada 15 s para que aparezcan y se quiten a su hora). */
export function useActiveMessages(): OwnerMessage[] {
  const all = useMessages((s) => s.all);
  const tick = Math.floor(useNow(15_000) / 15_000);
  return useMemo(() => activeOwnerMessages(all, nowMs() / 1000), [all, tick]);   // eslint-disable-line react-hooks/exhaustive-deps
}
