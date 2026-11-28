import type { Feature, FeatureCollection, Polygon } from "geojson";
import { treeCellKey, treeCellsIn, type Bounds } from "./trees";

/**
 * Edificios reales de Bogotá para la vista 3D: las construcciones de Catastro (Unidad Administrativa Especial de Catastro Distrital,
 * publicadas por IDECA en el mapa 3D de Bogotá y en Datos Abiertos Bogotá), con su contorno y sus pisos. Reemplazan a los edificios de
 * OpenStreetMap del mapa base, que en Bogotá casi no traen altura (salían todos de 6 m).
 *
 * Van por celdas de 0,01° (~1,1 km, las mismas de los árboles): `tools/edificios.ts` las arma y las publica en la rama `edificios`, y la
 * web y la app bajan solo las de la pantalla con el 3D encendido y de cerca.
 */

/** Altura de un piso (m). */
export const FLOOR_M = 3;
/** Desde este zoom se piden los edificios de Catastro (los del mapa base salen desde el 15). */
export const BUILDINGS_IDECA_MIN_ZOOM = 15;

/** Una pieza de construcción: anillo exterior (lon, lat, sin repetir el primer punto), y base y techo en metros. */
export interface Building { ring: [number, number][]; b: number; h: number }

/** Base y techo (m) de una pieza a partir de los datos de Catastro. `ConAltura` es el piso donde arranca la pieza (0 = en el suelo, 1 =
 *  sobre el primer piso: voladizos, ampliaciones; negativo = sótano), `ConElevaci` el último piso al que llega y `ConNPisos` sus pisos. */
export function buildingHeights(a: { ConNPisos?: number; ConAltura?: number; ConElevaci?: number }): { b: number; h: number } | null {
  const pisos = Number(a.ConNPisos ?? 0), desde = Number(a.ConAltura ?? 0), hasta = Number(a.ConElevaci ?? 0);
  if (!Number.isFinite(pisos) || !Number.isFinite(desde) || !Number.isFinite(hasta)) return null;
  const b = Math.max(0, desde) * FLOOR_M;
  // el techo, en el último piso al que llega; si no lo trae, desde donde arranca más sus pisos
  const top = hasta > 0 ? Math.max(b + FLOOR_M, hasta * FLOOR_M) : b + Math.max(1, pisos) * FLOOR_M;
  if (top > 300) return null;      // dato roto (el edificio más alto de Bogotá ronda los 260 m)
  return { b, h: top };
}

/** Archivo de una celda: `b` = [base (dm), techo (dm), x0, y0, dx1, dy1, …] con coordenadas en millonésimas de grado relativas a la
 *  esquina de la celda (≈11 cm) y cada punto relativo al anterior. */
export interface BuildingCellFile { v: 1; k: string; b: number[][] }

export function encodeBuildingCell(key: string, list: readonly Building[]): BuildingCellFile {
  const [cx, cy] = key.split("_").map(Number) as [number, number];
  const ox = cx / 100, oy = cy / 100;
  const b: number[][] = [];
  for (const it of list) {
    if (it.ring.length < 3) continue;
    const row = [Math.round(it.b * 10), Math.round(it.h * 10)];
    let px = 0, py = 0;
    for (const [lon, lat] of it.ring) {
      const x = Math.round((lon - ox) * 1e6), y = Math.round((lat - oy) * 1e6);
      row.push(x - px, y - py); px = x; py = y;
    }
    b.push(row);
  }
  return { v: 1, k: key, b };
}

export function decodeBuildingCell(file: unknown): Building[] {
  const f = file as Partial<BuildingCellFile> | null;
  if (!f || f.v !== 1 || typeof f.k !== "string" || !Array.isArray(f.b)) return [];
  const [cx, cy] = f.k.split("_").map(Number) as [number, number];
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return [];
  const ox = cx / 100, oy = cy / 100, out: Building[] = [];
  for (const row of f.b) {
    if (!Array.isArray(row) || row.length < 8) continue;
    const ring: [number, number][] = [];
    let x = 0, y = 0;
    for (let i = 2; i + 1 < row.length; i += 2) { x += row[i]!; y += row[i + 1]!; ring.push([ox + x / 1e6, oy + y / 1e6]); }
    out.push({ ring, b: row[0]! / 10, h: row[1]! / 10 });
  }
  return out;
}

/** Celda de un punto (la misma cuadrícula de los árboles). */
export const buildingCellKey = treeCellKey;

/** Pide las celdas de edificios de la pantalla (con el índice de celdas que existen) y guarda las ya bajadas. */
export function buildingCellLoader(base: string, fetchJson: (url: string) => Promise<unknown>, retryMs = 10 * 60_000) {
  let index: Record<string, number> | null = null, indexAt = -Infinity, indexing: Promise<void> | null = null;
  const cells = new Map<string, Building[] | Promise<Building[]>>();
  const loadIndex = async () => {
    try {
      const j = (await fetchJson(base + "edificios-indice.json")) as { v?: number; n?: Record<string, number> } | null;
      index = j && j.v === 1 && j.n ? j.n : null;
    } catch { index = null; }
    indexAt = Date.now();
  };
  return {
    /** ¿Ya se sabe que hay edificios de Catastro publicados? (mientras no, se dejan los del mapa base). */
    get ready(): boolean { return !!index && Object.keys(index).length > 0; },
    async inView(b: Bounds, onLoad?: () => void, maxCells = 9): Promise<Building[]> {
      if (!index && Date.now() - indexAt > retryMs) await (indexing ??= loadIndex().finally(() => { indexing = null; }));
      if (!index) return [];
      const out: Building[] = [];
      for (const k of treeCellsIn(b, maxCells)) {
        if (!index[k]) continue;
        const c = cells.get(k);
        if (Array.isArray(c)) { out.push(...c); continue; }
        if (!c) {
          const p = fetchJson(`${base}edi_${k}.json`).then(decodeBuildingCell).catch(() => [] as Building[]);
          cells.set(k, p);
          void p.then((list) => { cells.set(k, list); onLoad?.(); });
        }
      }
      // solo los que tocan el recuadro (con un margen: un edificio grande puede salirse de su punto)
      const m = 0.0004;
      return out.filter((it) => { const [x, y] = it.ring[0]!; return x >= b.west - m && x <= b.east + m && y >= b.south - m && y <= b.north + m; });
    },
    /** Cuántas celdas hay guardadas (para no crecer sin fin: se vacía si pasa de `max`). */
    trim(max = 40) { if (cells.size > max) cells.clear(); },
  };
}

/** Clave para no rearmar los edificios en cada movimiento: cambia solo si el centro se corre ~150 m, llegan otras celdas o cambia la
 *  apariencia (rearmar y mandar al mapa 1–3 MB en cada paso del dedo era lo que más costaba). */
/** El centro redondeado a ~150 m: el recuadro de edificios se arma desde aquí para que no cambie con cada pequeño movimiento. */
export function snapCenter(c: { lon: number; lat: number }): { lon: number; lat: number } {
  return { lon: Math.round(c.lon * 700) / 700, lat: Math.round(c.lat * 700) / 700 };
}
export function buildingsRefreshKey(center: { lon: number; lat: number }, count: number, dark: boolean): string {
  return `${dark ? 1 : 0}|${Math.round(center.lon * 700)}|${Math.round(center.lat * 700)}|${count}`;
}

/** Tonos de los edificios: claros y un poco más oscuros los más altos (como el mapa base), y en la apariencia oscura al revés. */
export function buildingColor(h: number, dark: boolean): string {
  const t = Math.max(0, Math.min(1, (h - 3) / 45));
  const mix = (a: number[], b: number[]) => "#" + a.map((v, i) => Math.round(v + (b[i]! - v) * t).toString(16).padStart(2, "0")).join("");
  return dark ? mix([0x34, 0x38, 0x41], [0x45, 0x4a, 0x55]) : mix([0xe2, 0xde, 0xd5], [0xcd, 0xc8, 0xbd]);
}

/** El color de los edificios como expresión del mapa (según su altura `h`), igual a `buildingColor`. */
export function buildingColorExpression(dark: boolean): unknown {
  return ["interpolate", ["linear"], ["get", "h"], 3, buildingColor(3, dark), 48, buildingColor(48, dark)];
}

/** Los edificios como volúmenes para `fill-extrusion` (`c` color, `b` base, `h` techo en metros). Los más cercanos a `center`, hasta `max`. */
export function buildingVolumes(list: readonly Building[], opts: { dark?: boolean; center?: { lon: number; lat: number }; max?: number } = {}): FeatureCollection<Polygon, { b: number; h: number }> {
  let items = list;
  if (opts.center && opts.max != null && list.length > opts.max) {
    const c = opts.center, k = Math.cos((c.lat * Math.PI) / 180);
    items = [...list].map((it) => ({ it, d: ((it.ring[0]![0] - c.lon) * k) ** 2 + (it.ring[0]![1] - c.lat) ** 2 })).sort((a, b) => a.d - b.d).slice(0, opts.max).map((x) => x.it);
  }
  const features: Feature<Polygon, { b: number; h: number }>[] = [];
  for (const it of items) {
    if (it.ring.length < 3) continue;
    // 6 decimales (~10 cm): sin redondear salían 17 cifras por número y el texto para el mapa pesaba el doble
    const ring = it.ring.map(([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6]);
    ring.push(ring[0]!);
    // sin color ni id por edificio (el color lo pone el mapa según la altura: `buildingColorExpression`), para aligerar
    features.push({ type: "Feature", properties: { b: it.b, h: it.h }, geometry: { type: "Polygon", coordinates: [ring] } });
  }
  return { type: "FeatureCollection", features };
}
