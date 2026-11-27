/**
 * Aprende el orden de paradas de cada ruta con lo que reportan los buses y publica las correcciones al GTFS que tengan evidencia fuerte.
 *
 * Cada bus manda su «última parada»; desde nov. 2026 esa parada avanza con él. Siguiendo a cada bus se cuentan los pasos de una parada
 * a la siguiente (cuántos buses y en cuántos días) y se comparan con el recorrido del GTFS (ver `packages/application/src/stop-order.ts`):
 * paradas que faltan (como la Calle 57 de la H15), paradas que los buses nunca visitan y pares al revés.
 *
 * Uso:
 *   npx tsx tools/stoporder.ts [segundos]                  graba en vivo, suma a la rama `stop-order` y publica (lo corre el workflow)
 *   LOTES=<carpeta>[,<carpeta>] npx tsx tools/stoporder.ts  solo informe con lotes guardados (`<ms>.pb`), sin publicar
 * Variables: RED=<network.json.gz> (red local en vez de bajarla), MIN_BUSES / MIN_DIAS / MIN_PARTE (umbrales del informe; para
 * publicar siempre se usan los fuertes, `STOP_ORDER_STRONG`), SOLO_INFORME=1 (graba en vivo pero no publica).
 *
 * Publica en la rama `stop-order`: `stats.json.gz` (pasos acumulados, sin datos de buses: solo conteos por ruta y par de paradas) y
 * `stop-fixes.json` (correcciones con evidencia fuerte). El workflow «GTFS diario» baja `stop-fixes.json` y lo aplica al armar la red
 * (`tools/network-dto.ts`), así les llega también a las apps ya publicadas.
 */
import { execFileSync } from "node:child_process";
import { gunzipSync, gzipSync } from "node:zlib";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STOP_ORDER_STRONG, StopOrderObserver, emptyStopOrderStats, learnStopFixes, mergeStopSteps, type LearnedStopFix, type StopOrderStats, type StopSteps } from "@transmi/application";
import type { TransitNetwork } from "@transmi/domain";
import { buildNetwork, decodePositions, parseGtfsLite } from "@transmi/infrastructure";

const SECONDS = Number(process.argv[2] ?? 420), EVERY_MS = 10_000;
const REPO = process.env.GITHUB_REPOSITORY ?? "itsandresortiz/transmi-live", TOKEN = process.env.GITHUB_TOKEN ?? "";
const url = () => `https://${TOKEN ? `x-access-token:${TOKEN}@` : ""}github.com/${REPO}.git`;
const BRANCH = "stop-order";
const bogotaDay = (ms: number) => new Date(ms - 5 * 3600_000).toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function clone(branch: string): string | null {
  const dir = mkdtempSync(join(tmpdir(), "so-"));
  try { execFileSync("git", ["clone", "-q", "--depth", "1", "--branch", branch, url(), dir], { stdio: "pipe" }); return dir; } catch { /* abajo */ }
  // si la rama existe y no se pudo bajar, no se sigue: publicar solo esta corrida borraría lo acumulado
  let exists = true;
  try { execFileSync("git", ["ls-remote", "--exit-code", "--heads", url(), branch], { stdio: "pipe" }); } catch (e) { exists = (e as { status?: number }).status !== 2; }
  if (exists) throw new Error(`no se pudo bajar la rama ${branch} (existe): no se publica para no borrar lo acumulado`);
  return null;
}

async function network(): Promise<TransitNetwork> {
  if (process.env.RED) return buildNetwork(JSON.parse(gunzipSync(readFileSync(process.env.RED)).toString()));
  // el GTFS reducido (sin las correcciones aprendidas: se aprende contra lo que publica TransMilenio, más las correcciones a mano)
  const dir = clone("live-data");
  if (!dir || !existsSync(join(dir, "gtfs-lite.zip"))) throw new Error("no hay gtfs-lite.zip en live-data");
  return buildNetwork(await parseGtfsLite(new Uint8Array(readFileSync(join(dir, "gtfs-lite.zip")))));
}

function report(net: TransitNetwork, stats: StopOrderStats, fixes: LearnedStopFix[]): void {
  const name = (id: string) => `${net.stops.get(id)?.name ?? "?"} (${id})`;
  const steps = Object.values(stats.steps).reduce((s, t) => s + Object.keys(t).length, 0);
  console.log(`rutas con pasos: ${Object.keys(stats.steps).length}, pasos distintos: ${steps}`);
  for (const f of fixes) {
    const e = `[${f.evidence.buses} buses, ${f.evidence.days} día(s), ${Math.round(f.evidence.share * 100)} %]`;
    if (f.kind === "add") console.log(`FALTA   ${f.route}: ${name(f.stop)} ${f.where === "after" ? "después de" : "antes de"} ${name(f.anchor)}${f.next ? ` y antes de ${name(f.next)}` : ""} ${e}`);
    else if (f.kind === "drop") console.log(`NO PARA ${f.route}: ${name(f.stop)} (entre ${name(f.prev)} y ${name(f.next)}) ${e}`);
    else console.log(`AL REVÉS ${f.route}: ${name(f.second)} va antes de ${name(f.first)} ${e}`);
  }
}

async function main() {
  const net = await network();
  const obs = new StopOrderObserver(net);
  const runs: { day: string; steps: StopSteps }[] = [];
  if (process.env.LOTES) {
    // lotes guardados: una corrida por carpeta y día
    for (const dir of process.env.LOTES.split(",")) {
      let cur: { day: string; o: StopOrderObserver } | null = null;
      for (const f of readdirSync(dir).filter((x) => x.endsWith(".pb")).sort()) {
        const day = bogotaDay(Number(f.slice(0, -3)));
        if (!cur || cur.day !== day) { if (cur) runs.push({ day: cur.day, steps: cur.o.steps }); cur = { day, o: new StopOrderObserver(net) }; }
        try { cur.o.observe(decodePositions(new Uint8Array(readFileSync(join(dir, f))))); } catch { /* lote cortado */ }
      }
      if (cur) runs.push({ day: cur.day, steps: cur.o.steps });
    }
  } else {
    const end = Date.now() + SECONDS * 1000;
    let polls = 0;
    while (Date.now() < end) {
      const t0 = Date.now();
      try {
        const res = await fetch("https://gtfs.transmilenio.gov.co/positions.pb", { headers: { "User-Agent": "Mozilla/5.0 (transmi-live)" } });
        if (res.ok) { obs.observe(decodePositions(new Uint8Array(await res.arrayBuffer()))); polls++; }
      } catch (e) { console.log("consulta fallida:", (e as Error).message); }
      const wait = EVERY_MS - (Date.now() - t0);
      if (Date.now() + wait < end) await sleep(Math.max(0, wait)); else break;
    }
    console.log(`consultas ${polls}, reportes ${obs.reports}`);
    runs.push({ day: bogotaDay(Date.now()), steps: obs.steps });
  }

  const publish = !process.env.LOTES && !process.env.SOLO_INFORME;
  let total = emptyStopOrderStats();
  const prev = publish ? clone(BRANCH) : null;
  if (prev && existsSync(join(prev, "stats.json.gz"))) total = JSON.parse(gunzipSync(readFileSync(join(prev, "stats.json.gz"))).toString());
  for (const r of runs) total = mergeStopSteps(total, r.steps, r.day);

  const th = { minBuses: Number(process.env.MIN_BUSES ?? STOP_ORDER_STRONG.minBuses), minDays: Number(process.env.MIN_DIAS ?? STOP_ORDER_STRONG.minDays), minShare: Number(process.env.MIN_PARTE ?? STOP_ORDER_STRONG.minShare) };
  report(net, total, learnStopFixes(total, net, th));
  if (!publish) return;

  const fixes = learnStopFixes(total, net, STOP_ORDER_STRONG);
  const out = mkdtempSync(join(tmpdir(), "so-out-"));
  writeFileSync(join(out, "stats.json.gz"), gzipSync(JSON.stringify(total), { level: 9 }));
  writeFileSync(join(out, "stop-fixes.json"), JSON.stringify({ v: 1, updated: new Date().toISOString(), thresholds: STOP_ORDER_STRONG, fixes }, null, 1));
  execFileSync("bash", ["scripts/publish.sh", out], { stdio: "inherit", env: { ...process.env, BRANCH, GITHUB_REPOSITORY: REPO, GITHUB_TOKEN: TOKEN } });
  console.log(`publicado: ${fixes.length} correcciones con evidencia fuerte`);
}
main().catch((e) => { console.error(e); process.exit(1); });
