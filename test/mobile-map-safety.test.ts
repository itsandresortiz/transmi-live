import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { latest, validateStyleMin } from "@maplibre/maplibre-gl-style-spec";

/**
 * Lo que la app le pasa al mapa nativo (MapLibre en iPhone y Android, a través de @maplibre/maplibre-react-native).
 *
 * La 1.1.0 se cerraba al abrir (2026-11-27): una capa `hillshade` mandaba un solo color donde MapLibre iPhone 6.31 ya espera una lista
 * (y Android también). Nada de eso se ve en las pruebas ni en `expo export`: solo en el teléfono. Esta prueba obliga a que cada tipo de
 * capa y cada propiedad que usa la app esté en una lista revisada a mano contra el código nativo de las DOS plataformas
 * (`ios/components/layer/style/MLRNStyle.m` y `android/.../MLRNStyleFactory.kt` de la librería). Si agregas una propiedad nueva, revisa
 * allí qué tipo espera cada plataforma (un número, un color, una lista…) antes de sumarla aquí.
 */

const ROOT = join(__dirname, "..", "apps", "mobile");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?)$/.test(n) ? [p] : [];
  });
}
const SOURCES = [...files(join(ROOT, "src")), ...files(join(ROOT, "app"))].map((p) => ({ p, text: readFileSync(p, "utf8") }));

/** Tipos de capa revisados en las dos plataformas. NO agregar `hillshade` (cierra la app) ni capas de relieve. */
const LAYER_TYPES = new Set(["fill", "line", "symbol", "circle", "fill-extrusion"]);

/** Propiedades revisadas: en Android el tipo que lee la librería; en iPhone, la propiedad de MapLibre 6.31 acepta lo mismo.
 *  Las que piden lista en Android: text-font, text-variable-anchor, text-offset, line-dasharray, circle-translate, text-translate. */
const VERIFIED = new Set([
  "visibility",
  "line-width", "line-color", "line-join", "line-cap", "line-opacity", "line-dasharray", "line-sort-key",
  "circle-radius", "circle-color", "circle-blur", "circle-pitch-alignment", "circle-stroke-width", "circle-stroke-color", "circle-opacity", "circle-translate", "circle-stroke-opacity",
  "text-size", "text-font", "text-field", "text-color", "text-halo-width", "text-halo-color", "text-offset", "text-max-width", "text-anchor",
  "text-allow-overlap", "text-variable-anchor", "text-radial-offset", "text-optional", "text-justify", "text-ignore-placement",
  "text-translate", "text-opacity",
  "icon-size", "icon-image", "icon-ignore-placement", "icon-allow-overlap", "icon-rotation-alignment", "icon-rotate", "icon-opacity",
  "icon-pitch-alignment", "icon-color",
  "symbol-placement", "symbol-sort-key",
  "fill-color", "fill-opacity",
  "fill-extrusion-opacity", "fill-extrusion-height", "fill-extrusion-color", "fill-extrusion-base", "fill-extrusion-vertical-gradient",
]);

/** El código sin textos entre comillas ni comentarios (sus palabras y paréntesis confundirían la búsqueda). */
const bare = (t: string) => t.replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g, '""').replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "");
const kebab = (k: string) => k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

/** El texto dentro de cada `sp({ ... })` (con paréntesis balanceados). */
function spBlocks(text: string): string[] {
  const out: string[] = [];
  let i = text.indexOf("sp({");
  while (i >= 0) {
    let depth = 0, j = i + 2;
    for (; j < text.length; j++) { const ch = text[j]; if (ch === "(") depth++; else if (ch === ")") { if (depth === 0) break; depth--; } }
    out.push(text.slice(i + 3, j));
    i = text.indexOf("sp({", j);
  }
  return out;
}
/** Las claves de primer nivel de un objeto literal (las de dentro de expresiones son listas, no objetos, así que no se confunden). */
function topKeys(block: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  for (let i = 0; i < block.length; i++) {
    const ch = block[i]!;
    if ("{[(".includes(ch)) depth++;
    else if ("}])".includes(ch)) depth--;
    else if (depth === 1) {
      const m = /^([a-zA-Z][a-zA-Z0-9]*)\s*:/.exec(block.slice(i));
      // una clave va justo después de «{» o «,» (no de «?» de un «a ? b : c»)
      const prev = block.slice(0, i).trimEnd().slice(-1);
      if (m && (prev === "{" || prev === ",")) { keys.push(m[1]!); i += m[0].length - 1; }
    }
  }
  return keys;
}

describe("mapa de la app: solo capas y propiedades revisadas en iPhone y Android", () => {
  it("cada <Layer type=…> es de un tipo revisado (sin sombreado de relieve)", () => {
    const bad: string[] = [];
    for (const { p, text } of SOURCES) for (const m of text.matchAll(/<Layer\b[^>]*?\btype="([a-z-]+)"/g)) if (!LAYER_TYPES.has(m[1]!)) bad.push(`${p}: ${m[1]}`);
    expect(bad).toEqual([]);
    for (const { p, text } of SOURCES) expect(/RasterDEMSource|hillshade/i.test(text.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "")), p).toBe(false);
  });

  it("cada propiedad de estilo existe en la especificación y está en la lista revisada", () => {
    const spec = latest as unknown as Record<string, Record<string, unknown>>;
    const known = new Set<string>();
    for (const [k, v] of Object.entries(spec)) if (/^(paint|layout)_/.test(k)) for (const prop of Object.keys(v)) known.add(prop);
    const unknown: string[] = [], unverified: string[] = [];
    let count = 0;
    for (const { p, text } of SOURCES) for (const block of spBlocks(bare(text))) for (const key of topKeys(block)) {
      const prop = kebab(key);
      count++;
      if (!known.has(prop)) unknown.push(`${p}: ${prop}`);
      else if (!VERIFIED.has(prop)) unverified.push(`${p}: ${prop}`);
    }
    expect(count).toBeGreaterThan(50);      // la búsqueda encuentra las capas (si cambia la forma de escribirlas, esta prueba debe cambiar)
    expect(unknown).toEqual([]);
    expect(unverified).toEqual([]);
  });

  it("los dos mapas base de la app son estilos válidos y solo usan tipos de capa revisados", () => {
    for (const name of ["style-light.json", "style-dark.json"]) {
      const style = JSON.parse(readFileSync(join(ROOT, "src", "map", name), "utf8")) as { layers: { type: string }[] };
      expect(validateStyleMin(style as never).map((e) => e.message)).toEqual([]);
      for (const l of style.layers) expect(["background", "fill", "line", "symbol"]).toContain(l.type);
    }
  });
});
