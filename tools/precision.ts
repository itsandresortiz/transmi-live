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
import { MotionEngine, TransitState } from "@transmi/application";
import { RoadPath, distanceMeters, toWorld, type VehicleReport } from "@transmi/domain";
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

  // 2) reproducción con el motor de la app
  const eng = new MotionEngine(st);
  const paths = new Map<string, RoadPath[]>();
  const pathsOf = (rid: string) => paths.get(rid) ?? (paths.set(rid, (st.network.shapes.get(rid) ?? []).filter((s) => s.points.length > 1).map((s) => new RoadPath(s.points))), paths.get(rid)!);
  const err = { model: [] as number[], held: [] as number[], along: [] as number[], lat: [] as number[] };
  const lag: number[] = [];
  let hist = new Map<string, { t: number; x: number; y: number }[]>();
  for (let k = 0; k < batches.length; k++) {
    const b = batches[k]!;
    if (k > 0) {
      for (const r of b.reports) {
        const h = hist.get(r.id), prev = st.fleet.get(r.id);
        if (!h || !prev || r.reportedAt === prev.reportedAt) continue;
        const rw = toWorld(r.position);
        if (distanceMeters(prev.world, rw) < 15) continue;       // parado: no mide el movimiento
        let best = h[0]!; for (const p of h) if (Math.abs(p.t - r.reportedAt) < Math.abs(best.t - r.reportedAt)) best = p;
        if (Math.abs(best.t - r.reportedAt) > 1.2) continue;
        err.model.push(distanceMeters(best, rw)); err.held.push(distanceMeters(prev.world, rw)); lag.push(b.at - r.reportedAt);
        const ps = pathsOf(prev.routeId); let bp: { s: number; dist: number } | null = null, bi = -1;
        ps.forEach((p, i) => { const h2 = p.project(rw, 0, 0, 120); if (h2 && (!bp || h2.dist < bp.dist)) { bp = h2; bi = i; } });
        if (bp && bi >= 0) { const sh = ps[bi]!.project(best, 0, 0, 200); if (sh) { err.along.push(Math.abs(sh.s - (bp as { s: number }).s)); err.lat.push(sh.dist); } }
      }
    }
    st.applyPositions(b.reports, b.at * 1000);
    const next = batches[k + 1]; if (!next) break;
    hist = new Map();
    for (let t = b.at; t < next.at; t += 0.25) for (const v of st.fleet.values()) { const w = eng.step(v, t); (hist.get(v.id) ?? hist.set(v.id, []).get(v.id)!).push({ t, x: w.x, y: w.y }); }
  }
  console.log("\n=== PRECISIÓN (buses que se movieron más de 15 m entre reportes) ===");
  console.log("Dibujado a la hora del reporte vs. reporte:", f(err.model));
  console.log("Sin predicción (quieto en el último reporte):", f(err.held));
  console.log("Error a lo largo de la ruta:", f(err.along));
  console.log("Distancia a la ruta (a lo ancho):", f(err.lat));
  console.log(`Retraso entre el reporte y su llegada: mediana ${pct(lag, 0.5).toFixed(1)} s, p90 ${pct(lag, 0.9).toFixed(1)} s`);
}
main().catch((e) => { console.error(e); process.exit(1); });
