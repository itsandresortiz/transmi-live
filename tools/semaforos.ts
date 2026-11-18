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
 * Uso: npx tsx tools/semaforos.ts <carpeta_dist>     (ACTUALIZAR_OSM=1 para volver a pedir las posiciones a OpenStreetMap)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CORRIDORS, countSignalGroups } from "@transmi/application";

const OUT = process.argv[2] ?? "apps/web/dist";
const BASE = "https://sig.simur.gov.co/arcgis/rest/services/DatosAbiertos/RedSemaforica/FeatureServer/0/query";
const PAGE = 1000;
/** Copia guardada de los semáforos de OpenStreetMap (se actualiza a mano con ACTUALIZAR_OSM=1). */
const SAVED = join(process.cwd(), "tools/data/osm-semaforos.json");

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
  let placed = await placeHeads(rows).catch((e) => { console.warn("Semáforos: sin posiciones de OpenStreetMap:", e instanceof Error ? e.message : e); return 0; });
  // OpenStreetMap a veces frena las consultas seguidas (cada publicación de la web hace una): si no respondió, se reutilizan las
  // posiciones de la versión ya publicada, cruce por cruce, para no dejar el mapa con un solo punto por cruce
  if (!placed) placed = await reuseHeads(rows).catch((e) => { console.warn("Semáforos: tampoco se pudieron reutilizar las posiciones publicadas:", e instanceof Error ? e.message : e); return 0; });
  placed += addManual(rows);
  console.log(`Semáforos con posición: ${placed}`);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "semaforos.json"), JSON.stringify({ v: 2, at: new Date().toISOString().slice(0, 10), rows }));
  console.log(`Semáforos: ${rows.length}`);
}
/** Semáforos que el dueño vio en la calle y que no tiene ninguna fuente (`tools/data/semaforos-manuales.json`): se suman al cruce oficial
 *  más cercano (≤120 m) o, si no hay, van como un punto propio. Devuelve cuántos agregó. */
function addManual(rows: [number, number, string, string, string, number, number, number, number, number, string, [number, number, "c" | "t"][]?][]): number {
  const file = join(process.cwd(), "tools/data/semaforos-manuales.json");
  if (!existsSync(file)) return 0;
  const list = (JSON.parse(readFileSync(file, "utf8")) as { semaforos?: { lat: number; lon: number; tipo?: string }[] }).semaforos ?? [];
  let n = 0;
  for (const m of list) {
    if (!Number.isFinite(m.lat) || !Number.isFinite(m.lon)) continue;
    const head: [number, number, "c" | "t"] = [m.lon, m.lat, m.tipo === "t" ? "t" : "c"];
    let best: (typeof rows)[number] | null = null, bd = 120;
    for (const r of rows) { const d = meters(r[0], r[1], m.lon, m.lat); if (d < bd && r[10] !== "OSM") { bd = d; best = r; } }
    if (best) {
      const heads = best[11] ?? [];
      if (!heads.some((h) => meters(h[0], h[1], m.lon, m.lat) < 3)) { heads.push(head); best[11] = heads; n++; }
    } else { rows.push([Math.round(m.lon * 1e5) / 1e5, Math.round(m.lat * 1e5) / 1e5, "", "", "", head[2] === "c" ? 1 : 0, head[2] === "t" ? 1 : 0, 0, 0, 0, "OSM", [head]]); n++; }
  }
  console.log(`Semáforos puestos a mano: ${n}`);
  return n;
}
/** Copia las posiciones de cada semáforo desde el archivo ya publicado (mismo cruce = misma dirección y casi el mismo punto). */
async function reuseHeads(rows: [number, number, string, string, string, number, number, number, number, number, string, [number, number, "c" | "t"][]?][]): Promise<number> {
  const r = await fetch(process.env.SEMAFOROS_PUBLICADO ?? "https://transmilive.com/semaforos.json", { headers: { "User-Agent": "transmi-live (datos abiertos)" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const old = ((await r.json()) as { rows?: unknown[][] }).rows ?? [];
  const byKey = new Map<string, [number, number, "c" | "t"][]>();
  for (const o of old) if (Array.isArray(o[11]) && o[11].length) byKey.set(`${o[2]}|${Number(o[0]).toFixed(4)},${Number(o[1]).toFixed(4)}`, o[11] as [number, number, "c" | "t"][]);
  let n = 0;
  for (const row of rows) { const h = byKey.get(`${row[2]}|${row[0].toFixed(4)},${row[1].toFixed(4)}`); if (h) { row[11] = h; n += h.length; } }
  console.log(`Semáforos: reutilizadas ${n} posiciones de la versión publicada`);
  return n;
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
  // de dónde salen las posiciones: (1) SEMAFOROS_OSM=<archivo de Overpass> para probar; (2) la copia guardada en el proyecto
  // (`tools/data/osm-semaforos.json`), que es lo normal: así cada publicación usa siempre las mismas y no depende de que OpenStreetMap
  // responda; (3) con ACTUALIZAR_OSM=1 se piden de nuevo a OpenStreetMap (y se guarda la copia nueva para subirla al repositorio)
  if (process.env.SEMAFOROS_OSM) nodes = (JSON.parse(readFileSync(process.env.SEMAFOROS_OSM, "utf8")) as { elements: typeof nodes }).elements.filter((n) => n.tags?.highway === "traffic_signals");
  else if (process.env.ACTUALIZAR_OSM !== "1" && existsSync(SAVED)) {
    const saved = JSON.parse(readFileSync(SAVED, "utf8")) as { nodos: [number, number, number][] };
    nodes = saved.nodos.map(([lon, lat, dir]) => ({ lon, lat, tags: dir ? { "traffic_signals:direction": "si" } : {} }));
    console.log(`Semáforos: posiciones guardadas de OpenStreetMap (${nodes.length} nodos)`);
  }
  for (let k = 0; k < 4 && !nodes.length; k++) {
    if (k) await new Promise((res) => setTimeout(res, 15_000 * k));
    try {
      const r = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: new URLSearchParams({ data: q }), headers: { "User-Agent": "transmi-live (datos abiertos)" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      nodes = ((await r.json()) as { elements?: typeof nodes }).elements ?? [];
    } catch (e) { err = e; }
  }
  if (!nodes.length && err) throw err;
  if (process.env.ACTUALIZAR_OSM === "1" && nodes.length >= 1000) {
    writeFileSync(SAVED, JSON.stringify({ fuente: "OpenStreetMap (© colaboradores de OpenStreetMap, ODbL), nodos highway=traffic_signals de Bogotá", fecha: new Date().toISOString().slice(0, 10), formato: "[lon, lat, 1 si tiene sentido marcado]",
      nodos: nodes.map((n) => [Math.round(n.lon * 1e6) / 1e6, Math.round(n.lat * 1e6) / 1e6, n.tags?.["traffic_signals:direction"] || n.tags?.direction ? 1 : 0]) }));
    console.log(`Semáforos: copia guardada actualizada (${SAVED}); súbela al repositorio`);
  }
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
  // semáforos de OpenStreetMap lejos de todo cruce oficial (>60 m): Movilidad no los lista, pero existen (p. ej. los dos del retorno en U
  // frente al Portal Suba, que el dueño vio en la calle). Se agrupan los que están a ≤50 m entre sí y cada grupo va como un cruce propio,
  // marcado «OSM» (sin cifras oficiales). Solo los que tienen sentido marcado: los demás suelen ser pasos peatonales o puntos dudosos
  const far = nodes.map((n, i) => ({ n, i })).filter(({ n, i }) => !taken.has(i) && (n.tags?.["traffic_signals:direction"] || n.tags?.direction) && !rows.some((r) => Math.abs(r[0] - n.lon) < 0.001 && Math.abs(r[1] - n.lat) < 0.001 && meters(r[0], r[1], n.lon, n.lat) <= 60));
  const used = new Set<number>();
  let extra = 0;
  for (const a of far) {
    if (used.has(a.i)) continue;
    const group = far.filter((b) => !used.has(b.i) && meters(a.n.lon, a.n.lat, b.n.lon, b.n.lat) <= 50);
    group.forEach((b) => used.add(b.i));
    const lon = group.reduce((s, b) => s + b.n.lon, 0) / group.length, lat = group.reduce((s, b) => s + b.n.lat, 0) / group.length;
    rows.push([Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5, "", "", "", group.length, 0, 0, 0, 0, "OSM", group.map((b) => [Math.round(b.n.lon * 1e6) / 1e6, Math.round(b.n.lat * 1e6) / 1e6, "c"] as [number, number, "c"])]);
    extra++; placed += group.length;
  }
  console.log(`Semáforos fuera de la lista oficial (OpenStreetMap): ${used.size} en ${extra} puntos`);
  return placed;
}

main().catch((e) => { console.warn("Semáforos: no se generó el archivo:", e instanceof Error ? e.message : e); });
