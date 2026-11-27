// Envío de avisos push: APNs (iPhone: avisos y actividad en vivo) y FCM (Android). Solo usa WebCrypto y fetch (sirve en Deno y en Node,
// donde lo prueba `test/edge-push.test.ts`). Las llaves NUNCA van en el código: llegan como secretos de Supabase (ver supabase/LEEME-avisos.md).

export interface ApnsKey { keyP8: string; keyId: string; teamId: string; bundleId: string }
export interface FcmAccount { client_email: string; private_key: string; project_id: string }

const b64url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = (s: string): string => b64url(new TextEncoder().encode(s));

/** El contenido de una llave en formato PEM (con o sin encabezados, con `\n` escritos como texto) → bytes PKCS#8. */
export function pemToPkcs8(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem.replace(/\\n/g, "\n").replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(body);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Firma un JWT. ES256 (Apple) o RS256 (Google). WebCrypto ya entrega la firma ECDSA como r‖s, que es lo que pide JWT. */
export async function signJwt(header: Record<string, unknown>, claims: Record<string, unknown>, pem: string, alg: "ES256" | "RS256"): Promise<string> {
  const params = alg === "ES256" ? { name: "ECDSA", namedCurve: "P-256" } : { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
  const key = await crypto.subtle.importKey("pkcs8", pemToPkcs8(pem), params, false, ["sign"]);
  const input = `${b64urlText(JSON.stringify({ ...header, alg }))}.${b64urlText(JSON.stringify(claims))}`;
  const sig = await crypto.subtle.sign(alg === "ES256" ? { name: "ECDSA", hash: "SHA-256" } : { name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(input));
  return `${input}.${b64url(new Uint8Array(sig))}`;
}

/* ---------------- APNs ---------------- */

let apnsJwt: { token: string; at: number } | null = null;
/** Apple pide renovar el token entre 20 y 60 min: se renueva a los 45. */
async function apnsToken(k: ApnsKey, nowMs: number): Promise<string> {
  if (apnsJwt && nowMs - apnsJwt.at < 45 * 60_000) return apnsJwt.token;
  const token = await signJwt({ kid: k.keyId }, { iss: k.teamId, iat: Math.floor(nowMs / 1000) }, k.keyP8, "ES256");
  apnsJwt = { token, at: nowMs };
  return token;
}

export interface ApnsMessage {
  /** «alert» para un aviso, «liveactivity» para la actividad en vivo. */
  type: "alert" | "liveactivity";
  payload: Record<string, unknown>;
  /** Avisos que reemplazan al anterior con la misma clave (p. ej. «ride-1»). */
  collapseId?: string;
  /** 10 = ya (avisos); 5 = cuando convenga (actualizaciones de la actividad que no urgen). */
  priority?: 5 | 10;
}

/** Arma el cuerpo de un aviso de iPhone. Los datos van en `body`: es de donde expo-notifications saca `content.data` de un aviso
 *  remoto (`NotificationRecords.swift`), así al tocarlo la app abre el viaje igual que con un aviso local. */
export function apnsAlert(title: string, body: string, data: Record<string, unknown>): Record<string, unknown> {
  return { aps: { alert: { title, body }, sound: "default", "interruption-level": "time-sensitive" }, body: data };
}
/** Cuerpo de una actualización (o final) de la actividad en vivo. `state` = `ContentState` del Swift, con los mismos nombres. */
export function apnsActivity(state: Record<string, unknown> | null, nowSec: number, end = false): Record<string, unknown> {
  const aps: Record<string, unknown> = { timestamp: Math.floor(nowSec), event: end ? "end" : "update" };
  if (state) aps["content-state"] = state;
  if (end) aps["dismissal-date"] = Math.floor(nowSec) + 120;      // se queda 2 min en la pantalla de bloqueo y se va
  else if (typeof state?.arrive === "number" && state.arrive > 0) aps["stale-date"] = Math.floor(state.arrive) + 1800;
  return { aps };
}

/** Envía a APNs. Devuelve el estado HTTP (410 = el token ya no sirve: hay que borrar el viaje). `sandbox` para compilaciones de Xcode. */
export async function sendApns(k: ApnsKey, deviceToken: string, msg: ApnsMessage, sandbox: boolean, nowMs = Date.now()): Promise<number> {
  const host = sandbox ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  const topic = msg.type === "liveactivity" ? `${k.bundleId}.push-type.liveactivity` : k.bundleId;
  const headers: Record<string, string> = {
    authorization: `bearer ${await apnsToken(k, nowMs)}`, "apns-push-type": msg.type, "apns-topic": topic,
    "apns-priority": String(msg.priority ?? 10), "apns-expiration": String(Math.floor(nowMs / 1000) + 600),
  };
  if (msg.collapseId) headers["apns-collapse-id"] = msg.collapseId;
  const r = await fetch(`${host}/3/device/${encodeURIComponent(deviceToken)}`, { method: "POST", headers, body: JSON.stringify(msg.payload) });
  await r.body?.cancel();
  return r.status;
}

/* ---------------- FCM (Android) ---------------- */

let fcmAccess: { token: string; until: number } | null = null;
async function fcmToken(acc: FcmAccount, nowMs: number): Promise<string> {
  if (fcmAccess && nowMs < fcmAccess.until) return fcmAccess.token;
  const iat = Math.floor(nowMs / 1000);
  const assertion = await signJwt({ typ: "JWT" }, { iss: acc.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600 }, acc.private_key, "RS256");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${assertion}` });
  if (!r.ok) throw new Error(`FCM: no se obtuvo acceso (HTTP ${r.status})`);
  const j = (await r.json()) as { access_token: string; expires_in?: number };
  fcmAccess = { token: j.access_token, until: nowMs + Math.max(60, (j.expires_in ?? 3600) - 300) * 1000 };
  return j.access_token;
}

/**
 * Mensaje de Android. Va SOLO con datos y prioridad alta, con las claves que lee expo-notifications (`title`, `message`, `body` con los
 * datos en JSON, `channelId`, `tag`; ver su `NotificationData.kt` y `FirebaseMessagingDelegate.kt`): lo muestra la propia app en su canal
 * «Avisos del viaje» y al tocarlo abre el viaje igual que un aviso local. `tag` = el mismo identificador del aviso local («ride-1»…):
 * si ese ya había salido, este lo reemplaza en vez de quedar dos.
 * La notificación fija del viaje NO se corrige desde aquí: un mensaje sin título no lo entrega expo-notifications a la app en segundo plano.
 */
export function fcmMessage(token: string, alert: { id: string; title: string; body: string }, data: Record<string, unknown>): Record<string, unknown> {
  const d: Record<string, string> = { channelId: "viaje", tag: alert.id, title: alert.title, message: alert.body, body: JSON.stringify(data) };
  return { message: { token, data: d, android: { priority: "high", ttl: "600s" } } };
}

/** Envía a FCM. Devuelve el estado HTTP (404 / 400 con UNREGISTERED = token que ya no sirve). */
export async function sendFcm(acc: FcmAccount, msg: Record<string, unknown>, nowMs = Date.now()): Promise<number> {
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${acc.project_id}/messages:send`, {
    method: "POST", headers: { authorization: `Bearer ${await fcmToken(acc, nowMs)}`, "content-type": "application/json" }, body: JSON.stringify(msg),
  });
  await r.body?.cancel();
  return r.status;
}
