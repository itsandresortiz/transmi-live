/**
 * Convierte el GTFS reducido (gtfs-lite.zip, ~17 MB de tablas) en la red ya procesada que usa la app (network.json.gz, ~2 MB):
 * rutas, paradas y trazados listos, con las coordenadas a 5 decimales (~1 m). Así el teléfono no tiene que descomprimir y leer
 * 50 MB de texto al abrir: baja mucho menos y arranca varias veces más rápido, sobre todo en teléfonos modestos.
 *
 * Escribe también `network2.json.gz` al lado (formato compacto, ver `compact.ts`): lo leen las apps nuevas; el de siempre queda para las viejas.
 *
 * Uso: npx tsx tools/network-dto.ts <gtfs-lite.zip> <network.json.gz>     (lo corre el workflow «GTFS diario»)
 *      CORRECCIONES=<stop-fixes.json> …   aplica también el orden de paradas aprendido de los buses (`tools/stoporder.ts`)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { applyStopPatches, applyTempStopChanges, compactNetwork, parseGtfsLite } from "@transmi/infrastructure";
import { applyLearnedStopFixes, type LearnedStopFix } from "@transmi/application";

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error("Uso: npx tsx tools/network-dto.ts <gtfs-lite.zip> <network.json.gz>"); process.exit(1); }
const r5 = (n: number) => Math.round(n * 1e5) / 1e5;

void (async () => {
  const dto = await parseGtfsLite(new Uint8Array(readFileSync(src)).buffer as ArrayBuffer);
  // las correcciones y los cierres temporales de hoy van ya aplicados: así les llegan también a las apps publicadas (que traen la lista vieja)
  applyStopPatches(dto);
  // orden de paradas aprendido de los buses (solo correcciones con evidencia fuerte; cada una se apaga sola si el GTFS ya cambió)
  const fx = process.env.CORRECCIONES;
  if (fx && existsSync(fx)) {
    try {
      const file = JSON.parse(readFileSync(fx, "utf8")) as { use?: boolean; fixes?: LearnedStopFix[] };
      // mientras el archivo no diga `use: true` (lo decide el dueño tras revisar lo que proponen los buses) solo se recolecta: no se corrige nada
      const fixes = file.use === true ? file.fixes ?? [] : [];
      if (file.use !== true && file.fixes?.length) console.log(`orden aprendido: ${file.fixes.length} corrección(es) propuestas, sin aplicar (use: false)`);
      const names = new Map(dto.routes.map((r) => [r.id, r.shortName])), known = new Set(dto.stops.map((s) => s.id));
      for (const f of applyLearnedStopFixes(dto.shapes, (id) => names.get(id), (id) => known.has(id), fixes)) console.log(`orden aprendido: ${f.why}`);
    } catch (e) { console.log("correcciones aprendidas ilegibles, se ignoran:", (e as Error).message); }
  }
  for (const c of applyTempStopChanges(dto)) console.log(`cambio temporal: ${c.route} ${c.stop}${c.replaceWith ? ` → ${c.replaceWith}` : " (se salta)"}`);
  for (const s of dto.stops) { s.lat = r5(s.lat); s.lon = r5(s.lon); }
  for (const sh of dto.shapes) sh.pts = sh.pts.map(r5);
  const gz = gzipSync(JSON.stringify({ v: 1, ...dto }), { level: 9 });
  writeFileSync(out, gz);
  const gz2 = gzipSync(JSON.stringify(compactNetwork(dto)), { level: 9 }), out2 = out.replace(/network\.json\.gz$/, "network2.json.gz");
  if (out2 !== out) { writeFileSync(out2, gz2); console.log(`${out2}: ${(gz2.length / 1e6).toFixed(2)} MB (formato compacto)`); }
  console.log(`${out}: ${dto.routes.length} rutas, ${dto.stops.length} paradas, ${dto.shapes.length} trazados, ${(gz.length / 1e6).toFixed(2)} MB`);
})();
