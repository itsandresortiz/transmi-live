/**
 * Empaqueta el núcleo (packages/*) en un solo archivo para la función de Supabase `viajes` (Deno no resuelve las rutas sin extensión
 * de los paquetes). Uso: `npx tsx tools/edge-core.ts` → `supabase/functions/_compartido/nucleo.js`. Hay que repetirlo (y volver a
 * desplegar la función) cuando cambie el cálculo de llegadas; la prueba `test/edge-core.test.ts` avisa si quedó viejo.
 */
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const CORE_OUT = `${ROOT}supabase/functions/_compartido/nucleo.js`;

export async function bundleCore(): Promise<string> {
  const r = await build({
    entryPoints: [`${ROOT}supabase/functions/_compartido/nucleo-entrada.ts`], bundle: true, format: "esm", platform: "neutral",
    target: "es2022", write: false, legalComments: "none", minify: false, treeShaking: true, mainFields: ["module", "main"],
    tsconfigRaw: "{}", logLevel: "silent",
    // el servidor lee la red ya procesada (network2.json.gz), nunca el GTFS en zip: JSZip (que pide módulos de Node) no se incluye
    plugins: [{ name: "sin-jszip", setup(b) {
      b.onResolve({ filter: /^jszip$/ }, () => ({ path: "jszip", namespace: "vacio" }));
      b.onLoad({ filter: /.*/, namespace: "vacio" }, () => ({ contents: "export default {};", loader: "js" }));
    } }],
  });
  // sin rutas de esta máquina en el archivo (cambian de un computador a otro y la huella no cuadraría)
  return r.outputFiles[0]!.text.split(ROOT).join("");
}
export const coreHash = (code: string): string => createHash("sha256").update(code).digest("hex").slice(0, 16);
export const coreHeader = (hash: string): string => `// GENERADO por tools/edge-core.ts: no editar a mano. huella ${hash}\n`;

if (process.argv[1]?.endsWith("edge-core.ts")) {
  const code = await bundleCore();
  writeFileSync(CORE_OUT, coreHeader(coreHash(code)) + code);
  console.log(`${CORE_OUT}: ${(readFileSync(CORE_OUT).length / 1024).toFixed(0)} KB`);
}
