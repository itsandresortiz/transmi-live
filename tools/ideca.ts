/**
 * Lector de los datos abiertos del mapa 3D de Bogotá (mapas.bogota.gov.co/3d, IDECA): la ciudad partida en sectores catastrales
 * (`data/SCat.json`, ~1.170) y, por cada sector, sus construcciones (Catastro: contorno y pisos) y su arbolado (censo del Jardín
 * Botánico: especie, altura). Son los mismos archivos públicos que baja ese mapa en el navegador.
 * Variables (para probar con pocos): IDECA_SECTORES=007304,007305 (solo esos) o IDECA_LIMITE=20 (los primeros N).
 */
export const IDECA_BASE = "https://mapas.bogota.gov.co/3d/";
export const IDECA_ATTRIBUTION_BUILDINGS = "Construcciones: Catastro Bogotá (UAECD) · IDECA";
export const IDECA_ATTRIBUTION_TREES = "Arbolado: Jardín Botánico de Bogotá · IDECA";

const UA = { "User-Agent": "transmi-live (datos abiertos)" };

async function getJson(url: string, tries = 4): Promise<unknown> {
  let err: unknown = null;
  for (let k = 0; k < tries; k++) {
    if (k) await new Promise((r) => setTimeout(r, 1500 * 2 ** k));
    try {
      const r = await fetch(url, { headers: UA });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { err = e; }
  }
  throw new Error(`${url}: ${err instanceof Error ? err.message : String(err)}`);
}

/** Los códigos de los sectores catastrales. */
export async function idecaSectors(): Promise<string[]> {
  const j = (await getJson(IDECA_BASE + "data/SCat.json")) as { RecordSet?: { features?: { attributes?: { SCaCodigo?: string } }[] } } | null;
  let keys = (j?.RecordSet?.features ?? []).map((f) => String(f.attributes?.SCaCodigo ?? "")).filter(Boolean);
  if (process.env.IDECA_SECTORES) { const only = new Set(process.env.IDECA_SECTORES.split(",").map((s) => s.trim())); keys = keys.filter((k) => only.has(k)); }
  if (process.env.IDECA_LIMITE) keys = keys.slice(0, Number(process.env.IDECA_LIMITE));
  if (!keys.length) throw new Error("no llegaron los sectores catastrales");
  return keys;
}

export interface IdecaFeature { attributes: Record<string, unknown>; geometry: { rings?: number[][][]; x?: number; y?: number } }

/** Recorre los sectores de un tipo de datos (de a `concurrency` a la vez) y entrega las piezas de cada uno. Un sector que falla se
 *  cuenta y se sigue (si fallan demasiados, error: no se publica a medias). */
export async function forEachSector(kind: "construcciones" | "arbolado", keys: readonly string[], each: (features: IdecaFeature[], key: string) => void, concurrency = 6): Promise<{ ok: number; failed: string[] }> {
  let i = 0, ok = 0;
  const failed: string[] = [];
  const worker = async () => {
    while (i < keys.length) {
      const key = keys[i++]!;
      try {
        const j = (await getJson(`${IDECA_BASE}data_${kind}/${key}.json`)) as { RecordSet?: { features?: IdecaFeature[] } } | null;
        each(j?.RecordSet?.features ?? [], key);
        ok++;
        if (ok % 100 === 0) console.log(`  ${kind}: ${ok}/${keys.length}`);
      } catch (e) { failed.push(key); console.warn(`  ${kind} ${key}:`, e instanceof Error ? e.message : e); }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  if (failed.length > Math.max(5, keys.length * 0.03)) throw new Error(`${kind}: fallaron ${failed.length} de ${keys.length} sectores`);
  return { ok, failed };
}
