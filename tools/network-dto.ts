/**
 * Convierte el GTFS reducido (gtfs-lite.zip, ~17 MB de tablas) en la red ya procesada que usa la app (network.json.gz, ~2 MB):
 * rutas, paradas y trazados listos, con las coordenadas a 5 decimales (~1 m). Así el teléfono no tiene que descomprimir y leer
 * 50 MB de texto al abrir: baja mucho menos y arranca varias veces más rápido, sobre todo en teléfonos modestos.
 *
 * Uso: npx tsx tools/network-dto.ts <gtfs-lite.zip> <network.json.gz>     (lo corre el workflow «GTFS diario»)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { parseGtfsLite } from "@transmi/infrastructure";

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error("Uso: npx tsx tools/network-dto.ts <gtfs-lite.zip> <network.json.gz>"); process.exit(1); }
const r5 = (n: number) => Math.round(n * 1e5) / 1e5;

void (async () => {
  const dto = await parseGtfsLite(new Uint8Array(readFileSync(src)).buffer as ArrayBuffer);
  for (const s of dto.stops) { s.lat = r5(s.lat); s.lon = r5(s.lon); }
  for (const sh of dto.shapes) sh.pts = sh.pts.map(r5);
  const gz = gzipSync(JSON.stringify({ v: 1, ...dto }), { level: 9 });
  writeFileSync(out, gz);
  console.log(`${out}: ${dto.routes.length} rutas, ${dto.stops.length} paradas, ${dto.shapes.length} trazados, ${(gz.length / 1e6).toFixed(2)} MB`);
})();
