/**
 * En qué calle está cada semáforo de OpenStreetMap y hacia dónde mira (a qué tráfico le da la orden).
 *
 * En OpenStreetMap un semáforo suele ir puesto SOBRE la calle que controla, en la línea de pare. Con la calle se sabe el rumbo de esa
 * vía en ese punto; si la vía es de un solo sentido, o si el semáforo dice para qué sentido es (`traffic_signals:direction`), se sabe
 * además a qué sentido le habla. Con eso, un bus que va por esa misma vía le hace caso y uno que va por la vía que cruza, al revés.
 *
 * Salida (`<carpeta>/osm-calles.json`): { v, fecha, s: { "lon,lat": [rumbo°, sentidos (1 = uno solo, 2 = los dos), nombre, vías] } }
 *   - rumbo: hacia dónde va el tráfico que controla (0 = norte, 90 = oriente…); con 2 sentidos vale también rumbo+180.
 *   - vías: en cuántas calles está el punto (si son varias con distinto rumbo, es la esquina misma y no se sabe a cuál mira: no se publica).
 * Fuente: © colaboradores de OpenStreetMap (ODbL). Corre en GitHub (el contenedor de Claude no llega al servidor de consultas).
 * Uso: npx tsx tools/osm-calles.ts <carpeta>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv[2] ?? "dist-osm";
const Q = '[out:json][timeout:240];node["highway"="traffic_signals"](4.45,-74.25,4.85,-73.98)->.s;.s out body;way(bn.s)["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street|busway|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"];out tags geom;';
const SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

interface El { type: string; id: number; lat?: number; lon?: number; tags?: Record<string, string>; nodes?: number[]; geometry?: { lat: number; lon: number }[] }

async function fetchAll(): Promise<El[]> {
  let err: unknown = null;
  for (let k = 0; k < 6; k++) {
    if (k) await new Promise((r) => setTimeout(r, 20_000 * k));
    try {
      const r = await fetch(SERVERS[k % SERVERS.length]!, { method: "POST", body: new URLSearchParams({ data: Q }), headers: { "User-Agent": "transmi-live (datos abiertos)" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return ((await r.json()) as { elements: El[] }).elements;
    } catch (e) { err = e; console.warn("intento", k + 1, "falló:", e instanceof Error ? e.message : e); }
  }
  throw err;
}

const bearing = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  ((Math.atan2((b.lon - a.lon) * Math.cos((4.65 * Math.PI) / 180), b.lat - a.lat) * 180) / Math.PI + 360) % 360;
/** Diferencia entre dos rumbos de vía sin sentido (0–90). */
const axisDiff = (a: number, b: number) => { const d = Math.abs(a - b) % 180; return Math.min(d, 180 - d); };

async function main() {
  const els = await fetchAll();
  const nodes = els.filter((e) => e.type === "node"), ways = els.filter((e) => e.type === "way");
  const byNode = new Map<number, El[]>();
  for (const w of ways) for (const id of w.nodes ?? []) (byNode.get(id) ?? byNode.set(id, []).get(id)!).push(w);
  const s: Record<string, [number, 1 | 2, string, number]> = {};
  let corner = 0, none = 0;
  for (const n of nodes) {
    const ws = byNode.get(n.id) ?? [];
    if (!ws.length) { none++; continue; }
    const opts = ws.map((w) => {
      const i = w.nodes!.indexOf(n.id), g = w.geometry!;
      const a = g[Math.max(0, i - 1)]!, b = g[Math.min(g.length - 1, i + 1)]!;
      return { w, br: bearing(a, b) };
    });
    // en la esquina misma (vías con rumbos distintos) no se sabe a cuál mira
    if (opts.some((o) => axisDiff(o.br, opts[0]!.br) > 30)) { corner++; continue; }
    const { w, br } = opts[0]!;
    const dir = n.tags?.["traffic_signals:direction"] ?? n.tags?.direction ?? "", ow = w.tags?.oneway ?? "";
    let rumbo = br, sentidos: 1 | 2 = 2;
    if (dir === "forward") sentidos = 1;
    else if (dir === "backward") { rumbo = (br + 180) % 360; sentidos = 1; }
    else if (ow === "yes" || ow === "1" || w.tags?.junction === "roundabout") sentidos = 1;
    else if (ow === "-1") { rumbo = (br + 180) % 360; sentidos = 1; }
    s[`${n.lon!.toFixed(6)},${n.lat!.toFixed(6)}`] = [Math.round(rumbo), sentidos, w.tags?.name ?? w.tags?.ref ?? "", ws.length];
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "osm-calles.json"), JSON.stringify({ v: 1, fecha: new Date().toISOString().slice(0, 10), fuente: "© colaboradores de OpenStreetMap (ODbL)", s }));
  console.log(`semáforos: ${nodes.length}; con calle y rumbo: ${Object.keys(s).length}; en la esquina misma (sin saber a cuál mira): ${corner}; sin calle: ${none}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
