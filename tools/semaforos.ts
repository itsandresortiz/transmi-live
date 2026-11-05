/**
 * Descarga la red semafórica de Bogotá (datos abiertos de la Secretaría Distrital de Movilidad, licencia CC BY 4.0)
 * y la guarda como un archivo pequeño para la app: `<carpeta>/semaforos.json`.
 *
 * Fuente: https://sig.simur.gov.co/arcgis/rest/services/DatosAbiertos/RedSemaforica/FeatureServer/0
 * Formato: { v, at, rows: [[lon, lat, dirección, localidad, tipo], …] }
 * Uso: npx tsx tools/semaforos.ts <carpeta_dist>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv[2] ?? "apps/web/dist";
const BASE = "https://sig.simur.gov.co/arcgis/rest/services/DatosAbiertos/RedSemaforica/FeatureServer/0/query";
const PAGE = 1000;

interface Feat { geometry?: { coordinates?: [number, number] }; properties?: Record<string, unknown> }

async function main() {
  const rows: [number, number, string, string, string][] = [];
  for (let offset = 0; offset < 20_000; offset += PAGE) {
    const q = new URLSearchParams({
      where: "1=1", outFields: "DIRECCION,LOCALIDAD,TIPOINTERSECCION", outSR: "4326", f: "geojson",
      resultOffset: String(offset), resultRecordCount: String(PAGE), orderByFields: "OBJECTID",
    });
    const r = await fetch(`${BASE}?${q}`, { headers: { "User-Agent": "Mozilla/5.0 (transmi-live)" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = (await r.json()) as { features?: Feat[] };
    const fs = j.features ?? [];
    for (const f of fs) {
      const c = f.geometry?.coordinates; if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
      const p = f.properties ?? {};
      rows.push([Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5, String(p.DIRECCION ?? "").trim(), String(p.LOCALIDAD ?? "").trim(), String(p.TIPOINTERSECCION ?? "").trim()]);
    }
    if (fs.length < PAGE) break;
  }
  if (rows.length < 500) throw new Error(`Muy pocos semáforos (${rows.length}); no se publica`);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "semaforos.json"), JSON.stringify({ v: 1, at: new Date().toISOString().slice(0, 10), rows }));
  console.log(`Semáforos: ${rows.length}`);
}
main().catch((e) => { console.warn("Semáforos: no se generó el archivo:", e instanceof Error ? e.message : e); });
