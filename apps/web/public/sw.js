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
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("tm-shell-") && k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
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
