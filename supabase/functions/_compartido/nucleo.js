// GENERADO por tools/edge-core.ts: no editar a mano. huella 497d60e81d44ede6
// packages/domain/src/shared/geo.ts
var METERS_PER_WORLD_UNIT = 40075016686e-3 * Math.cos(4.65 * Math.PI / 180);
function toWorld(p) {
  return {
    x: (p.lon + 180) / 360,
    y: 0.5 - Math.log(Math.tan(Math.PI / 4 + p.lat * Math.PI / 360)) / (2 * Math.PI)
  };
}
function toGeo(w) {
  return {
    lon: w.x * 360 - 180,
    lat: (2 * Math.atan(Math.exp((0.5 - w.y) * 2 * Math.PI)) - Math.PI / 2) * 180 / Math.PI
  };
}
function distanceMeters(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y) * METERS_PER_WORLD_UNIT;
}
function bearingDegrees(from, to) {
  return (Math.atan2(to.x - from.x, -(to.y - from.y)) * 180 / Math.PI + 360) % 360;
}

// packages/domain/src/transit/system.ts
var strip = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
function classifyRoute(r) {
  const sn = r.shortName.trim().toUpperCase();
  if (r.routeType === "6" || sn === "CABLE" || sn === "TRANSMICABLE") return "cable";
  const color = (r.routeColor ?? "").toLowerCase().replace("#", "");
  if (color === "ff0000") return "troncal";
  if (color === "0000ff") return "zonal";
  if (color === "00ff00") return /^\d{1,2}-\d{1,2}$/.test(sn) ? "alimentador" : "dual";
  const txt = strip([r.longName, r.description ?? "", r.agencyId ?? ""].join(" "));
  if (/alimentador/.test(txt) || /^\d{1,2}-\d{1,2}$/.test(sn)) return "alimentador";
  if (/\bdual\b/.test(txt)) return "dual";
  if (/troncal|transmilenio/.test(txt) || /^[A-M]\d{2}$/.test(sn)) return "troncal";
  if (r.routeType === "3" || /^[A-Z]{0,2}\d{1,3}[A-Z]?$/.test(sn) || /sitp|zonal/.test(txt)) return "zonal";
  return "otro";
}
function inferSystemFromReport(r) {
  if ((r.tripId ?? "").startsWith("TTBD")) return "troncal";
  if (/^Z\d/.test(r.label ?? r.id ?? "")) return "zonal";
  return "otro";
}

// packages/domain/src/transit/stop.ts
var WAGON_RE = /^(.*?)\s+([A-F])\s*-\s*\d(?:\s*ó\s*\d)?(?:-[a-z]+)?\.?\s*$/i;
var PLATFORM_RE = /^(.*?)\s+T-?\s?(\d+[A-Z]?)(?:\s+([A-Z]))?\.?\s*$/i;
var tidy = (s) => s.replace(/\s+/g, " ").trim();
function parseStopName(name, trunk = true) {
  const n = tidy(name);
  const p = trunk ? PLATFORM_RE.exec(n) : null;
  if (p && p[1]) return { title: tidy(p[1]), platform: `T${p[2].toUpperCase()}${(p[3] ?? "").toUpperCase()}` };
  const w = trunk ? WAGON_RE.exec(n) : null;
  if (w) return { title: tidy(w[1]), wagon: w[2].toUpperCase().charCodeAt(0) - 64 };
  return { title: n };
}

// packages/domain/src/transit/delay.ts
var MAX_CREDIBLE_SECONDS = 7200;
function delayFromSeconds(seconds) {
  if (seconds == null || !Number.isFinite(seconds) || Math.abs(seconds) > MAX_CREDIBLE_SECONDS) {
    return { kind: "unknown", minutes: 0, severe: false, seconds: null };
  }
  const minutes = Math.round(Math.abs(seconds) / 60);
  if (minutes < 2) return { kind: "onTime", minutes: 0, severe: false, seconds };
  return seconds > 0 ? { kind: "late", minutes, severe: seconds > 600, seconds } : { kind: "early", minutes, severe: false, seconds };
}

// packages/domain/src/transit/alert.ts
var INSTANT_S = 300;
var REPORT_WINDOW_S = 6 * 3600;
function isReportedAlert(a) {
  return a.startsAt != null && a.endsAt != null && a.endsAt - a.startsAt < INSTANT_S;
}
function isAlertActive(a, nowSec) {
  if (a.startsAt != null && a.startsAt > nowSec + 3600) return false;
  if (isReportedAlert(a)) return nowSec - a.endsAt < REPORT_WINDOW_S;
  if (a.endsAt != null && a.endsAt < nowSec) return false;
  return true;
}

// packages/domain/src/transit/vehicle.ts
var VELOCITY_BASELINE_SECONDS = 28;
var HISTORY_SECONDS = 150;
var MIN_MOVE_METERS = 8;
var TELEPORT_METERS = 800;
var MAX_SPEED_MPS = 20;
var Vehicle = class {
  id;
  plate;
  label;
  routeId;
  tripId;
  /** Última parada a la que llegó (ver `VehicleReport.lastStopId`). */
  lastStopId;
  position;
  world;
  reportedAt;
  /** Rumbo de la última marcha conocida (0 = norte). */
  bearing = null;
  velocity = null;
  /** Sistema de transporte, resuelto por la aplicación a partir de la ruta o del propio reporte. */
  system = "otro";
  lastSeenMs;
  history = [];
  constructor(r, nowMs) {
    this.id = r.id;
    this.plate = r.plate;
    this.label = r.label;
    this.routeId = r.routeId;
    this.tripId = r.tripId;
    this.lastStopId = r.lastStopId;
    this.position = r.position;
    this.world = toWorld(r.position);
    this.reportedAt = r.reportedAt;
    this.lastSeenMs = nowMs;
    this.history = [{ t: r.reportedAt, x: this.world.x, y: this.world.y }];
  }
  /** Aplica un reporte nuevo. Devuelve `true` si cambió algo (reporte más reciente que el anterior). */
  apply(r, nowMs) {
    this.lastSeenMs = nowMs;
    this.plate = r.plate ?? this.plate;
    this.label = r.label ?? this.label;
    if (r.reportedAt <= this.reportedAt) return false;
    this.routeId = r.routeId || this.routeId;
    this.tripId = r.tripId ?? this.tripId;
    this.lastStopId = r.lastStopId ?? this.lastStopId;
    const next = toWorld(r.position);
    const moved = distanceMeters(this.world, next);
    if (moved >= TELEPORT_METERS) {
      this.history = [];
      this.velocity = null;
      this.bearing = null;
    } else if (moved > 3) {
      this.bearing = bearingDegrees(this.world, next);
    }
    this.position = r.position;
    this.world = next;
    this.reportedAt = r.reportedAt;
    this.history = this.history.filter((s) => r.reportedAt - s.t <= HISTORY_SECONDS);
    this.history.push({ t: r.reportedAt, x: next.x, y: next.y });
    this.velocity = this.measureVelocity();
    return true;
  }
  /** Último tramo recorrido entre dos reportes distintos (para dibujar la velocidad en las calles). */
  lastLeg() {
    const h = this.history;
    if (h.length < 2) return null;
    const a = h[h.length - 2], b = h[h.length - 1];
    return { x0: a.x, y0: a.y, t0: a.t, x1: b.x, y1: b.y, t1: b.t };
  }
  /** Velocidad medida con una base de al menos 28 s: con base corta el ruido del GPS la desbarata. */
  measureVelocity() {
    const h = this.history;
    const last = h[h.length - 1];
    for (let i = h.length - 2; i >= 0; i--) {
      const o = h[i];
      const dt = last.t - o.t;
      if (dt < VELOCITY_BASELINE_SECONDS) continue;
      const dx = last.x - o.x;
      const dy = last.y - o.y;
      const hh = Math.hypot(dx, dy);
      const meters = distanceMeters(o, last);
      if (meters > MIN_MOVE_METERS && dt > 0) {
        return { speedMps: Math.min(MAX_SPEED_MPS, meters / dt), ux: dx / hh, uy: dy / hh };
      }
      return { speedMps: 0, ux: 0, uy: 0 };
    }
    return this.velocity;
  }
};

// packages/domain/src/transit/fleet.ts
var RETENTION_MS = 9e4;
var MAX_REPORT_AGE_S = 600;
var Fleet = class {
  byId = /* @__PURE__ */ new Map();
  /** Aumenta cada vez que cambia algo; sirve para que la interfaz sepa cuándo volver a leer. */
  version = 0;
  get size() {
    return this.byId.size;
  }
  get(id) {
    return this.byId.get(id);
  }
  values() {
    return this.byId.values();
  }
  toArray() {
    return [...this.byId.values()];
  }
  /** Incorpora un lote de reportes. `onNew` permite resolver el sistema de un bus recién visto. */
  ingest(reports, nowMs, onNew) {
    const seen = /* @__PURE__ */ new Set();
    for (const r of reports) {
      seen.add(r.id);
      const v = this.byId.get(r.id);
      if (v) v.apply(r, nowMs);
      else {
        const nv = new Vehicle(r, nowMs);
        onNew?.(nv);
        this.byId.set(r.id, nv);
      }
    }
    for (const [id, v] of this.byId) {
      if (!seen.has(id) && nowMs - v.lastSeenMs > RETENTION_MS) this.byId.delete(id);
    }
    this.version++;
  }
  /** Quita los buses cuyo último reporte (hora de la fuente, en segundos) es anterior a `minReportedAt`. Devuelve cuántos quitó. */
  dropReportedBefore(minReportedAt) {
    let n = 0;
    for (const [id, v] of this.byId) if (v.reportedAt < minReportedAt) {
      this.byId.delete(id);
      n++;
    }
    if (n) this.version++;
    return n;
  }
  clear() {
    this.byId.clear();
    this.version++;
  }
};

// packages/domain/src/transit/network.ts
var TransitNetwork = class {
  routes = /* @__PURE__ */ new Map();
  stops = /* @__PURE__ */ new Map();
  /** Destinos conocidos por ruta (para buscar por destino). */
  headsigns = /* @__PURE__ */ new Map();
  shapes = /* @__PURE__ */ new Map();
  /** Avisos que trae la red misma (cierres temporales de vagones anunciados por TransMilenio que no vienen en sus avisos en vivo). */
  notices = [];
  get isLoaded() {
    return this.routes.size > 0 && !this.hasOnlyProvisional();
  }
  hasOnlyProvisional() {
    for (const r of this.routes.values()) if (!r.provisional) return false;
    return true;
  }
  shapesOf(routeId) {
    return this.shapes.get(routeId) ?? [];
  }
};

// packages/domain/src/transit/path.ts
var RoadPath = class {
  xs;
  ys;
  /** Metros acumulados desde el inicio hasta cada punto. */
  cum;
  minX;
  maxX;
  minY;
  maxY;
  constructor(points) {
    const n = points.length;
    this.xs = new Float64Array(n);
    this.ys = new Float64Array(n);
    this.cum = new Float64Array(n);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const w = toWorld(points[i]);
      this.xs[i] = w.x;
      this.ys[i] = w.y;
      if (w.x < minX) minX = w.x;
      if (w.x > maxX) maxX = w.x;
      if (w.y < minY) minY = w.y;
      if (w.y > maxY) maxY = w.y;
      if (i) this.cum[i] = this.cum[i - 1] + Math.hypot(w.x - this.xs[i - 1], w.y - this.ys[i - 1]) * METERS_PER_WORLD_UNIT;
    }
    this.minX = minX;
    this.maxX = maxX;
    this.minY = minY;
    this.maxY = maxY;
  }
  get length() {
    return this.cum.length ? this.cum[this.cum.length - 1] : 0;
  }
  get size() {
    return this.xs.length;
  }
  /** Punto del trazado más cercano a `p`: metros desde el inicio, distancia al trazado y sentido (+1/-1) respecto a (ux,uy). */
  project(p, ux, uy, maxMeters) {
    const pad = maxMeters / METERS_PER_WORLD_UNIT;
    if (this.size < 2 || p.x < this.minX - pad || p.x > this.maxX + pad || p.y < this.minY - pad || p.y > this.maxY + pad) return null;
    let best = Infinity, bs = 0, bdot = 0;
    for (let i = 0; i < this.size - 1; i++) {
      const ax = this.xs[i], ay = this.ys[i], dx = this.xs[i + 1] - ax, dy = this.ys[i + 1] - ay;
      const l2 = dx * dx + dy * dy;
      let t = l2 ? ((p.x - ax) * dx + (p.y - ay) * dy) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d2 = (p.x - (ax + t * dx)) ** 2 + (p.y - (ay + t * dy)) ** 2;
      if (d2 < best) {
        best = d2;
        bs = this.cum[i] + t * (this.cum[i + 1] - this.cum[i]);
        bdot = dx * ux + dy * uy;
      }
    }
    const dist = Math.sqrt(best) * METERS_PER_WORLD_UNIT;
    return dist <= maxMeters ? { s: bs, dist, forward: bdot >= 0 } : null;
  }
  /** Como `project`, pero solo cuenta los tramos que van en el mismo sentido que (ux,uy). Hace falta en los recorridos de ida y vuelta por la misma calle
   *  (alimentadores y zonales): el punto más cercano puede ser el de la otra pasada, que va al revés. Sin rumbo (0,0) equivale a `project`. */
  projectAlong(p, ux, uy, maxMeters) {
    if (!ux && !uy) return this.project(p, ux, uy, maxMeters);
    const pad = maxMeters / METERS_PER_WORLD_UNIT;
    if (this.size < 2 || p.x < this.minX - pad || p.x > this.maxX + pad || p.y < this.minY - pad || p.y > this.maxY + pad) return null;
    let best = Infinity, bs = 0;
    for (let i = 0; i < this.size - 1; i++) {
      const ax = this.xs[i], ay = this.ys[i], dx = this.xs[i + 1] - ax, dy = this.ys[i + 1] - ay;
      if (dx * ux + dy * uy < 0) continue;
      const l2 = dx * dx + dy * dy;
      let t = l2 ? ((p.x - ax) * dx + (p.y - ay) * dy) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d2 = (p.x - (ax + t * dx)) ** 2 + (p.y - (ay + t * dy)) ** 2;
      if (d2 < best) {
        best = d2;
        bs = this.cum[i] + t * (this.cum[i + 1] - this.cum[i]);
      }
    }
    const dist = Math.sqrt(best) * METERS_PER_WORLD_UNIT;
    return dist <= maxMeters ? { s: bs, dist, forward: true } : null;
  }
  /** Proyecta un punto que se sabe que viene DESPUÉS de `minS` metros (las paradas van en orden): elige la primera pasada del trazado que queda cerca (≤ `nearMeters`),
   *  no la más cercana de todas. En un recorrido de ida y vuelta por la misma calle, la más cercana puede ser la pasada de regreso. Si ninguna pasada posterior queda cerca,
   *  devuelve la más cercana después de `minS` y, si tampoco, la más cercana de todas. */
  projectAfter(p, minS, maxMeters, nearMeters = 40) {
    const pad = maxMeters / METERS_PER_WORLD_UNIT;
    if (this.size < 2 || p.x < this.minX - pad || p.x > this.maxX + pad || p.y < this.minY - pad || p.y > this.maxY + pad) return null;
    const near2 = (nearMeters / METERS_PER_WORLD_UNIT) ** 2;
    let all = Infinity, allS = 0, after = Infinity, afterS = 0, run = Infinity, runS = 0, inRun = false;
    for (let i = 0; i < this.size - 1; i++) {
      const ax = this.xs[i], ay = this.ys[i], dx = this.xs[i + 1] - ax, dy = this.ys[i + 1] - ay;
      const l2 = dx * dx + dy * dy;
      let t = l2 ? ((p.x - ax) * dx + (p.y - ay) * dy) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d2 = (p.x - (ax + t * dx)) ** 2 + (p.y - (ay + t * dy)) ** 2, s = this.cum[i] + t * (this.cum[i + 1] - this.cum[i]);
      if (d2 < all) {
        all = d2;
        allS = s;
      }
      if (s < minS) continue;
      if (d2 < after) {
        after = d2;
        afterS = s;
      }
      if (d2 <= near2) {
        inRun = true;
        if (d2 < run) {
          run = d2;
          runS = s;
        }
      } else if (inRun) break;
    }
    const pick2 = run < Infinity ? { d2: run, s: runS } : after < Infinity ? { d2: after, s: afterS } : { d2: all, s: allS };
    let dist = Math.sqrt(pick2.d2) * METERS_PER_WORLD_UNIT;
    if (dist > maxMeters && pick2.d2 !== all) {
      pick2.d2 = all;
      pick2.s = allS;
      dist = Math.sqrt(all) * METERS_PER_WORLD_UNIT;
    }
    return dist <= maxMeters ? { s: pick2.s, dist } : null;
  }
  /** Dirección (vector unitario en coordenadas de mundo) del trazado a `s` metros del inicio. */
  tangentAt(s) {
    const n = this.size;
    if (n < 2) return { ux: 0, uy: -1 };
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = lo + hi >> 1;
      if (this.cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    const dx = this.xs[hi] - this.xs[lo], dy = this.ys[hi] - this.ys[lo], h = Math.hypot(dx, dy) || 1;
    return { ux: dx / h, uy: dy / h };
  }
  /** Tramo del trazado entre `s0` y `s1` metros desde el inicio. */
  slice(s0, s1) {
    const a = Math.max(0, Math.min(s0, s1)), b = Math.min(this.length, Math.max(s0, s1));
    const out = [toGeo(this.pointAt(a))];
    for (let i = 0; i < this.size; i++) if (this.cum[i] > a && this.cum[i] < b) out.push(toGeo({ x: this.xs[i], y: this.ys[i] }));
    out.push(toGeo(this.pointAt(b)));
    return out;
  }
  /** Punto a `s` metros desde el inicio (limitado a los extremos). */
  pointAt(s) {
    const n = this.size;
    if (s <= 0) return { x: this.xs[0], y: this.ys[0] };
    if (s >= this.length) return { x: this.xs[n - 1], y: this.ys[n - 1] };
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = lo + hi >> 1;
      if (this.cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    const seg = this.cum[hi] - this.cum[lo];
    const t = seg ? (s - this.cum[lo]) / seg : 0;
    return { x: this.xs[lo] + t * (this.xs[hi] - this.xs[lo]), y: this.ys[lo] + t * (this.ys[hi] - this.ys[lo]) };
  }
};

// packages/application/src/travel-times.ts
var DEFAULT_SECONDS_PER_STOP = { troncal: 58, dual: 58, alimentador: 62, zonal: 50, cable: 80, otro: 55 };
function daypartOf(nowMs) {
  const h = new Date(nowMs - 5 * 36e5).getUTCHours();
  return h < 5 ? "madrugada" : h < 9 ? "pico-am" : h < 16 ? "valle" : h < 20 ? "pico-pm" : "noche";
}
var MIN_HOP = 10;
var MAX_HOP = 400;
var MAX_WEIGHT = 40;
var MIN_ROUTE_SAMPLES = 8;
var MIN_SYSTEM_SAMPLES = 20;
var TravelTimes = class {
  /** Si es `false` (por defecto) se usan siempre los tiempos típicos: lo aprendido por cada dispositivo daba resultados distintos entre
   *  aparatos y, medido con lotes reales, erraba más que el valor típico (ver README). */
  apply = false;
  stats = /* @__PURE__ */ new Map();
  seen = /* @__PURE__ */ new Map();
  /** Segundos por parada para una ruta ahora: lo aprendido de la ruta, si no del sistema, si no el valor típico. */
  secondsPerStop(routeId, system, nowMs) {
    if (!this.apply) return DEFAULT_SECONDS_PER_STOP[system];
    const part = daypartOf(nowMs);
    const r = this.stats.get(`r|${routeId}|${part}`);
    if (r && r.n >= MIN_ROUTE_SAMPLES) return r.mean;
    const s = this.stats.get(`s|${system}|${part}`);
    if (s && s.n >= MIN_SYSTEM_SAMPLES) return s.mean;
    return DEFAULT_SECONDS_PER_STOP[system];
  }
  /** Cuántas observaciones lleva aprendidas (para saber si ya sirve). */
  get samples() {
    let n = 0;
    for (const [k, v] of this.stats) if (k.startsWith("s|")) n += v.n;
    return n;
  }
  add(key, x) {
    const st = this.stats.get(key) ?? { mean: x, n: 0 };
    st.n++;
    st.mean += (x - st.mean) / Math.min(st.n, MAX_WEIGHT);
    this.stats.set(key, st);
  }
  /** Revisa la flota tras un lote nuevo: si la próxima parada de un bus avanzó una posición, midió un tramo. */
  observe(state) {
    if (!this.apply) return;
    for (const v of state.fleet.values()) {
      const stop = v.lastStopId;
      if (!stop) continue;
      const prev = this.seen.get(v.id);
      if (!prev) {
        this.seen.set(v.id, { stop, since: v.reportedAt, known: false });
        continue;
      }
      if (prev.stop === stop) continue;
      const elapsed = v.reportedAt - prev.since;
      const hops = prev.known ? this.hopsBetween(state, v.routeId, prev.stop, stop) : 0;
      if (hops > 0 && elapsed >= MIN_HOP * hops && elapsed <= MAX_HOP * hops) {
        const part = daypartOf(v.reportedAt * 1e3);
        for (let k = 0; k < hops; k++) {
          this.add(`r|${v.routeId}|${part}`, elapsed / hops);
          this.add(`s|${v.system}|${part}`, elapsed / hops);
        }
      }
      this.seen.set(v.id, { stop, since: v.reportedAt, known: true });
    }
    if (this.seen.size > state.fleet.size * 2 + 100) {
      for (const id of this.seen.keys()) if (!state.fleet.get(id)) this.seen.delete(id);
    }
  }
  /** Cuántas paradas hay de `from` a `to` en el recorrido de la ruta (1 a 4), o 0 si no es un avance normal. */
  hopsBetween(state, routeId, from, to) {
    for (const sh of state.network.shapes.get(routeId) ?? []) {
      const i = sh.stopIds.indexOf(from), j = sh.stopIds.indexOf(to);
      if (i >= 0 && j > i && j - i <= 4) return j - i;
    }
    return 0;
  }
  toJSON() {
    return [...this.stats].map(([k, v]) => [k, Math.round(v.mean * 10) / 10, v.n]);
  }
  load(data) {
    if (!Array.isArray(data)) return;
    for (const row of data) if (Array.isArray(row) && typeof row[0] === "string" && Number.isFinite(row[1]) && Number.isFinite(row[2])) this.stats.set(row[0], { mean: row[1], n: Math.min(row[2], 1e6) });
  }
};

// packages/application/src/eta.ts
var CRUISE_MPS = 18;
var DETOUR_FACTOR = 1.15;
function hav(a, b) {
  const R = 6371e3, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function estimateTravelSeconds(state, v, stopIds, from, to, nowMs = Date.now()) {
  let meters = 0;
  for (let i = from; i < to; i++) {
    const a = state.stopById(stopIds[i]), b = state.stopById(stopIds[i + 1]);
    if (a && b) meters += hav(a.position, b.position) * DETOUR_FACTOR;
  }
  return meters / CRUISE_MPS + (to - from) * state.travelTimes.secondsPerStop(v.routeId, v.system, nowMs);
}
var shapeCache = /* @__PURE__ */ new WeakMap();
function shapeStops(state, shape) {
  let c = shapeCache.get(shape);
  if (c !== void 0) return c;
  c = null;
  if (shape.points.length >= 2) {
    const path = new RoadPath(shape.points), s = [];
    let last = 0, ok = true;
    for (const id of shape.stopIds) {
      const p = state.stopById(id)?.position;
      const hit = p ? path.projectAfter(toWorld(p), last, 120) : null;
      if (!hit) {
        ok = false;
        break;
      }
      last = Math.max(last, hit.s);
      s.push(last);
    }
    if (ok) c = { path, s };
  }
  shapeCache.set(shape, c);
  return c;
}
function arrivalAtIndex(state, v, shape, lastIndex, to, nowMs = Date.now()) {
  const { eta, remaining } = rawArrival(state, v, shape, lastIndex, to, nowMs), now = nowMs / 1e3;
  return eta > now + 3 ? eta : now + Math.max(10, 0.3 * remaining);
}
function shownArrival(state, v, shape, lastIndex, to, nowMs = Date.now(), key = v.id) {
  return state.etaHold.smooth(key, shape.stopIds[to] ?? `#${to}`, arrivalAtIndex(state, v, shape, lastIndex, to, nowMs), nowMs / 1e3);
}
function rawArrival(state, v, shape, lastIndex, to, nowMs = Date.now()) {
  const stopIds = shape.stopIds;
  const hop = (i) => state.hopProfile.seconds(shape, i, nowMs, estimateTravelSeconds(state, v, stopIds, i, i + 1, nowMs));
  let eta;
  let remaining = 0;
  for (let i = lastIndex; i < to; i++) remaining += hop(i);
  const info = shapeStops(state, shape);
  const bus = info ? info.path.project(v.world, 0, 0, 120) : null;
  const sa = info?.s[lastIndex], sb = info?.s[lastIndex + 1];
  if (info && bus && sa != null && sb != null && sb - sa > 15 && bus.s >= sa - 80 && bus.s <= sb + 80) {
    const f = Math.min(1, Math.max(0, (bus.s - sa) / (sb - sa)));
    remaining -= hop(lastIndex) * f;
    eta = v.reportedAt + remaining;
    if (state.hopProfile.apply && state.hopProfile.size) eta += state.hopProfile.extraAt(nowMs, to - lastIndex);
    const st = info.s[to];
    if (state.signalWaits.size && st != null && to - lastIndex <= 3) {
      const t0 = v.reportedAt, span = Math.max(1, st - bus.s), dur = eta - t0;
      eta += state.signalWaits.waitAlong(info.path, bus.s, st, (s) => t0 + dur * ((s - bus.s) / span));
    }
  } else {
    const tu = v.tripId ? state.tripUpdates.get(v.tripId) : void 0;
    const fresh = tu?.reportedAt != null && v.reportedAt - tu.reportedAt <= 600;
    const at = fresh && tu?.nextStop && tu.nextStop.stopId === v.lastStopId ? tu.nextStop.arrivalAt : void 0;
    const reached = at != null && at <= v.reportedAt + 60 && v.reportedAt - at <= 3600 ? at : void 0;
    eta = (reached ?? v.reportedAt) + remaining;
  }
  return { eta, remaining };
}
var MAX_SKIP = 3;
function displayNextIndex(state, v, shape, lastIndex, nowMs = Date.now()) {
  const now = nowMs / 1e3, last = shape.stopIds.length - 1;
  let j = lastIndex + 1;
  for (let n = 0; n < MAX_SKIP && j < last && rawArrival(state, v, shape, lastIndex, j, nowMs).eta < now - 5; n++) j++;
  return j;
}

// packages/application/src/shared-rides.ts
var SHARED_MAX_AGE_S = 60;
var SAME_BUS_M = 250;
var AHEAD_MAX_S = 20;
var MAX_SPEED_MPS2 = 20;
var speedOf = (r) => Math.min(MAX_SPEED_MPS2, Math.max(0, r.speed ?? 0));
function dedupeSharedRides(list, nowSec) {
  const fresh = list.filter((r) => nowSec - r.at <= SHARED_MAX_AGE_S && r.at - nowSec <= 30).sort((a, b) => b.at - a.at);
  const kept = [];
  for (const r of fresh) {
    const same = kept.some((k) => {
      if (k.routeId !== r.routeId || k.shape !== r.shape) return false;
      if (k.busId && r.busId) return k.busId === r.busId;
      return Math.abs(k.meters - (r.meters + speedOf(r) * (k.at - r.at))) <= SAME_BUS_M;
    });
    if (!same) kept.push(r);
  }
  return kept;
}
var SharedRides = class {
  list = [];
  byBus = /* @__PURE__ */ new Map();
  get size() {
    return this.list.length;
  }
  set(list, nowSec) {
    this.list = dedupeSharedRides(list, nowSec);
    this.byBus = new Map(this.list.filter((r) => r.busId).map((r) => [r.busId, r]));
  }
  /** Dónde dibujar el bus `busId` según quien va en él (si hay una posición compartida reciente y más nueva que el reporte del bus). */
  positionOf(state, busId, nowSec) {
    const r = this.byBus.get(busId), v = state.fleet.get(busId);
    if (!r || nowSec - r.at > SHARED_MAX_AGE_S || v && v.reportedAt >= r.at) return null;
    return sharedPosition(state, r, nowSec);
  }
  /** Buses que solo conoce la gente que va en ellos (TransMilenio no los reporta, o su número no está en los datos ahora). */
  extras(state, nowSec) {
    const out = [];
    this.list.forEach((r, i) => {
      if (nowSec - r.at > SHARED_MAX_AGE_S || r.busId && state.fleet.get(r.busId)) return;
      const p = sharedPosition(state, r, nowSec);
      if (p) out.push({ id: `comp:${r.routeId}:${r.shape}:${i}`, routeId: r.routeId, ...p });
    });
    return out;
  }
};
function sharedPosition(state, r, nowSec) {
  const shape = state.network.shapes.get(r.routeId)?.[r.shape];
  const ss = shape ? shapeStops(state, shape) : null;
  if (!ss) return null;
  const s = Math.min(ss.path.length, r.meters + speedOf(r) * Math.min(AHEAD_MAX_S, Math.max(0, nowSec - r.at)));
  const here = ss.path.pointAt(s), ahead = ss.path.pointAt(Math.min(ss.path.length, s + 15)), g = toGeo(here);
  return { lat: g.lat, lon: g.lon, heading: bearingDegrees(here, ahead) };
}

// packages/application/src/signal-timing.ts
var med = (a) => {
  const s = [...a].sort((x, y) => x - y), h = s.length >> 1;
  return !s.length ? NaN : s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};
var secs = (ms) => `${Math.round(ms / 1e3)} s`;
function summarize(marks) {
  const dur = { g: [], y: [], r: [] }, preGreen = [], cycles = [];
  for (let i = 2; i < marks.length; i++) {
    const a = marks[i - 1], b = marks[i];
    if (a.t - marks[i - 2].t > 1e5) continue;
    if (a.c === b.c || b.t - a.t >= 3e5) continue;
    if (a.c === "y" && b.c === "g") preGreen.push(b.t - a.t);
    else dur[a.c].push(b.t - a.t);
  }
  const lastOf = {}, per = { g: 0, r: 0 };
  for (let i = 1; i < marks.length; i++) {
    const m = marks[i];
    if (m.c === "y") continue;
    if (m.t - marks[i - 1].t > 1e5) {
      lastOf[m.c] = void 0;
      continue;
    }
    const p = lastOf[m.c];
    if (p != null && m.t - p <= 3e5 && m.t - p > 1e4) {
      cycles.push(m.t - p);
      per[m.c]++;
    }
    lastOf[m.c] = m.t;
  }
  const rounds = Math.max(per.g, per.r);
  if (!cycles.length) return { cycles, dur, preGreen, text: "Marca al menos dos veces el mismo color (verde o rojo) para calcular el ciclo: unas 2\u20133 vueltas." };
  const base0 = med(cycles), shortest = Math.min(...cycles), cands = [];
  const floor = (dur.r.length ? Math.max(...dur.r) : 0) + 2 * (dur.y.length ? med(dur.y) : 0) + 1e4;
  for (const c of cycles) for (const k of [1, 2, 3]) {
    if (k > 1 && c < shortest * 1.6) continue;
    const v = c / k;
    if (v >= Math.max(3e4, floor) && v <= 24e4) cands.push(v, Math.round(v / 1e3) * 1e3);
  }
  if (!cands.length) cands.push(base0);
  const points = ["g", "r"].map((c) => marks.filter((m, i) => m.c === c && i > 0 && m.t - marks[i - 1].t <= 1e5).map((m) => m.t));
  const fitOf = (ts, cyc2) => {
    let best2 = { f: 0, w: 0 };
    for (const a of ts) {
      let f = 0, w = 0;
      for (const t of ts) {
        const off = Math.abs(t - a - Math.round((t - a) / cyc2) * cyc2);
        if (off <= 3e3) f++;
        else w = Math.max(w, off);
      }
      if (f > best2.f) best2 = { f, w };
    }
    return best2;
  };
  const score = (cyc2) => {
    let fit2 = 0, total2 = 0, worst2 = 0;
    const byColor2 = points.map((ts) => {
      const r = fitOf(ts, cyc2);
      fit2 += r.f;
      total2 += ts.length;
      worst2 = Math.max(worst2, r.w);
      return { fit: r.f, total: ts.length };
    });
    return { fit: fit2, total: total2, worst: worst2, byColor: byColor2 };
  };
  let cyc = refineCycle(marks, med(cands)), best = score(cyc);
  const value = (sc) => sc.fit + (sc.byColor.some((c) => c.total >= 3 && c.fit === c.total) ? 1.5 : 0);
  for (const c of cands) {
    const cc = refineCycle(marks, c), sc = score(cc);
    if (value(sc) > value(best) || value(sc) === value(best) && sc.worst < best.worst) {
      cyc = cc;
      best = sc;
    }
  }
  const { fit, total, worst, byColor } = best;
  const [pg, pr] = byColor;
  const restG = cyc - (dur.r.length ? med(dur.r) : 0) - (dur.y.length ? med(dur.y) : 0) - (preGreen.length ? med(preGreen) : 0);
  const greenTxt = dur.r.length && dur.y.length && restG > 3e3 ? restG : dur.g.length ? med(dur.g) : NaN;
  const parts = [Number.isFinite(greenTxt) ? `verde ${secs(greenTxt)}` : "", dur.y.length ? `amarillo ${secs(med(dur.y))}` : "", dur.r.length ? `rojo ${secs(med(dur.r))}` : "", preGreen.length ? `amarillo antes del verde ${secs(med(preGreen))}` : ""].filter(Boolean);
  const steady = total < 3 || rounds < 2 ? "" : fit === total ? " Se repite igual: parece de tiempo fijo." : pr && pg && pr.total >= 2 && pr.fit === pr.total && pg.fit < pg.total ? ` El rojo empieza siempre en el mismo punto del ciclo; el verde var\xEDa unos segundos (el rojo dura entre ${secs(Math.min(...dur.r))} y ${secs(Math.max(...dur.r))}): ciclo fijo que ajusta el tiempo del cruce seg\xFAn el tr\xE1fico.` : pr && pg && pg.total >= 2 && pg.fit === pg.total && pr.fit < pr.total ? ` El verde empieza siempre en el mismo punto del ciclo; el rojo var\xEDa unos segundos: ciclo fijo que ajusta el tiempo del cruce seg\xFAn el tr\xE1fico.` : fit / total >= 0.7 ? ` ${fit} de ${total} cambios caen justo en un ciclo fijo; ${total - fit} se corrieron hasta ${secs(worst)} (puede ser el toque o que se adapte al tr\xE1fico).` : ` Solo ${fit} de ${total} cambios caen en un ciclo fijo: parece adaptarse al tr\xE1fico.`;
  return { cycles, dur, preGreen, cycle: cyc, text: `Ciclo de ${secs(cyc)} (${rounds} ${rounds === 1 ? "vuelta" : "vueltas"})${parts.length ? `: ${parts.join(", ")}` : ""}.${steady}` };
}
var SESSION_GAP = 5 * 6e4;
function lastSession(marks) {
  let i = marks.length - 1;
  while (i > 0 && marks[i].t - marks[i - 1].t <= SESSION_GAP) i--;
  return clean(marks.slice(Math.max(0, i)));
}
function clean(marks) {
  const out = [];
  for (const m of marks) {
    const p = out[out.length - 1];
    if (p && p.c === m.c && m.t - p.t < 1e4) continue;
    out.push(m);
  }
  return out;
}
function signalModel(all) {
  const marks = lastSession(all), s = summarize(marks);
  const last = [...marks].reverse().find((m) => m.c === "r")?.t;
  if (!s.cycles.length || last == null || !s.dur.r.length || !s.dur.g.length) return null;
  const measured = s.cycle ?? refineCycle(clean(all), med(s.cycles)), whole = Math.round(measured / 1e3) * 1e3;
  const cycle = Math.abs(measured - whole) < 500 ? whole : measured;
  const reds = marks.filter((m, i) => m.c === "r" && i > 0 && m.t - marks[i - 1].t <= 1e5).map((m) => m.t);
  const res = reds.map((t) => {
    const d = t - last;
    return d - Math.round(d / cycle) * cycle;
  }).filter((r) => Math.abs(r) <= 3e3);
  const anchor = last + (res.length ? res.reduce((a, b) => a + b, 0) / res.length : 0);
  const R = med(s.dur.r), Yg = s.preGreen.length ? med(s.preGreen) : 0, Yb = s.dur.y.length ? med(s.dur.y) : 0;
  const G = cycle - R - Yg - Yb > 3e3 ? cycle - R - Yg - Yb : med(s.dur.g);
  const raw = [{ c: "r", d: R }, { c: "y", d: Yg }, { c: "g", d: G }, { c: "y", d: Yb }].filter((x) => x.d > 0);
  const k = cycle / raw.reduce((a, x) => a + x.d, 0);
  return { cycle, anchor, segs: raw.map((x) => ({ c: x.c, d: x.d * k })) };
}
var daySec = (t) => ((t / 1e3 - 5 * 3600) % 86400 + 86400) % 86400;
function signalSessions(all) {
  const out = [];
  let cur = [];
  const push = () => {
    if (cur.length) {
      const a = cur[0].t, b = cur[cur.length - 1].t;
      out.push({ marks: clean(cur), mid: daySec((a + b) / 2), end: b });
    }
  };
  for (const m of all) {
    if (cur.length && m.t - cur[cur.length - 1].t > SESSION_GAP) {
      push();
      cur = [];
    }
    cur.push(m);
  }
  push();
  return out;
}
function signalPlans(all, maxHours = 3) {
  const sessions = signalSessions(all).flatMap((s) => {
    const m = signalModel(s.marks);
    return m ? [{ m, mid: s.mid, end: s.end, marks: s.marks }] : [];
  });
  const plans = sessions.map((ref) => {
    const cyc = ref.m.cycle, members = sessions.filter((q) => {
      const raw = Math.abs(q.mid - ref.mid), d = Math.min(raw, 86400 - raw);
      if (d > maxHours * 3600 || Math.abs(q.m.cycle - cyc) >= 1e3) return false;
      const off = q.m.anchor - ref.m.anchor, res = off - Math.round(off / cyc) * cyc;
      return Math.abs(res) <= 3e3;
    });
    return { ...ref, m: members.length > 1 ? mergePlan(ref.m, members.map((q) => q.marks)) : ref.m, n: members.length };
  });
  return (t) => {
    let best = null, bd = Infinity;
    const now = daySec(t);
    for (const p of plans) {
      const raw = Math.abs(p.mid - now), d = Math.min(raw, 86400 - raw);
      if (d > maxHours * 3600) continue;
      if (best && (d > bd + 1800 || Math.abs(d - bd) <= 1800 && p.end < best.end)) continue;
      best = p;
      bd = d;
    }
    return best?.m ?? null;
  };
}
function mergePlan(ref, sessions) {
  const cycle = ref.cycle, dur = { g: [], y: [], r: [] }, preGreen = [], res = [];
  for (const marks of sessions) {
    const s = summarize(marks);
    ["g", "y", "r"].forEach((c) => dur[c].push(...s.dur[c]));
    preGreen.push(...s.preGreen);
    marks.forEach((m, i) => {
      if (m.c !== "r" || i === 0 || m.t - marks[i - 1].t > 1e5) return;
      const d = m.t - ref.anchor, r = d - Math.round(d / cycle) * cycle;
      if (Math.abs(r) <= 3e3) res.push(r);
    });
  }
  if (!dur.r.length) return ref;
  const anchor = ref.anchor + (res.length ? res.reduce((a, b) => a + b, 0) / res.length : 0);
  const R = med(dur.r), Yg = preGreen.length ? med(preGreen) : 0, Yb = dur.y.length ? med(dur.y) : 0;
  const G = cycle - R - Yg - Yb > 3e3 ? cycle - R - Yg - Yb : dur.g.length ? med(dur.g) : cycle - R - Yg - Yb;
  const raw = [{ c: "r", d: R }, { c: "y", d: Yg }, { c: "g", d: G }, { c: "y", d: Yb }].filter((x) => x.d > 0);
  const k = cycle / raw.reduce((a, x) => a + x.d, 0);
  return { cycle, anchor, segs: raw.map((x) => ({ c: x.c, d: x.d * k })) };
}
function refineCycle(all, base) {
  let best = base, bestN = 1;
  for (const c of ["g", "r"]) {
    const ts = all.filter((m) => m.c === c).map((m) => m.t);
    for (let i = 0; i < ts.length; i++) for (let j = ts.length - 1; j > i; j--) {
      const span = ts[j] - ts[i], n = Math.round(span / base);
      if (n > bestN && Math.abs(span / n - base) < 1500 && span < 6 * 36e5) {
        const fit = ts.slice(i, j + 1).every((t) => {
          const k = (t - ts[i]) / (span / n);
          return Math.abs(k - Math.round(k)) * (span / n) < 4e3;
        });
        if (fit) {
          best = span / n;
          bestN = n;
        }
        break;
      }
    }
  }
  return best;
}
function signalNow(m, t) {
  let into = ((t - m.anchor) % m.cycle + m.cycle) % m.cycle;
  for (const s of m.segs) {
    if (into < s.d) return { c: s.c, left: s.d - into };
    into -= s.d;
  }
  return { c: m.segs[0].c, left: 0 };
}
function measuredSignals(data) {
  const list = data?.mediciones ?? [];
  const C = { verde: "g", amarillo: "y", rojo: "r" };
  const parse = (m) => (m?.marcas ?? []).map(([t, c]) => ({ t: Date.parse(t), c: C[c] })).filter((x) => Number.isFinite(x.t) && x.c);
  return list.flatMap((m) => {
    const lat = Number(m.semaforo?.lat), lon = Number(m.semaforo?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
    const ref = typeof m.igual_a === "number" ? m.igual_a : typeof m.opuesto_de === "number" ? m.opuesto_de : -1;
    const shared = ref >= 0 && ref !== list.indexOf(m) ? parse(list[ref]) : [];
    const inverse = typeof m.opuesto_de === "number" && shared.length > 0;
    const marks = (shared.length ? shared : parse(m)).sort((a, b) => a.t - b.t);
    return marks.length ? [{ lat, lon, title: String(m.semaforo?.titulo ?? ""), marks, inverse, tm: m.semaforo?.transmilenio === true, follows: shared.length > 0, ref: shared.length ? { lat: Number(list[ref].semaforo?.lat), lon: Number(list[ref].semaforo?.lon) } : void 0 }] : [];
  });
}
function opposite(m, t) {
  let into = ((t - m.anchor) % m.cycle + m.cycle) % m.cycle;
  for (let i = 0; i < m.segs.length; i++) {
    const seg = m.segs[i];
    if (into < seg.d) {
      if (seg.c === "r") return "g";
      const prev = m.segs[(i - 1 + m.segs.length) % m.segs.length];
      return seg.c === "y" && prev.c === "r" ? "y" : "r";
    }
    into -= seg.d;
  }
  return "r";
}

// packages/application/src/signal-footprint.ts
function footprintModel(fp) {
  const [cycle, start, len] = fp;
  return { cycle: cycle * 1e3, anchor: start * 1e3, segs: [{ c: "r", d: len * 1e3 }, { c: "g", d: (cycle - len) * 1e3 }] };
}

// packages/application/src/signal-eta.ts
function busesConfirm(r) {
  const s = r?.stopped, g = r?.goes;
  if (!s?.n || !g?.n || s.n < 30 || g.n < 10) return false;
  return (s.red ?? 0) / s.n >= (s.chance ?? 1) + 0.15 && (g.ok ?? 0) / g.n >= (g.chance ?? 1) + 0.15;
}
var FRANJA = (h) => h < 6 ? 0 : h < 10 ? 1 : h < 16 ? 2 : h < 20 ? 3 : 4;
var DAY = (tMs) => {
  const w = new Date(tMs - 5 * 36e5).getUTCDay();
  return w === 0 ? "su" : w === 6 ? "sa" : "wk";
};
var HEAD = (ux, uy) => {
  const deg = (Math.atan2(ux, -uy) * 180 / Math.PI + 360) % 360;
  return ["N", "E", "S", "O"][Math.round(deg / 90) % 4];
};
var SignalWaits = class {
  list = [];
  prints = [];
  /** Por cada trazado, los semáforos con huella que quedan sobre él (se calcula una vez por trazado). */
  along = /* @__PURE__ */ new WeakMap();
  get size() {
    return this.list.length + this.prints.length;
  }
  /** Las huellas que publica `signalstats.ts` (`huellas.json`). Solo se usan si el archivo dice `use: true` (se enciende cuando la medición
   *  de precisión de las llegadas muestre que mejoran, sin sacar versión nueva). */
  loadFootprints(data) {
    const d = data;
    this.along = /* @__PURE__ */ new WeakMap();
    if (!d || d.use !== true || !d.s) {
      this.prints = [];
      return;
    }
    const by = /* @__PURE__ */ new Map();
    for (const [key, fp] of Object.entries(d.s)) {
      const [ll, day, bucket, dir] = key.split("|");
      const [lon, lat] = (ll ?? "").split(",").map(Number);
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || !day || bucket == null || !dir || !Array.isArray(fp) || fp.length < 3) continue;
      const f = by.get(ll) ?? by.set(ll, { lat, lon, plans: /* @__PURE__ */ new Map() }).get(ll);
      f.plans.set(`${day}|${bucket}|${dir}`, footprintModel(fp));
    }
    this.prints = [...by.values()];
  }
  /** `measured`: el archivo de medidas (`tools/data/mediciones-semaforos.json`); `learning`: `aprendizaje.json`. */
  load(measured, learning) {
    const rows = learning?.semaforos ?? {};
    const out = [];
    for (const m of measuredSignals(measured)) {
      const row = rows[`${m.lat.toFixed(6)},${m.lon.toFixed(6)}`];
      if (!busesConfirm(row)) continue;
      const ax = [...row.axes ?? []].filter((a) => (a.axis === "NS" || a.axis === "EO") && a.inverse != null).sort((a, b) => (b.n ?? 0) - (a.n ?? 0))[0];
      if (!ax) continue;
      out.push({ lat: m.lat, lon: m.lon, plan: signalPlans(m.marks), inverse: m.inverse !== (ax.inverse === true), axis: ax.axis });
    }
    this.list = out;
  }
  /** Segundos de espera en los semáforos confirmados entre los metros `fromS` y `toS` del recorrido `path`, si el bus llega a cada uno
   *  en rojo. `arriveAt(s)` dice a qué hora (s desde 1970) pasa el bus por el metro `s`. */
  waitAlong(path, fromS, toS, arriveAt) {
    if (!this.size || toS <= fromS) return 0;
    let wait = 0;
    for (const sig of this.list) {
      const hit = path.projectAfter(toWorld(sig), Math.max(0, fromS - 40), 30);
      if (!hit || hit.s <= fromS || hit.s >= toS) continue;
      const tg = path.tangentAt(hit.s), axis = Math.abs(tg.uy) >= Math.abs(tg.ux) ? "NS" : "EO";
      if (axis !== sig.axis) continue;
      const t = arriveAt(hit.s) + wait, model = sig.plan(t * 1e3);
      if (!model) continue;
      const c = sig.inverse ? opposite(model, t * 1e3) : signalNow(model, t * 1e3).c;
      if (c !== "r") continue;
      wait += redLeft(model, t * 1e3, sig.inverse) / 1e3;
    }
    if (this.prints.length) {
      for (const { s, f } of this.printsAlong(path)) {
        if (s <= fromS || s >= toS) continue;
        const t = arriveAt(s) + wait, tg = path.tangentAt(s);
        const h = new Date(t * 1e3 - 5 * 36e5).getUTCHours();
        const model = f.plans.get(`${DAY(t * 1e3)}|${FRANJA(h)}|${HEAD(tg.ux, tg.uy)}`);
        if (!model) continue;
        const now = signalNow(model, t * 1e3);
        if (now.c === "r") wait += now.left / 1e3;
      }
    }
    return wait;
  }
  printsAlong(path) {
    let hit = this.along.get(path);
    if (hit) return hit;
    hit = [];
    for (const f of this.prints) {
      const p = path.projectAfter(toWorld(f), 0, 25);
      if (p) hit.push({ s: p.s, f });
    }
    hit.sort((a, b2) => a.s - b2.s);
    this.along.set(path, hit);
    return hit;
  }
};
function redLeft(m, t, inverse) {
  const n = m.segs.length;
  let into = ((t - m.anchor) % m.cycle + m.cycle) % m.cycle, i = 0;
  for (; i < n; i++) {
    if (into < m.segs[i].d) break;
    into -= m.segs[i].d;
  }
  i %= n;
  let acc = 0;
  for (let k = 0; k < n; k++) {
    const seg = m.segs[(i + k) % n], part = k === 0 ? seg.d - into : seg.d;
    const waiting = inverse ? seg.c !== "r" : seg.c === "r" || k > 0 && seg.c === "y";
    if (!waiting) return acc;
    acc += part;
  }
  return acc;
}

// packages/application/src/eta-hold.ts
var ETA_HOLD_S = 90;
var FORGET_S = 120;
var EtaHold = class {
  shown = /* @__PURE__ */ new Map();
  /** La hora a mostrar (s desde 1970) para el bus `busId` en la parada `stopId`, dada la nueva estimación `at`. */
  smooth(busId, stopId, at, nowSec) {
    const key = `${busId}|${stopId}`, prev = this.shown.get(key);
    let out = at;
    if (prev && nowSec >= prev.t && nowSec - prev.t <= FORGET_S) {
      const later = at - prev.at;
      if (later > 0 && later <= ETA_HOLD_S) out = Math.min(at, prev.at + (nowSec - prev.t));
    }
    if (this.shown.size > 3e4) this.prune(nowSec);
    this.shown.set(key, { at: out, t: nowSec });
    return out;
  }
  prune(nowSec) {
    for (const [k, v] of this.shown) if (nowSec - v.t > FORGET_S) this.shown.delete(k);
  }
};

// packages/application/src/service-ends.ts
var SERVICE_DAY_CUTOFF_H = 3;
function serviceDay(nowMs, dates = {}) {
  const bog = new Date(nowMs - 5 * 36e5);
  let secs2 = bog.getUTCHours() * 3600 + bog.getUTCMinutes() * 60 + bog.getUTCSeconds() + bog.getUTCMilliseconds() / 1e3;
  let day = new Date(Date.UTC(bog.getUTCFullYear(), bog.getUTCMonth(), bog.getUTCDate()));
  if (bog.getUTCHours() < SERVICE_DAY_CUTOFF_H) {
    day = new Date(day.getTime() - 864e5);
    secs2 += 86400;
  }
  const key = `${day.getUTCFullYear()}${String(day.getUTCMonth() + 1).padStart(2, "0")}${String(day.getUTCDate()).padStart(2, "0")}`;
  const dow = day.getUTCDay();
  return { type: dates[key] ?? (dow === 0 ? "su" : dow === 6 ? "sa" : "wk"), secs: secs2 };
}
var ServiceEnds = class {
  last = /* @__PURE__ */ new Map();
  first = /* @__PURE__ */ new Map();
  byRoute = {};
  dates = {};
  get size() {
    return this.last.size;
  }
  load(data) {
    this.last.clear();
    this.first.clear();
    this.byRoute = data.routes ?? {};
    this.dates = data.dates ?? {};
    for (const days of Object.values(data.routes ?? {}))
      for (const d of Object.values(days ?? {})) {
        if (!d) continue;
        this.last.set(d.last[0], d.last[1]);
        this.first.set(d.first[0], d.first[1]);
      }
  }
  markOf(tripId) {
    if (!tripId) return void 0;
    const l = this.last.get(tripId), f = this.first.get(tripId);
    if (l == null && f == null) return void 0;
    return { isLast: l != null, isFirst: f != null, startSeconds: l ?? f };
  }
  /** Tipo de día y segundos transcurridos del día de servicio en este instante. */
  dayAt(nowMs) {
    return serviceDay(nowMs, this.dates);
  }
  /** Primer y último viaje de la ruta en cada tipo de día (segundos desde la medianoche), y cuál es el de hoy. */
  scheduleOf(routeId, nowMs) {
    const r = this.byRoute[routeId];
    if (!r) return void 0;
    const days = ["wk", "sa", "su"].flatMap((type) => {
      const d = r[type];
      return d ? [{ type, first: d.first[1], last: d.last[1] }] : [];
    });
    return days.length ? { today: this.todayFor(routeId, nowMs), days } : void 0;
  }
  /** El día que se marca «hoy» en el horario de una ruta. Pasada la medianoche el día de servicio sigue siendo el anterior (los horarios
   *  pasan de las 24:00), pero si el último bus de ayer ya terminó (salió hace más de hora y media) para la gente ya es el día nuevo:
   *  a la 1:50 a. m. del martes, tras un lunes festivo, se marcaba «Domingos y festivos · hoy». */
  todayFor(routeId, nowMs) {
    const sd = serviceDay(nowMs, this.dates);
    if (sd.secs < 86400) return sd.type;
    const last = this.byRoute[routeId]?.[sd.type]?.last[1];
    return last != null && sd.secs <= last + 5400 ? sd.type : serviceDay(nowMs + SERVICE_DAY_CUTOFF_H * 36e5, this.dates).type;
  }
  /** Estado de la ruta hoy según el horario programado. `activeBuses` son los buses de esa ruta que ahora mismo circulan. */
  routeStatus(routeId, nowMs, activeBuses) {
    const { type, secs: secs2 } = serviceDay(nowMs, this.dates);
    const d = this.byRoute[routeId]?.[type];
    if (!d) return void 0;
    const firstStart = d.first[1], lastStart = d.last[1];
    const state = secs2 < firstStart - 900 && activeBuses === 0 ? "before" : secs2 > lastStart && activeBuses === 0 ? "ended" : "running";
    const nextFirstStart = state === "ended" ? this.byRoute[routeId]?.[this.nextDayType(nowMs)]?.first[1] : void 0;
    return { state, firstStart, lastStart, nextFirstStart };
  }
  /** Tipo de horario del día de servicio que sigue al actual (para decir cuándo sale el primer bus una vez terminó el de hoy). */
  nextDayType(nowMs) {
    const { secs: secs2 } = serviceDay(nowMs, this.dates);
    return serviceDay(nowMs - secs2 * 1e3 + 36 * 36e5, this.dates).type;
  }
};

// packages/application/src/departures.ts
var decode = (d) => {
  let t = 0;
  return d.map((x) => t += x);
};
var Departures = class {
  data = {};
  starts = /* @__PURE__ */ new Map();
  byStop = null;
  get size() {
    return Object.keys(this.data).length;
  }
  load(d) {
    this.data = d.routes ?? {};
    this.starts.clear();
    this.byStop = null;
  }
  startsOf(routeId, direction, type) {
    const key = `${routeId}|${direction}|${type}`;
    let v = this.starts.get(key);
    if (!v) {
      const enc = this.data[routeId]?.[direction]?.[type];
      v = enc ? decode(enc) : [];
      this.starts.set(key, v);
    }
    return v;
  }
  /** Cada cuántos segundos pasa la ruta a esa hora, si va por frecuencia (TransMiCable: 10–16 s), o `null`. También dice cuándo abre
   *  y cierra ese día (segundos del día de servicio). */
  frequencyOf(routeId, type, secs2) {
    let opens = Infinity, closes = -Infinity, every = null;
    for (const e of Object.values(this.data[routeId] ?? {})) for (const [a, b, hw] of e.freq?.[type] ?? []) {
      opens = Math.min(opens, a);
      closes = Math.max(closes, b);
      if (secs2 >= a && secs2 < b) every = every == null ? hw : Math.min(every, hw);
    }
    return Number.isFinite(opens) ? { every, opens, closes } : null;
  }
  /** Ventanas de frecuencia de la ruta ese tipo de día: [desde, hasta, cada N s] (segundos del día de servicio). */
  windowsOf(routeId, type) {
    return Object.values(this.data[routeId] ?? {})[0]?.freq?.[type] ?? [];
  }
  /** El recorrido de una ruta (su primera variante) con lo que tarda en llegar a cada parada desde que sale (s). */
  scheduleOf(routeId) {
    const e = Object.values(this.data[routeId] ?? {})[0];
    return e ? { stops: e.stops, off: e.off } : null;
  }
  /** Última parada del recorrido (su destino). */
  terminusOf(routeId, direction) {
    const s = this.data[routeId]?.[direction]?.stops;
    return s?.[s.length - 1];
  }
  stopIndex() {
    if (!this.byStop) {
      this.byStop = /* @__PURE__ */ new Map();
      for (const [routeId, dirs] of Object.entries(this.data))
        for (const [direction, e] of Object.entries(dirs)) e.stops.forEach((s, index) => (this.byStop.get(s) ?? this.byStop.set(s, []).get(s)).push({ routeId, direction, index }));
    }
    return this.byStop;
  }
  /** La última hora de paso de cada ruta y sentido por la parada en ese tipo de día (segundos del día de servicio). */
  lastAt(stopId, type) {
    const out = [];
    for (const { routeId, direction, index } of this.stopIndex().get(stopId) ?? []) {
      const e = this.data[routeId][direction], off = e.off[index];
      if (off == null || index === e.stops.length - 1) continue;
      const starts = this.startsOf(routeId, direction, type);
      if (starts.length) out.push({ routeId, direction, time: starts[starts.length - 1] + off });
    }
    return out.sort((a, b) => a.time - b.time);
  }
  /** Próximas `n` horas de paso de cada ruta y sentido por la parada, desde `secs` (segundos del día de servicio). */
  nextAt(stopId, type, secs2, n = 3) {
    const out = [];
    for (const { routeId, direction, index } of this.stopIndex().get(stopId) ?? []) {
      const off = this.data[routeId][direction].off[index];
      if (off == null || index === this.data[routeId][direction].stops.length - 1) continue;
      const starts = this.startsOf(routeId, direction, type);
      let lo = 0, hi = starts.length;
      while (lo < hi) {
        const mid = lo + hi >> 1;
        if (starts[mid] + off < secs2 - 30) lo = mid + 1;
        else hi = mid;
      }
      const times = starts.slice(lo, lo + n).map((s) => s + off);
      if (times.length) out.push({ routeId, direction, times });
    }
    return out.sort((a, b) => a.times[0] - b.times[0]);
  }
  /** Cada cuántos segundos sale un bus de la ruta alrededor de `secs` (mediana de los intervalos de la hora anterior y siguiente). */
  headwayAt(routeId, type, secs2) {
    const gaps = [];
    for (const direction of Object.keys(this.data[routeId] ?? {})) {
      const s = this.startsOf(routeId, direction, type).filter((t) => t >= secs2 - 3600 && t <= secs2 + 3600);
      for (let i = 1; i < s.length; i++) gaps.push(s[i] - s[i - 1]);
    }
    if (!gaps.length) return void 0;
    gaps.sort((a, b) => a - b);
    return gaps[Math.floor(gaps.length / 2)];
  }
};

// packages/application/src/hop-profile.ts
var HOP_BUCKETS = ["0-6", "6-10", "10-16", "16-20", "20-24"];
function hopTag(nowMs) {
  const d = new Date(nowMs - 5 * 36e5), h = d.getUTCHours(), w = d.getUTCDay();
  return { day: w === 0 ? "su" : w === 6 ? "sa" : "wk", bucket: h < 6 ? 0 : h < 10 ? 1 : h < 16 ? 2 : h < 20 ? 3 : 4 };
}
var HOP_MIN_N = 3;
var HOP_PRIOR_N = 0;
var MIN_S = 8;
var MAX_S = 900;
var HopProfile = class {
  /** Si es `false`, el cálculo de llegada usa solo el valor fijo (para comparar). */
  apply = true;
  minN = HOP_MIN_N;
  priorN = HOP_PRIOR_N;
  /** Segundos que se suman a cada llegada mientras se usa lo aprendido (ver `HOP_EXTRA_S`). */
  extra = 0;
  /** Lo mismo por franja (`HOP_BUCKETS`); `null` = el mismo `extra` todo el día. */
  extraBy = null;
  /** Corrección aparte para la próxima parada y para las demás, por franja (ver `HOP_SPLIT_NEXT`); `null` = la de `extra`/`extraBy`. */
  split = null;
  routes = /* @__PURE__ */ new Map();
  stamp = "";
  tag = hopTag(0);
  /** Tipo de día de servicio (lo pone `TransitState` con el calendario de festivos): un lunes festivo usa los tiempos de domingo, no los de
   *  un lunes en hora pico. Sin él, solo se mira el día de la semana. */
  dayOf = null;
  tagAt = -Infinity;
  get size() {
    return this.routes.size;
  }
  get updated() {
    return this.stamp;
  }
  /** Carga el perfil publicado. Devuelve `false` (y no cambia nada) si el formato no es el esperado. */
  load(data) {
    const d = data;
    if (!d || d.v !== 1 || typeof d.r !== "object" || !d.r) return false;
    const next = /* @__PURE__ */ new Map();
    for (const [k, tags] of Object.entries(d.r)) {
      if (!tags || typeof tags !== "object") continue;
      const ok = {};
      for (const [t, arr] of Object.entries(tags)) if (Array.isArray(arr) && arr.every((x) => typeof x === "number" && Number.isFinite(x))) ok[t] = arr;
      next.set(k, ok);
    }
    this.routes = next;
    this.stamp = typeof d.updated === "string" ? d.updated : "";
    this.apply = d.use !== false;
    if (typeof d.prior === "number" && d.prior >= 0) this.priorN = d.prior;
    this.extra = okExtra(d.extra) ? d.extra : 0;
    this.extraBy = okBy(d.extraBy) ? d.extraBy.slice() : null;
    const sp = d.split;
    this.split = sp && okBy(sp.next) && okBy(sp.later) ? { next: sp.next.slice(), later: sp.later.slice() } : null;
    return true;
  }
  /** Segundos que se suman a una llegada calculada a esta hora a `away` paradas del bus (1 = la próxima): la corrección aparte de la
   *  próxima parada y las demás si el perfil la trae; si no, la de su franja; si no, la general. */
  extraAt(nowMs, away = 1) {
    if (this.split) return (away <= 1 ? this.split.next : this.split.later)[hopTag(nowMs).bucket];
    return this.extraBy ? this.extraBy[hopTag(nowMs).bucket] : this.extra;
  }
  /** Segundos para el tramo `i` (de la parada i a la i+1) del recorrido a esta hora: lo aprendido mezclado con `fallback` (el valor fijo).
   *  Sin datos suficientes devuelve `fallback` tal cual. Los fines de semana sin datos propios usan los de entre semana de la misma franja. */
  seconds(shape, i, nowMs, fallback) {
    const hit = this.learned(shape, i, nowMs);
    if (!hit) return fallback;
    const s = Math.min(MAX_S, Math.max(MIN_S, hit.s));
    return (hit.n * s + this.priorN * fallback) / (hit.n + this.priorN);
  }
  /** ¿Hay tiempo aprendido para ese tramo a esta hora? (Para quien quiere usarlo solo si existe, sin valor fijo con qué mezclarlo.) */
  has(shape, i, nowMs) {
    return this.learned(shape, i, nowMs) != null;
  }
  learned(shape, i, nowMs) {
    if (!this.apply) return null;
    const r = this.routes.get(`${shape.routeId}|${shape.direction}`);
    if (!r) return null;
    if (Math.abs(nowMs - this.tagAt) > 3e4) {
      const t = hopTag(nowMs);
      this.tag = this.dayOf ? { ...t, day: this.dayOf(nowMs) } : t;
      this.tagAt = nowMs;
    }
    const { day, bucket } = this.tag;
    let hit = pick(r[`${day}|${bucket}`], i, this.minN);
    if (!hit && day !== "wk") hit = pick(r[`wk|${bucket}`], i, this.minN);
    return hit;
  }
};
function okExtra(x) {
  return typeof x === "number" && Number.isFinite(x) && x >= -120 && x <= 120;
}
function okBy(x) {
  return Array.isArray(x) && x.length === HOP_BUCKETS.length && x.every(okExtra);
}
function pick(arr, i, minN) {
  if (!arr) return null;
  const s = arr[2 * i], n = arr[2 * i + 1];
  return s != null && n != null && s > 0 && n >= minN ? { s, n } : null;
}

// packages/application/src/alert-route.ts
function alertRouteName(state, code, alert) {
  const byId = state.routeById(code);
  if (byId) return byId.shortName;
  const idx = indexOf(state);
  if (idx.names.has(code)) return code;
  for (const id of alert.routeIds) {
    const r = state.routeById(id);
    if (r) return r.shortName;
  }
  const set = idx.byCode.get(code);
  return set && set.size === 1 ? [...set][0] : void 0;
}
var cache = null;
function indexOf(state) {
  const net = state.network, alerts = state.alerts;
  if (cache && cache.net === net && cache.alerts === alerts) return cache.idx;
  const names = /* @__PURE__ */ new Set();
  const byStop = /* @__PURE__ */ new Map();
  for (const [rid, shapes] of net.shapes) {
    const sn = net.routes.get(rid)?.shortName;
    if (!sn) continue;
    names.add(sn);
    for (const sh of shapes) for (const s of sh.stopIds) (byStop.get(s) ?? byStop.set(s, /* @__PURE__ */ new Set()).get(s)).add(sn);
  }
  const inOrder = (sn, stops) => {
    for (const r of net.routes.values()) {
      if (r.shortName !== sn) continue;
      for (const sh of net.shapes.get(r.id) ?? []) {
        let last = -1, ok = true;
        for (const s of stops) {
          const i = sh.stopIds.indexOf(s, last + 1);
          if (i < 0) {
            ok = false;
            break;
          }
          last = i;
        }
        if (ok) return true;
      }
    }
    return false;
  };
  const byCode = /* @__PURE__ */ new Map();
  for (const a of alerts) {
    const code = alertRouteCode(a);
    if (!code || names.has(code) || state.routeById(code) || !a.stopIds.length) continue;
    const sets = a.stopIds.map((s) => byStop.get(s) ?? /* @__PURE__ */ new Set());
    const cand = new Set([...sets[0]].filter((n) => sets.every((x) => x.has(n)) && inOrder(n, a.stopIds)));
    const prev = byCode.get(code);
    byCode.set(code, prev ? new Set([...prev].filter((x) => cand.has(x))) : cand);
  }
  const idx = { names, byCode };
  cache = { net, alerts, idx };
  return idx;
}
function alertRouteCode(a) {
  return (a.description.split("\\")[0] ?? "").replace(/^.*\s/, "").trim();
}

// packages/application/src/transit-state.ts
var DELAY_MAX_AGE_S = 600;
var TransitState = class {
  fleet = new Fleet();
  network = new TransitNetwork();
  tripUpdates = /* @__PURE__ */ new Map();
  alerts = [];
  /** Los últimos avisos recibidos de TransMilenio (sin los de la red), para volver a armar la lista si cambia la red. */
  feedAlerts = [];
  alertsByRoute = /* @__PURE__ */ new Map();
  alertsByStop = /* @__PURE__ */ new Map();
  /** Hora del último lote de posiciones (segundos desde 1970). */
  lastBatchAt = null;
  /** Última vez (ms) que la fuente respondió bien, haya traído datos nuevos o no. */
  lastPollOkAt = null;
  /** Última vez (ms) que la consulta falló (sin red o sin respuesta) y cuántas van seguidas. */
  lastPollFailAt = null;
  pollFailures = 0;
  source = null;
  version = 0;
  /** Lo que se ha aprendido de cuánto tarda cada ruta por parada. */
  travelTimes = new TravelTimes();
  /** Tiempos reales por tramo y hora (rama `hop-stats`); vacío hasta que la app los descarga. */
  hopProfile = new HopProfile();
  /** Semáforos medidos que los buses confirman: su espera se suma a las llegadas (ver `signal-eta.ts`). */
  signalWaits = new SignalWaits();
  /** Lo que se mostró de cada llegada: la cuenta regresiva se detiene en vez de subir de golpe (ver `eta-hold.ts`). */
  etaHold = new EtaHold();
  /** Posiciones que comparte la gente que va en un bus (opcional y anónimo; ver `shared-rides.ts`). Vacío si el servidor está apagado. */
  sharedRides = new SharedRides();
  // festivos: los tiempos aprendidos se eligen por el tipo de día de servicio, no solo por el día de la semana
  hopDayWired = this.hopProfile.dayOf = (t) => this.serviceEnds.dayAt(t).type;
  /** Primer y último viaje de cada ruta, para marcar «último servicio». */
  serviceEnds = new ServiceEnds();
  departures = new Departures();
  provisional = /* @__PURE__ */ new Map();
  trunk = null;
  served = null;
  labels = /* @__PURE__ */ new Map();
  seq = /* @__PURE__ */ new Map();
  listeners = /* @__PURE__ */ new Set();
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  touch() {
    this.version++;
    for (const l of this.listeners) l();
  }
  /** Rutas conocidas: las del GTFS o, mientras no cargan, las deducidas de los buses. */
  routes() {
    return this.network.routes.size ? [...this.network.routes.values()] : [...this.provisional.values()];
  }
  routeById(id) {
    return this.network.routes.get(id) ?? this.provisional.get(id);
  }
  families = null;
  /** Las rutas que para la gente son «la misma»: mismo nombre y mismo sistema. TransMilenio publica cada sentido como una ruta aparte
   *  (el 7 hacia Polo y el 7 hacia Portal Suba tienen códigos distintos; pasa con 261 de 668 nombres). Al elegir «el 7» hay que mostrar
   *  los buses de los dos sentidos: antes salían solo los de uno y parecía que faltaban buses en el mapa. Incluye siempre la propia ruta. */
  routeFamily(routeId) {
    const r = this.routeById(routeId);
    if (!r) return [routeId];
    if (!this.families) {
      this.families = /* @__PURE__ */ new Map();
      for (const x of this.network.routes.values()) {
        const k = `${x.system}|${x.shortName}`;
        (this.families.get(k) ?? this.families.set(k, []).get(k)).push(x.id);
      }
    }
    return this.families.get(`${r.system}|${r.shortName}`) ?? [routeId];
  }
  routeOf(v) {
    return this.routeById(v.routeId);
  }
  stopById(id) {
    return id ? this.network.stops.get(id) : void 0;
  }
  setDepartures(data) {
    this.departures.load(data);
    this.touch();
  }
  setServiceEnds(data) {
    this.serviceEnds.load(data);
    this.touch();
  }
  /** ¿Este bus hace el último (o el primer) viaje programado de su ruta? */
  serviceOf(v) {
    return this.serviceEnds.markOf(v.tripId);
  }
  /** Estado de la ruta hoy (antes del primer servicio, en servicio o terminada). Sin datos en vivo no se afirma nada. */
  routeStatus(routeId, nowMs) {
    if (this.fleet.size < 50) return void 0;
    let n = 0;
    for (const v of this.fleet.values()) if (v.routeId === routeId) n++;
    return this.serviceEnds.routeStatus(routeId, nowMs, n);
  }
  /** Puntualidad del bus según TransMilenio, o «sin dato». Solo vale si ese dato es de la misma época que la posición del bus:
   *  en nov. 2026 el archivo de retrasos trae datos de hace horas (mediana 3,5 h; solo 231 de 4.079 buses, todos zonales, y más de la
   *  mitad con retraso «0» exacto). Mostrar eso como puntualidad sería presentar un dato viejo como actual: se descarta si tiene más
   *  de 10 minutos respecto al reporte de posición. Si TransMilenio vuelve a publicarlo al día, reaparece solo. */
  delayOf(v) {
    const tu = v.tripId ? this.tripUpdates.get(v.tripId) : void 0;
    if (!tu || tu.reportedAt == null || v.reportedAt - tu.reportedAt > DELAY_MAX_AGE_S) return delayFromSeconds(null);
    return delayFromSeconds(tu.delaySeconds);
  }
  /** ¿Hay puntualidad vigente de algún bus? Si no, la interfaz esconde todo lo que hable de puntualidad. */
  hasDelays() {
    for (const v of this.fleet.values()) if (this.delayOf(v).kind !== "unknown") return true;
    return false;
  }
  /** La parada tiene al menos una ruta que se detiene en ella (hay paradas del archivo sin servicio). */
  isServed(id) {
    if (!this.served) {
      this.served = /* @__PURE__ */ new Set();
      for (const shapes of this.network.shapes.values()) for (const sh of shapes) for (const sid of sh.stopIds) this.served.add(sid);
    }
    return this.served.has(id);
  }
  /** Paradas por las que pasan rutas troncales o duales (donde el nombre trae vagón o plataforma). */
  isTrunkStop(id) {
    if (!this.trunk) {
      this.trunk = /* @__PURE__ */ new Set();
      for (const [rid, shapes] of this.network.shapes) {
        const sys = this.network.routes.get(rid)?.system;
        if (sys === "troncal" || sys === "dual") for (const sh of shapes) for (const sid of sh.stopIds) this.trunk.add(sid);
      }
    }
    return this.trunk.has(id);
  }
  /** Nombre limpio de la parada y su vagón (estaciones) o plataforma (portales). */
  labelOf(stop) {
    let l = this.labels.get(stop.id);
    if (!l) {
      l = parseStopName(stop.name, this.isTrunkStop(stop.id));
      this.labels.set(stop.id, l);
    }
    return l;
  }
  /** La «última parada» que informa TransMilenio suele estar mal (hoy, ~9 de cada 10 buses van a más de 1 km de ella, a veces a más de 10 km: es la de otro tramo del día).
   *  Si no concuerda con dónde está el bus sobre el recorrido, se reemplaza por la última parada que de verdad pasó, calculada con su posición; así todo lo que se apoya en ella
   *  (próxima parada, llegadas, tiempos aprendidos) parte de un dato verdadero. */
  fixedStops = /* @__PURE__ */ new Map();
  reconcileLastStops() {
    if (!this.network.shapes.size) return;
    for (const v of this.fleet.values()) {
      if (!v.lastStopId) continue;
      const memo = this.fixedStops.get(v.id);
      if (memo && memo.reportedAt === v.reportedAt) {
        if (memo.stopId) v.lastStopId = memo.stopId;
        else if (memo.clear) v.lastStopId = void 0;
        continue;
      }
      let fix;
      const reported = this.sequenceByStop(v);
      const info = reported ? shapeStops(this, reported.shape) : null;
      const hit = info ? info.path.project(v.world, 0, 0, 300) : null;
      const agrees = reported && info ? !!hit && hit.s >= info.s[reported.index] - 150 && hit.s <= (info.s[reported.index + 1] ?? Infinity) + 150 : !!reported;
      if (!agrees) {
        const pos = this.sequenceByPosition(v);
        if (pos) fix = pos.shape.stopIds[pos.index];
      }
      const clear = !agrees && !fix;
      if (fix) v.lastStopId = fix;
      else if (clear) v.lastStopId = void 0;
      this.fixedStops.set(v.id, { reportedAt: v.reportedAt, stopId: fix, clear });
    }
    if (this.fixedStops.size > this.fleet.size * 2) {
      for (const id of this.fixedStops.keys()) if (!this.fleet.get(id)) this.fixedStops.delete(id);
    }
  }
  /** Dónde va el bus dentro del recorrido de su ruta: su última parada, la lista de paradas y su posición en ella. */
  sequenceOf(v) {
    return this.sequenceByStop(v);
  }
  /** Dónde va el bus para mostrárselo al usuario: por su última parada y, si esa no sirve, por su posición sobre el recorrido. */
  sequenceForDisplay(v) {
    return this.sequenceOf(v) ?? this.sequenceByPosition(v);
  }
  /** Si la última parada informada no sirve (no está en el trazado de su ruta), se ubica al bus por dónde va: el recorrido más cercano a él y la última parada que ya pasó. */
  sequenceByPosition(v) {
    const tripRoute = v.tripId?.split(".").pop();
    const ux = v.bearing != null ? Math.sin(v.bearing * Math.PI / 180) : 0, uy = v.bearing != null ? -Math.cos(v.bearing * Math.PI / 180) : 0;
    let best;
    for (const rid of tripRoute && tripRoute !== v.routeId ? [v.routeId, tripRoute] : [v.routeId]) {
      for (const shape of this.network.shapes.get(rid) ?? []) {
        const info = shapeStops(this, shape);
        const hit = info?.path.projectAlong(v.world, ux, uy, 40);
        if (!info || !hit || v.bearing != null && !hit.forward) continue;
        let index = -1;
        for (let i = 0; i < info.s.length; i++) if (info.s[i] <= hit.s + 10) index = i;
        else break;
        if (index < 0 || index >= shape.stopIds.length - 1) continue;
        if (!best || hit.dist < best.dist) best = { shape, index, dist: hit.dist };
      }
      if (best) break;
    }
    return best ? { shape: best.shape, index: best.index } : void 0;
  }
  sequenceByStop(v) {
    if (!v.lastStopId) return void 0;
    const key = `${v.routeId}|${v.lastStopId}|${v.tripId?.split(".").pop() ?? ""}`;
    let hit = this.seq.get(key);
    if (hit === void 0) {
      hit = null;
      const tripRoute = v.tripId?.split(".").pop();
      for (const rid of tripRoute && tripRoute !== v.routeId ? [v.routeId, tripRoute] : [v.routeId]) {
        for (const shape of this.network.shapes.get(rid) ?? []) {
          const index = shape.stopIds.indexOf(v.lastStopId);
          if (index >= 0) {
            hit = { shape, index };
            break;
          }
        }
        if (hit) break;
      }
      this.seq.set(key, hit);
    }
    return hit ?? void 0;
  }
  /** La parada que sigue (la última que informa TransMilenio ya la pasó) y la hora estimada de llegada, en segundos desde 1970. */
  nextStopOf(v, nowMs = Date.now(), byPosition = true) {
    const seq = byPosition ? this.sequenceForDisplay(v) : this.sequenceOf(v);
    if (!seq) return void 0;
    const j = byPosition ? displayNextIndex(this, v, seq.shape, seq.index, nowMs) : seq.index + 1;
    const stopId = seq.shape.stopIds[j];
    if (!stopId) return void 0;
    return { stopId, stop: this.stopById(stopId), arrivalAt: byPosition ? shownArrival(this, v, seq.shape, seq.index, j, nowMs) : arrivalAtIndex(this, v, seq.shape, seq.index, j, nowMs) };
  }
  /** Saca de la flota los buses que llevan mucho sin reportar. Hay que llamarlo aunque no lleguen datos nuevos. */
  dropStale(nowMs) {
    if (this.fleet.dropReportedBefore(nowMs / 1e3 - MAX_REPORT_AGE_S)) {
      this.resolveSystems();
      this.touch();
    }
  }
  applyPositions(reports, nowMs) {
    this.fleet.ingest(reports.filter((r) => r.reportedAt >= nowMs / 1e3 - MAX_REPORT_AGE_S), nowMs);
    this.reconcileLastStops();
    let latest = this.lastBatchAt ?? 0;
    const times = reports.map((r) => r.reportedAt).sort((a, b) => a - b), mid = times[times.length >> 1] ?? 0;
    for (const t of times) if (t > latest && t <= mid + 600) latest = t;
    if (latest) this.lastBatchAt = latest;
    this.resolveSystems();
    this.travelTimes.observe(this);
    this.touch();
  }
  applyTripUpdates(updates) {
    this.tripUpdates = new Map(updates.map((u) => [u.tripId, u]));
    this.touch();
  }
  applyAlerts(alerts, nowMs = Date.now()) {
    this.feedAlerts = alerts;
    this.alerts = [...this.network.notices, ...alerts].filter((a) => isAlertActive(a, nowMs / 1e3));
    this.alertsByRoute = /* @__PURE__ */ new Map();
    this.alertsByStop = /* @__PURE__ */ new Map();
    this.alerts.forEach((a, i) => {
      for (const r of a.routeIds) (this.alertsByRoute.get(r) ?? this.alertsByRoute.set(r, []).get(r)).push(i);
      if (!a.routeIds.some((r) => this.network.routes.has(r))) {
        const name = alertRouteName(this, alertRouteCode(a), a);
        if (name) {
          for (const r of this.network.routes.values()) if (r.shortName === name) (this.alertsByRoute.get(r.id) ?? this.alertsByRoute.set(r.id, []).get(r.id)).push(i);
        }
      }
      for (const s of a.stopIds) (this.alertsByStop.get(s) ?? this.alertsByStop.set(s, []).get(s)).push(i);
    });
    this.touch();
  }
  setNetwork(network) {
    this.network = network;
    this.seq.clear();
    this.trunk = null;
    this.served = null;
    this.labels.clear();
    this.fixedStops.clear();
    this.families = null;
    this.resolveSystems();
    this.reconcileLastStops();
    this.applyAlerts(this.feedAlerts);
  }
  /** Asigna el sistema a cada bus: por la ruta del GTFS o, sin GTFS, por votación de sus reportes. */
  resolveSystems() {
    const votes = /* @__PURE__ */ new Map();
    for (const v of this.fleet.values()) {
      const route = this.network.routes.get(v.routeId);
      if (route) {
        v.system = route.system;
        continue;
      }
      const sys = inferSystemFromReport({ tripId: v.tripId, label: v.label, id: v.id });
      const m = votes.get(v.routeId) ?? votes.set(v.routeId, /* @__PURE__ */ new Map()).get(v.routeId);
      m.set(sys, (m.get(sys) ?? 0) + 1);
    }
    for (const [routeId, m] of votes) {
      const system = [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
      this.provisional.set(routeId, { id: routeId, shortName: routeId, longName: "", system, provisional: true });
    }
    for (const v of this.fleet.values()) {
      if (!this.network.routes.has(v.routeId)) v.system = this.provisional.get(v.routeId)?.system ?? "otro";
    }
  }
};

// packages/application/src/returning-buses.ts
var MAX_AHEAD_S = 40 * 60;

// packages/application/src/queries.ts
var collator = new Intl.Collator("es", { numeric: true });

// packages/application/src/ride-push.ts
var RIDE_PUSH_MAX_MS = 3 * 36e5;
var RIDE_PUSH_GONE_MS = 10 * 6e4;
function rideActivityState(r, left, eta) {
  const total = Math.max(r.total, left, 1);
  return {
    title: `Vas en el ${r.route || "bus"}`,
    detail: left === 1 ? `La siguiente parada es la tuya: ${r.stop}.` : `Te bajas en ${r.stop}. Faltan ${left} paradas.`,
    badge: r.route,
    color: r.color,
    until: eta,
    untilLabel: "Te bajas en",
    step: total - left,
    steps: total,
    arrive: eta,
    link: `transmilive:///ride/${r.busId}`
  };
}
function rideAlertText(id, stop) {
  if (id === "ride-3") return { id, title: "Faltan 3 paradas", body: `Te bajas en ${stop}.` };
  if (id === "ride-1") return { id, title: "Prep\xE1rate para bajar", body: `La siguiente parada es ${stop}.` };
  return { id, title: "B\xE1jate aqu\xED", body: `Est\xE1s llegando a ${stop}.` };
}
function planRidePush(state, ride, nowMs, tickS = 25) {
  const v = state.fleet.get(ride.busId);
  const seq = v ? state.sequenceForDisplay(v) : void 0;
  if (!v || !seq) return { kind: "missing" };
  const ti = seq.shape.stopIds.indexOf(ride.alightId, Math.max(0, seq.index));
  const now = nowMs / 1e3, half = tickS / 2;
  const alerts = [], markSent = [];
  const due = (id, send) => {
    if (ride.sent[id] != null) return;
    markSent.push(id);
    if (send) alerts.push(rideAlertText(id, ride.stop));
  };
  if (ti < 0) {
    due("ride-3", false);
    due("ride-1", false);
    due("ride-0", ride.sent["ride-1"] != null);
    return { kind: "done", alerts, markSent };
  }
  const left = ti - seq.index;
  const at = (j) => arrivalAtIndex(state, v, seq.shape, seq.index, j, nowMs);
  const eta = at(ti);
  if (left < 3) due("ride-3", false);
  else if (at(ti - 3) <= now + half) due("ride-3", true);
  if (left < 1) due("ride-1", false);
  else if (left === 1 || at(ti - 1) <= now + half) due("ride-1", true);
  if (left <= 0 || eta - 20 <= now + half) due("ride-0", true);
  if (left <= 0) return { kind: "done", alerts, markSent };
  return { kind: "going", left, eta, alerts, markSent, activity: rideActivityState({ ...ride, total: ride.total }, left, eta) };
}
function rideActivityChanged(prev, left, eta) {
  return !prev || prev.left !== left || Math.abs(prev.eta - eta) >= 30;
}

// packages/infrastructure/src/gtfsrt/reader.ts
var FeedDecodeError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "FeedDecodeError";
  }
};
var DECODER = new TextDecoder();
var Reader = class {
  constructor(buf) {
    this.buf = buf;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  view;
  varint(p) {
    let result = 0;
    let mul = 1;
    const start = p.pos;
    let n = 0;
    for (; ; ) {
      if (p.pos >= p.end) throw new FeedDecodeError("varint cortado");
      const b = this.buf[p.pos++];
      result += (b & 127) * mul;
      mul *= 128;
      n++;
      if (b < 128) break;
      if (n > 10) throw new FeedDecodeError("varint demasiado largo");
    }
    if (n >= 10) {
      let big = 0n;
      for (let i = 0; i < n; i++) big |= BigInt(this.buf[start + i] & 127) << BigInt(7 * i);
      return Number(BigInt.asIntN(64, big));
    }
    return result;
  }
  /** Recorre los campos de un mensaje. Para campos de longitud variable, `range` apunta a su contenido. */
  *fields(range = [0, this.buf.length]) {
    const p = { pos: range[0], end: range[1] };
    while (p.pos < p.end) {
      const key = this.varint(p);
      const field = Math.floor(key / 8);
      const wire = key & 7;
      if (wire === 0) yield { field, wire, num: this.varint(p), range: [0, 0] };
      else if (wire === 2) {
        const len = this.varint(p);
        if (len < 0 || p.pos + len > p.end) throw new FeedDecodeError("campo de longitud variable cortado");
        yield { field, wire, num: 0, range: [p.pos, p.pos + len] };
        p.pos += len;
      } else if (wire === 5) {
        if (p.pos + 4 > p.end) throw new FeedDecodeError("float cortado");
        yield { field, wire, num: this.view.getFloat32(p.pos, true), range: [0, 0] };
        p.pos += 4;
      } else if (wire === 1) {
        if (p.pos + 8 > p.end) throw new FeedDecodeError("double cortado");
        yield { field, wire, num: this.view.getFloat64(p.pos, true), range: [0, 0] };
        p.pos += 8;
      } else throw new FeedDecodeError(`tipo de campo no soportado (${wire})`);
    }
  }
  text(r) {
    const n = r[1] - r[0];
    if (n <= 40) {
      let s = "";
      for (let i = r[0]; i < r[1]; i++) {
        const c = this.buf[i];
        if (c > 127) return DECODER.decode(this.buf.subarray(r[0], r[1]));
        s += String.fromCharCode(c);
      }
      return s;
    }
    return DECODER.decode(this.buf.subarray(r[0], r[1]));
  }
};

// packages/infrastructure/src/gtfsrt/decoders.ts
function* entities(r) {
  for (const f of r.fields()) if (f.field === 2 && f.wire === 2) yield f.range;
}
function decodePositions(buf) {
  const r = new Reader(buf);
  const out = [];
  for (const e of entities(r)) {
    let entityId = "";
    let tripId, routeId = "", stopId;
    let lat = NaN, lon = NaN, ts = 0;
    let vid, label, plate;
    for (const f of r.fields(e)) {
      if (f.field === 1) entityId = r.text(f.range);
      if (f.field !== 4 || f.wire !== 2) continue;
      for (const v of r.fields(f.range)) {
        if (v.field === 1)
          for (const t of r.fields(v.range)) {
            if (t.field === 1) tripId = r.text(t.range);
            if (t.field === 5) routeId = r.text(t.range);
          }
        else if (v.field === 2)
          for (const p of r.fields(v.range)) {
            if (p.field === 1) lat = p.num;
            if (p.field === 2) lon = p.num;
          }
        else if (v.field === 5) ts = v.num;
        else if (v.field === 7) stopId = r.text(v.range);
        else if (v.field === 8)
          for (const d of r.fields(v.range)) {
            if (d.field === 1) vid = r.text(d.range);
            if (d.field === 2) label = r.text(d.range);
            if (d.field === 3) plate = r.text(d.range);
          }
      }
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({
      id: vid ?? (entityId || `${lat},${lon}`),
      plate,
      label,
      routeId,
      tripId,
      lastStopId: stopId,
      position: { lat, lon },
      reportedAt: ts
    });
  }
  return out;
}

// packages/infrastructure/src/gtfs/compact.ts
var SCALE = 1e5;
function expandNetwork(dto) {
  for (const s of dto.shapes) {
    const p = s.pts;
    let a = 0, b = 0;
    for (let i = 0; i + 1 < p.length; i += 2) {
      a += p[i];
      b += p[i + 1];
      p[i] = a / SCALE;
      p[i + 1] = b / SCALE;
    }
  }
  return dto;
}

// packages/infrastructure/src/gtfs/patches.ts
var STOP_PATCHES = [
  // La app oficial lista la H15 como «Calle 57 (vagón A) → Calle 53 - Universidad Manuela Beltrán (vagón A) → Av. 39»; el GTFS la trae sin Calle 57.
  { why: "H15 para en Calle 57 antes de la nueva estaci\xF3n Calle 53 - Universidad Manuela Beltr\xE1n", route: "H15", anchor: "74430", add: "74109", where: "before" }
];
var STOP_NAMES = {
  cable_tunal: "Portal Tunal \xB7 TransMiCable",
  cable_jpablo: "Juan Pablo II",
  cable_manitas: "Manitas",
  cable_paraiso: "Mirador del Para\xEDso"
};
function applyStopPatches(dto, patches = STOP_PATCHES) {
  for (const s of dto.stops) {
    const n = STOP_NAMES[s.id];
    if (n) s.name = n;
  }
  const known = new Set(dto.stops.map((s) => s.id));
  for (const p of patches) {
    if (!known.has(p.add)) continue;
    const ids = new Set(dto.routes.filter((r) => r.shortName === p.route).map((r) => r.id));
    for (const sh of dto.shapes) {
      if (!ids.has(sh.routeId) || sh.stopIds.includes(p.add)) continue;
      const i = sh.stopIds.indexOf(p.anchor);
      if (i < 0) continue;
      sh.stopIds.splice(p.where === "before" ? i : i + 1, 0, p.add);
    }
  }
}
var SABANA_2026_11 = "Cierre temporal del vag\xF3n 1 de De La Sabana, sentido occidente-oriente (obras en la v\xEDa), del 17 al 23 de noviembre de 2026";
var ZONA_IND_2026_11 = "Cierre temporal del vag\xF3n 2 de Zona Industrial, sentido occidente-oriente (obras en la v\xEDa), del 17 al 23 de noviembre de 2026";
var TEMP_STOP_CHANGES = [
  // De La Sabana A - 2 ó 5 (61650) → San Façon - Cra. 22 B - 2 ó 5 (61705, «vagón 2 de San Facón»); la J23 ya para ahí y solo se salta De La Sabana
  { why: SABANA_2026_11, route: "A60", stop: "61650", replaceWith: "61705", from: "2026-11-17", to: "2026-11-23" },
  { why: SABANA_2026_11, route: "C19", stop: "61650", replaceWith: "61705", from: "2026-11-17", to: "2026-11-23" },
  { why: SABANA_2026_11, route: "J23", stop: "61650", from: "2026-11-17", to: "2026-11-23" },
  // Zona Industrial B - 2 ó 5 (61718) → CDS - Cra. 32 B - 2 ó 5 (61641, «vagón 2 de CDS Carrera 32»); la B28 ya para en CDS y solo se salta Zona Industrial
  { why: ZONA_IND_2026_11, route: "E32", stop: "61718", replaceWith: "61641", from: "2026-11-17", to: "2026-11-23" },
  { why: ZONA_IND_2026_11, route: "B28", stop: "61718", from: "2026-11-17", to: "2026-11-23" }
];
var bogotaDate = (ms) => new Date(ms - 5 * 36e5).toISOString().slice(0, 10);
function applyTempStopChanges(dto, nowMs = Date.now(), changes = TEMP_STOP_CHANGES) {
  const today = bogotaDate(nowMs), known = new Set(dto.stops.map((s) => s.id)), used = [];
  for (const c of changes) {
    if (today < c.from || today > c.to) continue;
    const ids = new Set(dto.routes.filter((r) => r.shortName === c.route).map((r) => r.id));
    for (const sh of dto.shapes) {
      if (!ids.has(sh.routeId)) continue;
      const i = sh.stopIds.indexOf(c.stop);
      if (i < 0) continue;
      const swap = c.replaceWith && known.has(c.replaceWith) && sh.stopIds[i - 1] !== c.replaceWith && sh.stopIds[i + 1] !== c.replaceWith;
      if (swap) sh.stopIds[i] = c.replaceWith;
      else sh.stopIds.splice(i, 1);
      used.push(c);
    }
  }
  return used;
}
var TEMP_NOTICES = [
  {
    title: "De La Sabana: vag\xF3n 1 cerrado hacia el oriente",
    text: "Del 17 al 23 de noviembre el vag\xF3n 1 de De La Sabana est\xE1 cerrado en sentido occidente-oriente por obras en la v\xEDa. Las rutas A60 y C19 paran en el vag\xF3n 2 de San Fac\xF3n - Cra. 22. La J23 no para en De La Sabana.",
    routes: ["A60", "C19", "J23"],
    stops: ["61650", "61705"],
    from: "2026-11-17",
    to: "2026-11-23"
  },
  {
    title: "Zona Industrial: vag\xF3n 2 cerrado hacia el oriente",
    text: "Del 17 al 23 de noviembre el vag\xF3n 2 de Zona Industrial est\xE1 cerrado en sentido occidente-oriente por obras en la v\xEDa. La ruta E32 para en el vag\xF3n 2 de CDS - Carrera 32. La B28 no para en Zona Industrial.",
    routes: ["E32", "B28"],
    stops: ["61718", "61641"],
    from: "2026-11-17",
    to: "2026-11-23"
  }
];
function tempNoticeAlerts(nowMs, routeIdsOf, notices = TEMP_NOTICES) {
  const today = bogotaDate(nowMs);
  const day = (d, end) => Date.parse(`${d}T${end ? "23:59:59" : "00:00:00"}-05:00`) / 1e3;
  return notices.filter((n) => today >= n.from && today <= n.to).map((n, i) => ({
    id: -1 - i,
    headline: n.title,
    description: "",
    effect: "modified",
    title: n.title,
    text: n.text,
    routeIds: n.routes.flatMap(routeIdsOf),
    stopIds: n.stops,
    startsAt: day(n.from, false),
    endsAt: day(n.to, true)
  }));
}

// packages/infrastructure/src/gtfs/parse.ts
function buildNetwork(dto) {
  applyStopPatches(dto);
  applyTempStopChanges(dto);
  const net = new TransitNetwork();
  for (const r of dto.routes) {
    net.routes.set(r.id, {
      id: r.id,
      shortName: r.shortName,
      longName: r.longName,
      system: classifyRoute({ shortName: r.shortName, longName: r.longName, description: r.description, agencyId: r.agencyId, routeType: r.routeType, routeColor: r.color })
    });
  }
  for (const s of dto.stops) net.stops.set(s.id, { id: s.id, code: s.code, name: s.name, position: { lat: s.lat, lon: s.lon } });
  for (const [rid, hs] of Object.entries(dto.headsigns)) net.headsigns.set(rid, hs);
  for (const sh of dto.shapes) {
    const points = [];
    for (let i = 0; i < sh.pts.length; i += 2) points.push({ lat: sh.pts[i], lon: sh.pts[i + 1] });
    (net.shapes.get(sh.routeId) ?? net.shapes.set(sh.routeId, []).get(sh.routeId)).push({
      routeId: sh.routeId,
      direction: sh.direction,
      headsign: sh.headsign,
      points,
      stopIds: sh.stopIds
    });
  }
  net.notices = tempNoticeAlerts(Date.now(), (sn) => [...net.routes.values()].filter((r) => r.shortName === sn).map((r) => r.id));
  return net;
}
export {
  RIDE_PUSH_GONE_MS,
  RIDE_PUSH_MAX_MS,
  TransitState,
  buildNetwork,
  decodePositions,
  dedupeSharedRides,
  expandNetwork,
  planRidePush,
  rideActivityChanged
};
