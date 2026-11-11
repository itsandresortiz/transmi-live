import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { type OwnerMessage, activeOwnerMessages, parseOwnerMessages } from "@transmi/domain";
import { CONFIG } from "../config";
import { nowMs } from "../clock";
import { useNow } from "./hooks";

/** Mensajes del dueño de la app (accidentes, manifestaciones, novedades propias). Se leen de `mensajes.json` del repositorio cada par de minutos. */
export const useMessages = create<{ all: OwnerMessage[] }>(() => ({ all: [] }));

async function refresh(): Promise<void> {
  try {
    const r = await fetch(`${CONFIG.messagesUrl}?t=${Math.floor(Date.now() / 60_000)}`, { cache: "no-store" });
    if (r.ok) useMessages.setState({ all: parseOwnerMessages(await r.json()) });
  } catch { /* sin conexión: se intenta en la próxima */ }
}

/** Arranca la lectura periódica (una sola vez, desde la raíz de la app). */
export function useMessagesPolling(): void {
  useEffect(() => {
    void refresh();
    const t = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 120_000);
    const vis = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, []);
}

/** Los mensajes que toca mostrar ahora (se revisa cada 15 s para que aparezcan y se quiten a su hora). */
export function useActiveMessages(): OwnerMessage[] {
  const all = useMessages((s) => s.all);
  const tick = Math.floor(useNow(15_000) / 15_000);
  return useMemo(() => activeOwnerMessages(all, nowMs() / 1000), [all, tick]);   // eslint-disable-line react-hooks/exhaustive-deps
}
