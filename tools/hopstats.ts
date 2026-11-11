/**
 * Grabadora de tiempos reales entre paradas.
 *
 * Hasta el 2026-11-05 se tomaba de la hora real de llegada a cada parada que traía el archivo de viajes de TransMilenio. Desde entonces
 * ese archivo no trae paradas ni horas, y la «última parada» y el número de secuencia que trae cada bus quedaron fijos (no cambian en
 * todo el viaje; comprobado con 4.796 buses en 41 min). Lo único que avanza es la posición: se mide cuánto recorre cada bus sobre su
 * trazado entre dos reportes y ese tiempo se reparte entre los tramos que cruzó. `n` es cuánto de cada tramo se recorrió en total
 * (puede tener decimales) y `sum` los segundos gastados: `sum / n` = segundos para recorrer el tramo. Lo acumulado antes se conserva.
 * Esta herramienta las acumula por ruta, tramo, tipo de día y franja horaria (suma, cuenta y suma de cuadrados), sin guardar datos crudos,
 * y las publica en la rama `hop-stats`. Con unos días de datos permite medir si un perfil histórico supera a la fórmula actual.
 *
 * Uso: npx tsx tools/hopstats.ts [segundos_de_grabación]
 */
import { execFileSync } from "node:child_process";
import { gunzipSync, gzipSync } from "node:zlib";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TransitState, shapeStops } from "@transmi/application";
import { buildNetwork, decodePositions, parseGtfsLite } from "@transmi/infrastructure";

const SECONDS = Number(process.argv[2] ?? 270), EVERY_MS = 10_000;
const REPO = process.env.GITHUB_REPOSITORY ?? "itsandresortiz/transmi-live", TOKEN = process.env.GITHUB_TOKEN ?? "";
const url = (b: string) => `https://${TOKEN ? `x-access-token:${TOKEN}@` : ""}github.com/${REPO}.git`;

/** Franjas del día en Bogotá: madrugada, pico de la mañana, valle, pico de la tarde, noche. */
const BUCKETS = ["0-6", "6-10", "10-16", "16-20", "20-24"];
const bucketOf = (h: number) => (h < 6 ? 0 : h < 10 ? 1 : h < 16 ? 2 : h < 20 ? 3 : 4);
function dayType(d: Date): "wk" | "sa" | "su" { const w = d.getUTCDay(); return w === 0 ? "su" : w === 6 ? "sa" : "wk"; }

interface Acc { n: number; sum: number; sq: number }
type Stats = Record<string, Acc>;          // ruta|tramo|tipoDía|franja

function clone(branch: string): string | null {
  const dir = mkdtempSync(join(tmpdir(), "hs-"));
  try { execFileSync("git", ["clone", "-q", "--depth", "1", "--branch", branch, url(branch), dir], { stdio: "pipe" }); return dir; } catch { return null; }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // red: recorrido de cada ruta, para saber cuántos tramos hay entre dos paradas
  const liteDir = clone("live-data");
  if (!liteDir || !existsSync(join(liteDir, "gtfs-lite.zip"))) throw new Error("no hay gtfs-lite.zip en live-data");
  const net = buildNetwork(await parseGtfsLite(new Uint8Array(readFileSync(join(liteDir, "gtfs-lite.zip")))));
  const run: Stats = {};
  // Dónde iba cada bus sobre su recorrido en su reporte anterior (metros desde el inicio) y a qué hora (la de su GPS).
  // Entre dos reportes seguidos se sabe cuántos metros avanzó y en cuánto tiempo: ese tiempo se reparte entre los tramos (parada a parada)
  // que cruzó, en proporción a lo recorrido en cada uno. Sumando tiempo y avance por tramo sale cuánto se tarda en recorrerlo entero
  // (incluida la espera en paradas y semáforos: el tiempo de un bus detenido también se suma al tramo donde está).
  const state = new TransitState(); state.setNetwork(net);
  const last = new Map<string, { key: string; s: number; at: number }>();
  let events = 0, seen = 0, polls = 0;
  const end = Date.now() + SECONDS * 1000;
  while (Date.now() < end) {
    const t0 = Date.now();
    try {
      const res = await fetch("https://gtfs.transmilenio.gov.co/positions.pb", { headers: { "User-Agent": "Mozilla/5.0 (transmi-live)" } });
      if (res.ok) {
        state.applyPositions(decodePositions(new Uint8Array(await res.arrayBuffer())), Date.now());
        polls++;
        for (const v of state.fleet.values()) {
          const seq = state.sequenceForDisplay(v); if (!seq) continue;
          const info = shapeStops(state, seq.shape); if (!info) continue;
          const hit = info.path.project(v.world, 0, 0, 120);
          const a = info.s[seq.index], b = info.s[seq.index + 1];
          if (!hit || a == null || b == null || hit.s < a - 150 || hit.s > b + 150) continue;      // el bus tiene que ir por el tramo donde se le ubicó
          seen++;
          const key = `${seq.shape.routeId}|${seq.shape.direction}`, prev = last.get(v.id);
          if (prev && prev.at === v.reportedAt) continue;                                            // mismo reporte que la vez pasada
          last.set(v.id, { key, s: hit.s, at: v.reportedAt });
          if (!prev || prev.key !== key) continue;
          const dt = v.reportedAt - prev.at, ds = hit.s - prev.s;
          if (dt < 5 || dt > 300 || ds < -30 || ds > 3500) continue;                                 // saltos o datos raros
          const d = new Date((v.reportedAt - 5 * 3600) * 1000);                                      // hora de Bogotá (UTC-5)
          const tag = `${dayType(d)}|${bucketOf(d.getUTCHours())}`;
          const add = (i: number, frac: number, secs: number) => { const acc = (run[`${key}|${i}|${tag}`] ??= { n: 0, sum: 0, sq: 0 }); acc.n += frac; acc.sum += secs; };
          if (ds <= 5) { add(seq.index, 0, dt); events++; continue; }                               // detenido: el tiempo cuenta, el avance no
          for (let i = 0; i < info.s.length - 1; i++) {
            const lo = Math.max(prev.s, info.s[i]!), hi = Math.min(hit.s, info.s[i + 1]!), len = info.s[i + 1]! - info.s[i]!;
            if (hi <= lo || len < 15) continue;
            add(i, (hi - lo) / len, dt * (hi - lo) / ds);
          }
          events++;
        }
      }
    } catch (e) { console.log("consulta fallida:", (e as Error).message); }
    const wait = EVERY_MS - (Date.now() - t0);
    if (Date.now() + wait < end) await sleep(Math.max(0, wait)); else break;
  }
  console.log(`consultas ${polls}, viajes vistos ${seen}, tramos nuevos ${events}, claves ${Object.keys(run).length}`);
  if (!events) return;

  // se suma a lo acumulado (estado fresco de la rama, para no pisar nada)
  const prevDir = clone("hop-stats");
  let total: Stats = {};
  if (prevDir && existsSync(join(prevDir, "stats.json.gz"))) total = JSON.parse(gunzipSync(readFileSync(join(prevDir, "stats.json.gz"))).toString()).stats ?? {};
  for (const [k, a] of Object.entries(run)) { const t = (total[k] ??= { n: 0, sum: 0, sq: 0 }); t.n += a.n; t.sum += a.sum; t.sq += a.sq; }
  const out = mkdtempSync(join(tmpdir(), "hs-out-"));
  mkdirSync(out, { recursive: true });
  const meta = { v: 3, fuente: "posiciones (avance sobre el trazado)", buckets: BUCKETS, updated: new Date().toISOString(), keys: Object.keys(total).length, tramos: Object.values(total).reduce((s, a) => s + a.n, 0) };
  const round = (x: number) => Math.round(x * 10) / 10;
  const compact = Object.fromEntries(Object.entries(total).map(([k, a]) => [k, { n: Math.round(a.n * 100) / 100, sum: round(a.sum), sq: Math.round(a.sq) }]));
  writeFileSync(join(out, "stats.json.gz"), gzipSync(JSON.stringify({ ...meta, stats: compact }), { level: 9 }));
  execFileSync("bash", ["scripts/publish.sh", out], { stdio: "inherit", env: { ...process.env, BRANCH: "hop-stats", GITHUB_REPOSITORY: REPO, GITHUB_TOKEN: TOKEN } });
  console.log("acumulado:", JSON.stringify(meta));
}
main().catch((e) => { console.error(e); process.exit(1); });
