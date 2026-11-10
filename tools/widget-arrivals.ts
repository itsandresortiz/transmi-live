/**
 * Publica las llegadas por parada para el widget del teléfono, en la rama `widget-data` (64 archivos pequeños: a/0.json … a/63.json).
 * Lo corre el workflow «Llegadas para el widget»: durante ~5 min, cada ~50 s baja las posiciones, calcula con el mismo motor de la app y sube si cambió.
 *
 * Variables: GITHUB_TOKEN y GITHUB_REPOSITORY (para subir); ROUNDS (vueltas, 6), GAP (segundos entre vueltas, 50);
 * para probar sin red ni subir: LOCAL_GTFS, LOCAL_POSITIONS (rutas de archivos) y OUT (carpeta de salida).
 */
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TransitState, WIDGET_SHARDS, arrivalsByStop, widgetShard } from "@transmi/application";
import type { SystemType } from "@transmi/domain";
import { buildNetwork, decodePositions, parseGtfsLite } from "@transmi/infrastructure";

const REPO = process.env.GITHUB_REPOSITORY ?? "itsandresortiz/transmi-live";
const RAW = `https://raw.githubusercontent.com/${REPO}/live-data/`;
const ROUNDS = Number(process.env.ROUNDS ?? 6), GAP = Number(process.env.GAP ?? 50) * 1000;
/** Los mismos colores de sistema de la app (apps/mobile/src/ui/theme.ts). */
const COLOR: Record<SystemType, string> = { troncal: "#e11d2e", dual: "#8b5cf6", alimentador: "#16a34a", zonal: "#2563eb", otro: "#64748b" };

async function bytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (transmi-live)" }, signal: AbortSignal.timeout(40_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
/** Posiciones: primero directo de TransMilenio; si no responde, la copia de la rama live-data. */
async function positions(): Promise<Uint8Array> {
  if (process.env.LOCAL_POSITIONS) return new Uint8Array(readFileSync(process.env.LOCAL_POSITIONS));
  try { return await bytes("https://gtfs.transmilenio.gov.co/positions.pb"); } catch { return bytes(`${RAW}positions.pb?t=${Date.now()}`); }
}

function write(dir: string, state: TransitState, nowMs: number): number {
  const shards: Record<string, { r: string; h: string; t: number; c: string }[]>[] = Array.from({ length: WIDGET_SHARDS }, () => ({}));
  let stops = 0;
  for (const [id, list] of arrivalsByStop(state, nowMs)) { shards[widgetShard(id)]![id] = list.map((a) => ({ r: a.r, h: a.h, t: a.t, c: COLOR[a.s] })); stops++; }
  mkdirSync(join(dir, "a"), { recursive: true });
  shards.forEach((s, i) => writeFileSync(join(dir, "a", `${i}.json`), JSON.stringify({ at: Math.round(nowMs / 1000), stops: s })));
  return stops;
}

async function main() {
  const gtfs = process.env.LOCAL_GTFS ? new Uint8Array(readFileSync(process.env.LOCAL_GTFS)) : await bytes(`${RAW}gtfs-lite.zip`);
  const state = new TransitState();
  state.setNetwork(buildNetwork(await parseGtfsLite(gtfs)));
  const local = !!process.env.OUT, dir = process.env.OUT ?? mkdtempSync(join(tmpdir(), "widget-"));
  const url = `https://x-access-token:${process.env.GITHUB_TOKEN}@github.com/${REPO}.git`;
  const git = (cmd: string) => execSync(`git ${cmd}`, { cwd: dir, stdio: "pipe" });
  if (!local) { git("init -q -b widget-data"); git('config user.name "transmi-live-bot"'); git('config user.email "actions@users.noreply.github.com"'); }

  for (let i = 1; i <= (local ? 1 : ROUNDS); i++) {
    const t0 = Date.now();
    try {
      const reports = decodePositions(await positions());
      const now = process.env.LOCAL_POSITIONS ? Math.max(...reports.map((r) => r.reportedAt)) * 1000 : Date.now();
      state.applyPositions(reports, now);
      const stops = write(dir, state, now);
      if (!local) {
        // una sola versión en la rama (como las demás ramas de datos): se reemplaza a la fuerza
        git(`checkout -q --orphan s${i}`); git("add -A"); git(`commit -q -m "llegadas ${new Date().toISOString()}"`);
        git(`push -q --force ${url} s${i}:widget-data`);
      }
      console.log(`[${i}] ${state.fleet.size} buses, ${stops} paradas con llegadas, ${Date.now() - t0} ms`);
    } catch (e) { console.log(`[${i}] falló: ${String(e).replace(/x-access-token:[^@]*@/, "")}`); }
    if (i < ROUNDS && !local) await new Promise((r) => setTimeout(r, Math.max(0, GAP - (Date.now() - t0))));
  }
}
void main();
