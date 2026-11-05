// Intermediario de solo lectura para los feeds GTFS-realtime de TransMilenio.
// Solo sirve tres archivos fijos, con CORS abierto, y los guarda unos segundos en memoria.
//
// Despliegue: Supabase -> Edge Functions -> crear funcion "tm" y pegar este archivo.
// IMPORTANTE: desactivar "Verify JWT" (los datos son publicos y la pagina no envia token).
//
//   GET /functions/v1/tm/meta         -> {"pos":"<huella>","tu":"...","al":"...","at":<epoch>}
//   GET /functions/v1/tm/positions    -> positions.pb   (igual con tripupdates y alerts)
//   GET /functions/v1/tm/live?pos=<huella>&tu=<huella>&al=<huella>&wait=20
//        -> espera (hasta `wait` s, máx. 25) a que cambie algo y responde UNA sola vez con todo lo nuevo.
//           Reduce las invocaciones por persona de ~34.000 a ~4.000 por día (cada invocación cuenta contra el plan).
//           Formato: 4 bytes (largo N, big-endian) + N bytes de JSON {"at":epoch,"parts":[{"k":"pos","sig":"..","len":123}]}
//           + los cuerpos de cada parte, en orden. Sin cambios: `parts` vacío.
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

const KEYS: Record<string, string> = { pos: "positions", tu: "tripupdates", al: "alerts" };
const MAX_WAIT_S = 25;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Responde con lo que cambió respecto a las huellas que trae el cliente; si no hay nada nuevo, espera hasta `wait` segundos. */
async function live(url: URL, acceptsGzip: boolean): Promise<Response> {
  const wait = Math.min(MAX_WAIT_S, Math.max(0, Number(url.searchParams.get("wait") ?? 0) || 0));
  const known: Record<string, string> = {};
  for (const k of Object.keys(KEYS)) known[k] = url.searchParams.get(k) ?? "";
  const end = Date.now() + wait * 1000;
  for (;;) {
    const names = Object.keys(KEYS);
    const res = await Promise.allSettled(names.map((k) => load(KEYS[k]!)));
    const changed: { k: string; e: Entry }[] = [];
    let ok = 0;
    res.forEach((r, i) => {
      if (r.status !== "fulfilled") return;
      ok++;
      if (r.value.sig !== known[names[i]!]) changed.push({ k: names[i]!, e: r.value });
    });
    if (!ok) return json({ error: "TransMilenio no respondio" }, 502);
    // lo opcional (retrasos y avisos) solo viaja junto con posiciones nuevas o cuando el cliente aún no lo tiene
    if (changed.length || Date.now() >= end) return frames(changed, acceptsGzip);
    await sleep(Math.min(1500, Math.max(0, end - Date.now())));
  }
}

function frames(parts: { k: string; e: Entry }[], acceptsGzip: boolean): Response {
  const head = new TextEncoder().encode(JSON.stringify({
    at: Math.floor(Date.now() / 1000),
    parts: parts.map((p) => ({ k: p.k, sig: p.e.sig, len: p.e.body.length })),
  }));
  const body = new Uint8Array(4 + head.length + parts.reduce((n, p) => n + p.e.body.length, 0));
  new DataView(body.buffer).setUint32(0, head.length);
  body.set(head, 4);
  let o = 4 + head.length;
  for (const p of parts) { body.set(p.e.body, o); o += p.e.body.length; }
  const headers: Record<string, string> = { ...CORS, "content-type": "application/x-transmi-live", "cache-control": "no-store" };
  if (acceptsGzip) {
    headers["content-encoding"] = "gzip";
    return new Response(new Blob([body]).stream().pipeThrough(new CompressionStream("gzip")), { headers });
  }
  return new Response(body, { headers });
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET") return json({ error: "method not allowed" }, 405);
  const last = new URL(req.url).pathname.split("/").filter(Boolean).pop() || "";
  const acceptsGzip = (req.headers.get("accept-encoding") || "").includes("gzip");

  if (last === "live") return await live(new URL(req.url), acceptsGzip);

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
  return json({ ok: true, endpoints: ["meta", "live", ...Object.keys(FILES)] });
}

Deno.serve(handler);
