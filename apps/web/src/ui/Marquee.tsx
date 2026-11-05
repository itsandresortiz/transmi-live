import { type ReactNode, useLayoutEffect, useRef } from "react";

/** Texto de una sola línea: si no cabe, se desplaza despacio de un lado a otro para poder leerlo completo (y se queda quieto si el aparato pide menos movimiento). */
export function Marquee({ children }: { children: ReactNode }) {
  const box = useRef<HTMLSpanElement>(null), inner = useRef<HTMLSpanElement>(null);
  const last = useRef(-1);
  const measure = () => {
    const b = box.current, i = inner.current; if (!b || !i) return;
    const shift = Math.max(0, Math.ceil(i.scrollWidth - b.clientWidth));
    const on = shift > 4;
    if (Math.abs(shift - last.current) < 3 && (on === (last.current > 4))) return;     // el texto cambia cada segundo: no se reinicia la animación por unos píxeles
    last.current = shift;
    b.classList.toggle("on", on);
    b.style.setProperty("--shift", `${shift}px`);
    b.style.setProperty("--dur", `${Math.max(7, (shift / 22) * 2 + 4)}s`);
  };
  useLayoutEffect(measure);
  useLayoutEffect(() => {
    const b = box.current; if (!b || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure); ro.observe(b);
    return () => ro.disconnect();
  }, []);
  return <span className="mq" ref={box}><span className="mqi" ref={inner}>{children}</span></span>;
}
