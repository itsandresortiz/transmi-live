// Función de Supabase «viajes»: (1) avisos del viaje que se corrigen con la app cerrada y (2) posiciones compartidas (anónimas).
// APAGADA por defecto: no hace nada hasta que el dueño ponga los secretos AVISOS_ACTIVOS=1 y/o COMPARTIR_ACTIVO=1 (ver supabase/LEEME-avisos.md).
// Despliegue (lo hace el dueño): `supabase functions deploy viajes --no-verify-jwt` (la app no tiene cuentas ni envía token).
//
//   POST /viajes/viaje       la app registra o actualiza su viaje (bus, parada de bajada, tokens de aviso). Responde {avisa}: si es
//                            true, el servidor se encarga de los avisos y la app no los programa en el teléfono (no sonarían dos veces).
//   POST /viajes/fin         la app terminó el viaje: se borra (con sus tokens).
//   POST /viajes/compartir   una posición compartida (ruta, recorrido, metros, hora, velocidad y número de bus si es de los datos).
//   POST /viajes/tick        lo llama pg_cron cada 20 s con la cabecera x-tick-key: recalcula los viajes, envía avisos y publica
//                            compartidos/vivo.json (lo que leen las apps, sin gastar invocaciones).
//
// El cálculo de llegadas es el MISMO de la app (packages/application), empaquetado en ../_compartido/nucleo.js por tools/edge-core.ts.
import { createClient } from "jsr:@supabase/supabase-js@2";
// @ts-ignore: archivo generado en JavaScript (sin tipos)
import * as core from "../_compartido/nucleo.js";
import { type ApnsKey, type FcmAccount, apnsActivity, apnsAlert, fcmMessage, sendApns, sendFcm } from "../_compartido/push.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const AVISOS = () => env("AVISOS_ACTIVOS") === "1";
const COMPARTIR = () => env("COMPARTIR_ACTIVO") === "1";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const LIVE = "https://gtfs.transmilenio.gov.co/positions.pb";
const RAW = "https://raw.githubusercontent.com/itsandresortiz/transmi-live/";
const TICK_S = 20;
/** Mientras la app abierta dio señales hace menos de esto, ella misma actualiza la actividad en vivo (el servidor no la pisa). */
const APP_ALIVE_MS = 40_000;
const MAX_ACTIVE = 5000, MAX_BODY = 4096;

const CORS: Record<string, string> = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" } });

function apnsKey(): ApnsKey | null {
  const k = { keyP8: env("APNS_KEY_P8"), keyId: env("APNS_KEY_ID"), teamId: env("APNS_TEAM_ID"), bundleId: env("APNS_BUNDLE_ID") || "com.transmilive.app" };
  return k.keyP8 && k.keyId && k.teamId ? k : null;
}
function fcmAccount(): FcmAccount | null {
  try { const a = JSON.parse(env("FCM_SERVICE_ACCOUNT")) as FcmAccount; return a.client_email && a.private_key && a.project_id ? a : null; } catch { return null; }
}
const canPush = (platform: string) => (platform === "ios" ? !!apnsKey() : !!fcmAccount());

async function sha256(s: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

async function body(req: Request): Promise<Record<string, unknown> | null> {
  const text = await req.text();
  if (text.length > MAX_BODY) return null;
  try { const o = JSON.parse(text); return o && typeof o === "object" ? o : null; } catch { return null; }
}

/* ---------------- la app registra, actualiza o termina su viaje ---------------- */

async function registerRide(b: Record<string, unknown>): Promise<Response> {
  const id = str(b.id, 64), clave = str(b.clave, 128), platform = b.plataforma === "ios" || b.plataforma === "android" ? b.plataforma : null;
  const busId = str(b.busId, 64), alight = str(b.paradaBajada, 64);
  if (!id || id.length < 16 || !clave || !platform || !busId || !alight) return json({ ok: false, error: "datos incompletos" }, 400);
  // un viaje que solo se sigue con el GPS del teléfono (el bus no está en los datos) no se puede seguir desde aquí
  if (busId.startsWith("gps:")) { await db.from("viajes_activos").delete().eq("id", id).eq("clave_hash", await sha256(clave)); return json({ ok: true, avisa: false }); }
  const hash = await sha256(clave);
  const { data: prev } = await db.from("viajes_activos").select("clave_hash,bus_id,parada_bajada,enviados,creado").eq("id", id).maybeSingle();
  if (prev && prev.clave_hash !== hash) return json({ ok: false }, 403);
  if (!prev) {
    const { count } = await db.from("viajes_activos").select("id", { count: "exact", head: true });
    if ((count ?? 0) >= MAX_ACTIVE) return json({ ok: true, avisa: false });
  }
  const tokenAviso = str(b.tokenAviso, 512), tokenActividad = platform === "ios" ? str(b.tokenActividad, 512) : null;
  // los avisos que ya sonaron en el teléfono (programados antes de que el servidor respondiera) no se repiten
  const sent: Record<string, number> = { ...(prev && prev.parada_bajada === alight ? (prev.enviados as Record<string, number>) : {}) };
  for (const s of Array.isArray(b.sonados) ? b.sonados : []) if (s === "ride-3" || s === "ride-1" || s === "ride-0") sent[s] ??= Math.floor(Date.now() / 1000);
  const color = typeof b.color === "string" && /^#[0-9a-fA-F]{6}$/.test(b.color) ? b.color : "#e11d2e";
  const row = {
    id, clave_hash: hash, plataforma: platform, entorno: b.entorno === "pruebas" ? "pruebas" : "produccion",
    token_aviso: tokenAviso, token_actividad: tokenActividad, bus_id: busId, parada_bajada: alight,
    paradas_total: Math.max(0, Math.min(500, Math.round(num(b.total) ?? 0))), ruta: str(b.ruta, 40) ?? "", color,
    parada_nombre: str(b.paradaNombre, 120) ?? "", enviados: sent, app_viva: new Date().toISOString(), actualizado: new Date().toISOString(),
    ...(prev && prev.parada_bajada !== alight ? { ultimo_estado: null } : {}),
    ...(prev ? {} : { vence: new Date(Date.now() + core.RIDE_PUSH_MAX_MS).toISOString() }),
  };
  const { error } = await db.from("viajes_activos").upsert(row);
  if (error) return json({ ok: false }, 500);
  return json({ ok: true, avisa: !!tokenAviso && canPush(platform) });
}

async function endRide(b: Record<string, unknown>): Promise<Response> {
  const id = str(b.id, 64), clave = str(b.clave, 128);
  if (!id || !clave) return json({ ok: false }, 400);
  await db.from("viajes_activos").delete().eq("id", id).eq("clave_hash", await sha256(clave));
  return json({ ok: true });
}

/* ---------------- posiciones compartidas ---------------- */

async function share(b: Record<string, unknown>): Promise<Response> {
  const r = str(b.r, 40), k = num(b.k), m = num(b.m), t = num(b.t), v = num(b.v), bus = str(b.b, 64), s = num(b.s);
  const now = Date.now() / 1000;
  if (!r || k == null || !Number.isInteger(k) || k < 0 || k > 50 || m == null || m < 0 || m > 300000 || t == null || Math.abs(t - now) > 120) return json({ ok: false }, 400);
  await db.from("posiciones_compartidas").insert({
    ruta: r, recorrido: k, sentido: s === 0 || s === 1 ? s : null, metros: m, velocidad: v != null && v >= 0 && v <= 40 ? v : null,
    bus_id: bus && !bus.startsWith("gps:") ? bus : null, hora: new Date(t * 1000).toISOString(),
  });
  return new Response(null, { status: 204, headers: CORS });
}

/** Publica las posiciones vigentes (≤60 s, una por bus) en el almacenamiento público: las apps lo leen de ahí. */
async function publishShared(): Promise<number> {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { data } = await db.from("posiciones_compartidas").select("ruta,recorrido,metros,velocidad,bus_id,hora").gte("hora", since).limit(5000);
  const now = Date.now() / 1000;
  const list = core.dedupeSharedRides((data ?? []).map((x: Record<string, unknown>) => ({ routeId: x.ruta, shape: x.recorrido, meters: x.metros, speed: x.velocidad, busId: x.bus_id, at: Date.parse(String(x.hora)) / 1000 })), now) as { routeId: string; shape: number; meters: number; speed?: number | null; busId?: string | null; at: number }[];
  const out = { at: Math.floor(now), items: list.map((x) => ({ r: x.routeId, k: x.shape, m: Math.round(x.meters), t: Math.round(x.at), ...(x.speed != null ? { v: Math.round(x.speed * 10) / 10 } : {}), ...(x.busId ? { b: x.busId } : {}) })) };
  await db.storage.from("compartidos").upload("vivo.json", new Blob([JSON.stringify(out)], { type: "application/json" }), { upsert: true, cacheControl: "10", contentType: "application/json" });
  // nunca se guardan trayectorias más de lo necesario (además del borrado de pg_cron)
  if (Math.random() < 0.05) await db.from("posiciones_compartidas").delete().lt("hora", new Date(Date.now() - 24 * 3600_000).toISOString());
  return list.length;
}

/* ---------------- la vuelta del servidor: recalcular y avisar ---------------- */

let state: InstanceType<typeof core.TransitState> | null = null;
let networkAt = 0, profileAt = 0;

async function gz(url: string): Promise<unknown> {
  const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok || !r.body) throw new Error(`${url}: HTTP ${r.status}`);
  return JSON.parse(await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).text());
}
/** La red (rutas, paradas, recorridos) ya procesada por el workflow «GTFS diario»: se renueva cada 6 h. Los tiempos aprendidos, cada hora. */
async function ensureState(): Promise<InstanceType<typeof core.TransitState>> {
  if (!state || Date.now() - networkAt > 6 * 3600_000) {
    const dto = await gz(`${RAW}live-data/network2.json.gz?t=${Math.floor(Date.now() / 3600_000)}`);
    const s = state ?? new core.TransitState();
    s.setNetwork(core.buildNetwork(core.expandNetwork(dto)));
    state = s; networkAt = Date.now();
  }
  if (Date.now() - profileAt > 3600_000) {
    profileAt = Date.now();
    try { state.hopProfile.load(await gz(`${RAW}hop-stats/profile.json.gz?t=${Math.floor(Date.now() / 3600_000)}`)); } catch { /* sin perfil: valor fijo por parada, como la app sin él */ }
  }
  return state;
}
async function positions(): Promise<Uint8Array> {
  try {
    const r = await fetch(LIVE, { headers: { "user-agent": "Mozilla/5.0 (transmi-live)" }, signal: AbortSignal.timeout(10_000) });
    if (r.ok) return new Uint8Array(await r.arrayBuffer());
  } catch { /* se usa la copia */ }
  const r = await fetch(`${RAW}live-data/positions.pb?t=${Date.now()}`, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`posiciones: HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

type Ride = {
  id: string; plataforma: "ios" | "android"; entorno: string; token_aviso: string | null; token_actividad: string | null; bus_id: string; parada_bajada: string;
  paradas_total: number; ruta: string; color: string; parada_nombre: string; enviados: Record<string, number>; ultimo_estado: { left: number; eta: number } | null;
  app_viva: string | null; sin_bus_desde: string | null; vence: string;
};

/** Envía un aviso y/o el estado del viaje al teléfono. Devuelve false si el token ya no sirve (se borra el viaje). */
async function deliver(r: Ride, alert: { id: string; title: string; body: string } | null, activity: Record<string, unknown> | null, end = false, urgent = true): Promise<boolean> {
  const data = { busId: r.bus_id, alightId: r.parada_bajada, total: r.paradas_total };
  const now = Date.now();
  try {
    if (r.plataforma === "ios") {
      const k = apnsKey();
      if (!k) return true;
      const sandbox = r.entorno === "pruebas";
      if (alert && r.token_aviso) {
        const st = await sendApns(k, r.token_aviso, { type: "alert", payload: apnsAlert(alert.title, alert.body, data), collapseId: alert.id, priority: 10 }, sandbox, now);
        if (st === 410) return false;      // 410 = el teléfono ya no acepta avisos con ese token
      }
      if ((activity || end) && r.token_actividad) {
        // al terminar se manda un estado final (Apple lo pide junto con el final de la actividad)
        const last = activity ?? { title: "Llegaste", detail: `Te bajaste en ${r.parada_nombre || "tu parada"}.`, badge: r.ruta, color: r.color, until: 0, untilLabel: "", step: r.paradas_total, steps: r.paradas_total, arrive: 0, link: `transmilive:///ride/${r.bus_id}` };
        const st = await sendApns(k, r.token_actividad, { type: "liveactivity", payload: apnsActivity(last, now / 1000, end), priority: urgent ? 10 : 5 }, sandbox, now);
        if (st === 410) await db.from("viajes_activos").update({ token_actividad: null }).eq("id", r.id);
      }
    } else {
      // Android: solo los avisos (la notificación fija del viaje la corrige la app al abrirse; ver fcmMessage)
      const acc = fcmAccount();
      if (!acc || !r.token_aviso || !alert) return true;
      const st = await sendFcm(acc, fcmMessage(r.token_aviso, alert, data), now);
      if (st === 404) return false;
    }
  } catch (e) { console.log(`aviso ${r.id.slice(0, 6)}: ${String(e)}`); }
  return true;
}

async function tickRides(): Promise<{ rides: number; sent: number }> {
  // vencidos (más de 3 h): se cierra la actividad en vivo y se borran con sus tokens
  const { data: old } = await db.from("viajes_activos").select("*").lt("vence", new Date().toISOString()).limit(200);
  for (const r of (old ?? []) as Ride[]) { await deliver(r, null, null, true); await db.from("viajes_activos").delete().eq("id", r.id); }

  const { data } = await db.from("viajes_activos").select("*").gte("vence", new Date().toISOString()).limit(MAX_ACTIVE);
  const rides = (data ?? []) as Ride[];
  if (!rides.length) return { rides: 0, sent: 0 };
  const s = await ensureState();
  const ids = new Set(rides.map((r) => r.bus_id));
  const nowMs = Date.now();
  // solo los buses de los viajes activos: el cálculo de todos los buses (~5.000) gastaría tiempo de CPU sin necesidad
  s.applyPositions((core.decodePositions(await positions()) as { id: string }[]).filter((x) => ids.has(x.id)), nowMs);
  s.dropStale(nowMs);      // un bus que dejó de reportar hace >10 min ya no cuenta (el viaje se termina tras RIDE_PUSH_GONE_MS)
  let sent = 0;
  for (const r of rides) {
    const plan = core.planRidePush(s, { busId: r.bus_id, alightId: r.parada_bajada, total: r.paradas_total, route: r.ruta, color: r.color, stop: r.parada_nombre || "tu parada", sent: r.enviados ?? {} }, nowMs, TICK_S);
    if (plan.kind === "missing") {
      const since = r.sin_bus_desde ? Date.parse(r.sin_bus_desde) : nowMs;
      if (nowMs - since > core.RIDE_PUSH_GONE_MS) { await deliver(r, null, null, true); await db.from("viajes_activos").delete().eq("id", r.id); }
      else if (!r.sin_bus_desde) await db.from("viajes_activos").update({ sin_bus_desde: new Date(nowMs).toISOString() }).eq("id", r.id);
      continue;
    }
    const enviados = { ...(r.enviados ?? {}) };
    for (const id of plan.markSent) enviados[id] = Math.floor(nowMs / 1000);
    const appAlive = r.app_viva != null && nowMs - Date.parse(r.app_viva) < APP_ALIVE_MS;
    let ok = true;
    for (const a of plan.alerts) { ok = (await deliver(r, a, null)) && ok; sent++; }
    if (plan.kind === "done") {
      // «ya pasó tu parada» sin haber avisado nada antes: puede ser un dato raro del bus; se espera a verlo 3 vueltas seguidas (como la app)
      const strikes = (r.ultimo_estado as { fuera?: number } | null)?.fuera ?? 0;
      if (!plan.alerts.length && !r.enviados?.["ride-1"] && strikes < 2) {
        await db.from("viajes_activos").update({ ultimo_estado: { ...(r.ultimo_estado ?? { left: -1, eta: 0 }), fuera: strikes + 1 } }).eq("id", r.id);
        continue;
      }
      if (!appAlive) await deliver(r, null, null, true);
      await db.from("viajes_activos").delete().eq("id", r.id);
      continue;
    }
    if (!ok) { await db.from("viajes_activos").delete().eq("id", r.id); continue; }
    let ultimo: { left: number; eta: number } | null = r.ultimo_estado ? { left: r.ultimo_estado.left, eta: r.ultimo_estado.eta } : null;
    // la actividad en vivo (y la notificación fija de Android): solo si la app no está abierta haciéndolo ella, y solo si cambió algo
    if (!appAlive && core.rideActivityChanged(ultimo, plan.left, plan.eta)) {
      await deliver(r, null, plan.activity, false, !ultimo || ultimo.left !== plan.left);
      ultimo = { left: plan.left, eta: Math.round(plan.eta) };
    }
    await db.from("viajes_activos").update({ enviados, ultimo_estado: ultimo, sin_bus_desde: null }).eq("id", r.id);
  }
  return { rides: rides.length, sent };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ ok: false }, 405);
  const path = new URL(req.url).pathname.replace(/\/+$/, "").split("/").pop();
  if (path === "tick") {
    const key = env("VIAJES_TICK_KEY");
    if (!key || req.headers.get("x-tick-key") !== key) return json({ ok: false }, 403);
    const out: Record<string, unknown> = {};
    try { if (AVISOS()) out.avisos = await tickRides(); } catch (e) { out.avisosError = String(e); }
    try { if (COMPARTIR()) out.compartidos = await publishShared(); } catch (e) { out.compartidosError = String(e); }
    return json(out);
  }
  const b = await body(req);
  if (!b) return json({ ok: false }, 400);
  if (path === "viaje") return AVISOS() ? registerRide(b) : json({ ok: true, avisa: false, apagado: true });
  if (path === "fin") return AVISOS() ? endRide(b) : json({ ok: true });
  if (path === "compartir") return COMPARTIR() ? share(b) : new Response(null, { status: 204, headers: CORS });
  return json({ ok: false }, 404);
});
