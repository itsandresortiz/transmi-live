/**
 * Enlaces viales de Bogotá (retornos en U, orejas, giros: `highway=*_link` en OpenStreetMap), que no estaban en las calles del mapa de la
 * web (`apps/web/src/data/roads.json` solo traía vías principales, secundarias, residenciales…). Sin ellos, un retorno en U se veía solo
 * como la línea del recorrido del bus, sin calle debajo (lo notó el dueño en la Calle 145 frente al Portal Suba).
 *
 * Salida (`<carpeta>/enlaces.json`): en el mismo formato de `roads.json` ([lat×1e4, lon×1e4, Δlat, Δlon, …] por vía), por clase:
 * los enlaces de troncales y principales van como «tertiary» y los de secundarias y terciarias como «unclassified» (se ven un poco más
 * angostos que la vía de la que salen). Fuente: © colaboradores de OpenStreetMap (ODbL). Corre en GitHub (desde el contenedor de Claude
 * el servidor de consultas corta la conexión).
 * Uso: npx tsx tools/osm-enlaces.ts <carpeta>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv[2] ?? "dist-osm";
const Q = '[out:json][timeout:180];way["highway"~"^(motorway|trunk|primary|secondary|tertiary)_link$"](4.45,-74.25,4.85,-73.98);out tags geom;';
const SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
interface Way { tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }

async function main() {
  let ways: Way[] = [], err: unknown = null;
  for (let k = 0; k < 6 && !ways.length; k++) {
    if (k) await new Promise((r) => setTimeout(r, 20_000 * k));
    try {
      const r = await fetch(SERVERS[k % SERVERS.length]!, { method: "POST", body: new URLSearchParams({ data: Q }), headers: { "User-Agent": "transmi-live (datos abiertos)" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      ways = ((await r.json()) as { elements: Way[] }).elements;
    } catch (e) { err = e; console.warn("intento", k + 1, "falló:", e instanceof Error ? e.message : e); }
  }
  if (!ways.length) throw err ?? new Error("sin enlaces");
  const out: Record<string, number[][]> = { tertiary: [], unclassified: [] };
  for (const w of ways) {
    const g = w.geometry ?? [];
    if (g.length < 2) continue;
    const cls = /^(motorway|trunk|primary)_link$/.test(w.tags?.highway ?? "") ? "tertiary" : "unclassified";
    const pts = g.map((p) => [Math.round(p.lat * 1e4), Math.round(p.lon * 1e4)] as const).filter((p, i, a) => i === 0 || p[0] !== a[i - 1]![0] || p[1] !== a[i - 1]![1]);
    if (pts.length < 2) continue;
    const e = [pts[0]![0], pts[0]![1]];
    for (let i = 1; i < pts.length; i++) e.push(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
    out[cls]!.push(e);
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "enlaces.json"), JSON.stringify(out));
  console.log(`enlaces: ${ways.length} (como terciarias ${out.tertiary!.length}, como menores ${out.unclassified!.length})`);
}
main().catch((e) => { console.error(e); process.exit(1); });
