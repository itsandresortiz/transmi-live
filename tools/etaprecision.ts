/**
 * Mide qué tan bien acierta la app la hora de llegada de un bus a sus próximas paradas.
 *
 * TransMilenio ya no publica la hora real de llegada a cada parada (ni actualiza la «última parada» de cada bus), así que la verdad
 * se saca de las posiciones: se sigue a cada bus sobre el trazado de su ruta y la hora en que cruza cada parada se interpola entre
 * los dos reportes que la encierran (margen de ± medio intervalo entre reportes, sin sesgo).
 * Contra eso se compara lo que la app habría mostrado en cada lote (`arrivalAtIndex`, el mismo cálculo de las pantallas).
 *
 * Uso: npx tsx tools/etaprecision.ts [segundos] [espera_entre_descargas]
 *      LOTES=<carpeta> npx tsx tools/etaprecision.ts   (lotes ya guardados: archivos `<ms>.pb`, la hora de descarga en milisegundos)
 * Con lotes guardados se puede medir la misma captura varias veces y por franjas (`DESDE`/`HASTA`, hora de Bogotá, p. ej. 16 y 20).
 * `GUARDAR=<carpeta>` guarda cada lote descargado como `<ms>.pb` (para volver a medirlo luego con `LOTES`; el workflow los sube como
 * artefacto «lotes-…»).
 * Archivos locales en vez de descargarlos (opcional): `GTFS=<gtfs-lite.zip>`, `TRAMOS=<stats.json.gz de hop-stats>`,
 * `HUELLAS=<huellas.json, o stats.json.gz de signal-stats para recalcularlas>`.
 *
 * Al final imprime un resumen corto (lo que sirve para decidir): con y sin huellas de semáforos, y la corrección de segundos aparte para la
 * próxima parada y para las demás (`HOP_SPLIT_NEXT`/`HOP_SPLIT_LATER` en hop-profile.ts), con sesgo, error mediano y p90 a 1, 2 y 3 paradas.
 */
import { gunzipSync } from "node:zlib";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SignalWaits, TransitState, arrivalAtIndex, buildHopProfile, rawArrival, shapeStops, signalFootprints, type Footprint, type FootprintStats } from "@transmi/application";
import type { VehicleReport } from "@transmi/domain";
import { buildNetwork, decodePositions, parseGtfsLite } from "@transmi/infrastructure";

const SECONDS = Number(process.argv[2] ?? 540), GAP_MS = Number(process.argv[3] ?? 8) * 1000;
const REPO = process.env.GITHUB_REPOSITORY ?? "itsandresortiz/transmi-live";
const pct = (a: number[], p: number) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))]! : NaN; };

/** Un archivo local (si se dio la variable) o descargado de una rama del repositorio. */
async function bytes(local: string | undefined, branchFile: string): Promise<Uint8Array> {
  if (local) return new Uint8Array(readFileSync(local));
  const r = await fetch(`https://raw.githubusercontent.com/${REPO}/${branchFile}`);
  if (!r.ok) throw new Error(`${branchFile}: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}
/** Las huellas de los semáforos: `huellas.json` publicado o, si aún no está (o se pasa el stats.json.gz), calculadas aquí. */
async function footprints(): Promise<Record<string, Footprint>> {
  const local = process.env.HUELLAS;
  const fromStats = (b: Uint8Array) => signalFootprints((JSON.parse(gunzipSync(b).toString()) as { stats?: Record<string, FootprintStats> }).stats ?? {});
  if (local) return local.endsWith(".gz") ? fromStats(new Uint8Array(readFileSync(local))) : (JSON.parse(readFileSync(local, "utf8")) as { s: Record<string, Footprint> }).s;
  try { return (JSON.parse(new TextDecoder().decode(await bytes(undefined, "signal-stats/huellas.json"))) as { s: Record<string, Footprint> }).s; } catch { /* aún no publicado */ }
  return fromStats(await bytes(undefined, "signal-stats/stats.json.gz"));
}

async function main() {
  const net = buildNetwork(await parseGtfsLite(await bytes(process.env.GTFS, "live-data/gtfs-lite.zip")));
  const batches: { reports: VehicleReport[]; at: number }[] = [];
  let lastSig = "";
  const DIR = process.env.LOTES, SAVE = process.env.GUARDAR, FROM_H = Number(process.env.DESDE ?? 0), TO_H = Number(process.env.HASTA ?? 24);
  const hourBog = (ms: number) => new Date(ms - 5 * 3600_000).getUTCHours() + new Date(ms - 5 * 3600_000).getUTCMinutes() / 60;
  if (DIR) for (const f of readdirSync(DIR).filter((x) => x.endsWith(".pb")).sort()) {
    const at = Number(f.slice(0, -3)), h = hourBog(at);
    if (h < FROM_H || h >= TO_H) continue;
    // un lote cortado (descarga interrumpida) se salta en vez de detener toda la medición
    try { batches.push({ reports: decodePositions(new Uint8Array(readFileSync(join(DIR, f)))), at: at / 1000 }); } catch (e) { console.log(`lote ${f} ilegible, se salta:`, e instanceof Error ? e.message : e); }
  }
  const end = DIR ? 0 : Date.now() + SECONDS * 1000;
  while (Date.now() < end) {
    try {
      const r = await fetch("https://gtfs.transmilenio.gov.co/positions.pb", { headers: { "User-Agent": "Mozilla/5.0 (transmi-live)" } });
      const buf = new Uint8Array(await r.arrayBuffer());
      const sig = Buffer.from(buf).toString("base64").slice(0, 64) + buf.length;
      if (r.ok && sig !== lastSig) {
        lastSig = sig;
        const now = Date.now();
        batches.push({ reports: decodePositions(buf), at: now / 1000 });
        if (SAVE) { mkdirSync(SAVE, { recursive: true }); writeFileSync(join(SAVE, `${now}.pb`), buf); }
      }
    } catch (e) { console.log("descarga falló", e instanceof Error ? e.message : e); }
    await new Promise((r) => setTimeout(r, GAP_MS));
  }
  console.log(`lotes: ${batches.length} en ${batches.length ? (batches[batches.length - 1]!.at - batches[0]!.at).toFixed(0) : 0} s (hora de Bogotá ${batches.length ? hourBog(batches[0]!.at * 1000).toFixed(2) : "-"}–${batches.length ? hourBog(batches[batches.length - 1]!.at * 1000).toFixed(2) : "-"}), buses por lote: ${batches.length ? Math.round(batches.reduce((a, b) => a + b.reports.length, 0) / batches.length) : 0}`);
  if (batches.length < 6) { console.log("Muy pocos lotes. No se mide."); return; }

  const state = new TransitState(); state.setNetwork(net);
  // tiempos reales por tramo (rama hop-stats): se compara el valor fijo con varias formas de usarlos
  try {
    const raw = JSON.parse(gunzipSync(await bytes(process.env.TRAMOS, "hop-stats/stats.json.gz")).toString());
    const stops = new Map<string, number>();
    for (const shapes of net.shapes.values()) for (const sh of shapes) stops.set(`${sh.routeId}|${sh.direction}`, sh.stopIds.length);
    state.hopProfile.load(buildHopProfile(raw.stats ?? {}, (k) => stops.get(k), raw.updated ?? "", 1));
    console.log(`perfil de tramos: ${state.hopProfile.size} recorridos (datos de ${raw.updated})`);
  } catch (e) { console.log("sin perfil de tramos:", e instanceof Error ? e.message : e); }
  const VARIANTS: { name: string; apply: boolean; minN: number; priorN: number }[] = [
    { name: "valor fijo (antes)", apply: false, minN: 0, priorN: 0 },
    { name: "aprendido, mín 3, mezcla 3", apply: true, minN: 3, priorN: 3 },
    { name: "aprendido, mín 3, sin mezcla", apply: true, minN: 3, priorN: 0 },
    { name: "aprendido, mín 8, mezcla 3", apply: true, minN: 8, priorN: 3 },
    { name: "aprendido, mín 1, mezcla 10", apply: true, minN: 1, priorN: 10 },
  ];
  const useVariant = (k: number) => { const x = VARIANTS[k]!; state.hopProfile.apply = x.apply; state.hopProfile.minN = x.minN; state.hopProfile.priorN = x.priorN; state.hopProfile.extra = 0; state.hopProfile.extraBy = null; state.hopProfile.split = null; };
  // huellas de semáforos no medidos: se calcula cada llegada con ellas y sin ellas (el resto igual)
  const plain = state.signalWaits, printed = new SignalWaits();
  try {
    const fp = await footprints();
    printed.loadFootprints({ use: true, s: fp });
    console.log(`huellas: ${printed.size} semáforos (${Object.keys(fp).length} huellas por día, franja y sentido)`);
  } catch (e) { console.log("sin huellas:", e instanceof Error ? e.message : e); }
  const withPrints = (on: boolean) => { (state as unknown as { signalWaits: SignalWaits }).signalWaits = on ? printed : plain; };      // las correcciones (+ s) se suman aparte
  useVariant(2);      // lo que usa la app desde el 2026-11-17 (aprendido, sin mezcla)
  // por bus: por dónde ha ido (metros sobre su trazado, hora del GPS) y qué se le pronosticó
  type Pred = { stopS: number; away: number; madeAt: number; shown: number; raw: number; remaining: number; alt: number[]; base: number; printed: number };
  const tracks = new Map<string, { key: string; pts: { t: number; s: number }[]; preds: Pred[] }>();
  for (const b of batches) {
    state.applyPositions(b.reports, b.at * 1000);
    for (const v of state.fleet.values()) {
      const seq = state.sequenceForDisplay(v); if (!seq) continue;
      const info = shapeStops(state, seq.shape); if (!info) continue;
      const hit = info.path.project(v.world, 0, 0, 120);
      const a = info.s[seq.index], nx = info.s[seq.index + 1];
      if (!hit || a == null || nx == null || hit.s < a - 150 || hit.s > nx + 150) continue;
      const key = `${seq.shape.routeId}|${seq.shape.direction}`;
      let tr = tracks.get(v.id);
      if (!tr || tr.key !== key) { tr = { key, pts: [], preds: [] }; tracks.set(v.id, tr); }
      const lastPt = tr.pts[tr.pts.length - 1];
      if (!lastPt || v.reportedAt > lastPt.t) tr.pts.push({ t: v.reportedAt, s: hit.s });
      for (let j = seq.index + 1; j <= Math.min(seq.index + 6, info.s.length - 1); j++) {
        const alt = VARIANTS.map((_, k) => { useVariant(k); return rawArrival(state, v, seq.shape, seq.index, j, b.at * 1000).eta; });
        useVariant(2);      // las correcciones (× tramo, + segundos) se prueban sobre lo que usa la app (aprendido, sin mezcla)
        const rw = rawArrival(state, v, seq.shape, seq.index, j, b.at * 1000);
        // lo que usa la app sin ninguna corrección de segundos, sin huellas y con ellas
        withPrints(true);
        const pr = printed.size ? rawArrival(state, v, seq.shape, seq.index, j, b.at * 1000).eta : rw.eta;
        withPrints(false);
        useVariant(1);
        tr.preds.push({ stopS: info.s[j]!, away: j - seq.index, madeAt: b.at, shown: arrivalAtIndex(state, v, seq.shape, seq.index, j, b.at * 1000), raw: rw.eta, remaining: rw.remaining, alt, base: rw.eta, printed: pr });
      }
    }
  }
  // la verdad: cuándo cruzó cada parada
  const cross = (pts: { t: number; s: number }[], S: number): number | null => {
    for (let i = 1; i < pts.length; i++) { const p = pts[i - 1]!, q = pts[i]!; if (p.s < S && q.s >= S && q.t - p.t <= 200 && q.s - p.s < 3500) return p.t + (q.t - p.t) * (S - p.s) / (q.s - p.s); }
    return null;
  };
  const endAt = batches[batches.length - 1]!.at;
  const FACTORS = [1, 1.1, 1.2, 1.3, 1.4], OFFSETS = [0, 10, 15, 20, 30, 45, 60], BUCKETS = ["no vencida", "vencida 0–30 s", "30–60 s", "60–120 s", "más de 120 s"];
  const bucket = (d: number) => (d < 0 ? 0 : d < 30 ? 1 : d < 60 ? 2 : d < 120 ? 3 : 4);
  interface G { n: number; gone: number; lleg: number; llegGone: number; exp: { n: number; gone: number }[]; err: number[][]; off: number[][]; shown: number[]; alt: number[][]; sum: { base: number; printed: number; truth: number }[] }
  const by = new Map<number, G>();
  for (const tr of tracks.values()) {
    const lastPt = tr.pts[tr.pts.length - 1]!;
    for (const p of tr.preds) {
      // solo cuentan los pronósticos del primer tercio de la captura: así quedan al menos dos tercios para ver llegar el bus.
      // (La corrida del 2026-11-11 contó también los del final, que no podían verse llegar: sus cifras de sesgo para 2+ paradas no valen.)
      // En capturas largas (lotes guardados) basta con dejar 15 min después de cada pronóstico.
      if (p.madeAt > endAt - Math.min((endAt - batches[0]!.at) * 2 / 3, 900)) continue;
      let truth = cross(tr.pts, p.stopS);
      // si el bus siguió reportando hasta el final y aún no llegaba a la parada, se sabe que llegó DESPUÉS de su último reporte:
      // se cuenta como «muy tarde» (no se descarta: descartarlo haría ver los tiempos mejores de lo que son)
      const late = truth == null && lastPt.s < p.stopS && endAt - lastPt.t < 150 && lastPt.t > p.madeAt;
      if (truth == null && !late) continue;
      if (late) truth = Infinity;
      const g2 = by.get(p.away) ?? by.set(p.away, { n: 0, gone: 0, lleg: 0, llegGone: 0, exp: BUCKETS.map(() => ({ n: 0, gone: 0 })), err: FACTORS.map(() => []), off: OFFSETS.map(() => []), shown: [], alt: VARIANTS.map(() => []), sum: [] }).get(p.away)!;
      g2.n++;
      const says = p.shown - p.madeAt <= 15, passed = truth! < p.madeAt;
      const e = g2.exp[bucket(p.madeAt - p.raw)]!; e.n++; if (passed) e.gone++;
      if (says) { g2.lleg++; if (passed) g2.llegGone++; }
      if (passed) { g2.gone++; continue; }
      g2.shown.push(p.shown - truth!);
      g2.sum.push({ base: p.base, printed: p.printed, truth: truth! });
      p.alt.forEach((eta, k) => g2.alt[k]!.push(eta - truth!));
      FACTORS.forEach((f, k) => g2.err[k]!.push(p.raw + p.remaining * (f - 1) - truth!));
      OFFSETS.forEach((o, k) => g2.off[k]!.push(p.raw + o - truth!));
    }
  }
  const med = (a: number[]) => pct(a, 0.5), fin = (x: number) => (Number.isFinite(x) ? x.toFixed(0) : "más de lo medible");
  console.log("\n=== HORA DE LLEGADA A LAS PRÓXIMAS PARADAS (negativo = la app dice que llega antes de lo que fue) ===");
  for (const away of [...by.keys()].sort((x, y) => x - y)) {
    const g2 = by.get(away)!;
    console.log(`\na ${away} parada(s): n=${g2.n} · ya había pasado al mostrarse: ${(100 * g2.gone / g2.n).toFixed(0)} % · decía «llegando»: ${(100 * g2.lleg / g2.n).toFixed(0)} % (de esos, ya había pasado: ${g2.lleg ? (100 * g2.llegGone / g2.lleg).toFixed(0) : "-"} %)`);
    console.log("   según cuánto hace que venció la cuenta → ya había pasado: " + g2.exp.map((e, k) => `${BUCKETS[k]}: ${e.n ? (100 * e.gone / e.n).toFixed(0) : "-"} % (n=${e.n})`).join(" · "));
    console.log(`   lo mostrado: sesgo ${fin(med(g2.shown))} s, error mediano ${fin(med(g2.shown.map(Math.abs)))} s`);
    VARIANTS.forEach((x, k) => console.log(`   ${x.name}: sesgo ${fin(med(g2.alt[k]!))} s, error mediano ${fin(med(g2.alt[k]!.map(Math.abs)))} s, p75 ${fin(pct(g2.alt[k]!.map(Math.abs), 0.75))} s (n=${g2.alt[k]!.length})`));
    OFFSETS.forEach((o, k) => console.log(`   aprendido + ${o} s: sesgo ${fin(med(g2.off[k]!))} s, error mediano ${fin(med(g2.off[k]!.map(Math.abs)))} s, p75 ${fin(pct(g2.off[k]!.map(Math.abs), 0.75))} s (n=${g2.off[k]!.length})`));
    FACTORS.forEach((f, k) => console.log(`   aprendido, tramo × ${f}: sesgo ${fin(med(g2.err[k]!))} s, error mediano ${fin(med(g2.err[k]!.map(Math.abs)))} s, p75 ${fin(pct(g2.err[k]!.map(Math.abs), 0.75))} s (n=${g2.err[k]!.length})`));
  }
  summary(by, fin);
}

/** El resumen para decidir: huellas sí o no y la corrección de segundos para la próxima parada y las demás. */
function summary(by: Map<number, { sum: { base: number; printed: number; truth: number }[] }>, fin: (x: number) => string) {
  const row = (errs: number[]) => `sesgo ${fin(pct(errs, 0.5)).padStart(4)} · mediana ${fin(pct(errs.map(Math.abs), 0.5)).padStart(3)} · p90 ${fin(pct(errs.map(Math.abs), 0.9)).padStart(4)}`;
  const at = (k: number) => by.get(k)?.sum ?? [];
  const AWAY = [1, 2, 3];
  console.log("\n=== RESUMEN (segundos; negativo = la app dice que llega antes; sin el ajuste de «llegando») ===");
  console.log(`pronósticos medidos: ${AWAY.map((k) => `${at(k).length} a ${k} parada(s)`).join(", ")}`);
  const show = (name: string, f: (x: { base: number; printed: number; truth: number }, away: number) => number) => {
    console.log(`\n${name}`);
    for (const k of AWAY) console.log(`   a ${k}: ${row(at(k).map((x) => f(x, k) - x.truth))}`);
  };
  show("sin corrección", (x) => x.base);
  show("+15 s a todas (lo de las apps hasta hoy)", (x) => x.base + 15);
  show("+15 s a todas + huellas de semáforos", (x) => x.printed + 15);
  // solo donde las huellas cambian algo (el bus cruza un semáforo con huella en rojo): ahí se ve si aciertan
  console.log("\nsolo donde las huellas suman espera:");
  for (const k of AWAY) {
    const hit = at(k).filter((x) => x.printed - x.base > 0.5);
    console.log(`   a ${k}: n=${hit.length} (${at(k).length ? ((100 * hit.length) / at(k).length).toFixed(1) : "-"} %), espera mediana ${fin(pct(hit.map((x) => x.printed - x.base), 0.5))} s · sin huellas ${row(hit.map((x) => x.base + 15 - x.truth))} · con huellas ${row(hit.map((x) => x.printed + 15 - x.truth))}`);
  }
  // corrección aparte: N s a la próxima parada, L s a las demás
  console.log("\nprimera parada + N s, las demás + L s (mediana del error a 1 / 2 / 3 paradas; p90 a 1 / 2 / 3):");
  const NEXT = [0, 5, 10, 15, 20, 25, 30], LATER = [-10, -5, 0, 5, 10, 15];
  for (const n of NEXT) for (const l of LATER) {
    const e = AWAY.map((k) => at(k).map((x) => x.base + (k === 1 ? n : l) - x.truth));
    console.log(`   +${String(n).padStart(2)} / ${(l >= 0 ? "+" : "") + l}`.padEnd(14) + `mediana ${e.map((a) => fin(pct(a.map(Math.abs), 0.5)).padStart(3)).join(" / ")} · p90 ${e.map((a) => fin(pct(a.map(Math.abs), 0.9)).padStart(4)).join(" / ")} · sesgo ${e.map((a) => fin(pct(a, 0.5)).padStart(4)).join(" / ")}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
