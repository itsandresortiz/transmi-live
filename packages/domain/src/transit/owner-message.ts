/** Mensajes que escribe el dueño de la app (un accidente, una manifestación, una novedad propia). No vienen de TransMilenio: salen de un
 *  archivo sencillo (`mensajes.json`) que se edita a mano, y se muestran por un tiempo en la línea de «En vivo» y en la ventana de avisos. */
export interface OwnerMessage {
  readonly id: string;
  readonly text: string;
  /** Segundos desde 1970. Sin `startsAt` vale desde ya; sin `endsAt` vale hasta que se borre del archivo. */
  readonly startsAt?: number;
  readonly endsAt?: number;
  /** «importante» se pinta en rojo; lo demás, en ámbar. */
  readonly important: boolean;
}

const MAX_TEXT = 280, MAX_MESSAGES = 5, MAX_READ = 50;

/** «2026-11-12 06:30» (hora de Bogotá, UTC−5 todo el año) → segundos desde 1970. También acepta «2026-11-12» y números.
 *  Una fecha sin hora es el inicio del día, o el final si `endOfDay` (un «hasta el 14» vale todo el día 14). Fechas imposibles → `undefined`. */
export function parseBogotaTime(v: unknown, endOfDay = false): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v > 1e9) return v > 1e12 ? Math.round(v / 1000) : v;
  if (typeof v !== "string") return undefined;
  const m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::\d{2})?)?\s*$/.exec(v);
  if (!m) return undefined;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]), hasTime = m[4] != null, h = Number(m[4] ?? 0), mi = Number(m[5] ?? 0);
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59) return undefined;
  if (new Date(Date.UTC(y, mo - 1, d)).getUTCDate() !== d) return undefined;   // 31 de noviembre, 30 de febrero…
  const t = Date.UTC(y, mo - 1, d, h + 5, mi) / 1000 + (!hasTime && endOfDay ? 86_400 : 0);
  return Number.isFinite(t) ? t : undefined;
}

/** Lee el archivo tal como lo escribe una persona: tolera campos que falten o sobren y descarta lo que no se entienda, sin romper nada. */
export function parseOwnerMessages(raw: unknown): OwnerMessage[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { mensajes?: unknown }).mensajes) ? (raw as { mensajes: unknown[] }).mensajes : Array.isArray(raw) ? raw : [];
  const out: OwnerMessage[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const text = typeof o.texto === "string" ? o.texto.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT) : "";
    if (!text) continue;
    const startsAt = parseBogotaTime(o.desde), endsAt = parseBogotaTime(o.hasta, true);
    // una fecha escrita pero mal formada no se toma como «sin fecha»: el mensaje se descarta, para no dejarlo puesto para siempre por un error de dedo
    if ((o.desde != null && o.desde !== "" && startsAt == null) || (o.hasta != null && o.hasta !== "" && endsAt == null)) continue;
    let h = 5381; const key = `${text}|${startsAt ?? ""}|${endsAt ?? ""}`;
    for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) | 0;
    const id = (h >>> 0).toString(36);
    if (out.some((x) => x.id === id)) continue;   // el mismo mensaje escrito dos veces
    out.push({ id, text, startsAt, endsAt, important: typeof o.tipo === "string" && /importante|urgente|alerta/i.test(o.tipo) });
    if (out.length >= MAX_READ) break;
  }
  return out;
}

/** Los mensajes que toca mostrar en `nowSec`: primero los importantes; cinco como máximo (el tope va después de mirar la vigencia,
 *  para que mensajes vencidos que sigan en el archivo no tapen a los vigentes). */
export function activeOwnerMessages(all: readonly OwnerMessage[], nowSec: number): OwnerMessage[] {
  return all.filter((m) => (m.startsAt == null || m.startsAt <= nowSec) && (m.endsAt == null || m.endsAt > nowSec)).sort((a, b) => Number(b.important) - Number(a.important)).slice(0, MAX_MESSAGES);
}

/** «Hasta hoy a las 12:00 p. m.» / «Hasta el 14 nov.» (hora de Bogotá). */
export function ownerMessageUntil(m: OwnerMessage, nowSec: number): string {
  if (m.endsAt == null) return "";
  const day = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date(t * 1000));
  const hour = new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Bogota" }).format(new Date(m.endsAt * 1000));
  if (day(m.endsAt) === day(nowSec)) return `Hasta hoy a las ${hour}`;
  return `Hasta el ${new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", timeZone: "America/Bogota" }).format(new Date(m.endsAt * 1000)).replace(/\.$/, "")}, ${hour}`;
}
