/**
 * Grabadora de tiempos reales entre paradas.
 *
 * TransMilenio informa, por viaje, la última parada a la que llegó el bus con su hora REAL de llegada. Dos llegadas
 * consecutivas de un mismo viaje dan cuánto tardó en ese tramo (con la espera en la parada incluida), con precisión de segundos.
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
import { buildNetwork, decodeTripUpdates, parseGtfsLite } from "@transmi/infrastructure";

const SECONDS = Number(process.argv[2] ?? 270), EVERY_MS = 20_000;
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
  const stopIndex = new Map<string, Map<string, number>>();      // ruta|sentido -> parada -> posición
  for (const [rid, shapes] of net.shapes) for (const sh of shapes) stopIndex.set(`${rid}|${sh.direction}`, new Map(sh.stopIds.map((s, i) => [s, i])));
  const shapesOf = (rid: string) => net.shapes.get(rid) ?? [];

  const run: Stats = {};
  const last = new Map<string, { stop: string; at: number }>();   // viaje -> última llegada vista
  let events = 0, seen = 0, polls = 0;
  const end = Date.now() + SECONDS * 1000;
  while (Date.now() < end) {
    const t0 = Date.now();
    try {
      const res = await fetch("https://gtfs.transmilenio.gov.co/tripupdates.pb", { headers: { "User-Agent": "Mozilla/5.0 (transmi-live)" } });
      if (res.ok) {
        const updates = decodeTripUpdates(new Uint8Array(await res.arrayBuffer()));
        polls++;
        for (const u of updates) {
          const cur = u.nextStop; if (!cur?.arrivalAt || !u.routeId) continue;
          seen++;
          const prev = last.get(u.tripId);
          last.set(u.tripId, { stop: cur.stopId, at: cur.arrivalAt });
          if (!prev || prev.stop === cur.stopId || cur.arrivalAt <= prev.at) continue;
          const dur = cur.arrivalAt - prev.at;
          for (const sh of shapesOf(u.routeId)) {
            const idx = stopIndex.get(`${u.routeId}|${sh.direction}`)!;
            const a = idx.get(prev.stop), b = idx.get(cur.stopId);
            if (a == null || b == null || b <= a || b - a > 4) continue;
            const hops = b - a, per = dur / hops;
            if (per < 5 || per > 900) break;
            const d = new Date((cur.arrivalAt - 5 * 3600) * 1000);      // hora de Bogotá (UTC-5)
            const tag = `${dayType(d)}|${bucketOf(d.getUTCHours())}`;
            for (let i = a; i < b; i++) {
              const k = `${u.routeId}|${sh.direction}|${i}|${tag}`;
              const acc = (run[k] ??= { n: 0, sum: 0, sq: 0 });
              acc.n++; acc.sum += per; acc.sq += per * per;
            }
            events++;
            break;
          }
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
  const meta = { v: 1, buckets: BUCKETS, updated: new Date().toISOString(), keys: Object.keys(total).length, tramos: Object.values(total).reduce((s, a) => s + a.n, 0) };
  const round = (x: number) => Math.round(x * 10) / 10;
  const compact = Object.fromEntries(Object.entries(total).map(([k, a]) => [k, { n: a.n, sum: round(a.sum), sq: Math.round(a.sq) }]));
  writeFileSync(join(out, "stats.json.gz"), gzipSync(JSON.stringify({ ...meta, stats: compact }), { level: 9 }));
  execFileSync("bash", ["scripts/publish.sh", out], { stdio: "inherit", env: { ...process.env, BRANCH: "hop-stats", GITHUB_REPOSITORY: REPO, GITHUB_TOKEN: TOKEN } });
  console.log("acumulado:", JSON.stringify(meta));
}
main().catch((e) => { console.error(e); process.exit(1); });
