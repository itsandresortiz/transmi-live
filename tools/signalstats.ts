/**
 * Grabadora de comportamiento de los buses cerca de los semáforos (datos para entrenar algo más adelante).
 *
 * Cada ~20 s baja las posiciones de TransMilenio y, por cada bus que pasa o se detiene cerca de un semáforo de la red oficial
 * de Bogotá, cuenta: pasadas, detenciones, suma de velocidades y cuántas veces estaba lento. No se guardan trayectorias de buses,
 * solo conteos por semáforo, tipo de día y franja horaria, publicados en la rama `signal-stats`.
 *
 * Excluye las paradas de bus (un bus detenido en una parada no está esperando un semáforo) y los carriles exclusivos de la troncal.
 * Además guarda, por semáforo, un histograma de la hora del minuto (segundos 0-59 de cada minuto en pasos de 5 s) de las detenciones:
 * si un semáforo es de tiempo fijo con ciclo de 60/90/120 s, la «huella» queda visible tras varios días.
 *
 * Uso: npx tsx tools/signalstats.ts [segundos_de_grabación]
 */
import { execFileSync } from "node:child_process";
import { gunzipSync, gzipSync } from "node:zlib";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { distanceMeters, toWorld } from "@transmi/domain";
import { TransitState } from "@transmi/application";
import { buildNetwork, decodePositions, parseGtfsLite } from "@transmi/infrastructure";

const SECONDS = Number(process.argv[2] ?? 270), EVERY_MS = 18_000;
const REPO = process.env.GITHUB_REPOSITORY ?? "itsandresortiz/transmi-live", TOKEN = process.env.GITHUB_TOKEN ?? "";
const url = `https://${TOKEN ? `x-access-token:${TOKEN}@` : ""}github.com/${REPO}.git`;
const NEAR_M = 35, STOP_EXCLUDE_M = 45, STILL_MPS = 1.2;
const BUCKETS = ["0-6", "6-10", "10-16", "16-20", "20-24"];
const bucketOf = (h: number) => (h < 6 ? 0 : h < 10 ? 1 : h < 16 ? 2 : h < 20 ? 3 : 4);
const dayType = (d: Date) => { const w = d.getUTCDay(); return w === 0 ? "su" : w === 6 ? "sa" : "wk"; };

interface Acc { n: number; still: number; slow: number; sumV: number; phase: number[] }   // phase: 12 casillas de 5 s dentro del minuto (solo detenciones)
type Stats = Record<string, Acc>;                      // "lon,lat|tipoDía|franja"

function clone(branch: string): string | null {
  const dir = mkdtempSync(join(tmpdir(), "ss-"));
  try { execFileSync("git", ["clone", "-q", "--depth", "1", "--branch", branch, url, dir], { stdio: "pipe" }); return dir; } catch { return null; }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const grid = new Map<string, number[]>();             // índice espacial de semáforos
const cell = (lon: number, lat: number) => `${Math.floor(lon / 0.0005)},${Math.floor(lat / 0.0005)}`;

async function main() {
  const liteDir = clone("live-data");
  if (!liteDir) throw new Error("no hay rama live-data");
  const st = new TransitState();
  st.setNetwork(buildNetwork(await parseGtfsLite(new Uint8Array(readFileSync(join(liteDir, "gtfs-lite.zip"))))));
  const stopCells = new Set<string>();
  for (const s of st.network.stops.values()) stopCells.add(cell(s.position.lon, s.position.lat));
  const nearStop = (lon: number, lat: number) => {
    const cx = Math.floor(lon / 0.0005), cy = Math.floor(lat / 0.0005);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (stopCells.has(`${cx + dx},${cy + dy}`)) {
      for (const s of st.network.stops.values()) if (Math.abs(s.position.lon - lon) < 0.0006 && Math.abs(s.position.lat - lat) < 0.0006 && distanceMeters(toWorld(s.position), toWorld({ lat, lon })) < STOP_EXCLUDE_M) return true;
      return false;
    }
    return false;
  };

  // semáforos oficiales
  const sig: [number, number][] = [];
  for (let off = 0; off < 20_000; off += 1000) {
    const q = new URLSearchParams({ where: "1=1", outFields: "OBJECTID", outSR: "4326", f: "geojson", resultOffset: String(off), resultRecordCount: "1000", orderByFields: "OBJECTID" });
    const r = await fetch(`https://sig.simur.gov.co/arcgis/rest/services/DatosAbiertos/RedSemaforica/FeatureServer/0/query?${q}`);
    const j = (await r.json()) as { features?: { geometry?: { coordinates?: [number, number] } }[] };
    for (const f of j.features ?? []) { const c = f.geometry?.coordinates; if (c) sig.push([Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5]); }
    if ((j.features?.length ?? 0) < 1000) break;
  }
  if (sig.length < 500) throw new Error(`pocos semáforos (${sig.length})`);
  sig.forEach(([lon, lat], i) => { const k = cell(lon, lat); (grid.get(k) ?? grid.set(k, []).get(k)!).push(i); });
  console.log("semáforos:", sig.length);

  const run: Stats = {};
  const prev = new Map<string, { x: number; y: number; t: number; lon: number; lat: number }>();
  const trunk = (rid: string) => st.network.routes.get(rid)?.system === "troncal";
  let polls = 0, obs = 0;
  const end = Date.now() + SECONDS * 1000;
  while (Date.now() < end) {
    const t0 = Date.now();
    try {
      const res = await fetch("https://gtfs.transmilenio.gov.co/positions.pb", { headers: { "User-Agent": "Mozilla/5.0 (transmi-live)" } });
      if (res.ok) {
        const reports = decodePositions(new Uint8Array(await res.arrayBuffer())); polls++;
        for (const r of reports) {
          if (trunk(r.routeId)) continue;
          const w = toWorld(r.position), p = prev.get(r.id);
          prev.set(r.id, { x: w.x, y: w.y, t: r.reportedAt, lon: r.position.lon, lat: r.position.lat });
          if (!p || r.reportedAt <= p.t) continue;
          const dt = r.reportedAt - p.t; if (dt < 8 || dt > 90) continue;
          const speed = distanceMeters(p, w) / dt;
          // semáforos a menos de 35 m de la posición nueva
          const cx = Math.floor(r.position.lon / 0.0005), cy = Math.floor(r.position.lat / 0.0005);
          let best = -1, bd = NEAR_M;
          for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const i of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
            const d = distanceMeters(toWorld({ lat: sig[i]![1], lon: sig[i]![0] }), w); if (d < bd) { bd = d; best = i; }
          }
          if (best < 0 || nearStop(r.position.lon, r.position.lat)) continue;
          const d = new Date((r.reportedAt - 5 * 3600) * 1000);
          const k = `${sig[best]![0]},${sig[best]![1]}|${dayType(d)}|${bucketOf(d.getUTCHours())}`;
          const a = (run[k] ??= { n: 0, still: 0, slow: 0, sumV: 0, phase: new Array(12).fill(0) });
          a.n++; a.sumV += speed; obs++;
          if (speed < 4) a.slow++;
          if (speed < STILL_MPS) { a.still++; a.phase[Math.floor(((r.reportedAt % 60) + 60) % 60 / 5)]!++; }
        }
      }
    } catch (e) { console.log("consulta fallida:", (e as Error).message); }
    const wait = EVERY_MS - (Date.now() - t0);
    if (Date.now() + wait < end) await sleep(Math.max(0, wait)); else break;
  }
  console.log(`consultas ${polls}, observaciones ${obs}, claves ${Object.keys(run).length}`);
  if (!obs) return;

  const prevDir = clone("signal-stats");
  let total: Stats = {};
  if (prevDir && existsSync(join(prevDir, "stats.json.gz"))) total = JSON.parse(gunzipSync(readFileSync(join(prevDir, "stats.json.gz"))).toString()).stats ?? {};
  for (const [k, a] of Object.entries(run)) {
    const t = (total[k] ??= { n: 0, still: 0, slow: 0, sumV: 0, phase: new Array(12).fill(0) });
    t.n += a.n; t.still += a.still; t.slow += a.slow; t.sumV += a.sumV; a.phase.forEach((v, i) => { t.phase[i] = (t.phase[i] ?? 0) + v; });
  }
  const out = mkdtempSync(join(tmpdir(), "ss-out-"));
  mkdirSync(out, { recursive: true });
  const compact = Object.fromEntries(Object.entries(total).map(([k, a]) => [k, { ...a, sumV: Math.round(a.sumV * 10) / 10 }]));
  const meta = { v: 1, buckets: BUCKETS, updated: new Date().toISOString(), keys: Object.keys(total).length, observaciones: Object.values(total).reduce((s, a) => s + a.n, 0) };
  writeFileSync(join(out, "stats.json.gz"), gzipSync(JSON.stringify({ ...meta, stats: compact }), { level: 9 }));
  execFileSync("bash", ["scripts/publish.sh", out], { stdio: "inherit", env: { ...process.env, BRANCH: "signal-stats", GITHUB_REPOSITORY: REPO, GITHUB_TOKEN: TOKEN } });
  console.log("acumulado:", JSON.stringify(meta));
}
main().catch((e) => { console.error(e); process.exit(1); });
