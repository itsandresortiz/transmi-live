/* TransMi Go: guarda la app en el dispositivo para que abra rápido y funcione sin internet.
   Los datos en vivo NO pasan por aquí (la app guarda su propia última copia). */
const VERSION = "tm-shell-v1";
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
  if (req.mode === "navigate") {
    // la página: primero la red (para tener siempre la versión nueva); sin red, la última guardada
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try { const res = await fetch(req); if (res.ok) cache.put("./", res.clone()); return res; }
      catch { return (await cache.match("./")) || (await cache.match(req)) || Response.error(); }
    })());
    return;
  }
  // archivos de la app (llevan huella en el nombre) y fuentes: lo guardado primero, y se refresca en segundo plano
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req);
    const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    return hit || (await net) || Response.error();
  })());
});
