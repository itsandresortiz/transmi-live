/**
 * Árboles de Bogotá para la vista 3D del mapa, por celdas de 0,01° (~1,1 km): el teléfono y la web bajan solo las celdas de la pantalla.
 *
 * Fuentes:
 *   1. OpenStreetMap: nodos `natural=tree` (con `height`, `diameter_crown` o `circumference` cuando los traen). © colaboradores de
 *      OpenStreetMap, licencia ODbL (la misma del mapa base: la atribución «© OpenStreetMap» ya sale en el mapa).
 *   2. Opcional: el censo del arbolado urbano (SIGAU, Jardín Botánico de Bogotá, publicado en Datos Abiertos Bogotá), si se da su
 *      dirección en `ARBOLADO_URL` (GeoJSON de puntos o CSV con columnas de latitud y longitud; altura y diámetro de copa si vienen).
 *      **(?) Sin comprobar**: desde el contenedor de Claude no se llega a datosabiertos.bogota.gov.co; hay que confirmar la dirección de
 *      descarga y la licencia del conjunto (y agregar su atribución en el mapa) antes de encenderlo.
 * Donde no hay datos de árboles, la web y la app siembran árboles dentro de los parques del mapa base (`plantTrees`), así que esto solo
 * mejora lo que ya se ve.
 *
 * Salida (`<carpeta>/`): `arb_<x>_<y>.json` por celda (formato de `encodeTreeCell`) y `arboles-indice.json` con cuántos árboles hay en cada
 * celda (los clientes no piden las celdas vacías). Corre en GitHub (workflow «Árboles para el mapa 3D»), que lo publica en la rama `arboles`.
 * Uso: npx tsx tools/arboles.ts <carpeta>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodeTreeCell, mergeTrees, treeCellKey, type TreePoint } from "@transmi/application";

const OUT = process.argv[2] ?? "dist-arboles";
/** Bogotá urbana y un poco de los cerros (sur, oeste, norte, este). */
const BBOX = [4.45, -74.25, 4.85, -73.98] as const;
const Q = `[out:json][timeout:300];node["natural"="tree"](${BBOX.join(",")});out body;`;
const SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

interface El { type: string; id: number; lat: number; lon: number; tags?: Record<string, string> }

async function overpass(): Promise<El[]> {
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

/** Un número en metros de una etiqueta de OpenStreetMap («12», «12 m», «12.5»); null si no se entiende. */
export function meters(v: string | undefined): number | null {
  if (!v) return null;
  const m = /^\s*([\d.,]+)\s*(m|cm)?\s*$/i.exec(v);
  if (!m) return null;
  const n = Number(m[1]!.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return m[2]?.toLowerCase() === "cm" ? n / 100 : n;
}

export function fromOsm(els: readonly El[]): TreePoint[] {
  const out: TreePoint[] = [];
  for (const e of els) {
    if (e.type !== "node" || !Number.isFinite(e.lat) || !Number.isFinite(e.lon)) continue;
    const t: TreePoint = { lon: e.lon, lat: e.lat, real: true };
    const h = meters(e.tags?.height), d = meters(e.tags?.diameter_crown);
    if (h && h < 60) t.h = h;
    if (d && d < 40) t.crown = d;
    out.push(t);
  }
  return out;
}

/** El censo: GeoJSON de puntos o CSV. Busca columnas por nombre (latitud/longitud/altura/diámetro de copa) sin importar mayúsculas. */
export function fromCensus(text: string): TreePoint[] {
  const out: TreePoint[] = [];
  const num = (v: unknown) => { const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) && n > 0 ? n : null; };
  const pick = (o: Record<string, unknown>, re: RegExp) => { for (const k of Object.keys(o)) if (re.test(k)) return o[k]; return undefined; };
  const H = /^(altura(_?total)?|height|alt_total)$/i, D = /^(diam(etro)?_?copa|diametro_copa|crown|copa)$/i;
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{")) {
    const j = JSON.parse(text) as { features?: { geometry?: { type: string; coordinates: number[] }; properties?: Record<string, unknown> }[] };
    for (const f of j.features ?? []) {
      if (f.geometry?.type !== "Point") continue;
      const [lon, lat] = f.geometry.coordinates as [number, number];
      const p: TreePoint = { lon, lat, real: true }, props = f.properties ?? {};
      const h = num(pick(props, H)), d = num(pick(props, D));
      if (h && h < 60) p.h = h;
      if (d && d < 40) p.crown = d;
      out.push(p);
    }
    return out;
  }
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const sep = (lines[0] ?? "").includes(";") ? ";" : ",";
  const head = (lines[0] ?? "").split(sep).map((h) => h.trim().replace(/^"|"$/g, ""));
  const col = (re: RegExp) => head.findIndex((h) => re.test(h));
  const iLat = col(/^(lat|latitud|latitude|y)$/i), iLon = col(/^(lon|lng|longitud|longitude|x)$/i), iH = col(H), iD = col(D);
  if (iLat < 0 || iLon < 0) throw new Error(`el CSV no trae latitud y longitud (columnas: ${head.join(", ")})`);
  for (const line of lines.slice(1)) {
    const c = line.split(sep).map((v) => v.trim().replace(/^"|"$/g, ""));
    const lat = Number(c[iLat]?.replace(",", ".")), lon = Number(c[iLon]?.replace(",", "."));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const p: TreePoint = { lon, lat, real: true };
    const h = iH >= 0 ? num(c[iH]) : null, d = iD >= 0 ? num(c[iD]) : null;
    if (h && h < 60) p.h = h;
    if (d && d < 40) p.crown = d;
    out.push(p);
  }
  return out;
}

/** Reparte los árboles en celdas y escribe los archivos. Devuelve el índice. */
export function writeCells(dir: string, trees: readonly TreePoint[], sources: string[]): { total: number; cells: number } {
  mkdirSync(dir, { recursive: true });
  const byCell = new Map<string, TreePoint[]>();
  for (const t of trees) {
    if (t.lat < BBOX[0] || t.lat > BBOX[2] || t.lon < BBOX[1] || t.lon > BBOX[3]) continue;
    const k = treeCellKey(t.lon, t.lat);
    (byCell.get(k) ?? byCell.set(k, []).get(k)!).push(t);
  }
  const n: Record<string, number> = {};
  let total = 0;
  for (const [k, list] of byCell) {
    writeFileSync(join(dir, `arb_${k}.json`), JSON.stringify(encodeTreeCell(k, list)));
    n[k] = list.length; total += list.length;
  }
  writeFileSync(join(dir, "arboles-indice.json"), JSON.stringify({ v: 1, fecha: new Date().toISOString(), fuentes: sources, celda: 0.01, total, n }));
  return { total, cells: byCell.size };
}

async function main() {
  const sources: string[] = [];
  let census: TreePoint[] = [];
  const url = process.env.ARBOLADO_URL;
  if (url) {
    const r = await fetch(url, { headers: { "User-Agent": "transmi-live (datos abiertos)" } });
    if (!r.ok) throw new Error(`censo: HTTP ${r.status}`);
    census = fromCensus(await r.text());
    sources.push(`Censo del arbolado urbano de Bogotá (${census.length})`);
    console.log("censo:", census.length, "árboles");
  }
  const osm = fromOsm(await overpass());
  sources.push(`© OpenStreetMap (${osm.length})`);
  console.log("OpenStreetMap:", osm.length, "árboles");
  // el censo manda; de OpenStreetMap solo los que no estén ya en el censo (a menos de 3 m)
  const trees = census.length ? mergeTrees(census, osm, 3) : osm;
  const { total, cells } = writeCells(OUT, trees, sources);
  console.log(`${total} árboles en ${cells} celdas → ${OUT}`);
}

if (process.argv[1]?.endsWith("arboles.ts")) main().catch((e) => { console.error(e); process.exit(1); });
