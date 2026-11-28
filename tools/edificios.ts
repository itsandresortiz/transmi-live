/**
 * Edificios de Bogotá para la vista 3D: las construcciones de Catastro (datos abiertos de IDECA, ver tools/ideca.ts) con su contorno y
 * sus pisos, por celdas de 0,01° (~1,1 km), en el formato de `encodeBuildingCell`. Se quitan las piezas de menos de 12 m² (casetas,
 * tanques) y los puntos que sobran (a menos de 15 cm o en línea recta) para aligerar.
 * Salida (`<carpeta>/`): `edi_<x>_<y>.json` por celda y `edificios-indice.json` (cuántos hay en cada celda). Corre en GitHub (workflow
 * «Árboles y edificios para el mapa 3D»), que lo publica en la rama `edificios`.
 * Uso: npx tsx tools/edificios.ts <carpeta>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildingCellKey, buildingHeights, encodeBuildingCell, type Building } from "@transmi/application";
import { IDECA_ATTRIBUTION_BUILDINGS, forEachSector, idecaSectors } from "./ideca";

const OUT = process.argv[2] ?? "dist-edificios";
const MIN_AREA_M2 = 12;      // casetas, tanques y pedazos sueltos (no se ven desde la calle y pesan)

/** Anillo limpio (sin el punto repetido del final, sin puntos casi iguales ni en línea recta) y su área en m². */
export function cleanRing(raw: readonly number[][]): { ring: [number, number][]; area: number } | null {
  if (raw.length < 4) return null;
  const lat0 = raw[0]![1]!, kx = 111_320 * Math.cos((lat0 * Math.PI) / 180), ky = 110_540;
  let pts = raw.map(([x, y]) => [x!, y!] as [number, number]);
  if (pts.length > 1 && pts[0]![0] === pts[pts.length - 1]![0] && pts[0]![1] === pts[pts.length - 1]![1]) pts = pts.slice(0, -1);
  const m = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * ky);
  const out: [number, number][] = [];
  for (const p of pts) if (!out.length || m(out[out.length - 1]!, p) > 0.15) out.push(p);
  // quita los puntos casi en línea recta con sus vecinos (desvío < 25 cm)
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 3; i++) {
      const a = out[(i - 1 + out.length) % out.length]!, b = out[i]!, c = out[(i + 1) % out.length]!;
      const ax = (b[0] - a[0]) * kx, ay = (b[1] - a[1]) * ky, cx = (c[0] - a[0]) * kx, cy = (c[1] - a[1]) * ky, L = Math.hypot(cx, cy);
      if (L > 0 && Math.abs(ax * cy - ay * cx) / L < 0.25) { out.splice(i, 1); changed = true; i--; }
    }
  }
  if (out.length < 3) return null;
  let s = 0;
  for (let i = 0; i < out.length; i++) { const p = out[i]!, q = out[(i + 1) % out.length]!; s += p[0] * kx * q[1] * ky - q[0] * kx * p[1] * ky; }
  return { ring: out, area: Math.abs(s) / 2 };
}

async function main() {
  const keys = await idecaSectors();
  console.log("sectores catastrales:", keys.length);
  const byCell = new Map<string, Building[]>();
  let total = 0, tiny = 0, broken = 0;
  const { failed } = await forEachSector("construcciones", keys, (features) => {
    for (const f of features) {
      const hh = buildingHeights(f.attributes as never), raw = f.geometry.rings?.[0];
      if (!hh || !raw) { broken++; continue; }
      const c = cleanRing(raw);
      if (!c) { broken++; continue; }
      if (c.area < MIN_AREA_M2) { tiny++; continue; }
      const k = buildingCellKey(c.ring[0]![0], c.ring[0]![1]);
      (byCell.get(k) ?? byCell.set(k, []).get(k)!).push({ ring: c.ring, b: hh.b, h: hh.h });
      total++;
    }
  });
  mkdirSync(OUT, { recursive: true });
  const n: Record<string, number> = {};
  let bytes = 0;
  for (const [k, list] of byCell) {
    const txt = JSON.stringify(encodeBuildingCell(k, list));
    writeFileSync(join(OUT, `edi_${k}.json`), txt);
    n[k] = list.length; bytes += txt.length;
  }
  writeFileSync(join(OUT, "edificios-indice.json"), JSON.stringify({ v: 1, fecha: new Date().toISOString(), fuente: IDECA_ATTRIBUTION_BUILDINGS, celda: 0.01, total, n, sectoresFallidos: failed }));
  console.log(`edificios: ${total} en ${byCell.size} celdas (${(bytes / 1e6).toFixed(1)} MB); pequeños quitados ${tiny}, dañados ${broken}, sectores fallidos ${failed.length}`);
}

if (process.argv[1]?.endsWith("edificios.ts")) main().catch((e) => { console.error(e); process.exit(1); });
