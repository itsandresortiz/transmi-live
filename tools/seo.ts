/**
 * Páginas estáticas para buscadores: una por ruta y una por estación o portal, más sus índices y el sitemap.
 *
 * Los buscadores no ejecutan bien una app de mapa con datos en vivo, así que aquí se genera, a partir del GTFS, el contenido que sí
 * pueden leer (nombre, paradas, primer y último servicio, rutas de cada vagón) con título, descripción y vista previa propios.
 * Cada página lleva un botón que abre la app en esa ruta o estación (`/#/ruta/ID`, `/#/estacion/ID1,ID2`).
 *
 * Uso: npx tsx tools/seo.ts <carpeta_dist> [gtfs-lite.zip] [service-ends.json.gz]
 *   (si no se dan los archivos se descargan de las ramas live-data y schedule-data)
 * Variables: SITE_URL (https://transmilive.com), REPO (itsandresortiz/transmi-live)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { SYSTEM_LABEL, TRUNK_LINES, routeTitle, trunkLetterOf, type Route, type Stop, type SystemType } from "@transmi/domain";
import { TransitState, sortStationStops } from "@transmi/application";
import { buildNetwork, parseGtfsLite } from "@transmi/infrastructure";

const OUT = process.argv[2] ?? "apps/web/dist";
const SITE = (process.env.SITE_URL ?? "https://transmilive.com").replace(/\/$/, "");
const REPO = process.env.REPO ?? "itsandresortiz/transmi-live";
const GTM = "GTM-NM7C6973";

/* ---------- utilidades ---------- */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const slugOf = (s: string) => fold(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
const clock = (secs: number) => {
  const h = Math.floor(secs / 3600) % 24, m = Math.floor((secs % 3600) / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "a. m." : "p. m."}`;
};
const cut = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1).replace(/[\s,;:·–-]+\S*$/, "") + "…");
/** Une frases mientras quepan en `max` caracteres (la primera siempre entra, recortada si hace falta). */
const fit = (max: number, ...parts: string[]) => parts.filter(Boolean).reduce((acc, p, i) => (i === 0 ? cut(p, max) : (acc + " " + p).length <= max ? acc + " " + p : acc), "");
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s(/-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase()).replace(/\b(De|Del|La|Las|Los|El|Y|Con|En)\b/g, (w) => w.toLowerCase()).replace(/^./, (c) => c.toUpperCase());

async function bytes(local: string | undefined, url: string): Promise<Uint8Array | null> {
  if (local && existsSync(local)) return readFileSync(local);
  try { const r = await fetch(url); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; } catch { return null; }
}

interface EndsDay { first: [string, number]; last: [string, number] }
type Ends = { routes: Record<string, Partial<Record<"wk" | "sa" | "su", EndsDay>>> };

const SYSTEM_NOUN: Record<SystemType, string> = { troncal: "troncal de TransMilenio", dual: "dual de TransMilenio", alimentador: "alimentadora de TransMilenio", zonal: "zonal del SITP", otro: "de TransMilenio" };
const SYSTEM_TEXT: Record<SystemType, string> = {
  troncal: "Es una ruta troncal de TransMilenio: circula por carriles exclusivos y se detiene en las estaciones de la troncal.",
  dual: "Es una ruta dual de TransMilenio: recorre carriles exclusivos de la troncal y continúa por calles normales.",
  alimentador: "Es una ruta alimentadora de TransMilenio: conecta barrios con el portal o estación de la troncal, sin costo adicional con la tarjeta TuLlave.",
  zonal: "Es una ruta zonal del SITP: recorre calles y avenidas de la ciudad con paradas en paraderos.",
  otro: "Es una ruta del sistema de transporte público de Bogotá.",
};

/* ---------- estilos y plantilla ---------- */
const CSS = `*{box-sizing:border-box}:root{--bg:#f2f2f7;--card:#fff;--fg:#111;--muted:#60646c;--line:#e3e4e8;--accent:#e11d2e}@media(prefers-color-scheme:dark){:root{--bg:#000;--card:#15161a;--fg:#f2f2f5;--muted:#a3a7b0;--line:#26282e;--accent:#ff4d5e}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}a{color:inherit}
header.top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 18px;background:var(--card);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:2}
.brand{font-weight:800;text-decoration:none;letter-spacing:-.02em}.brand i{font-style:normal;color:var(--accent)}
.btn{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;font-weight:700;padding:10px 16px;border-radius:12px}
main{max-width:860px;margin:0 auto;padding:20px 18px 60px}nav.crumbs{font-size:13.5px;color:var(--muted);margin-bottom:10px}nav.crumbs a{color:var(--muted)}
h1{font-size:28px;line-height:1.2;letter-spacing:-.02em;margin:.2em 0 .4em}h2{font-size:20px;margin:1.6em 0 .5em}.lead{color:var(--muted);font-size:17px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px 16px;margin:12px 0}
.badge{display:inline-block;min-width:44px;text-align:center;padding:2px 10px;border-radius:10px;font-weight:800;color:#fff;background:var(--c,#1f6fd1)}
table{width:100%;border-collapse:collapse}td{white-space:nowrap}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);font-variant-numeric:tabular-nums}th{color:var(--muted);font-weight:600;font-size:14px}
ol.stops{margin:0;padding-left:1.4em;columns:2;column-gap:28px}ol.stops li{break-inside:avoid;padding:1px 0}@media(max-width:620px){ol.stops{columns:1}}
ul.chips{list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:8px}ul.chips a{display:inline-block;padding:6px 12px;border-radius:12px;background:var(--card);border:1px solid var(--line);text-decoration:none;font-weight:650}
.cta{margin:18px 0}footer{max-width:860px;margin:0 auto;padding:0 18px 40px;color:var(--muted);font-size:13.5px}`;

interface Page { path: string; title: string; description: string; body: string; ld: object[]; priority: number }

function html(p: Page): string {
  const url = `${SITE}${p.path}`;
  return `<!doctype html>
<html lang="es-CO">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(p.title)}</title>
<meta name="description" content="${esc(p.description)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
<meta name="theme-color" content="#e11d2e">
<meta property="og:type" content="website"><meta property="og:site_name" content="TransMi LIVE"><meta property="og:locale" content="es_CO">
<meta property="og:title" content="${esc(p.title)}"><meta property="og:description" content="${esc(p.description)}"><meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(p.title)}"><meta name="twitter:description" content="${esc(p.description)}"><meta name="twitter:image" content="${SITE}/og.png">
<link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="manifest" href="/manifest.webmanifest">
${p.ld.map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`).join("\n")}
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM}');</script>
<style>${CSS}</style>
</head>
<body>
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${GTM}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<header class="top"><a class="brand" href="/">TransMi <i>LIVE</i></a><a class="btn" href="/">Abrir el mapa</a></header>
<main>
${p.body}
</main>
<footer>Datos del GTFS oficial de TransMilenio (horarios programados) y buses en tiempo real. TransMi LIVE es una herramienta independiente y no es un sitio oficial de TransMilenio. · <a href="/rutas/">Todas las rutas</a> · <a href="/estaciones/">Estaciones y portales</a></footer>
</body>
</html>
`;
}

const crumbsLd = (items: [string, string][]) => ({
  "@context": "https://schema.org", "@type": "BreadcrumbList",
  itemListElement: items.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: `${SITE}${path}` })),
});
const crumbsHtml = (items: [string, string][]) => `<nav class="crumbs" aria-label="Ruta de navegación">${items.map(([n, p], i) => (i < items.length - 1 ? `<a href="${p}">${esc(n)}</a>` : `<span>${esc(n)}</span>`)).join(" › ")}</nav>`;

/* ---------- datos ---------- */
async function main() {
  const base = `https://raw.githubusercontent.com/${REPO}`;
  const gtfs = await bytes(process.argv[3], `${base}/live-data/gtfs-lite.zip`);
  if (!gtfs) { console.warn("SEO: no se pudo obtener el GTFS; se deja solo la portada."); return; }
  const endsRaw = await bytes(process.argv[4], `${base}/schedule-data/service-ends.json.gz`);
  let ends: Ends = { routes: {} };
  try { if (endsRaw) ends = JSON.parse(new TextDecoder().decode(gunzipSync(endsRaw))) as Ends; } catch { /* sin horarios: las páginas salen sin esa tabla */ }

  const state = new TransitState();
  state.setNetwork(buildNetwork(await parseGtfsLite(gtfs)));
  const net = state.network;

  // rutas: una página por nombre corto (hay nombres repetidos con variantes)
  const byName = new Map<string, Route[]>();
  for (const r of net.routes.values()) {
    if (r.provisional || !r.shortName) continue;
    (byName.get(r.shortName) ?? byName.set(r.shortName, []).get(r.shortName)!).push(r);
  }
  const routeSlugs = new Map<string, string>(), usedRoute = new Set<string>();
  for (const name of [...byName.keys()].sort()) {
    let s = slugOf(name), i = 2; while (usedRoute.has(s)) s = `${slugOf(name)}-${i++}`;
    usedRoute.add(s); routeSlugs.set(name, s);
  }
  const routePath = (name: string) => `/ruta/${routeSlugs.get(name)}/`;

  // paradas -> rutas (una sola pasada)
  const routesOfStop = new Map<string, Set<string>>();
  for (const [rid, shapes] of net.shapes) { const r = net.routes.get(rid); if (!r || r.provisional) continue; for (const sh of shapes) for (const id of sh.stopIds) (routesOfStop.get(id) ?? routesOfStop.set(id, new Set()).get(id)!).add(r.shortName); }

  // estaciones y portales: estaciones con vagones + portales (nombre «Portal …»), unidos por nombre
  const groups = new Map<string, Stop[]>();
  for (const s of net.stops.values()) {
    const l = state.labelOf(s);
    if (!routesOfStop.has(s.id)) continue;
    if (!(l.wagon || (l.platform && /^(portal|terminal|estaci)/i.test(l.title)))) continue;
    const k = fold(l.title); (groups.get(k) ?? groups.set(k, []).get(k)!).push(s);
  }
  interface Station { title: string; slug: string; kind: "Estación" | "Portal"; stops: Stop[]; routes: string[]; letter: string | null }
  const stations: Station[] = [], usedSt = new Set<string>();
  for (const stops of groups.values()) {
    const sorted = sortStationStops(state, stops), title = titleCase(state.labelOf(sorted[0]!).title);
    const isPortal = /^portal/i.test(title) || sorted.every((s) => !state.labelOf(s).wagon);
    let slug = slugOf(title), i = 2; while (usedSt.has(slug)) slug = `${slugOf(title)}-${i++}`;
    usedSt.add(slug);
    const names = new Set<string>(); for (const s of sorted) for (const n of routesOfStop.get(s.id) ?? []) names.add(n);
    const letters = new Map<string, number>(); for (const n of names) { const l = trunkLetterOf(n); if (l) letters.set(l, (letters.get(l) ?? 0) + 1); }
    const letter = [...letters.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    stations.push({ title, slug, kind: isPortal ? "Portal" : "Estación", stops: sorted, routes: [...names].sort(cmp), letter });
  }
  stations.sort((a, b) => a.title.localeCompare(b.title, "es"));
  const stationByTitle = new Map(stations.map((s) => [fold(s.title), s]));
  const stationPath = (s: Station) => `/estacion/${s.slug}/`;

  const pages: Page[] = [];

  /* ---------- páginas de ruta ---------- */
  const DAYS: ["wk" | "sa" | "su", string][] = [["wk", "Lunes a viernes"], ["sa", "Sábados"], ["su", "Domingos y festivos"]];
  for (const [name, variants] of byName) {
    variants.sort((a, b) => a.id.localeCompare(b.id));
    const main = variants[0]!, sys = main.system, path = routePath(name);
    const title0 = titleCase(routeTitle(main).replace(/\s+⇄\s+/g, " – "));
    const trunkLetter = sys === "troncal" || sys === "dual" ? trunkLetterOf(name) : null;
    const color = trunkLetter ? TRUNK_LINES[trunkLetter]!.light : sys === "zonal" ? "#1f6fd1" : sys === "alimentador" ? "#12945f" : sys === "dual" ? "#8a45d6" : "#e11d2e";
    const first = DAYS.map(([k]) => variants.map((v) => ends.routes[v.id]?.[k]).filter((d): d is EndsDay => !!d))
      .map((ds) => (ds.length ? { a: Math.min(...ds.map((d) => d.first[1])), z: Math.max(...ds.map((d) => d.last[1])) } : null));
    const wk = first[0];
    const shapes = variants.flatMap((v) => net.shapes.get(v.id) ?? []);
    const dirs = shapes.filter((s, i) => shapes.findIndex((o) => o.routeId === s.routeId && o.direction === s.direction) === i);
    const nStops = new Set(dirs.flatMap((d) => d.stopIds)).size;

    const desc = fit(158, `Ruta ${name} ${SYSTEM_NOUN[sys]}${title0 ? `: ${title0}` : ""}.`, wk ? `Primer bus ${clock(wk.a)}, último ${clock(wk.z)} (lun-vie).` : "", nStops ? `${nStops} paradas.` : "", "Mira dónde va el bus en vivo.");
    const head = `Ruta ${name} ${sys === "zonal" ? "SITP" : "TransMilenio"}`, tail = " | Horario";
    const title = title0 ? `${head}: ${cut(title0, Math.max(14, 64 - head.length - tail.length - 2))}${tail}` : `${head}${tail}`;

    const sched = first.some(Boolean)
      ? `<h2>Horario de la ruta ${esc(name)}</h2><div class="card"><table><thead><tr><th>Día</th><th>Primer bus</th><th>Último bus</th></tr></thead><tbody>${DAYS.map(([, label], i) => first[i] ? `<tr><td>${label}</td><td>${clock(first[i]!.a)}</td><td>${clock(first[i]!.z)}</td></tr>` : "").join("")}</tbody></table><p class="lead" style="font-size:14px;margin:.6em 0 0">Horas de salida programadas según el GTFS oficial. Entre ambas horas la ruta circula con la frecuencia de cada franja; el horario puede cambiar por avisos del sistema.</p></div>`
      : "";
    const dirHtml = dirs.map((d) => {
      const list = d.stopIds.map((id) => net.stops.get(id)).filter((s): s is Stop => !!s);
      const seen = new Set<string>(), items: string[] = [];
      for (const s of list) {
        const l = state.labelOf(s), key = fold(l.title); if (seen.has(key) && (l.wagon || l.platform)) continue; seen.add(key);
        const st = (l.wagon || l.platform) ? stationByTitle.get(key) : undefined;
        items.push(`<li>${st ? `<a href="${stationPath(st)}">${esc(st.title)}</a>` : esc(titleCase(s.name))}</li>`);
      }
      return `<div class="card"><b>${d.headsign ? `Hacia ${esc(titleCase(d.headsign))}` : `Sentido ${Number(d.direction) + 1}`}</b> · ${items.length} paradas<ol class="stops" style="margin-top:8px">${items.join("")}</ol></div>`;
    }).join("");
    const related = [...byName.keys()].filter((n) => n !== name && ((trunkLetter && trunkLetterOf(n) === trunkLetter) || (!trunkLetter && n.replace(/\D+/g, "") === name.replace(/\D+/g, "") && n.length <= 5))).sort(cmp).slice(0, 14);
    const through = new Set<string>(); for (const d of dirs) for (const id of d.stopIds) { const l = state.labelOf(net.stops.get(id)!); if (l?.wagon || l?.platform) { const st = stationByTitle.get(fold(l.title)); if (st) through.add(st.slug); } }
    const stationsLine = [...through].slice(0, 30).map((s) => stations.find((x) => x.slug === s)!);

    const crumbs: [string, string][] = [["Inicio", "/"], ["Rutas", "/rutas/"], [`Ruta ${name}`, path]];
    const faq: { q: string; a: string }[] = [];
    if (wk) faq.push({ q: `¿A qué hora empieza y termina la ruta ${name}?`, a: `De lunes a viernes el primer bus de la ruta ${name} sale a las ${clock(wk.a)} y el último a las ${clock(wk.z)}, según el horario programado.` });
    if (title0) faq.push({ q: `¿Por dónde pasa la ruta ${name}?`, a: `La ruta ${name} (${SYSTEM_NOUN[sys]}) conecta ${title0}${nStops ? ` y tiene ${nStops} paradas` : ""}.` });
    const links = variants.map((v) => `/#/ruta/${encodeURIComponent(v.id)}`);
    pages.push({
      path, title, description: desc, priority: sys === "troncal" ? 0.8 : 0.6,
      ld: [crumbsLd(crumbs), ...(faq.length ? [{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) }] : [])],
      body: `${crumbsHtml(crumbs)}<h1><span class="badge" style="--c:${color}">${esc(name)}</span> ${esc(title0 || SYSTEM_LABEL[sys])}</h1>
<p class="lead">${esc(SYSTEM_TEXT[sys])}${trunkLetter ? ` Pertenece a la línea ${trunkLetter} (${esc(TRUNK_LINES[trunkLetter]!.name)}).` : ""}</p>
<p class="cta"><a class="btn" href="${links[0]}">Ver la ruta ${esc(name)} en vivo</a></p>${variants.length > 1 ? `<p>Variantes: ${variants.map((v, i) => `<a href="${links[i]}">${esc(titleCase(routeTitle(v).replace(/\s+⇄\s+/g, " – ")) || v.id)}</a>`).join(" · ")}</p>` : ""}
${sched}<h2>Paradas y sentidos</h2>${dirHtml || "<p>Esta ruta todavía no tiene el recorrido publicado.</p>"}
${stationsLine.length ? `<h2>Estaciones y portales de la ruta</h2><ul class="chips">${stationsLine.map((s) => `<li><a href="${stationPath(s)}">${esc(s.title)}</a></li>`).join("")}</ul>` : ""}
${related.length ? `<h2>${trunkLetter ? `Otras rutas de la línea ${trunkLetter}` : "Rutas parecidas"}</h2><ul class="chips">${related.map((n) => `<li><a href="${routePath(n)}">${esc(n)}</a></li>`).join("")}</ul>` : ""}
${faq.length ? `<h2>Preguntas frecuentes</h2>${faq.map((f) => `<div class="card"><b>${esc(f.q)}</b><br>${esc(f.a)}</div>`).join("")}` : ""}`,
    });
  }

  /* ---------- páginas de estación o portal ---------- */
  for (const st of stations) {
    const path = stationPath(st), kindLow = st.kind.toLowerCase();
    const crumbs: [string, string][] = [["Inicio", "/"], ["Estaciones", "/estaciones/"], [st.title, path]];
    const line = st.letter ? TRUNK_LINES[st.letter] : undefined;
    // un vagón suele tener una parada por sentido: se juntan las rutas de ambas
    const byLabel = new Map<string, Set<string>>();
    for (const s of st.stops) {
      const l = state.labelOf(s), label = l.wagon ? `Vagón ${l.wagon}` : l.platform ? `Plataforma ${l.platform.replace(/^T/, "")}` : "Parada";
      const set = byLabel.get(label) ?? byLabel.set(label, new Set()).get(label)!;
      for (const n of routesOfStop.get(s.id) ?? []) set.add(n);
    }
    const rows = [...byLabel].map(([label, names]) => ({ label, names: [...names].sort(cmp) }));
    const pos = st.stops[0]!.position;
    const wagons = new Set(st.stops.map((s) => state.labelOf(s).wagon).filter(Boolean)).size;
    const nm = new RegExp(`^${st.kind}\\b`, "i").test(st.title) ? st.title : `${st.kind} ${st.title}`;
    const desc = fit(158, `${nm} de TransMilenio${line ? ` (línea ${st.letter}, ${line.name})` : ""}: ${wagons ? `${wagons} vagones, ` : ""}${st.routes.length} rutas${st.routes.length ? ` (${st.routes.slice(0, 6).join(", ")}…)` : ""}.`, "Mira qué buses vienen en vivo.");
    const title = cut(`${nm} TransMilenio: vagones y rutas`, 62);
    const link = `/#/estacion/${st.stops.map((s) => encodeURIComponent(s.id)).join(",")}`;
    const sameLine = st.letter ? stations.filter((o) => o.letter === st.letter && o !== st).slice(0, 12) : [];
    const faq = [{ q: `¿Qué rutas paran en ${kindLow === "portal" ? "el portal" : "la estación"} ${st.title}?`, a: `Paran las rutas ${st.routes.slice(0, 30).join(", ")}${st.routes.length > 30 ? " y otras" : ""}.` }];
    pages.push({
      path, title, description: desc, priority: 0.7,
      ld: [crumbsLd(crumbs), { "@context": "https://schema.org", "@type": "BusStation", name: nm, url: `${SITE}${path}`, geo: { "@type": "GeoCoordinates", latitude: pos.lat, longitude: pos.lon }, address: { "@type": "PostalAddress", addressLocality: "Bogotá", addressCountry: "CO" } },
        { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) }],
      body: `${crumbsHtml(crumbs)}<h1>${esc(nm)}</h1>
<p class="lead">${esc(st.title)} es ${st.kind === "Portal" ? "un portal" : "una estación"} de TransMilenio en Bogotá${line ? `, línea ${st.letter} (${esc(line.name)})` : ""}. ${wagons ? `Tiene ${wagons} vagones; ` : ""}aquí ves qué rutas se detienen en cada uno.</p>
<p class="cta"><a class="btn" href="${link}">Ver buses en vivo en ${esc(nm)}</a></p>
<h2>Rutas por ${wagons ? "vagón" : "plataforma"}</h2>${rows.map((r) => `<div class="card"><b>${r.label}</b>${r.names.length ? `<ul class="chips" style="margin-top:8px">${r.names.map((n) => `<li><a href="${routePath(n)}">${esc(n)}</a></li>`).join("")}</ul>` : "<br>Sin rutas registradas"}</div>`).join("")}
<h2>Ubicación</h2><p>Coordenadas: ${pos.lat.toFixed(5)}, ${pos.lon.toFixed(5)}. <a href="https://www.google.com/maps/search/?api=1&query=${pos.lat},${pos.lon}" rel="noopener">Abrir en Google Maps</a>.</p>
${sameLine.length ? `<h2>Otras estaciones de la línea ${st.letter}</h2><ul class="chips">${sameLine.map((o) => `<li><a href="${stationPath(o)}">${esc(o.title)}</a></li>`).join("")}</ul>` : ""}
<h2>Preguntas frecuentes</h2>${faq.map((f) => `<div class="card"><b>${esc(f.q)}</b><br>${esc(f.a)}</div>`).join("")}`,
    });
  }

  /* ---------- índices ---------- */
  const order: SystemType[] = ["troncal", "dual", "alimentador", "zonal", "otro"];
  const listRoutes = order.map((sys) => {
    const names = [...byName.entries()].filter(([, v]) => v[0]!.system === sys).map(([n]) => n).sort(cmp);
    return names.length ? `<h2>Rutas ${SYSTEM_LABEL[sys].toLowerCase()}es</h2><ul class="chips">${names.map((n) => `<li><a href="${routePath(n)}">${esc(n)}</a></li>`).join("")}</ul>` : "";
  }).join("");
  const crR: [string, string][] = [["Inicio", "/"], ["Rutas", "/rutas/"]];
  pages.push({ path: "/rutas/", title: "Todas las rutas de TransMilenio y SITP en Bogotá | TransMi LIVE", description: `Lista de ${byName.size} rutas de TransMilenio y SITP en Bogotá: troncales, duales, alimentadoras y zonales, con horario, paradas y mapa en vivo.`, priority: 0.9, ld: [crumbsLd(crR)], body: `${crumbsHtml(crR)}<h1>Rutas de TransMilenio y SITP en Bogotá</h1><p class="lead">Elige una ruta para ver su horario, sus paradas y dónde va el bus en este momento.</p>${listRoutes}` });
  const crS: [string, string][] = [["Inicio", "/"], ["Estaciones", "/estaciones/"]];
  const chips = (list: Station[]) => `<ul class="chips">${list.map((s) => `<li><a href="${stationPath(s)}">${esc(s.title)}</a></li>`).join("")}</ul>`;
  pages.push({ path: "/estaciones/", title: "Estaciones y portales de TransMilenio en Bogotá | TransMi LIVE", description: `${stations.length} estaciones y portales de TransMilenio en Bogotá con sus vagones, las rutas que paran en cada uno y los buses en vivo.`, priority: 0.9, ld: [crumbsLd(crS)], body: `${crumbsHtml(crS)}<h1>Estaciones y portales de TransMilenio</h1><p class="lead">Consulta qué rutas paran en cada vagón y qué buses vienen.</p><h2>Portales</h2>${chips(stations.filter((s) => s.kind === "Portal"))}<h2>Estaciones</h2>${chips(stations.filter((s) => s.kind === "Estación"))}` });

  /* ---------- escritura ---------- */
  for (const p of pages) {
    const file = join(OUT, p.path, "index.html");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, html(p));
  }
  const today = new Date().toISOString().slice(0, 10);
  const urls = [{ path: "/", priority: 1.0 }, ...pages].map((p) => `<url><loc>${SITE}${p.path}</loc><lastmod>${today}</lastmod><changefreq>${p.path === "/" ? "daily" : "weekly"}</changefreq><priority>${p.priority.toFixed(1)}</priority></url>`);
  writeFileSync(join(OUT, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`);
  console.log(`SEO: ${pages.length} páginas (${byName.size} rutas, ${stations.length} estaciones y portales)`);
}

function cmp(a: string, b: string): number { return a.localeCompare(b, "es", { numeric: true }); }

main().catch((e) => { console.warn("SEO: no se generaron las páginas:", e instanceof Error ? e.message : e); });
