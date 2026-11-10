import AsyncStorage from "@react-native-async-storage/async-storage";
import { File, Paths } from "expo-file-system";

/** Copia en el teléfono de los archivos grandes que casi no cambian (rutas y horarios), para que la app abra rápido y funcione sin conexión.
 *  Nunca se guardan aquí los buses en vivo: un bus viejo no se debe mostrar como si fuera de ahora. */
const STAMPS = "tm.cache.v1";
let stamps: Record<string, number> | null = null;
async function loadStamps(): Promise<Record<string, number>> {
  if (!stamps) { try { stamps = JSON.parse((await AsyncStorage.getItem(STAMPS)) ?? "{}") as Record<string, number>; } catch { stamps = {}; } }
  return stamps!;
}
const file = (name: string) => new File(Paths.document, `tm-${name}`);

async function readCopy(name: string): Promise<Uint8Array | null> {
  try { const f = file(name); return f.exists ? await f.bytes() : null; } catch { return null; }
}
async function saveCopy(name: string, data: Uint8Array): Promise<void> {
  try {
    const f = file(name);
    if (!f.exists) f.create();
    f.write(data);
    const s = await loadStamps(); s[name] = Date.now();
    await AsyncStorage.setItem(STAMPS, JSON.stringify(s));
  } catch { /* sin espacio o sin permiso: se sigue sin copia */ }
}

/** Bytes de `url`. Si la copia guardada tiene menos de `freshMs`, se usa sin ir a la red (abre al instante y no gasta datos);
 *  si no, se baja y se guarda; y si no hay red, sirve la copia que haya, aunque sea vieja. Devuelve `null` si no hay ni red ni copia. */
export async function cachedBytes(url: string, name: string, freshMs: number, timeoutMs = 20_000): Promise<{ data: Uint8Array; fromCopy: boolean } | null> {
  const at = (await loadStamps())[name] ?? 0;
  if (Date.now() - at < freshMs) { const c = await readCopy(name); if (c) return { data: c, fromCopy: true }; }
  try {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(String(res.status));
    const data = new Uint8Array(await res.arrayBuffer());
    void saveCopy(name, data);
    return { data, fromCopy: false };
  } catch {
    const c = await readCopy(name);
    return c ? { data: c, fromCopy: true } : null;
  }
}
