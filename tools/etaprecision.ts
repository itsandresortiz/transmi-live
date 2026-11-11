/**
 * Mide qué tan bien acierta la app la hora de llegada de un bus a sus próximas paradas.
 *
 * TransMilenio ya no publica la hora real de llegada a cada parada (ni actualiza la «última parada» de cada bus), así que la verdad
 * se saca de las posiciones: se sigue a cada bus sobre el trazado de su ruta y la hora en que cruza cada parada se interpola entre
 * los dos reportes que la encierran (margen de ± medio intervalo entre reportes, sin sesgo).
 * Contra eso se compara lo que la app habría mostrado en cada lote (`arrivalAtIndex`, el mismo cálculo de las pantallas).
 *
 * Uso: npx tsx tools/etaprecision.ts [segundos] [espera_entre_descargas]
 */
import { TransitState, arrivalAtIndex, rawArrival, shapeStops } from "@transmi/application";
import type { VehicleReport } from "@transmi/domain";
import { buildNetwork, decodePositions, parseGtfsLite } from "@transmi/infrastructure";

const SECONDS = Number(process.argv[2] ?? 540), GAP_MS = Number(process.argv[3] ?? 8) * 1000;
const REPO = process.env.GITHUB_REPOSITORY ?? "itsandresortiz/transmi-live";
const pct = (a: number[], p: number) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))]! : NaN; };

async function main() {
  const g = await fetch(`https://raw.githubusercontent.com/${REPO}/live-data/gtfs-lite.zip`);
  const net = buildNetwork(await parseGtfsLite(new Uint8Array(await g.arrayBuffer())));
  const batches: { reports: VehicleReport[]; at: number }[] = [];
  let lastSig = "";
  const end = Date.now() + SECONDS * 1000;
  while (Date.now() < end) {
    try {
      const r = await fetch("https://gtfs.transmilenio.gov.co/positions.pb", { headers: { "User-Agent": "Mozilla/5.0 (transmi-live)" } });
      const buf = new Uint8Array(await r.arrayBuffer());
      const sig = Buffer.from(buf).toString("base64").slice(0, 64) + buf.length;
      if (r.ok && sig !== lastSig) { lastSig = sig; batches.push({ reports: decodePositions(buf), at: Date.now() / 1000 }); }
    } catch (e) { console.log("descarga falló", e instanceof Error ? e.message : e); }
    await new Promise((r) => setTimeout(r, GAP_MS));
  }
  console.log(`lotes: ${batches.length} en ${SECONDS} s`);
  if (batches.length < 6) { console.log("Muy pocos lotes. No se mide."); return; }

  const state = new TransitState(); state.setNetwork(net);
  // por bus: por dónde ha ido (metros sobre su trazado, hora del GPS) y qué se le pronosticó
  type Pred = { stopS: number; away: number; madeAt: number; shown: number; raw: number };
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
      for (let j = seq.index + 1; j <= Math.min(seq.index + 5, info.s.length - 1); j++) {
        tr.preds.push({ stopS: info.s[j]!, away: j - seq.index, madeAt: b.at, shown: arrivalAtIndex(state, v, seq.shape, seq.index, j, b.at * 1000), raw: rawArrival(state, v, seq.shape, seq.index, j, b.at * 1000).eta });
      }
    }
  }
  // la verdad: cuándo cruzó cada parada
  const cross = (pts: { t: number; s: number }[], S: number): number | null => {
    for (let i = 1; i < pts.length; i++) { const p = pts[i - 1]!, q = pts[i]!; if (p.s < S && q.s >= S && q.t - p.t <= 200 && q.s - p.s < 3500) return p.t + (q.t - p.t) * (S - p.s) / (q.s - p.s); }
    return null;
  };
  const by = new Map<number, { shown: number[]; raw: number[]; gone: number; n: number; lleg: number; llegGone: number }>();
  for (const tr of tracks.values()) for (const p of tr.preds) {
    const truth = cross(tr.pts, p.stopS); if (truth == null) continue;
    const g2 = by.get(p.away) ?? by.set(p.away, { shown: [], raw: [], gone: 0, n: 0, lleg: 0, llegGone: 0 }).get(p.away)!;
    g2.n++;
    const says = p.shown - p.madeAt <= 15;                  // la pantalla dice «llegando»
    if (says) g2.lleg++;
    if (truth < p.madeAt) { g2.gone++; if (says) g2.llegGone++; continue; }     // cuando se mostró, el bus ya había pasado por esa parada
    g2.shown.push(p.shown - truth); g2.raw.push(p.raw - truth);
  }
  console.log("\n=== HORA DE LLEGADA A LAS PRÓXIMAS PARADAS (positivo = la app dice más tarde de lo que fue) ===");
  for (const away of [...by.keys()].sort((x, y) => x - y)) {
    const g2 = by.get(away)!, abs = g2.shown.map(Math.abs), absR = g2.raw.map(Math.abs);
    console.log(`a ${away} parada(s): n=${g2.n} · ya había pasado al mostrarse: ${(100 * g2.gone / g2.n).toFixed(0)} % · decía «llegando»: ${(100 * g2.lleg / g2.n).toFixed(0)} % (de esos, ya había pasado: ${g2.lleg ? (100 * g2.llegGone / g2.lleg).toFixed(0) : "-"} %)`);
    if (g2.shown.length) console.log(`     lo mostrado: sesgo ${pct(g2.shown, 0.5).toFixed(0)} s, error mediano ${pct(abs, 0.5).toFixed(0)} s, p90 ${pct(abs, 0.9).toFixed(0)} s · cálculo sin retoque: sesgo ${pct(g2.raw, 0.5).toFixed(0)} s, error mediano ${pct(absR, 0.5).toFixed(0)} s, p90 ${pct(absR, 0.9).toFixed(0)} s (n=${g2.shown.length})`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
