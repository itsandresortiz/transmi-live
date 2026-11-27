/**
 * Informe por cruce semafórico para la Secretaría Distrital de Movilidad: lo que muestran los buses zonales al pasar por los cruces
 * con semáforo de Bogotá (dónde, cuándo y en qué sentido esperan más; qué cruces parecen de tiempo fijo y su rojo estimado).
 *
 * Lee lo que acumula `tools/signalstats.ts` en la rama `signal-stats` (`stats.json.gz`, `aprendizaje.json`), lo resume con
 * `signalReport` (`packages/application/src/signal-report.ts`) y escribe en la carpeta de salida:
 *   semaforos-informe.html   página estática, sin dependencias (se publica con la web)
 *   semaforos-informe.json   las cifras de la página
 *   semaforos-informe.csv    una fila por cruce, para abrir en una hoja de cálculo
 * Los nombres de los cruces salen de `<salida>/semaforos.json` (lo escribe `tools/semaforos.ts` en el despliegue) o, si no está, de la
 * red semafórica de Movilidad (datos abiertos, CC BY 4.0). Sin datos personales: solo conteos; no hay identidad de buses.
 *
 * Uso: npx tsx tools/informe-semaforos.ts [carpeta_salida=apps/web/dist] [carpeta_con_stats.json.gz]
 *      (sin la segunda carpeta, baja la rama signal-stats del repositorio público)
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  CORRIDORS, REPORT_BUCKET_NAMES, REPORT_DAY_NAMES, REPORT_DIR_NAMES, redTimes, signalReport,
  type ReportCrossing, type ReportGroup, type ReportPrint, type ReportStats,
} from "@transmi/application";

const OUT = process.argv[2] ?? "apps/web/dist";
const REPO = process.env.GITHUB_REPOSITORY ?? "itsandresortiz/transmi-live";
/** Desde cuándo los conteos traen el sentido del bus (las claves de antes no se usan). */
const SINCE = "2026-11-17T12:00:00Z";
const MOVILIDAD = "https://sig.simur.gov.co/arcgis/rest/services/DatosAbiertos/RedSemaforica/FeatureServer/0/query";
const TOP = 40, TOP_BUCKET = 10, TOP_PRINTS = 60;

interface Learned { titulo: string; tm: boolean; n: number; agree: number; stopped?: { n: number; red: number; chance: number } }
type Names = Map<string, { dir: string; loc: string }>;

function dataDir(): string {
  if (process.argv[3]) return process.argv[3];
  const dir = mkdtempSync(join(tmpdir(), "informe-"));
  execFileSync("git", ["clone", "-q", "--depth", "1", "--branch", "signal-stats", `https://github.com/${REPO}.git`, dir], { stdio: "pipe" });
  return dir;
}

async function names(): Promise<Names> {
  const out: Names = new Map();
  const local = join(OUT, "semaforos.json");
  if (existsSync(local)) {
    for (const r of (JSON.parse(readFileSync(local, "utf8")) as { rows: [number, number, string, string][] }).rows) out.set(`${r[0]},${r[1]}`, { dir: r[2], loc: r[3] });
    if (out.size) return out;
  }
  try {
    for (let off = 0; off < 20_000; off += 1000) {
      const q = new URLSearchParams({ where: "1=1", outFields: "DIRECCION,LOCALIDAD", outSR: "4326", f: "geojson", resultOffset: String(off), resultRecordCount: "1000", orderByFields: "OBJECTID" });
      const j = (await (await fetch(`${MOVILIDAD}?${q}`, { headers: { "User-Agent": "Mozilla/5.0 (transmi-live)" } })).json()) as { features?: { geometry?: { coordinates?: [number, number] }; properties?: Record<string, unknown> }[] };
      for (const f of j.features ?? []) {
        const c = f.geometry?.coordinates; if (!c) continue;
        out.set(`${Math.round(c[0] * 1e5) / 1e5},${Math.round(c[1] * 1e5) / 1e5}`, { dir: String(f.properties?.DIRECCION ?? "").trim(), loc: String(f.properties?.LOCALIDAD ?? "").trim() });
      }
      if ((j.features?.length ?? 0) < 1000) break;
    }
  } catch (e) { console.warn("Informe: sin nombres de cruces de Movilidad:", e instanceof Error ? e.message : e); }
  return out;
}

// ——— formato ———
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const num = (x: number) => Math.round(x).toLocaleString("es-CO");
const pct = (x: number) => `${Math.round(x * 100)} %`;
const kmh = (x: number) => `${x.toLocaleString("es-CO", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} km/h`;
const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Bogota" });
const when = (g: { day: string; bucket: number }) => `${REPORT_DAY_NAMES[g.day] ?? g.day}, ${(REPORT_BUCKET_NAMES[g.bucket] ?? "").toLowerCase()}`;
const dirName = (d: string) => REPORT_DIR_NAMES[d] ?? d;
/** Hora de ejemplo dentro de la franja para mostrar cuándo empieza el rojo. */
const SAMPLE_HOUR = [5, 7, 12, 17, 21];
const strength = (z: number) => (z >= 20 ? "Muy clara" : z >= 10 ? "Clara" : "Moderada");
/** Escala de espera (una sola tinta, de claro a oscuro). */
const STEPS = [0.2, 0.35, 0.5, 0.65];
const step = (share: number) => STEPS.filter((t) => share >= t).length;

function title(c: { lon: number; lat: number }, nm: Names): { name: string; loc: string } {
  const n = nm.get(`${c.lon},${c.lat}`);
  return { name: n?.dir || `Cruce en ${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`, loc: n?.loc ?? "" };
}

function mapSvg(all: ReportCrossing[], top: ReportCrossing[], nm: Names): string {
  const lons = all.map((c) => c.lon), lats = all.map((c) => c.lat);
  const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2, k = Math.cos((lat0 * Math.PI) / 180);
  const x0 = Math.min(...lons) * k, x1 = Math.max(...lons) * k, y0 = Math.min(...lats), y1 = Math.max(...lats);
  const W = 640, pad = 16, s = (W - 2 * pad) / (x1 - x0), H = Math.round((y1 - y0) * s + 2 * pad);
  const X = (lon: number) => (pad + (lon * k - x0) * s).toFixed(1), Y = (lat: number) => (pad + (y1 - lat) * s).toFixed(1);
  const lines = CORRIDORS.map((c) => `<polyline points="${c.p.map(([la, lo]) => `${X(lo)},${Y(la)}`).join(" ")}"/>`).join("");
  const rank = new Map(top.map((c, i) => [c, i + 1]));
  const dots = [...all].sort((a, b) => a.share - b.share).map((c) => {
    const r = rank.get(c), t = title(c, nm);
    const rad = r ? 5 + Math.min(5, Math.sqrt(c.still) / 12) : 2.5;
    return `<circle class="s${step(c.share)}${r ? " top" : ""}" cx="${X(c.lon)}" cy="${Y(c.lat)}" r="${rad.toFixed(1)}"><title>${r ? `${r}. ` : ""}${esc(t.name)}: ${pct(c.share)} de los buses detenidos, ${kmh(c.kmh)} (${num(c.n)} pasadas)</title></circle>`;
  }).join("");
  // los números de dos cruces pegados se pisaban: si ya hay uno cerca, este va al otro lado del punto
  const placed: [number, number][] = [];
  const labels = top.slice(0, 10).map((c, i) => {
    const cx = Number(X(c.lon)), cy = Number(Y(c.lat));
    const clash = placed.some(([x, y]) => Math.abs(x - (cx + 9)) < 18 && Math.abs(y - (cy + 4)) < 12);
    const x = clash ? cx - 9 : cx + 9, y = cy + 4;
    placed.push([x, y]);
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}"${clash ? ' text-anchor="end"' : ""}>${i + 1}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Mapa de Bogotá con los ${all.length} cruces analizados; los ${top.length} con más espera, numerados"><g class="trunk">${lines}</g><g>${dots}</g><g class="lbl">${labels}</g></svg>`;
}

/** En el celular cada fila se ve como una ficha: cada celda lleva el nombre de su columna (`data-l`) para mostrarlo al lado. */
function cardify(html: string): string {
  return html.replace(/<table>([\s\S]*?)<\/table>/g, (whole, inner: string) => {
    const labels = [...inner.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]!);
    const body = inner.replace(/<tr>([\s\S]*?)<\/tr>/g, (tr, cells: string) => {
      if (cells.includes("<th")) return tr;
      let i = 0;
      return `<tr>${cells.replace(/<td( class="[^"]*")?>/g, (_m, cls: string | undefined) => `<td${cls ?? ""} data-l="${labels[i++] ?? ""}">`)}</tr>`;
    });
    return `<table class="cards">${body}</table>`;
  });
}

function groupCell(g: ReportGroup | null): string {
  if (!g) return "—";
  return `${esc(when(g))}<br><span class="muted">buses ${esc(dirName(g.dir))}: ${pct(g.share)} detenidos, ${kmh(g.kmh)}</span>`;
}

function crossTable(rows: ReportCrossing[], nm: Names): string {
  const tr = rows.map((c, i) => {
    const t = title(c, nm);
    return `<tr><td class="n">${i + 1}</td><td><b>${esc(t.name)}</b>${t.loc ? `<br><span class="muted">${esc(t.loc)}</span>` : ""}</td><td class="n">${num(c.n)}</td><td class="n"><span class="chip s${step(c.share)}"></span>${pct(c.share)}</td><td class="n">${kmh(c.kmh)}</td><td>${groupCell(c.worst)}</td></tr>`;
  }).join("");
  return `<div class="tw"><table><thead><tr><th class="n">#</th><th>Cruce</th><th class="n">Pasadas</th><th class="n">Detenidos</th><th class="n">Velocidad media</th><th>Cuándo y en qué sentido esperan más</th></tr></thead><tbody>${tr}</tbody></table></div>`;
}

function bucketTables(all: ReportCrossing[], nm: Names): string {
  const parts: string[] = [];
  const blocks: [string, (g: ReportGroup) => boolean][] = [
    ...REPORT_BUCKET_NAMES.map((b, i) => [`Entre semana · ${b}`, (g: ReportGroup) => g.day === "wk" && g.bucket === i] as [string, (g: ReportGroup) => boolean]),
    ["Sábado (todo el día)", (g) => g.day === "sa"], ["Domingo (todo el día)", (g) => g.day === "su"],
  ];
  blocks.forEach(([label, keep], bi) => {
    const rows = all.flatMap((c) => c.groups.filter(keep).map((g) => ({ c, g }))).sort((a, b) => b.g.lb - a.g.lb).slice(0, TOP_BUCKET);
    if (!rows.length) return;
    const tr = rows.map(({ c, g }, i) => {
      const t = title(c, nm);
      return `<tr><td class="n">${i + 1}</td><td><b>${esc(t.name)}</b>${t.loc ? `<br><span class="muted">${esc(t.loc)}</span>` : ""}</td><td>${esc(dirName(g.dir))}${label.startsWith("Entre") ? "" : `<br><span class="muted">${esc((REPORT_BUCKET_NAMES[g.bucket] ?? "").toLowerCase())}</span>`}</td><td class="n">${num(g.n)}</td><td class="n"><span class="chip s${step(g.share)}"></span>${pct(g.share)}</td><td class="n">${kmh(g.kmh)}</td></tr>`;
    }).join("");
    parts.push(`<details${bi === 1 ? " open" : ""}><summary>${esc(label)}</summary><div class="tw"><table><thead><tr><th class="n">#</th><th>Cruce</th><th>Buses que van</th><th class="n">Pasadas</th><th class="n">Detenidos</th><th class="n">Velocidad media</th></tr></thead><tbody>${tr}</tbody></table></div></details>`);
  });
  return parts.join("");
}

function printTable(rows: { c: ReportCrossing; p: ReportPrint; more: number }[], nm: Names): string {
  const tr = rows.map(({ c, p, more }) => {
    const t = title(c, nm), times = redTimes(p.cycle, p.redStart, SAMPLE_HOUR[p.bucket] ?? 12).join(", ");
    return `<tr><td><b>${esc(t.name)}</b>${t.loc ? `<br><span class="muted">${esc(t.loc)}</span>` : ""}</td><td>${esc(when(p))}<br><span class="muted">buses ${esc(dirName(p.dir))}</span></td><td class="n">${p.cycle} s</td><td class="n">~${p.red} s</td><td>${times}…</td><td>${strength(p.z)}<br><span class="muted">${num(p.stops)} detenciones${more ? ` · también en ${more} franja${more > 1 ? "s" : ""} más` : ""}</span></td></tr>`;
  }).join("");
  return `<div class="tw"><table><thead><tr><th>Cruce</th><th>Cuándo</th><th class="n">Ciclo</th><th class="n">Rojo estimado</th><th>El rojo empezaría a las</th><th>Señal</th></tr></thead><tbody>${tr}</tbody></table></div>`;
}

async function main() {
  const dir = dataDir();
  const raw = JSON.parse(gunzipSync(readFileSync(join(dir, "stats.json.gz"))).toString()) as { updated: string; stats: Record<string, ReportStats> };
  const learned = existsSync(join(dir, "aprendizaje.json")) ? (JSON.parse(readFileSync(join(dir, "aprendizaje.json"), "utf8")) as { semaforos: Record<string, Learned> }).semaforos : {};
  const rep = signalReport(raw.stats);
  if (rep.crossings.length < 20) throw new Error(`muy pocos cruces con datos (${rep.crossings.length}): no se publica`);
  const nm = await names();
  const top = rep.crossings.slice(0, TOP);
  // huellas: la más fuerte de cada cruce, con cuántas franjas más la muestran con el mismo ciclo y un inicio parecido (±10 s)
  const printed = rep.crossings.filter((c) => c.prints.length).map((c) => {
    const p = c.prints[0]!;
    const near = (a: number, b: number) => { const d = Math.abs(a - b) % p.cycle; return Math.min(d, p.cycle - d) <= 10; };
    return { c, p, more: c.prints.slice(1).filter((q) => q.cycle === p.cycle && near(q.redStart, p.redStart)).length };
  }).sort((a, b) => b.more - a.more || b.p.z - a.p.z);
  const cyc = (n: number) => printed.filter((x) => x.p.cycle === n).length;
  const reds = printed.map((x) => x.p.red).sort((a, b) => a - b), redMed = reds.length ? reds[Math.floor(reds.length / 2)]! : 0;
  const allShare = rep.stops / rep.observations;
  const updated = raw.updated, nCross = rep.crossings.length;
  const measured = Object.values(learned).filter((l) => l.n > 0);

  const json = {
    v: 1, generado: new Date().toISOString(), datosHasta: updated, desde: SINCE.slice(0, 10),
    fuentes: ["TransMilenio S.A., datos abiertos (posiciones de los buses y GTFS)", "Secretaría Distrital de Movilidad, Red semafórica (datos abiertos, CC BY 4.0)"],
    metodo: { radio_m: 35, excluye: "paradas a ≤45 m y rutas troncales", detenido: "< 1,2 m/s entre dos reportes", reportes_s: "~20", minPasadasGrupo: rep.minGroup, minPasadasCruce: rep.minCrossing },
    totales: { pasadas: rep.observations, detenciones: rep.stops, cruces: nCross, conHuella: printed.length, huella90: cyc(90), huella120: cyc(120) },
    cruces: rep.crossings.map((c) => ({ cruce: title(c, nm).name, localidad: title(c, nm).loc, lon: c.lon, lat: c.lat, pasadas: c.n, detenidos: c.still, proporcion: c.share, kmh: c.kmh, grupos: c.groups.map((g) => ({ dia: g.day, franja: REPORT_BUCKET_NAMES[g.bucket], sentido: g.dir, pasadas: g.n, detenidos: g.still, proporcion: g.share, kmh: g.kmh })), huellas: c.prints.map((p) => ({ dia: p.day, franja: REPORT_BUCKET_NAMES[p.bucket], sentido: p.dir, ciclo_s: p.cycle, inicioRojo_s: p.redStart, rojo_s: p.red, fuerza: p.z, detenciones: p.stops })) })),
  };
  const csv = ["cruce,localidad,lat,lon,pasadas,detenidos,proporcion_detenidos,velocidad_kmh,mas_espera_dia,mas_espera_franja,mas_espera_sentido,mas_espera_proporcion,huella_ciclo_s,huella_rojo_s,huella_inicio_rojo_s"]
    .concat(rep.crossings.map((c) => {
      const t = title(c, nm), w = c.worst, p = c.prints[0];
      const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
      return [q(t.name), q(t.loc), c.lat, c.lon, c.n, c.still, c.share, c.kmh, w ? REPORT_DAY_NAMES[w.day] : "", w ? q(REPORT_BUCKET_NAMES[w.bucket] ?? "") : "", w ? dirName(w.dir) : "", w?.share ?? "", p?.cycle ?? "", p?.red ?? "", p?.redStart ?? ""].join(",");
    })).join("\n");

  const html = `<!doctype html>
<html lang="es-CO">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Espera en semáforos · TransMi LIVE</title>
<meta name="description" content="Informe por cruce: dónde, cuándo y en qué sentido esperan más los buses de Bogotá en los semáforos, según sus reportes de posición.">
<meta name="color-scheme" content="light dark">
<style>
@font-face{font-family:TMWide;src:url(fonts/TMWide-ExtraBold.woff2) format("woff2");font-display:swap}
:root{--bg:#fff;--fg:#0b0b0d;--muted:#5b5b62;--line:#e4e4e9;--soft:#f5f5f7;--accent:#d4162a;--trunk:#d9d9de;--dot:#c4c4ca;
--s0:#fde3e1;--s1:#f9b4ad;--s2:#ee7a6f;--s3:#d4162a;--s4:#8a0d1b}
@media (prefers-color-scheme:dark){:root{--bg:#000;--fg:#fff;--muted:#a9a9b0;--line:#2c2c2e;--soft:#141416;--accent:#ff4d5e;--trunk:#3a3a3e;--dot:#4a4a50;
--s0:#4a1a1d;--s1:#7a242b;--s2:#b23440;--s3:#ec4b58;--s4:#ff9aa3}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:980px;margin:0 auto;padding:24px 16px 64px}
h1{font-family:TMWide,-apple-system,sans-serif;font-weight:800;font-size:clamp(26px,5vw,38px);line-height:1.1;letter-spacing:-.5px;margin:8px 0 8px}
h2{font-size:22px;margin:40px 0 8px}
p,li{color:var(--muted)}b{color:var(--fg)}a{color:var(--accent)}
.muted{color:var(--muted);font-size:14px}
.top{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);padding-bottom:14px;margin-bottom:20px;gap:12px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:20px 0}
.tile{background:var(--soft);border-radius:14px;padding:14px}.tile b{display:block;font-size:26px;font-variant-numeric:tabular-nums;line-height:1.2}.tile span{color:var(--muted);font-size:14px}
.tw{overflow-x:auto;margin:12px 0;border:1px solid var(--line);border-radius:14px}
table{border-collapse:collapse;width:100%;font-size:14.5px}
th,td{padding:9px 10px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line)}
tr:last-child td{border-bottom:0}
th{font-size:13px;color:var(--muted);font-weight:600;background:var(--soft);white-space:nowrap}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.chip{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:baseline}
.s0{fill:var(--s0);background:var(--s0)}.s1{fill:var(--s1);background:var(--s1)}.s2{fill:var(--s2);background:var(--s2)}.s3{fill:var(--s3);background:var(--s3)}.s4{fill:var(--s4);background:var(--s4)}
svg{width:100%;height:auto;max-height:78vh;display:block;margin:0 auto}
.trunk polyline{fill:none;stroke:var(--trunk);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
circle{stroke:var(--bg);stroke-width:1}circle:not(.top){fill:var(--dot)}circle.top{stroke-width:2}
.lbl text{font-size:12px;font-weight:700;fill:var(--fg);paint-order:stroke;stroke:var(--bg);stroke-width:3px}
.mapbox{border:1px solid var(--line);border-radius:14px;padding:8px;margin:12px 0}
.legend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:13px;color:var(--muted);margin:8px 4px 0}
details{border:1px solid var(--line);border-radius:14px;margin:10px 0;padding:0 12px}
details[open]{padding-bottom:4px}summary{cursor:pointer;padding:12px 0;font-weight:600}
details .tw{border:0;margin:0 -12px;border-radius:0;border-top:1px solid var(--line)}
@media (max-width:640px){table.cards thead{display:none}table.cards,table.cards tbody,table.cards tr,table.cards td{display:block}
table.cards tr{padding:10px 12px;border-bottom:1px solid var(--line)}table.cards tr:last-child{border-bottom:0}
table.cards td{border:0;padding:2px 0;text-align:left;white-space:normal}
table.cards td[data-l]:not([data-l="Cruce"]):not([data-l="#"]):not([data-l="Semáforo"])::before{content:attr(data-l) " · ";color:var(--muted);font-size:13px}
table.cards td[data-l="#"]{float:left;margin-right:8px;font-weight:700;color:var(--fg)}}
.note{background:var(--soft);border-radius:14px;padding:12px 14px;font-size:15px}
</style>
</head>
<body>
<main>
<div class="top"><b>TransMi <span style="color:var(--accent)">LIVE</span></b><a href="./">Ir al mapa</a></div>
<p class="muted" style="margin:0">Informe por cruce semafórico · datos del ${fecha(SINCE)} al ${fecha(updated)}</p>
<h1>¿Dónde esperan los buses en los semáforos de Bogotá?</h1>
<p>Cada bus zonal del SITP reporta su posición cada ~20 segundos. Contamos cuántas veces un bus pasó junto a un cruce con semáforo y cuántas de esas veces estaba detenido, por día, hora y sentido. No es un conteo de todo el tráfico: es lo que ven los buses. Hecho para compartir con la Secretaría Distrital de Movilidad.</p>
<div class="tiles">
<div class="tile"><b>${num(nCross)}</b><span>cruces con suficientes datos</span></div>
<div class="tile"><b>${num(rep.observations)}</b><span>pasadas de buses junto a un semáforo</span></div>
<div class="tile"><b>${pct(allShare)}</b><span>de esas pasadas, con el bus detenido</span></div>
<div class="tile"><b>${num(printed.length)}</b><span>cruces que parecen de tiempo fijo</span></div>
</div>

<h2>Mapa</h2>
<p>Cada punto es un cruce analizado. En color, los ${TOP} con más espera (los 10 primeros, numerados). Las líneas grises son las troncales de TransMilenio, como referencia.</p>
<div class="mapbox">${mapSvg(rep.crossings, top, nm)}
<div class="legend"><span>Buses detenidos:</span><span><span class="chip s0"></span>menos de 20 %</span><span><span class="chip s1"></span>20–35 %</span><span><span class="chip s2"></span>35–50 %</span><span><span class="chip s3"></span>50–65 %</span><span><span class="chip s4"></span>65 % o más</span><span><span class="chip" style="background:var(--dot)"></span>resto de los cruces</span></div></div>

<h2>Los ${TOP} cruces donde más esperan los buses</h2>
<p><b>Detenidos</b>: de cada 100 veces que un bus pasó junto al cruce, cuántas estaba quieto. <b>Velocidad media</b>: a la que llegaban al cruce en los ~20 s anteriores. El orden castiga a los cruces con pocos datos (ver «Método»), por eso un cruce con un porcentaje alto pero pocas pasadas puede quedar más abajo.</p>
${crossTable(top, nm)}

<h2>Por franja y día</h2>
<p>Los ${TOP_BUCKET} casos con más espera en cada franja (cruce y sentido del bus). Toque una franja para verla.</p>
${bucketTables(rep.crossings, nm)}

<h2>Cruces que parecen de tiempo fijo</h2>
<p>Si un semáforo cambia siempre al mismo ritmo (por ejemplo cada 120 segundos), los buses detenidos se amontonan día tras día en el mismo tramo de cada vuelta. Esa «huella» deja estimar la duración del rojo y cuándo empieza. Encontramos ${num(printed.length)} cruces con huella: ${num(cyc(120))} con ciclo de 120 s y ${num(cyc(90))} con ciclo de 90 s; el rojo estimado mediano es de ~${redMed} s. Las vueltas se cuentan desde cada hora en punto (90 y 120 s caben exactos en una hora).</p>
<p class="note">Son <b>estimaciones</b> a partir de los buses, no la programación real. Sirven para elegir dónde comparar con el plan de cada controlador. Primero, los cruces donde la huella se repite en varias franjas con el mismo ritmo.</p>
${printTable(printed.slice(0, TOP_PRINTS), nm)}
${printed.length > TOP_PRINTS ? `<p class="muted">Se muestran ${TOP_PRINTS} de ${num(printed.length)}; la lista completa está en el archivo de datos.</p>` : ""}
${measured.length ? `<h2>Contraste con mediciones en la calle</h2>
<p>En ${measured.length} semáforo${measured.length > 1 ? "s" : ""} se midió el ciclo a mano con un cronómetro. Así encajan los reportes de los buses con esa medición (al azar se esperaría ~50 %):</p>
<div class="tw"><table><thead><tr><th>Semáforo</th><th class="n">Reportes</th><th class="n">Encajan</th></tr></thead><tbody>${measured.map((l) => `<tr><td>${esc(l.titulo)}${l.tm ? " (TransMilenio)" : ""}</td><td class="n">${num(l.n)}</td><td class="n">${pct(l.agree)}</td></tr>`).join("")}</tbody></table></div>` : ""}

<h2>Método</h2>
<ul>
<li>Cada ~20 s se descargan las posiciones de los buses que publica TransMilenio. Se compara cada reporte con el anterior del mismo bus para saber su velocidad y hacia dónde va (norte, sur, oriente u occidente).</li>
<li>Se cuenta una <b>pasada</b> cuando el bus está a menos de 35 m del punto del cruce en la red semafórica de Movilidad. Es <b>detenido</b> si avanzó a menos de 1,2 m/s (~4 km/h) desde su reporte anterior.</li>
<li>Se dejan por fuera las pasadas a menos de 45 m de una parada (un bus quieto en una parada no espera el semáforo) y las rutas troncales (van por carril exclusivo).</li>
<li>Solo se usan datos con el sentido del bus, desde el ${fecha(SINCE)}. Un cruce entra si tiene al menos ${rep.minCrossing} pasadas; un día, franja y sentido, al menos ${rep.minGroup}.</li>
<li>Para ordenar se usa un porcentaje «prudente» (el límite bajo del intervalo de confianza del 95 %): con pocos datos, el porcentaje real podría ser mucho menor, y así no salen primero cruces con 3 pasadas.</li>
<li>Huella de tiempo fijo: en qué segundo de cada vuelta de 90 y 120 s estaba cada bus detenido, frente a cómo se reparten en toda la ciudad. Se exige al menos 40 detenciones y una diferencia muy por encima del azar.</li>
</ul>
<h2>Limitaciones</h2>
<ul>
<li>Los buses reportan cada ~20 s: una espera corta puede no verse, y un bus que frena y arranca entre dos reportes cuenta como «en movimiento».</li>
<li>Los datos llegan con cerca de 1 minuto de atraso, así que esto sirve para analizar, no para saber qué pasa en este momento.</li>
<li>Los buses no son todo el tráfico: no dicen nada de carros, motos, bicicletas ni peatones, y en cruces por donde pasan pocos buses hay menos certeza.</li>
<li>Un bus detenido junto a un cruce puede estar en un trancón, recogiendo pasajeros fuera de la parada o en una fila que empieza más adelante: «detenido» no siempre es «en rojo».</li>
<li>El punto de cada cruce es el del controlador en la red de Movilidad; si un controlador maneja varios cruces cercanos, se cuentan juntos. El sentido es el del recorrido del bus, no el del semáforo.</li>
<li>Junto a terminales, patios o puntos donde las rutas zonales esperan para salir, los buses pueden estar estacionados: revise los primeros puestos con eso en mente.</li>
<li>Los días se separan en entre semana, sábado y domingo; los festivos cuentan como día entre semana.</li>
<li>El rojo y su inicio son <b>estimados</b>; un cruce que cambia de plan según la hora o que se ajusta al tráfico deja una huella más débil o ninguna.</li>
</ul>
<h2>Datos y créditos</h2>
<p>Posiciones de los buses y rutas: TransMilenio S.A., datos abiertos. Ubicación y nombres de los cruces: Red semafórica de la Secretaría Distrital de Movilidad de Bogotá, datos abiertos (CC BY 4.0). TransMi LIVE es independiente: no está afiliado a TransMilenio S.A., a la Alcaldía de Bogotá ni a la Secretaría de Movilidad.</p>
<p>Sin datos personales: solo se guardan conteos por cruce, día, franja y sentido; no se guarda qué bus pasó ni su recorrido.</p>
<p>Descargar las cifras: <a href="semaforos-informe.csv">tabla por cruce (CSV)</a> · <a href="semaforos-informe.json">todo el detalle (JSON)</a>. Generado el ${fecha(json.generado)}.</p>
</main>
</body>
</html>
`;
  mkdirSync(OUT, { recursive: true });
  // se escribe aparte y se mueve al final: si algo falla a mitad, queda la versión anterior completa
  for (const [name, body] of [["semaforos-informe.json", JSON.stringify(json)], ["semaforos-informe.csv", "﻿" + csv + "\n"], ["semaforos-informe.html", cardify(html)]] as const) {
    writeFileSync(join(OUT, `.${name}.tmp`), body);
  }
  for (const name of ["semaforos-informe.json", "semaforos-informe.csv", "semaforos-informe.html"]) renameSync(join(OUT, `.${name}.tmp`), join(OUT, name));
  console.log(`Informe de semáforos: ${nCross} cruces, ${rep.observations} pasadas, ${rep.stops} detenidos (${pct(allShare)}), ${printed.length} con huella (${cyc(120)} de 120 s, ${cyc(90)} de 90 s), nombres ${nm.size ? "sí" : "no"}`);
  console.log("Primeros 5:", top.slice(0, 5).map((c) => `${title(c, nm).name} ${pct(c.share)} ${kmh(c.kmh)}`).join(" | "));
}
main().catch((e) => { console.error(e); process.exit(1); });
