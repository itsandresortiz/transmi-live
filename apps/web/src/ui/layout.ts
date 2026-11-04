/** En pantallas anchas el panel va a un lado en vez de abajo. */
export const advanced = () => window.matchMedia("(min-width:900px)").matches;
export function mapPadding(): { top: number; bottom: number; left: number; right: number } {
  if (advanced()) return { top: 90, bottom: 50, left: 450, right: 70 };
  const vis = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--vis")) || 152;
  return { top: 90, bottom: vis + 24, left: 36, right: 36 };
}
