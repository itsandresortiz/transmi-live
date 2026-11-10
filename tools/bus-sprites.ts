/**
 * Genera las imágenes de los buses para la app: vistos desde arriba (apps/mobile/assets/sprites-top, para el mapa)
 * y en 3/4 desde atrás (apps/mobile/assets/sprites-rear, para la escena del viaje; dibujo en tools/bus-rear-draw.js).
 * Usa el mismo dibujo que la web (apps/web/src/map/busTop.ts), renderizado en un navegador.
 * Uso: npx tsx tools/bus-sprites.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { createRequire } from "node:module";
// Playwright (un navegador sin pantalla) solo hace falta para regenerar las imágenes; no es una dependencia de la app
const { chromium } = createRequire(import.meta.url)("playwright") as typeof import("playwright");

const SRC = readFileSync("apps/web/src/map/busTop.ts", "utf8");
const js = transformSync(SRC, { loader: "ts", format: "iife", globalName: "BT" }).code;
const OUT = "apps/mobile/assets/sprites-top";
const COLORS: Record<string, string> = { troncal: "#e11d2e", dual: "#8a45d6", alimentador: "#12945f", zonal: "#1f6fd1", otro: "#8e8e93" };
const RATIO = 6;

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch(), page = await browser.newPage();
  await page.setContent("<canvas id=c></canvas>");
  await page.addScriptTag({ content: js });
  for (const [system, color] of Object.entries(COLORS)) for (const long of [false, true]) {
    const url = await page.evaluate(({ color, long, RATIO }) => {
      // @ts-expect-error BT lo define el script
      const { TOP_W, TOP_H, TOP_LONG_H, drawTopBus } = BT;
      const cv = document.getElementById("c") as HTMLCanvasElement, H = long ? TOP_LONG_H : TOP_H;
      cv.width = Math.round(TOP_W * RATIO); cv.height = Math.round(H * RATIO);
      const c = cv.getContext("2d")!; c.clearRect(0, 0, cv.width, cv.height);
      c.scale(RATIO, RATIO); c.translate(TOP_W / 2, H / 2);
      drawTopBus(c, color, long, RATIO);
      return cv.toDataURL("image/png");
    }, { color, long, RATIO });
    writeFileSync(`${OUT}/top-${system}-${long ? "l" : "s"}.png`, Buffer.from(url.split(",")[1]!, "base64"));
  }
  // buses en 3/4 desde atrás (escena de «Voy en este bus»)
  const REAR = "apps/mobile/assets/sprites-rear";
  mkdirSync(REAR, { recursive: true });
  await page.addScriptTag({ content: readFileSync("tools/bus-rear-draw.js", "utf8") });
  for (const [system, color] of Object.entries(COLORS)) for (const long of [false, true]) {
    const url = await page.evaluate(({ color, long }) => {
      const cv = document.getElementById("c") as HTMLCanvasElement, R = 4;
      cv.width = 120 * R; cv.height = (long ? 250 : 190) * R;
      const c = cv.getContext("2d")!; c.clearRect(0, 0, cv.width, cv.height); c.scale(R, R);
      // @ts-expect-error drawRearBus lo define el script
      drawRearBus(c, color, long);
      return cv.toDataURL("image/png");
    }, { color, long });
    writeFileSync(`${REAR}/rear-${system}-${long ? "l" : "s"}.png`, Buffer.from(url.split(",")[1]!, "base64"));
  }
  await browser.close();
  console.log("Imágenes listas en", OUT);
}
void main();
