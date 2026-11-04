// Intermediario de solo lectura para los feeds GTFS-realtime de TransMilenio.
// Solo sirve tres archivos fijos, con CORS abierto, y los guarda unos segundos en memoria.
//
// Despliegue: Supabase -> Edge Functions -> crear funcion "tm" y pegar este archivo.
// IMPORTANTE: desactivar "Verify JWT" (los datos son publicos y la pagina no envia token).
//
//   GET /functions/v1/tm/meta         -> {"pos":"<huella>","tu":"...","al":"...","at":<epoch>}
//   GET /functions/v1/tm/positions    -> positions.pb   (igual con tripupdates y alerts)
const BASE = "https://gtfs.transmilenio.gov.co/";
const FILES: Record<string, string> = {
  positions: "positions.pb",
  tripupdates: "tripupdates.pb",
  alerts: "alerts.pb",
};
const TTL_MS = 4000;

type Entry = { t: number; body: Uint8Array; sig: string };
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry>>();

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "*",
  "access-control-expose-headers": "etag, x-sig, x-fetched-at",
};

async function sig(b: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-1", b));
  return [...h.slice(0, 6)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function load(name: string): Promise<Entry> {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.t < TTL_MS) return Promise.resolve(hit);
  const pending = inflight.get(name);
  if (pending) return pending;
  const p = (async () => {
    const r = await fetch(BASE + FILES[name], {
      headers: { "user-agent": "Mozilla/5.0 (transmi-live)" },
    });
    if (!r.ok) throw new Error(`${FILES[name]}: HTTP ${r.status}`);
    const body = new Uint8Array(await r.arrayBuffer());
    const e: Entry = { t: Date.now(), body, sig: await sig(body) };
    cache.set(name, e);
    return e;
  })().finally(() => inflight.delete(name));
  inflight.set(name, p);
  return p;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET") return json({ error: "method not allowed" }, 405);
  const last = new URL(req.url).pathname.split("/").filter(Boolean).pop() || "";

  if (last === "meta") {
    const names = Object.keys(FILES);
    const res = await Promise.allSettled(names.map((n) => load(n)));
    const out: Record<string, unknown> = { at: Math.floor(Date.now() / 1000) };
    let ok = 0;
    res.forEach((r, i) => {
      const k = names[i] === "positions" ? "pos" : names[i] === "tripupdates" ? "tu" : "al";
      if (r.status === "fulfilled") { out[k] = r.value.sig; ok++; }
    });
    if (!ok) return json({ error: "TransMilenio no respondio" }, 502);
    return json(out);
  }

  if (last in FILES) {
    try {
      const e = await load(last);
      const headers: Record<string, string> = {
        ...CORS,
        "content-type": "application/octet-stream",
        "cache-control": "public, max-age=20",
        etag: `"${e.sig}"`,
        "x-sig": e.sig,
        "x-fetched-at": String(Math.floor(e.t / 1000)),
      };
      if ((req.headers.get("accept-encoding") || "").includes("gzip")) {
        headers["content-encoding"] = "gzip";
        const stream = new Blob([e.body]).stream().pipeThrough(new CompressionStream("gzip"));
        return new Response(stream, { headers });
      }
      return new Response(e.body, { headers });
    } catch (err) {
      return json({ error: String((err as Error).message || err) }, 502);
    }
  }
  return json({ ok: true, endpoints: ["meta", ...Object.keys(FILES)] });
});
