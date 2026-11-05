/** `fetch` que guarda la última respuesta buena de cada dirección y, si no hay internet, entrega esa copia.
 *  Así la app abre con lo último que vio (rutas, paradas y el último lote de buses) en vez de quedar en blanco. */
const CACHE = "tm-data-v1";
const keyOf = (input: RequestInfo | URL): string => {
  const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  u.search = "";           // las huellas ?v=… cambian en cada lote; la copia guardada es siempre la última
  return u.href;
};

/** `onlyOffline`: con internet un fallo se deja pasar (así la app puede probar otra fuente); la copia solo se usa sin conexión. */
export function makeCachedFetch(opts: { onlyOffline?: boolean } = {}, base: typeof fetch = (...a) => fetch(...a)): typeof fetch {
  return async (input, init) => {
    const store = typeof caches !== "undefined" ? await caches.open(CACHE).catch(() => null) : null;
    try {
      const res = await base(input, init);
      if (res.ok && store) void store.put(keyOf(input), res.clone()).catch(() => {});
      return res;
    } catch (e) {
      if (opts.onlyOffline && navigator.onLine) throw e;
      const hit = store ? await store.match(keyOf(input)) : undefined;
      if (hit) return hit;
      throw e;
    }
  };
}
