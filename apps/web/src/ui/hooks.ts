import { startTransition, useEffect, useState } from "react";
import { nowMs } from "../clock";
import { transit } from "../composition-root";

/** Vuelve a pintar cuando llega un lote nuevo, pero sin bloquear el movimiento: React lo hace por tandas y cede el paso a los cuadros del mapa. */
export function useTransitVersion(): number {
  const [v, setV] = useState(transit.version);
  useEffect(() => {
    let raf = 0;
    const off = transit.subscribe(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; startTransition(() => setV(transit.version)); });
    });
    setV(transit.version);
    return () => { off(); if (raf) cancelAnimationFrame(raf); };
  }, []);
  return v;
}
/** Reloj de pantalla: se actualiza cada segundo para que los tiempos «corran». */
export function useNow(ms = 1000): number {
  const [n, setN] = useState(() => nowMs());
  useEffect(() => { const t = setInterval(() => setN(nowMs()), ms); return () => clearInterval(t); }, [ms]);
  return n;
}
