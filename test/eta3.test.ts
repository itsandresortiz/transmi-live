import { it } from "vitest";
import { readFileSync } from "node:fs";
import { TransitState, estimateTravelSeconds } from "@transmi/application";
import { RoadPath, toWorld, type RouteShape } from "@transmi/domain";
import { buildNetwork, decodePositions, parseGtfsLite } from "@transmi/infrastructure";
it("ajuste en vivo", async () => {
  const net = buildNetwork(await parseGtfsLite(readFileSync("/tmp/ld/gtfs-lite.zip")));
  const st = new TransitState(); st.setNetwork(net);
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
  const firstSeen = new Map<string, Map<string, number>>();
  const lastChange = new Map<string, { stop: string; T: number; known: boolean }>();
  const obsSeg = new Map<string, { T: number; dur: number }[]>();     // clave: ruta|índice del tramo (en la parada de salida)
  const obsRoute = new Map<string, { T: number; ratio: number }[]>();
  const preds: any[] = [];
  const hopDef = (v: any, shape: RouteShape, i: number, T: number) => estimateTravelSeconds(st, v, shape.stopIds, i, i + 1, T * 1000);
  batches.forEach((b, bi) => {
    st.applyPositions(b.reps, b.T * 1000);
    for (const v of st.fleet.values()) {
      if (!v.lastStopId) continue;
      const m = firstSeen.get(v.id) ?? new Map(); if (!m.has(v.lastStopId)) m.set(v.lastStopId, b.T); firstSeen.set(v.id, m);
      const q = st.sequenceOf(v); if (!q) continue;
      // registrar tramos observados
      const lc = lastChange.get(v.id);
      if (!lc) lastChange.set(v.id, { stop: v.lastStopId, T: b.T, known: false });
      else if (lc.stop !== v.lastStopId) {
        const i0 = q.shape.stopIds.indexOf(lc.stop), i1 = q.index;
        const hops = i1 - i0;
        if (lc.known && hops >= 1 && hops <= 4) {
          const per = (b.T - lc.T) / hops;
          for (let i = i0; i < i1; i++) {
            const key = `${v.routeId}|${q.shape.direction}|${i}`; (obsSeg.get(key) ?? obsSeg.set(key, []).get(key)!).push({ T: b.T, dur: per });
            const rk = `${v.routeId}|${q.shape.direction}`; (obsRoute.get(rk) ?? obsRoute.set(rk, []).get(rk)!).push({ T: b.T, ratio: per / hopDef(v, q.shape, i, b.T) });
          }
        }
        lastChange.set(v.id, { stop: v.lastStopId, T: b.T, known: true });
      }
      if (bi < 6) continue;
      const inf = info(q.shape); if (!inf) continue;
      const k = q.index, sb = inf.path.project(v.world, 0, 0, 120); if (!sb) continue;
      const span = inf.s[k + 1]! - inf.s[k]!; if (!(span > 15)) continue;
      const f = Math.min(1, Math.max(0, (sb.s - inf.s[k]!) / span));
      const WINDOW = 300;
      const recentSeg = (i: number) => (obsSeg.get(`${v.routeId}|${q.shape.direction}|${i}`) ?? []).filter((o) => b.T - o.T <= WINDOW);
      const rr = (obsRoute.get(`${v.routeId}|${q.shape.direction}`) ?? []).filter((o) => b.T - o.T <= WINDOW).map((o) => o.ratio).sort((x, y) => x - y);
      const beta = rr.length >= 2 ? Math.min(1.6, Math.max(0.6, rr[Math.floor(rr.length / 2)]!)) : 1;
      const wBeta = rr.length / (rr.length + 3);
      for (const hop of [1, 2, 3]) {
        const j = k + hop; if (j >= q.shape.stopIds.length) continue;
        const sum = (fn: (i: number) => number) => { let t = fn(k) * (1 - f); for (let i = k + 1; i < j; i++) t += fn(i); return b.T + t; };
        const M0 = sum((i) => hopDef(v, q.shape, i, b.T));
        const M1 = sum((i) => { const o = recentSeg(i); const d = hopDef(v, q.shape, i, b.T); if (!o.length) return d; const mean = o.reduce((a, c) => a + c.dur, 0) / o.length; return (mean * o.length + d * 2) / (o.length + 2); });
        const M2 = sum((i) => hopDef(v, q.shape, i, b.T) * (1 + wBeta * (beta - 1)));
        const M3 = sum((i) => { const d = hopDef(v, q.shape, i, b.T) * (1 + wBeta * (beta - 1)); const o = recentSeg(i); if (!o.length) return d; const mean = o.reduce((a, c) => a + c.dur, 0) / o.length; return (mean * o.length + d * 2) / (o.length + 2); });
        preds.push({ id: v.id, hop, T: b.T, M0, M1, M2, M3, j: q.shape.stopIds[j]!, haveSeg: recentSeg(k + 1).length > 0, haveRoute: rr.length >= 2 });
      }
    }
  });
  const stat: Record<string, Record<string, number[]>> = {};
  for (const p of preds) { const hit = [...firstSeen.get(p.id)!.entries()].find(([s, t]) => s === p.j && t > p.T); if (!hit) continue; for (const key of ["M0", "M1", "M2", "M3"]) { const grp = p.haveRoute ? "con datos recientes" : "sin datos recientes"; ((stat[grp] ??= {})[key] ??= []).push(p[key] - hit[1]); } }
  for (const [g, o] of Object.entries(stat)) console.log("E3", g, "n=" + o.M0!.length, Object.entries(o).map(([k, e]) => { const a = e.map(Math.abs).sort((x, y) => x - y); return `${k}: ${a[Math.floor(a.length / 2)]!.toFixed(1)} s (medio ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1)})`; }).join(" | "));
});
