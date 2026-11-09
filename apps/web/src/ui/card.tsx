import { useState } from "react";
import { type CardMovement, type CardReading, type TuLlaveCard, NotTuLlaveError, groupCardNumber, maskedReading, movementsByMonth, parseTuLlave } from "@transmi/domain";

/** Lo que la app nativa (iPhone o Android) le ofrece a la página para leer la tarjeta por NFC. El navegador no puede: ni Safari tiene NFC web, ni Chrome lee estas tarjetas. */
interface NativeReader { isAvailable(): boolean | Promise<boolean>; read(): Promise<CardReading> }
const reader = (): NativeReader | null => (window as unknown as { TransmiNative?: { tullave?: NativeReader } }).TransmiNative?.tullave ?? null;

export const canReadCard = (): boolean => reader() != null;

const pesos = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("es-CO")}`;
const KIND: Record<CardMovement["kind"], string> = { trip: "Viaje", topup: "Recarga", topupCancelled: "Recarga anulada", other: "Movimiento" };
const when = (at: string) => new Date(at).toLocaleString("es-CO", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const month = (m: string) => { const s = new Date(`${m}-15T12:00:00`).toLocaleDateString("es-CO", { month: "long", year: "numeric" }); return s.charAt(0).toUpperCase() + s.slice(1); };

const copyTechnical = (r: CardReading) => navigator.clipboard.writeText(maskedReading(r)).catch(() => undefined);

/** «Mi tarjeta»: el saldo se lee de la tarjeta en el teléfono; no se envía ni se guarda nada. */
export function CardSection() {
  const [card, setCard] = useState<{ data: TuLlaveCard; at: number; raw: CardReading } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const native = reader();

  const read = async () => {
    if (!native) return;
    setBusy(true); setError(null);
    try {
      if (!(await native.isAvailable())) { setError("Este teléfono no puede leer tarjetas."); return; }
      const raw = await native.read();
      setCard({ data: parseTuLlave(raw), at: Date.now(), raw }); setCopied(false);
    } catch (e) {
      const code = (e as { code?: string }).code;
      setError(e instanceof NotTuLlaveError || code === "not_tullave" ? "Esa tarjeta no parece una TuLlave."
        : code === "cancelled" ? null
        : code === "timeout" ? "No alcanzamos a leer la tarjeta. Acércala a la parte de atrás del teléfono e intenta de nuevo."
        : "No pudimos leer la tarjeta. Intenta de nuevo.");
    } finally { setBusy(false); }
  };

  return (
    <div className="grp"><h3>Mi tarjeta TuLlave</h3>
      {!native ? (
        <p className="hint">Para ver tu saldo hace falta la app para iPhone o Android: el navegador no puede leer la tarjeta. Cuando la uses, el saldo se lee en tu teléfono y no se envía a ningún lado.</p>
      ) : (
        <>
          <button className="btn primary" onClick={() => void read()} disabled={busy}>{busy ? "Acerca la tarjeta…" : card ? "Leer de nuevo" : "Leer mi tarjeta"}</button>
          {error && <p className="hint" role="alert">{error}</p>}
          {card && (
            <div className="card" role="region" aria-label="Saldo de la tarjeta">
              <div className="ct" aria-label={`Saldo ${pesos(card.data.balance)}`} style={{ fontSize: 28 }}>{pesos(card.data.balance)}</div>
              {card.data.balance < 0 && <div className="cs">Debes {pesos(-card.data.balance)}: se descuenta en tu próxima recarga.</div>}
              {card.data.number && <div className="cs faint">Tarjeta {groupCardNumber(card.data.number)}</div>}
              <div className="cs faint">Leído a las {new Date(card.at).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" })} (solo se muestra aquí, no se guarda)</div>
              <button className="tlink" onClick={() => void copyTechnical(card.raw).then(() => setCopied(true))}>{copied ? "Copiado" : "Copiar lectura técnica (sin el número de la tarjeta)"}</button>
              {movementsByMonth(card.data.movements).map((g) => (
                <div key={g.month ?? "sin-fecha"}>
                  <div className="sec">{g.month ? month(g.month) : "Sin fecha"}</div>
                  {g.movements.map((m, i) => (
                    <div key={i} className="cs" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <span>{KIND[m.kind]}{m.at ? ` · ${when(m.at)}` : ""}</span>
                      <b>{m.kind === "topup" ? "+" : m.kind === "trip" ? "-" : ""}{pesos(m.amount)}</b>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
