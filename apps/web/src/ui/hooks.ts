import { useEffect, useState, useSyncExternalStore } from "react";
import { transit } from "../composition-root";

/** Vuelve a pintar cuando llega un lote nuevo (ya viene limitado: un cambio por lote). */
export function useTransitVersion(): number {
  return useSyncExternalStore((fn) => transit.subscribe(fn), () => transit.version);
}
/** Reloj de pantalla: se actualiza cada segundo para que los tiempos «corran». */
export function useNow(ms = 1000): number {
  const [n, setN] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setN(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return n;
}
