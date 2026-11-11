/**
 * Mide qué tan cerca queda el bus dibujado de lo que TransMilenio informa después.
 *
 * Baja las posiciones directamente de TransMilenio cada pocos segundos (~4 min), reproduce el movimiento con el mismo motor de la app
 * entre un lote y el siguiente y, cuando llega un reporte nuevo de un bus, compara dónde estaba dibujado a la hora de ese reporte
 * con la posición que el bus informó. También mide cuánto se aleja de su ruta.
 * Referencia: dejar el bus quieto en su último reporte (sin predicción).
 *
 * Uso: npx tsx tools/precision.ts [segundos] [espera_entre_descargas]
 */
import { DEFAULT_MOTION, MotionEngine, type MotionParams, TransitState } from "@transmi/application";
import { DEFAULT_PREDICTION, RoadPath, distanceMeters, toWorld, type VehicleReport } from "@transmi/domain";
import { buildNetwork, decodePositions, parseGtfsLite } from "@transmi/infrastructure";

const SECONDS = Number(process.argv[2] ?? 270), GAP_MS = Number(process.argv[3] ?? 8) * 1000;
const REPO = process.env.GITHUB_REPOSITORY ?? "itsandresortiz/transmi-live";
const pct = (a: number[], p: number) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))]! : NaN; };
const f = (a: number[]) => `n=${a.length} mediana=${pct(a, 0.5).toFixed(1)} p75=${pct(a, 0.75).toFixed(1)} p90=${pct(a, 0.9).toFixed(1)} m`;

async function main() {
  const g = await fetch(`https://raw.githubusercontent.com/${REPO}/live-data/gtfs-lite.zip`);
  const st = new TransitState();
  st.setNetwork(buildNetwork(await parseGtfsLite(new Uint8Array(await g.arrayBuffer()))));

  // 1) captura de lotes reales
  const batches: { reports: VehicleReport[]; at: number }[] = [];
  let lastSig = "";
  const end = Date.now() + SECONDS * 1000;
  while (Date.now() < end) {
    try {
      const r = await fetch("https://gtfs.transmilenio.gov.co/positions.pb", { headers: { "User-Agent": "Mozilla/5.0 (transmi-live)" } });
      const buf = new Uint8Array(await r.arrayBuffer());
      const sig = Buffer.from(buf).toString("base64").slice(0, 64) + buf.length;
      if (r.ok && sig !== lastSig) { lastSig = sig; batches.push({ reports: decodePositions(buf), at: Date.now() / 1000 }); console.log(`lote ${batches.length}: ${batches.at(-1)!.reports.length} buses`); }
    } catch (e) { console.log("descarga falló", e instanceof Error ? e.message : e); }
    await new Promise((r) => setTimeout(r, GAP_MS));
  }
  if (batches.length < 3) { console.log("Muy pocos lotes (¿es de madrugada?). No se mide."); return; }
  console.log("intervalos entre lotes (s):", batches.slice(1).map((b, i) => (b.at - batches[i]!.at).toFixed(0)).join(","));

  // 2) reproducción con el motor de la app, para varias políticas de predicción (misma captura)
  const net = st.network;
  const evaluate = (gain: number, extra: Partial<MotionParams> = {}, maxSeconds = 90) => {
    (DEFAULT_PREDICTION as { gain: number }).gain = gain;
    (DEFAULT_PREDICTION as { maxSeconds: number }).maxSeconds = maxSeconds;
    const state = new TransitState(); state.setNetwork(net);
    const eng = new MotionEngine(state, { ...DEFAULT_MOTION, ...extra });
    const paths = new Map<string, RoadPath[]>();
    const pathsOf = (rid: string) => paths.get(rid) ?? (paths.set(rid, (net.shapes.get(rid) ?? []).filter((x) => x.points.length > 1).map((x) => new RoadPath(x.points))), paths.get(rid)!);
    const err = { model: [] as number[], held: [] as number[], along: [] as number[], lat: [] as number[], signed: [] as number[] };
    const lag: number[] = [];
    // dónde se dibujó cada bus en los últimos ~4 min. Hace falta guardar varios intervalos: TransMilenio entrega hoy cada posición con
    // 30–90 s de atraso, así que el reporte que dice dónde estaba el bus en el instante T llega uno o varios lotes después de T.
    const HIST_S = 240;
    const hist = new Map<string, { t: number; x: number; y: number }[]>();
    const gap: number[] = [], lagAll: number[] = [];
    for (let k = 0; k < batches.length; k++) {
      const b = batches[k]!;
      if (k > 0) {
        for (const r of b.reports) {
          const h = hist.get(r.id), prev = state.fleet.get(r.id);
          if (prev && r.reportedAt !== prev.reportedAt) { gap.push(r.reportedAt - prev.reportedAt); lagAll.push(b.at - r.reportedAt); }
          if (!h || !prev || r.reportedAt === prev.reportedAt) continue;
          const rw = toWorld(r.position);
          if (distanceMeters(prev.world, rw) < 15) continue;       // parado: no mide el movimiento
          let best = h[0]!; for (const p of h) if (Math.abs(p.t - r.reportedAt) < Math.abs(best.t - r.reportedAt)) best = p;
          if (Math.abs(best.t - r.reportedAt) > 1.2) continue;
          err.model.push(distanceMeters(best, rw)); err.held.push(distanceMeters(prev.world, rw)); lag.push(b.at - r.reportedAt);
          const ps = pathsOf(prev.routeId); let bp: { s: number; dist: number } | null = null, bi = -1;
          ps.forEach((p, i2) => { const h2 = p.project(rw, 0, 0, 120); if (h2 && (!bp || h2.dist < bp.dist)) { bp = h2; bi = i2; } });
          if (bp && bi >= 0) { const sh = ps[bi]!.project(best, 0, 0, 200); if (sh) { const d = sh.s - (bp as { s: number }).s; err.along.push(Math.abs(d)); err.signed.push(d); err.lat.push(sh.dist); } }
        }
      }
      state.applyPositions(b.reports, b.at * 1000);
      const next = batches[k + 1]; if (!next) break;
      let tick = 0;
      for (let t = b.at; t < next.at; t += 0.25, tick++) for (const v of state.fleet.values()) {
        const w = eng.step(v, t);
        if (tick % 4) continue;                    // el motor avanza 4 veces por segundo, como en la app; se guarda una muestra por segundo
        const l = hist.get(v.id) ?? hist.set(v.id, []).get(v.id)!;
        l.push({ t, x: w.x, y: w.y });
        while (l.length && l[0]!.t < t - HIST_S) l.shift();
      }
    }
    return { err, lag, gap, lagAll };
  };
  const base = evaluate(0.5);
  console.log("\n=== PRECISIÓN (buses que se movieron más de 15 m entre reportes; " + base.err.model.length + " muestras) ===");
  console.log("Sin predicción (quieto en el último reporte):", f(base.err.held));
  console.log("Distancia a la ruta (a lo ancho):", f(base.err.lat));
  console.log(`Retraso entre el reporte y su llegada: mediana ${pct(base.lag, 0.5).toFixed(1)} s, p90 ${pct(base.lag, 0.9).toFixed(1)} s`);
  console.log(`Cada cuánto cambia el reporte de un mismo bus (s): mediana ${pct(base.gap, 0.5).toFixed(0)}, p10 ${pct(base.gap, 0.1).toFixed(0)}, p90 ${pct(base.gap, 0.9).toFixed(0)} (n=${base.gap.length})`);
  console.log(`Edad del GPS al llegar el lote, todos los reportes nuevos (s): mediana ${pct(base.lagAll, 0.5).toFixed(0)}, p10 ${pct(base.lagAll, 0.1).toFixed(0)}, p90 ${pct(base.lagAll, 0.9).toFixed(0)}`);
  console.log("--- políticas (ganancia = fracción de la velocidad medida que realmente avanza) ---");
  const row = (label: string, r: ReturnType<typeof evaluate>) => console.log(`${label.padEnd(34)} error ${f(r.err.model)} | a lo largo: sesgo mediano ${pct(r.err.signed.map((x) => x), 0.5).toFixed(1)} m (neg = se queda corto)`);
  for (const g of [0.3, 0.5, 0.6, 0.7]) row(`ganancia ${g}`, g === 0.5 ? base : evaluate(g));
  // el dato llega hoy con ~60 s de edad y cada bus cambia cada ~60 s: con el tope de 90 s el bus se queda quieto buena parte del tiempo
  for (const [g, mx] of [[0.5, 120], [0.5, 150], [0.5, 200], [0.6, 150], [0.6, 200], [0.4, 150]] as const) row(`ganancia ${g}, tope ${mx} s`, evaluate(g, {}, mx));
  for (const [c, name] of [[0.1, "corrección suave"], [0.3, "corrección fuerte"]] as const) row(`ganancia 0.7 + ${name}`, evaluate(0.7, { catchUp: c }));
}

main().catch((e) => { console.error(e); process.exit(1); });
