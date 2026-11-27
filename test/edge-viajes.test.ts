import { describe, expect, it } from "vitest";
import { apnsActivity, apnsAlert, fcmMessage, pemToPkcs8, signJwt } from "../supabase/functions/_compartido/push";

// La función de Supabase «viajes» corre en Deno; aquí se prueba en Node lo que no depende de Deno: las firmas, los mensajes y el núcleo
// empaquetado (que sea el mismo cálculo de la app y que cargue sin nada de Node).
const toPem = (der: ArrayBuffer) => `-----BEGIN PRIVATE KEY-----\n${Buffer.from(der).toString("base64")}\n-----END PRIVATE KEY-----`;

describe("avisos push del viaje", () => {
  it("firma el token de Apple (ES256) y se verifica con la llave pública", async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const pem = toPem(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
    const jwt = await signJwt({ kid: "ABC" }, { iss: "TEAM", iat: 1 }, pem, "ES256");
    const [h, c, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h!, "base64url").toString())).toEqual({ kid: "ABC", alg: "ES256" });
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, Buffer.from(s!, "base64url"), new TextEncoder().encode(`${h}.${c}`));
    expect(ok).toBe(true);
  });
  it("acepta la llave pegada con «\\n» escritos como texto (como suele quedar en un secreto)", async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
    const pem = toPem(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).replace(/\n/g, "\\n");
    expect(pemToPkcs8(pem).length).toBeGreaterThan(100);
  });
  it("mensajes: aviso de iPhone, actividad en vivo y Android solo con datos", () => {
    const a = apnsAlert("Bájate aquí", "Estás llegando a Calle 100.", { busId: "b", alightId: "s", total: 4 });
    expect(a).toMatchObject({ aps: { alert: { title: "Bájate aquí" }, "interruption-level": "time-sensitive" }, body: { busId: "b", alightId: "s" } });
    const u = apnsActivity({ title: "x", arrive: 1000 }, 900) as { aps: Record<string, unknown> };
    expect(u.aps).toMatchObject({ event: "update", timestamp: 900, "stale-date": 2800 });
    expect((apnsActivity(null, 900, true) as { aps: Record<string, unknown> }).aps).toMatchObject({ event: "end", "dismissal-date": 1020 });
    const f = fcmMessage("tok", { id: "ride-1", title: "Prepárate para bajar", body: "…" }, { busId: "b" }) as { message: { data: Record<string, unknown>; android: unknown } };
    expect(f.message.data).toMatchObject({ title: "Prepárate para bajar", message: "…", channelId: "viaje", tag: "ride-1", body: '{"busId":"b"}' });
    expect(Object.values(f.message.data).every((v) => typeof v === "string")).toBe(true);      // FCM solo acepta textos en `data`
  });
  it("el núcleo empaquetado para el servidor carga y calcula", async () => {
    const core = await import("../supabase/functions/_compartido/nucleo.js");
    expect(typeof core.planRidePush).toBe("function");
    const s = new core.TransitState();
    expect(core.planRidePush(s, { busId: "x", alightId: "y", total: 1, route: "", color: "#000000", stop: "", sent: {} }, Date.now()).kind).toBe("missing");
  });
});
