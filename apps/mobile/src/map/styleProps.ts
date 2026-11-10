/** La librería del mapa ya no acepta `style` en las capas: pide `paint` (cómo se pinta) y `layout` (cómo se coloca), con los nombres de la especificación de estilos (con guiones). Esto reparte un estilo en ambos. */
const kebab = (k: string) => k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
const PAINT_ICON_TEXT = new Set(["icon-color", "icon-opacity", "icon-halo-color", "icon-halo-width", "icon-halo-blur", "icon-translate", "icon-translate-anchor", "text-color", "text-opacity", "text-halo-color", "text-halo-width", "text-halo-blur", "text-translate", "text-translate-anchor"]);
const isLayout = (k: string) => k === "visibility" || k.endsWith("-sort-key") || /^(line-(cap|join|miter-limit|round-limit)|symbol-)/.test(k) || ((k.startsWith("icon-") || k.startsWith("text-")) && !PAINT_ICON_TEXT.has(k));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sp(style: Record<string, unknown>): { paint: any; layout: any } {
  const paint: Record<string, unknown> = {}, layout: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(style)) { const kk = kebab(k); (isLayout(kk) ? layout : paint)[kk] = v; }
  return { paint, layout };
}
