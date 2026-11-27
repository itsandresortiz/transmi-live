import { describe, expect, it } from "vitest";
import { METERS_PER_WORLD_UNIT, RoadPath, type WorldPoint, toWorld } from "@transmi/domain";

/* Las búsquedas de `RoadPath` se saltan grupos de tramos lejanos para ir más rápido. Estas son las versiones de antes, que revisan todos
   los tramos: las dos deben dar exactamente lo mismo, en trazados con idas y vueltas, rizos y puntos lejos y cerca. */
function seg(path: RoadPath, i: number, p: WorldPoint) {
  const ax = path.xs[i]!, ay = path.ys[i]!, dx = path.xs[i + 1]! - ax, dy = path.ys[i + 1]! - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p.x - ax) * dx + (p.y - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { dx, dy, d2: (p.x - (ax + t * dx)) ** 2 + (p.y - (ay + t * dy)) ** 2, s: path.cum[i]! + t * (path.cum[i + 1]! - path.cum[i]!) };
}
function inBox(path: RoadPath, p: WorldPoint, maxMeters: number): boolean {
  const pad = maxMeters / METERS_PER_WORLD_UNIT;
  return path.size >= 2 && !(p.x < path.minX - pad || p.x > path.maxX + pad || p.y < path.minY - pad || p.y > path.maxY + pad);
}
function project(path: RoadPath, p: WorldPoint, ux: number, uy: number, max: number) {
  if (!inBox(path, p, max)) return null;
  let best = Infinity, bs = 0, bdot = 0;
  for (let i = 0; i < path.size - 1; i++) { const r = seg(path, i, p); if (r.d2 < best) { best = r.d2; bs = r.s; bdot = r.dx * ux + r.dy * uy; } }
  const dist = Math.sqrt(best) * METERS_PER_WORLD_UNIT;
  return dist <= max ? { s: bs, dist, forward: bdot >= 0 } : null;
}
function projectAlong(path: RoadPath, p: WorldPoint, ux: number, uy: number, max: number) {
  if (!ux && !uy) return project(path, p, ux, uy, max);
  if (!inBox(path, p, max)) return null;
  let best = Infinity, bs = 0;
  for (let i = 0; i < path.size - 1; i++) { const r = seg(path, i, p); if (r.dx * ux + r.dy * uy < 0) continue; if (r.d2 < best) { best = r.d2; bs = r.s; } }
  const dist = Math.sqrt(best) * METERS_PER_WORLD_UNIT;
  return dist <= max ? { s: bs, dist, forward: true } : null;
}
function projectAfter(path: RoadPath, p: WorldPoint, minS: number, max: number, nearMeters = 40) {
  if (!inBox(path, p, max)) return null;
  const near2 = (nearMeters / METERS_PER_WORLD_UNIT) ** 2;
  let all = Infinity, allS = 0, after = Infinity, afterS = 0, run = Infinity, runS = 0, inRun = false;
  for (let i = 0; i < path.size - 1; i++) {
    const { d2, s } = seg(path, i, p);
    if (d2 < all) { all = d2; allS = s; }
    if (s < minS) continue;
    if (d2 < after) { after = d2; afterS = s; }
    if (d2 <= near2) { inRun = true; if (d2 < run) { run = d2; runS = s; } } else if (inRun) break;
  }
  const pick = run < Infinity ? { d2: run, s: runS } : after < Infinity ? { d2: after, s: afterS } : { d2: all, s: allS };
  let dist = Math.sqrt(pick.d2) * METERS_PER_WORLD_UNIT;
  if (dist > max && pick.d2 !== all) { pick.d2 = all; pick.s = allS; dist = Math.sqrt(all) * METERS_PER_WORLD_UNIT; }
  return dist <= max ? { s: pick.s, dist } : null;
}

/** Generador fijo (siempre los mismos números) para que la prueba no cambie entre corridas. */
function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; }; }

describe("búsquedas sobre el trazado con grupos de tramos", () => {
  it("dan exactamente lo mismo que revisar todos los tramos", () => {
    const r = rng(7), M = 111_320;
    let checks = 0;
    for (let k = 0; k < 25; k++) {
      // un trazado de 30–420 puntos que da vueltas (a veces regresa por la misma calle, a 10 m)
      const n = 30 + Math.floor(r() * 390), pts: { lat: number; lon: number }[] = [];
      let la = 4.6 + r() * 0.1, lo = -74.15 + r() * 0.1, h = r() * 2 * Math.PI;
      for (let i = 0; i < n; i++) { h += (r() - 0.5) * 0.8; const step = 20 + r() * 120; la += (Math.cos(h) * step) / M; lo += (Math.sin(h) * step) / M; pts.push({ lat: la, lon: lo }); }
      if (k % 3 === 0) for (let i = n - 1; i >= 0; i--) pts.push({ lat: pts[i]!.lat + 10 / M, lon: pts[i]!.lon });
      const path = new RoadPath(pts);
      for (let q = 0; q < 120; q++) {
        const base = pts[Math.floor(r() * pts.length)]!, off = [5, 30, 80, 200, 600, 3000][Math.floor(r() * 6)]!;
        const p = toWorld({ lat: base.lat + ((r() - 0.5) * off) / M, lon: base.lon + ((r() - 0.5) * off) / M });
        const ang = r() * 2 * Math.PI, ux = q % 5 === 0 ? 0 : Math.sin(ang), uy = q % 5 === 0 ? 0 : -Math.cos(ang);
        const max = [25, 45, 120, 300, 5000][q % 5]!, minS = r() < 0.3 ? 0 : r() * path.length;
        expect(path.project(p, ux, uy, max)).toEqual(project(path, p, ux, uy, max));
        expect(path.projectAlong(p, ux, uy, max)).toEqual(projectAlong(path, p, ux, uy, max));
        expect(path.projectAfter(p, minS, max)).toEqual(projectAfter(path, p, minS, max));
        expect(path.projectAfter(p, minS, max, 15)).toEqual(projectAfter(path, p, minS, max, 15));
        checks += 4;
      }
    }
    expect(checks).toBe(25 * 120 * 4);
  });
});
