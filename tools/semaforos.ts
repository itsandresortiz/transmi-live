/**
 * Descarga la red semafórica de Bogotá (datos abiertos de la Secretaría Distrital de Movilidad, licencia CC BY 4.0)
 * y la guarda como un archivo pequeño para la app: `<carpeta>/semaforos.json`.
 *
 * Fuente: https://sig.simur.gov.co/arcgis/rest/services/DatosAbiertos/RedSemaforica/FeatureServer/0
 * Formato: { v, at, rows: [[lon, lat, dirección, localidad, tipo, carros, TransMilenio, peatones, bicis, fases, operación], …] }
 * Cada punto es un CRUCE (un controlador), no cada semáforo: las cifras dicen cuántos grupos de señal tiene para cada uno.
 * Posición de cada semáforo (índice 11, `[[lon, lat, "c" carros | "t" TransMilenio], …]`): Movilidad no la publica, así que se toma de
 * OpenStreetMap (© colaboradores de OpenStreetMap, ODbL): los nodos `highway=traffic_signals` a ≤ 60 m del cruce, hasta el número
 * oficial de semáforos para carros + TransMilenio (primero los que tienen sentido marcado, que suelen estar en la línea de pare). El más
 * pegado al eje de la troncal (≤ 15 m) es el de TransMilenio. Si OpenStreetMap no tiene nada, queda solo el punto del cruce.
 * Uso: npx tsx tools/semaforos.ts <carpeta_dist>
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CORRIDORS, countSignalGroups } from "@transmi/application";

const OUT = process.argv[2] ?? "apps/web/dist";
const BASE = "https://sig.simur.gov.co/arcgis/rest/services/DatosAbiertos/RedSemaforica/FeatureServer/0/query";
const PAGE = 1000;

interface Feat { geometry?: { coordinates?: [number, number] }; properties?: Record<string, unknown> }

async function main() {
  type Head = [number, number, "c" | "t"];
  const rows: [number, number, string, string, string, number, number, number, number, number, string, Head[]?][] = [];
  for (let offset = 0; offset < 20_000; offset += PAGE) {
    const q = new URLSearchParams({
      where: "1=1", outFields: "DIRECCION,LOCALIDAD,TIPOINTERSECCION,GRUPOSVEHICULARES,GRUPOS_BRT,GRUPOSPEATONALES,GRUPOSCICLISTAS,NUMEROFASES,OPERACIONACTUAL", outSR: "4326", f: "geojson",
      resultOffset: String(offset), resultRecordCount: String(PAGE), orderByFields: "OBJECTID",
    });
    const r = await fetch(`${BASE}?${q}`, { headers: { "User-Agent": "Mozilla/5.0 (transmi-live)" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = (await r.json()) as { features?: Feat[] };
    const fs = j.features ?? [];
    for (const f of fs) {
      const c = f.geometry?.coordinates; if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
      const p = f.properties ?? {};
      rows.push([Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5, String(p.DIRECCION ?? "").trim(), String(p.LOCALIDAD ?? "").trim(), String(p.TIPOINTERSECCION ?? "").trim(),
        countSignalGroups(p.GRUPOSVEHICULARES), countSignalGroups(p.GRUPOS_BRT), countSignalGroups(p.GRUPOSPEATONALES), countSignalGroups(p.GRUPOSCICLISTAS), Number(p.NUMEROFASES) || 0, String(p.OPERACIONACTUAL ?? "").trim()]);
    }
    if (fs.length < PAGE) break;
  }
  if (rows.length < 500) throw new Error(`Muy pocos semáforos (${rows.length}); no se publica`);
  const placed = await placeHeads(rows).catch((e) => { console.warn("Semáforos: sin posiciones de OpenStreetMap:", e instanceof Error ? e.message : e); return 0; });
  console.log(`Semáforos con posición: ${placed}`);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "semaforos.json"), JSON.stringify({ v: 2, at: new Date().toISOString().slice(0, 10), rows }));
  console.log(`Semáforos: ${rows.length}`);
}
/** Metros entre dos puntos (aproximado, suficiente dentro de Bogotá). */
const meters = (lon1: number, lat1: number, lon2: number, lat2: number) => Math.hypot((lon1 - lon2) * 111_320 * Math.cos((4.65 * Math.PI) / 180), (lat1 - lat2) * 110_570);
/** Distancia de un punto al eje de la troncal más cercano. */
function toTrunk(lon: number, lat: number): number {
  let best = Infinity;
  for (const c of CORRIDORS) for (let i = 1; i < c.p.length; i++) {
    const [la1, lo1] = c.p[i - 1]!, [la2, lo2] = c.p[i]!;
    if (Math.min(la1, la2) - 0.001 > lat || Math.max(la1, la2) + 0.001 < lat || Math.min(lo1, lo2) - 0.001 > lon || Math.max(lo1, lo2) + 0.001 < lon) continue;
    const kx = 111_320 * Math.cos((4.65 * Math.PI) / 180), ky = 110_570;
    const ax = (lo2 - lo1) * kx, ay = (la2 - la1) * ky, px = (lon - lo1) * kx, py = (lat - la1) * ky;
    const t = Math.max(0, Math.min(1, (px * ax + py * ay) / (ax * ax + ay * ay || 1)));
    best = Math.min(best, Math.hypot(px - t * ax, py - t * ay));
  }
  return best;
}

/** Pone a cada cruce sus semáforos de carros y TransMilenio con la posición de OpenStreetMap. Devuelve cuántos semáforos ubicó. */
async function placeHeads(rows: [number, number, string, string, string, number, number, number, number, number, string, [number, number, "c" | "t"][]?][]): Promise<number> {
  const q = '[out:json][timeout:120];node["highway"="traffic_signals"](4.45,-74.25,4.85,-73.98);out body;';
  // el servicio de consultas de OpenStreetMap a veces corta o pide esperar: hasta 4 intentos con espera creciente
  let nodes: { lat: number; lon: number; tags?: Record<string, string> }[] = [], err: unknown = null;
  // para probar sin red: SEMAFOROS_OSM=<archivo .json de Overpass ya descargado>
  if (process.env.SEMAFOROS_OSM) nodes = (JSON.parse(readFileSync(process.env.SEMAFOROS_OSM, "utf8")) as { elements: typeof nodes }).elements.filter((n) => n.tags?.highway === "traffic_signals");
  for (let k = 0; k < 4 && !nodes.length; k++) {
    if (k) await new Promise((res) => setTimeout(res, 15_000 * k));
    try {
      const r = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: new URLSearchParams({ data: q }), headers: { "User-Agent": "transmi-live (datos abiertos)" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      nodes = ((await r.json()) as { elements?: typeof nodes }).elements ?? [];
    } catch (e) { err = e; }
  }
  if (!nodes.length && err) throw err;
  if (nodes.length < 1000) throw new Error(`muy pocos nodos (${nodes.length})`);
  const grid = new Map<string, number[]>(), key = (lon: number, lat: number) => `${Math.floor(lon / 0.001)},${Math.floor(lat / 0.001)}`;
  nodes.forEach((n, i) => { const k = key(n.lon, n.lat); (grid.get(k) ?? grid.set(k, []).get(k)!).push(i); });
  const taken = new Set<number>();
  let placed = 0;
  for (const row of rows) {
    const want = row[5] + row[6];
    if (!want) continue;
    const cx = Math.floor(row[0] / 0.001), cy = Math.floor(row[1] / 0.001), near: { i: number; d: number; dir: boolean }[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const i of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
      if (taken.has(i)) continue;
      const n = nodes[i]!, d = meters(row[0], row[1], n.lon, n.lat);
      if (d <= 60) near.push({ i, d, dir: !!(n.tags?.["traffic_signals:direction"] || n.tags?.direction) });
    }
    if (!near.length) continue;
    // primero los que tienen sentido marcado (en la línea de pare), luego los más cercanos al cruce
    near.sort((a, b) => Number(b.dir) - Number(a.dir) || a.d - b.d);
    const pick = near.slice(0, want);
    pick.forEach((p) => taken.add(p.i));
    const heads: [number, number, "c" | "t"][] = pick.map((p) => [Math.round(nodes[p.i]!.lon * 1e6) / 1e6, Math.round(nodes[p.i]!.lat * 1e6) / 1e6, "c"]);
    // los de TransMilenio: los más pegados al eje de la troncal
    if (row[6] > 0) heads.map((h, k) => ({ k, d: toTrunk(h[0], h[1]) })).filter((x) => x.d <= 15).sort((a, b) => a.d - b.d).slice(0, row[6]).forEach((x) => { heads[x.k]![2] = "t"; });
    row[11] = heads;
    placed += heads.length;
  }
  return placed;
}

main().catch((e) => { console.warn("Semáforos: no se generó el archivo:", e instanceof Error ? e.message : e); });
