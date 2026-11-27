/* TransMi LIVE: guarda la app en el dispositivo para que abra rápido y funcione sin internet.
   Los datos en vivo NO pasan por aquí (la app guarda su propia última copia). */
const VERSION = "tm-shell-v4";
/** Cuántos archivos de la app (con huella en el nombre) se guardan como máximo: cada publicación trae nombres nuevos y antes se
 *  acumulaban sin límite (~0,75 MB por publicación). La versión de hoy tiene menos de 10. */
const MAX_ASSETS = 24;
async function prune(cache) {
  const keys = (await cache.keys()).filter((r) => new URL(r.url).pathname.includes("/assets/"));
  for (const r of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(r);      // los más viejos primero
}

/* ---------- Mapa base sin conexión ----------
   El mapa base (calles, nombres, parques) viene de OpenFreeMap. Se guarda lo que se va viendo y, un rato después de abrir la web,
   Bogotá completa a zoom 9–12 (38 teselas, unos pocos MB): sin señal se siguen viendo las calles que ya se vieron y, de lejos, toda la
   ciudad. Solo se guarda el mapa base: nada de buses, rutas ni datos en vivo pasa por aquí (son de otros servidores y no se tocan). */
const MAP_HOST = "tiles.openfreemap.org";
/** Lo que se va viendo (teselas, letras, imágenes del mapa): se borra lo más viejo al pasar de `MAP_MAX` archivos. */
const MAP_CACHE = "tm-map-v1";
/** Bogotá a zoom bajo, el índice de teselas y las letras: pocos archivos que no se borran por espacio. */
const MAP_PIN = "tm-map-pin-v1";
/** ~700 teselas de calles son unos 30–50 MB en Bogotá: de sobra para los barrios de siempre sin llenar el teléfono. */
const MAP_MAX = 700;
/** Pasado esto, lo guardado se pide de nuevo (si hay red); sin red se sigue usando. */
const MAP_MAX_AGE = 30 * 24 * 3600_000;
const MAP_INDEX = "https://tiles.openfreemap.org/planet";
const BOGOTA = { w: -74.24, s: 4.46, e: -73.99, n: 4.84 };      // la misma zona que guarda la app (con Soacha, Chía, Funza y Mosquera)
const PRE_ZOOMS = [9, 10, 11, 12];                               // el mapa de la web no se aleja más de 9
/** Las letras que usa el mapa (los otros rangos se piden vacíos: ver `transformRequest` en MapController) y sus íconos (`sprite` de
 *  base-light.json; si cambia allá, cambiar aquí). Se piden al cargar el estilo, antes de que este archivo alcance a guardarlos la primera vez. */
const PRE_FIXED = [
  ...["Noto Sans Regular", "Noto Sans Bold", "Noto Sans Italic"].flatMap((f) => ["0-255", "256-511"].map((r) => `https://${MAP_HOST}/fonts/${encodeURIComponent(f)}/${r}.pbf`)),
  ...["", "@2x"].flatMap((d) => ["json", "png"].map((x) => `https://${MAP_HOST}/sprites/ofm_f384/ofm${d}.${x}`)),
];
const PRE_MARK = new URL("./__mapa-precargado", self.location).href;      // marca interna (no es un archivo real)

/** Qué es la petición, si es del mapa base: el índice (cambia cada semana con la versión del mapa), una tesela o un archivo fijo. */
function mapKind(url) {
  if (url.hostname !== MAP_HOST) return null;
  if (url.pathname === "/planet" || url.pathname === "/planet/") return "index";
  if (url.pathname.startsWith("/fonts/") || url.pathname.startsWith("/sprites/")) return "static";
  if (/\/\d+\/\d+\/\d+\.(pbf|png)$/.test(url.pathname)) return "tile";      // las de calles llevan la versión en la ruta: nunca cambian
  return null;
}
/** Lo guardado para esa dirección y en cuál de las dos cachés está. */
async function mapMatch(url) {
  for (const name of [MAP_PIN, MAP_CACHE]) {
    const hit = await (await caches.open(name)).match(url, { ignoreVary: true });
    if (hit) return { hit, name };
  }
  return { hit: undefined, name: MAP_CACHE };
}
const savedAt = (res) => Number(res.headers.get("x-tm-guardado") || 0);
let putsSincePrune = 0;
/** Guarda una respuesta con la hora en que se guardó (para saber su edad) y poda la caché de lo visto si se pasa del tope. */
async function mapSave(url, res, name = MAP_CACHE) {
  if (!res.ok || res.type === "opaque") return;
  const headers = new Headers(res.headers);
  headers.set("x-tm-guardado", String(Date.now())); headers.delete("vary");
  const body = await res.arrayBuffer();
  const cache = await caches.open(name);
  try { await cache.put(url, new Response(body, { status: res.status, statusText: res.statusText, headers })); }
  catch { await mapPrune(Math.floor(MAP_MAX / 2)); return; }               // sin espacio: se libera la mitad y se sigue sin guardar este
  if (name === MAP_CACHE && ++putsSincePrune >= 40) { putsSincePrune = 0; await mapPrune(MAP_MAX); }
}
/** Deja como máximo `max` archivos en lo visto; se van primero los guardados hace más tiempo. */
async function mapPrune(max) {
  const cache = await caches.open(MAP_CACHE), keys = await cache.keys();
  for (const r of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(r);
}
function withTimeout(p, ms) { return Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error("tiempo")), ms))]); }

function mapFetch(e, kind) {
  const req = e.request, url = req.url;
  if (kind === "index") {
    // primero la red (trae la versión vigente del mapa); sin red o si tarda, la última guardada
    return (async () => {
      try {
        const res = await withTimeout(fetch(req), 6000);
        if (res.ok) e.waitUntil(mapSave(url, res.clone(), MAP_PIN));
        return res;
      } catch { return (await mapMatch(url)).hit || Response.error(); }
    })();
  }
  // teselas, letras e imágenes: lo guardado primero (no cambian); si es muy viejo se intenta renovar y, sin red, se usa igual
  return (async () => {
    const { hit, name } = await mapMatch(url);
    if (hit && Date.now() - savedAt(hit) < MAP_MAX_AGE) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) e.waitUntil(mapSave(url, res.clone(), name));      // se renueva en la misma caché donde estaba
      return res;
    } catch { return hit || Response.error(); }
  })();
}

/** Números de tesela que cubren Bogotá a un zoom. */
function tilesOf(z) {
  const n = 2 ** z, x = (lon) => Math.floor(((lon + 180) / 360) * n);
  const y = (lat) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n); };
  const out = [];
  for (let i = x(BOGOTA.w); i <= x(BOGOTA.e); i++) for (let j = y(BOGOTA.n); j <= y(BOGOTA.s); j++) out.push([z, i, j]);
  return out;
}
let precaching = false;
/** Baja Bogotá a zoom bajo, las letras y el índice del mapa. Se repite solo cuando cambia la versión del mapa o pasaron 30 días. */
async function precacheMap() {
  if (precaching) return;
  precaching = true;
  try {
    const pin = await caches.open(MAP_PIN);
    const res = await withTimeout(fetch(MAP_INDEX), 10000);
    if (!res.ok) return;
    await mapSave(MAP_INDEX, res.clone(), MAP_PIN);
    const tmpl = (await res.json()).tiles?.[0];
    if (typeof tmpl !== "string" || !tmpl.includes("{z}")) return;
    const mark = await pin.match(PRE_MARK);
    const prev = mark ? await mark.json().catch(() => null) : null;
    if (prev && prev.tmpl === tmpl && Date.now() - prev.at < MAP_MAX_AGE) return;
    const urls = [...PRE_FIXED, ...PRE_ZOOMS.flatMap(tilesOf).map(([z, x, y]) => tmpl.replace("{z}", z).replace("{x}", x).replace("{y}", y))];
    let ok = 0;
    for (const u of urls) {                                   // de a uno: es en segundo plano y no debe quitarle red a lo que se está viendo
      const have = await pin.match(u, { ignoreVary: true });
      if (have && Date.now() - savedAt(have) < MAP_MAX_AGE) { ok++; continue; }
      try { const r = await withTimeout(fetch(u, { mode: "cors" }), 15000); if (r.ok) { await mapSave(u, r, MAP_PIN); ok++; } } catch { /* sin red: se reintenta otra vez */ }
    }
    // las teselas de una versión anterior del mapa ya no se piden nunca: se borran
    const base = tmpl.slice(0, tmpl.indexOf("{z}"));
    for (const r of await pin.keys()) if (mapKind(new URL(r.url)) === "tile" && !r.url.startsWith(base)) await pin.delete(r);
    if (ok === urls.length) await pin.put(PRE_MARK, new Response(JSON.stringify({ tmpl, at: Date.now() }), { headers: { "content-type": "application/json" } }));
  } catch { /* se intenta en la próxima visita */ }
  finally { precaching = false; }
}
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "tm-precargar-mapa") e.waitUntil(precacheMap());
});

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("tm-shell-") && k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;
  const kind = mapKind(url);
  if (kind) { e.respondWith(mapFetch(e, kind)); return; }
  if (url.origin !== self.location.origin) return;
  const root = new URL("./", self.location).pathname;
  // las páginas de ruta y estación para buscadores (/ruta/…, /estacion/…) son documentos aparte: no se guardan como si fueran la app
  if (req.mode === "navigate" && url.pathname !== root && url.pathname !== root + "index.html") return;
  if (req.mode === "navigate") {
    // la página: primero la red (para tener siempre la versión nueva); sin red, la última guardada
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try { const res = await fetch(req); if (res.ok) cache.put("./", res.clone()); return res; }
      catch { return (await cache.match("./")) || (await cache.match(req)) || Response.error(); }
    })());
    return;
  }
  // datos que cambian sin cambiar de nombre (semaforos.json…): primero la red; lo guardado solo sin conexión. Antes se mostraba la
  // copia guardada y se actualizaba por detrás, y la primera vez salía la versión vieja (p. ej. semáforos sin sus posiciones)
  if (url.pathname.endsWith(".json")) {
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try { const res = await fetch(req, { cache: "no-cache" }); if (res.ok) cache.put(req, res.clone()); return res; }
      catch { return (await cache.match(req)) || Response.error(); }
    })());
    return;
  }
  // archivos de la app (llevan huella en el nombre) y fuentes: lo guardado primero, y se refresca en segundo plano
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req);
    const net = fetch(req).then((res) => { if (res.ok) void cache.put(req, res.clone()).then(() => prune(cache)).catch(() => undefined); return res; }).catch(() => null);
    return hit || (await net) || Response.error();
  })());
});
