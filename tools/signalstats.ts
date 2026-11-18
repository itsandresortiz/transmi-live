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
 * Desde el 2026-11-17 (v2) cada conteo va además por **dirección del bus** al llegar al cruce (N, E, S, O, o «?» si aún no se sabe):
 * en un mismo cruce, quien va de norte a sur puede esperar distinto que quien va de oriente a occidente. Las claves viejas (sin dirección)
 * se conservan tal cual.
 *
 * Uso: npx tsx tools/signalstats.ts [segundos_de_grabación]
 */
import { execFileSync } from "node:child_process";
import { gunzipSync, gzipSync } from "node:zlib";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { distanceMeters, toWorld } from "@transmi/domain";
import { TransitState, learnFromBuses, measuredSignals, signalPlans, type BusGo, type BusNearSignal, type Heading } from "@transmi/application";
import { buildNetwork, decodePositions, parseGtfsLite } from "@transmi/infrastructure";
import { SignalNearCollector } from "./signal-near";

/** Reportes de buses junto a los semáforos medidos a mano que se conservan (para volver a compararlos cada vez que se mide de nuevo). */
const KEEP_DAYS = 7;
type NearStore = { obs: Record<string, [number, 0 | 1, Heading, number?][]>; goes: Record<string, [number, number, Heading][]> };

const SECONDS = Number(process.argv[2] ?? 270), EVERY_MS = 18_000;
const REPO = process.env.GITHUB_REPOSITORY ?? "itsandresortiz/transmi-live", TOKEN = process.env.GITHUB_TOKEN ?? "";
const url = `https://${TOKEN ? `x-access-token:${TOKEN}@` : ""}github.com/${REPO}.git`;
const NEAR_M = 35, STOP_EXCLUDE_M = 45, STILL_MPS = 1.2;
const BUCKETS = ["0-6", "6-10", "10-16", "16-20", "20-24"];
const bucketOf = (h: number) => (h < 6 ? 0 : h < 10 ? 1 : h < 16 ? 2 : h < 20 ? 3 : 4);
const dayType = (d: Date) => { const w = d.getUTCDay(); return w === 0 ? "su" : w === 6 ? "sa" : "wk"; };

/** phase: 12 casillas de 5 s dentro del minuto (solo detenciones). p90 / p120: lo mismo dentro de vueltas de 90 y 120 s contadas desde
 *  la medianoche (desde el 2026-11-17): un ciclo de 90 s medido en la calle (Cra. 102B Bis × Calle 145) no deja huella en el minuto,
 *  porque cada vuelta cae corrida 30 s. */
interface Acc { n: number; still: number; slow: number; sumV: number; phase: number[]; p90?: number[]; p120?: number[] }
type Stats = Record<string, Acc>;                      // "lon,lat|tipoDía|franja|dirección" (antes de v2, sin dirección)

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

  // semáforos medidos a mano (los del archivo del proyecto): los buses que se les acercan se guardan aparte para aprender unos de otros
  const measured = existsSync("tools/data/mediciones-semaforos.json") ? measuredSignals(JSON.parse(readFileSync("tools/data/mediciones-semaforos.json", "utf8"))) : [];
  const near = new SignalNearCollector(measured);
  const trunkOrDual = (rid: string) => { const sys = st.network.routes.get(rid)?.system; return sys === "troncal" || sys === "dual"; };
  const run: Stats = {};
  const prev = new Map<string, { x: number; y: number; t: number; lon: number; lat: number; dir: string }>();
  // hacia dónde va el bus (N, E, S, O) según cómo se movió desde su reporte anterior; quieto, se queda con la última que se le vio
  const dirOf = (dx: number, dy: number): string => { const deg = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360; return ["N", "E", "S", "O"][Math.round(deg / 90) % 4]!; };
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
          near.add({ id: r.id, lon: r.position.lon, lat: r.position.lat, t: r.reportedAt, trunk: trunkOrDual(r.routeId) });
          if (trunk(r.routeId)) continue;
          const w = toWorld(r.position), p = prev.get(r.id);
          const moved = p ? distanceMeters(p, w) : 0;
          const dir = p && moved > 8 ? dirOf(w.x - p.x, w.y - p.y) : p?.dir ?? "?";
          prev.set(r.id, { x: w.x, y: w.y, t: r.reportedAt, lon: r.position.lon, lat: r.position.lat, dir });
          if (!p || r.reportedAt <= p.t) continue;
          const dt = r.reportedAt - p.t; if (dt < 8 || dt > 90) continue;
          const speed = moved / dt;
          // semáforos a menos de 35 m de la posición nueva
          const cx = Math.floor(r.position.lon / 0.0005), cy = Math.floor(r.position.lat / 0.0005);
          let best = -1, bd = NEAR_M;
          for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const i of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
            const d = distanceMeters(toWorld({ lat: sig[i]![1], lon: sig[i]![0] }), w); if (d < bd) { bd = d; best = i; }
          }
          if (best < 0 || nearStop(r.position.lon, r.position.lat)) continue;
          const d = new Date((r.reportedAt - 5 * 3600) * 1000);
          const k = `${sig[best]![0]},${sig[best]![1]}|${dayType(d)}|${bucketOf(d.getUTCHours())}|${dir}`;
          const a = (run[k] ??= { n: 0, still: 0, slow: 0, sumV: 0, phase: new Array(12).fill(0), p90: new Array(18).fill(0), p120: new Array(24).fill(0) });
          a.n++; a.sumV += speed; obs++;
          if (speed < 4) a.slow++;
          if (speed < STILL_MPS) {
            a.still++; a.phase[Math.floor(((r.reportedAt % 60) + 60) % 60 / 5)]!++;
            const sec = ((r.reportedAt - 5 * 3600) % 86_400 + 86_400) % 86_400;      // segundo del día en Bogotá
            a.p90![Math.floor((sec % 90) / 5)]!++; a.p120![Math.floor((sec % 120) / 5)]!++;
          }
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
    if (a.p90) { t.p90 ??= new Array(18).fill(0); a.p90.forEach((v, i) => { t.p90![i] = (t.p90![i] ?? 0) + v; }); }
    if (a.p120) { t.p120 ??= new Array(24).fill(0); a.p120.forEach((v, i) => { t.p120![i] = (t.p120![i] ?? 0) + v; }); }
  }
  const out = mkdtempSync(join(tmpdir(), "ss-out-"));
  mkdirSync(out, { recursive: true });
  const compact = Object.fromEntries(Object.entries(total).map(([k, a]) => [k, { ...a, sumV: Math.round(a.sumV * 10) / 10 }]));
  const meta = { v: 2, direcciones: "N, E, S, O (hacia dónde va el bus), ? = sin saber", buckets: BUCKETS, updated: new Date().toISOString(), keys: Object.keys(total).length, observaciones: Object.values(total).reduce((s, a) => s + a.n, 0) };
  // buses junto a los semáforos medidos: se suman a los de días anteriores y se vuelve a calcular lo que dicen con la medida de hoy
  const store: NearStore = { obs: {}, goes: {} };
  if (prevDir && existsSync(join(prevDir, "cerca-medidos.json.gz"))) Object.assign(store, JSON.parse(gunzipSync(readFileSync(join(prevDir, "cerca-medidos.json.gz"))).toString()));
  const since = Date.now() / 1000 - KEEP_DAYS * 86_400, learned: Record<string, unknown> = {};
  const calles: Record<string, [number, number, string, number]> = prevDir && existsSync(join(prevDir, "osm-calles.json")) ? (JSON.parse(readFileSync(join(prevDir, "osm-calles.json"), "utf8")) as { s: Record<string, [number, number, string, number]> }).s : {};
  // los puestos a mano traen su rumbo
  if (existsSync("tools/data/semaforos-manuales.json")) for (const m of (JSON.parse(readFileSync("tools/data/semaforos-manuales.json", "utf8")) as { semaforos: { lat: number; lon: number; rumbo?: number }[] }).semaforos) if (m.rumbo != null) calles[`${m.lon.toFixed(6)},${m.lat.toFixed(6)}`] = [m.rumbo, 1, "", 1];
  measured.forEach((m, k) => {
    const key = `${m.lat.toFixed(6)},${m.lon.toFixed(6)}`;
    const obsAll = [...(store.obs[key] ?? []), ...near.obs[k]!.map((o) => (o.b == null ? [o.t, o.still ? 1 : 0, o.h] : [o.t, o.still ? 1 : 0, o.h, o.b]) as [number, 0 | 1, Heading, number?])].filter((o) => o[0] >= since);
    const goesAll = [...(store.goes[key] ?? []), ...near.goes[k]!.map((g) => [g.a, g.b, g.h] as [number, number, Heading])].filter((g) => g[0] >= since);
    store.obs[key] = obsAll; store.goes[key] = goesAll;
    const model = signalPlans(m.marks);      // el plan de cada hora del día (de madrugada no es el mismo que al mediodía)
    const obs: BusNearSignal[] = obsAll.map(([t, still, h, b]) => ({ t, still: still === 1, h, b })), goes: BusGo[] = goesAll.map(([a, b, h]) => ({ a, b, h }));
    // hacia dónde mira el semáforo (calle de OpenStreetMap, `tools/osm-calles.ts`): solo cuentan los buses que van en ese sentido
    const rumbo = calles[`${m.lon.toFixed(6)},${m.lat.toFixed(6)}`]?.[0];
    const L = learnFromBuses(model, m.inverse, obs, goes, rumbo), day = learnFromBuses(model, m.inverse, obs.filter((o) => o.t >= Date.now() / 1000 - 86_400), goes.filter((g) => g.a >= Date.now() / 1000 - 86_400), rumbo);
    learned[key] = { titulo: m.title, tm: m.tm, ...L, ultimas24h: { n: day.n, agree: day.agree, shift: day.shift, text: day.text } };
  });
  writeFileSync(join(out, "cerca-medidos.json.gz"), gzipSync(JSON.stringify(store), { level: 9 }));
  writeFileSync(join(out, "aprendizaje.json"), JSON.stringify({ v: 1, updated: new Date().toISOString(), semaforos: learned }));
  console.log("semáforos medidos:", Object.entries(learned).map(([k, v]) => `${k}: ${(v as { text: string }).text}`).join("\n"));
  writeFileSync(join(out, "stats.json.gz"), gzipSync(JSON.stringify({ ...meta, stats: compact }), { level: 9 }));
  execFileSync("bash", ["scripts/publish.sh", out], { stdio: "inherit", env: { ...process.env, BRANCH: "signal-stats", GITHUB_REPOSITORY: REPO, GITHUB_TOKEN: TOKEN } });
  console.log("acumulado:", JSON.stringify(meta));
}
main().catch((e) => { console.error(e); process.exit(1); });
