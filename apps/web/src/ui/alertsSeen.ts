import { create } from "zustand";
import type { ServiceAlert } from "@transmi/domain";
import { safeStorage } from "../storage";

const KEY = "tm.alerts-seen.v1";
/** Huella corta y estable de un aviso (su número cambia entre lotes; el contenido no). */
export function alertKey(a: ServiceAlert): string {
  const s = `${a.headline}|${a.description}|${a.effect}|${a.startsAt ?? ""}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
const load = (): string[] => {
  try { const j = JSON.parse(safeStorage.get(KEY) ?? "[]") as unknown; return Array.isArray(j) ? j.filter((x): x is string => typeof x === "string").slice(0, 500) : []; }
  catch { return []; }
};

interface Seen { seen: Set<string>; markSeen(alerts: readonly ServiceAlert[]): void }
/** Qué avisos ya vio este usuario (solo en este dispositivo). */
export const useAlertsSeen = create<Seen>((set, get) => ({
  seen: new Set(load()),
  markSeen: (alerts) => {
    const keys = alerts.map(alertKey);
    const cur = get().seen;
    if (keys.length === cur.size && keys.every((k) => cur.has(k))) return;
    const next = new Set(keys);          // se descartan los de avisos que ya vencieron
    set({ seen: next });
    safeStorage.set(KEY, JSON.stringify([...next]));
  },
}));
