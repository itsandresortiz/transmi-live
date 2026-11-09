import { useEffect, useState, useSyncExternalStore } from "react";
import { nowMs } from "./clock";
import { transit } from "./composition-root";

/** Vuelve a pintar cuando llega un lote nuevo de datos. */
export function useTransitVersion(): number {
  return useSyncExternalStore((onChange) => transit.subscribe(onChange), () => transit.version);
}

/** Reloj de pantalla: se actualiza cada segundo para que los tiempos «corran». */
export function useNow(ms = 1000): number {
  const [n, setN] = useState(() => nowMs());
  useEffect(() => { const t = setInterval(() => setN(nowMs()), ms); return () => clearInterval(t); }, [ms]);
  return n;
}
