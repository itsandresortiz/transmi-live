import { it } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { TransitState, estimateTravelSeconds } from "@transmi/application";
import { RoadPath, toWorld, type RouteShape } from "@transmi/domain";
import { buildNetwork, decodePositions, parseGtfsLite } from "@transmi/infrastructure";
interface Sched { buckets: [number, number][]; routes: Record<string, { stops: string[]; seg: number[]; scale: Record<string, number[]> }> }
it("perfil del horario", async () => {
  const sched = JSON.parse(gunzipSync(readFileSync("/tmp/sched/schedule.json.gz")).toString()) as Sched;
  const net = buildNetwork(await parseGtfsLite(readFileSync("/tmp/ld/gtfs-lite.zip")));
  const st = new TransitState(); st.setNetwork(net);
  const bucketOf = (h: number) => { const i = sched.buckets.findIndex(([a, b]) => h >= a && h < b); return i < 0 ? sched.buckets.length - 1 : i; };
  const cache = new Map<RouteShape, { path: RoadPath; s: number[] } | null>();
  const info = (sh: RouteShape) => {
    let c = cache.get(sh); if (c !== undefined) return c;
    if (sh.points.length < 2) { cache.set(sh, null); return null; }
    const path = new RoadPath(sh.points); const s: number[] = []; let last = 0, ok = true;
    for (const id of sh.stopIds) { const p = st.stopById(id)?.position; const h = p ? path.project(toWorld(p), 0, 0, 120) : null; if (!h) { ok = false; break; } last = Math.max(last, h.s); s.push(last); }
    c = ok ? { path, s } : null; cache.set(sh, c); return c;
  };
  const batches: { T: number; reps: any[] }[] = [];
  for (let i = 1; i <= 16; i++) { const reps = decodePositions(new Uint8Array(readFileSync(`/tmp/snaps2/positions.${i}.pb`))); const T = reps[0]!.reportedAt; if (!batches.length || batches[batches.length - 1]!.T !== T) batches.push({ T, reps }); }
  const hourBog = (T: number) => new Date((T - 5 * 3600) * 1000).getUTCHours();
  console.log("S4 hora Bogotá de los lotes:", hourBog(batches[0]!.T), "→ franja", bucketOf(hourBog(batches[0]!.T)), "rutas con perfil:", Object.keys(sched.routes).length);
  const firstSeen = new Map<string, Map<string, number>>(); const preds: any[] = []; let match = 0, nomatch = 0;
  batches.forEach((b, bi) => {
    st.applyPositions(b.reps, b.T * 1000);
    for (const v of st.fleet.values()) {
      if (!v.lastStopId) continue;
      const m = firstSeen.get(v.id) ?? new Map(); if (!m.has(v.lastStopId)) m.set(v.lastStopId, b.T); firstSeen.set(v.id, m);
      if (bi < 2) continue;
      const q = st.sequenceOf(v); if (!q) continue; const inf = info(q.shape); if (!inf) continue;
      const k = q.index, sb = inf.path.project(v.world, 0, 0, 120); if (!sb) continue;
      const span = inf.s[k + 1]! - inf.s[k]!; if (!(span > 15)) continue;
      const f = Math.min(1, Math.max(0, (sb.s - inf.s[k]!) / span));
      const sr = sched.routes[v.routeId];
      const sameSeq = !!sr && sr.stops.length === q.shape.stopIds.length && sr.stops.every((x, i) => x === q.shape.stopIds[i]);
      sameSeq ? match++ : nomatch++;
      const dtype = "wk", bk = bucketOf(hourBog(b.T));
      const hopD = (i: number) => estimateTravelSeconds(st, v, q.shape.stopIds, i, i + 1, b.T * 1000);
      const hopS = (i: number) => { if (!sameSeq) return hopD(i); const base = sr!.seg[i]!, sc = sr!.scale[dtype]![bk]!; return base > 0 && sc > 0 ? base * sc : hopD(i); };
      for (const hop of [1, 2, 3]) {
        const j = k + hop; if (j >= q.shape.stopIds.length) continue;
        const sum = (fn: (i: number) => number) => { let t = fn(k) * (1 - f); for (let i = k + 1; i < j; i++) t += fn(i); return b.T + t; };
        preds.push({ id: v.id, hop, sameSeq, T: b.T, D: sum(hopD), S: sum(hopS), SD: sum((i) => (hopS(i) + hopD(i)) / 2), j: q.shape.stopIds[j]! });
      }
    }
  });
  console.log("S4 recorridos que coinciden con el perfil:", match, "no coinciden:", nomatch);
  const stat: Record<string, Record<string, number[]>> = {};
  for (const p of preds) { if (!p.sameSeq) continue; const hit = [...firstSeen.get(p.id)!.entries()].find(([s, t]) => s === p.j && t > p.T); if (!hit) continue; for (const key of ["D", "S", "SD"]) ((stat[`${p.hop} parada(s)`] ??= {})[key] ??= []).push(p[key] - hit[1]); }
  for (const [g, o] of Object.entries(stat)) console.log("S4", g, "n=" + o.D!.length, Object.entries(o).map(([k, e]) => { const a = e.map(Math.abs).sort((x, y) => x - y), sg = e.slice().sort((x, y) => x - y); return `${k}: error mediano ${a[Math.floor(a.length / 2)]!.toFixed(0)} s (sesgo ${sg[Math.floor(sg.length / 2)]!.toFixed(0)})`; }).join(" | "));
});
