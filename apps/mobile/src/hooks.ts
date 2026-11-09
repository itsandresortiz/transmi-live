import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useIsFocused } from "expo-router";
import { nowMs } from "./clock";
import { transit } from "./composition-root";

/** Vuelve a pintar cuando llega un lote nuevo de datos. Una pestaña que no se ve no se repinta: así no compite con la que sí. */
export function useTransitVersion(): number {
  const focused = useIsFocused();
  const subscribe = useCallback((onChange: () => void) => (focused ? transit.subscribe(onChange) : () => undefined), [focused]);
  return useSyncExternalStore(subscribe, () => transit.version);
}

/** Reloj de pantalla: se actualiza cada segundo para que los tiempos «corran» (solo en la pestaña que se ve). */
export function useNow(ms = 1000): number {
  const focused = useIsFocused();
  const [n, setN] = useState(() => nowMs());
  useEffect(() => {
    if (!focused) return;
    setN(nowMs());
    const t = setInterval(() => setN(nowMs()), ms);
    return () => clearInterval(t);
  }, [ms, focused]);
  return n;
}
