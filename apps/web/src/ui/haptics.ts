/** Vibración muy corta al elegir algo (solo donde el aparato la permite; iPhone no la ofrece a las páginas web) y respetando «reducir movimiento». */
export function haptic(ms = 8): void {
  try {
    if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
    if (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    navigator.vibrate(ms);
  } catch { /* sin vibración */ }
}
