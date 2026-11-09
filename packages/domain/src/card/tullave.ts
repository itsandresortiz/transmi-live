/** Lee lo que respondió una tarjeta TuLlave por NFC: saldo, número y últimos movimientos.
 *  La tarjeta contesta en bytes (en hexadecimal); aquí se convierten a datos. Es lógica pura: sirve igual en iPhone y Android.
 *  El formato de las respuestas lo documentó el proyecto Paradero de Croma Labs (MIT, github.com/croma-labs/paradero).
 *  OJO: no lo hemos probado contra una tarjeta real; las posiciones de los bytes son las que ese proyecto describe. */

/** Respuestas crudas de la tarjeta a los cinco pedidos de lectura, en hexadecimal e incluyendo el estado final (`9000` = bien). */
export interface CardReading {
  balance: string;
  purse: string;
  cardFile: string;
  /** Registros de movimientos 1 a 10; `null` si la tarjeta no respondió ese registro. */
  records: (string | null)[];
}

export type MovementKind = "trip" | "topup" | "topupCancelled" | "other";
export interface CardMovement {
  kind: MovementKind;
  /** Hora de Bogotá tal como la escribió la tarjeta («2026-11-08T07:42:10»), o `null` si no se pudo leer. */
  at: string | null;
  /** Pesos del movimiento. */
  amount: number;
  /** Saldo que quedó después del movimiento. */
  balanceAfter: number;
}
export interface TuLlaveCard {
  /** Número de la tarjeta (16 dígitos hexadecimales) o vacío si no se pudo leer. */
  number: string;
  /** Saldo en pesos. Puede ser negativo: la tarjeta deja un viaje «fiado» y se descuenta en la siguiente recarga. */
  balance: number;
  /** Del más reciente al más antiguo, como los guarda la tarjeta. */
  movements: CardMovement[];
}

export class NotTuLlaveError extends Error {
  constructor() { super("not_tullave"); this.name = "NotTuLlaveError"; }
}

const KIND_OF: Record<number, MovementKind> = { 1: "trip", 2: "topup", 4: "topupCancelled" };

const toBytes = (hex: string): number[] => {
  const h = hex.replace(/[^0-9a-f]/gi, "");
  const out: number[] = [];
  for (let i = 0; i + 1 < h.length; i += 2) out.push(parseInt(h.slice(i, i + 2), 16));
  return out;
};
/** Bytes [from, to) completando con ceros si la respuesta es corta, para que una respuesta incompleta dé 0 en vez de fallar. */
const slice = (b: number[], from: number, to: number): number[] => Array.from({ length: to - from }, (_, i) => b[from + i] ?? 0);
const int = (b: number[]): number => b.reduce((n, x) => n * 256 + x, 0);
const hex = (b: number[]): string => b.map((x) => x.toString(16).padStart(2, "0")).join("");
/** La tarjeta termina cada respuesta con `90 00` cuando todo salió bien. */
const succeeded = (b: number[]): boolean => b.length >= 2 && b[b.length - 2] === 0x90 && b[b.length - 1] === 0x00;
/** Un byte en BCD son dos dígitos escritos: 0x26 es 26. */
const bcd = (x: number | undefined): number | null => (x == null || x >> 4 > 9 || (x & 15) > 9 ? null : (x >> 4) * 10 + (x & 15));

function readDate(b: number[]): string | null {
  const [century, year, month, day, h, m, s] = [26, 27, 28, 29, 30, 31, 32].map((i) => bcd(b[i]));
  if ([century, year, month, day, h, m, s].some((x) => x == null)) return null;
  if (month! < 1 || month! > 12 || day! < 1 || day! > 31 || h! > 23 || m! > 59 || s! > 59) return null;
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(century!)}${two(year!)}-${two(month!)}-${two(day!)}T${two(h!)}:${two(m!)}:${two(s!)}`;
}

function readMovement(raw: string | null): CardMovement | null {
  if (!raw) return null;
  const b = toBytes(raw);
  if (!succeeded(b) || b.length < 35) return null;
  const at = readDate(b), amount = int(slice(b, 11, 14)), balanceAfter = int(slice(b, 3, 6));
  if (at == null && amount === 0 && balanceAfter === 0) return null;       // registro vacío
  return { kind: KIND_OF[b[0]!] ?? "other", at, amount, balanceAfter };
}

/** Convierte las respuestas de la tarjeta en saldo, número y movimientos. Lanza `NotTuLlaveError` si no contestó como una TuLlave. */
export function parseTuLlave(r: CardReading): TuLlaveCard {
  const bal = toBytes(r.balance);
  if (!succeeded(bal)) throw new NotTuLlaveError();
  let balance = int(slice(bal, 0, 4)) + int(slice(bal, 5, 8));
  const purse = toBytes(r.purse);
  if (succeeded(purse) && purse[0] === 0x01) balance -= int(slice(purse, 4, 8));      // monedero con deuda pendiente
  const file = toBytes(r.cardFile);
  return {
    number: succeeded(file) ? hex(slice(file, 8, 16)) : "",
    balance,
    movements: r.records.map(readMovement).filter((m): m is CardMovement => m != null),
  };
}

/** «1010 0000 1234 5678»: el número en grupos de cuatro, como se imprime en la tarjeta. */
export const groupCardNumber = (n: string): string => n.replace(/(.{4})(?=.)/g, "$1 ").toUpperCase();

/** Los movimientos separados por mes (en el orden de la tarjeta); los que no tienen fecha van al final. */
export function movementsByMonth(list: readonly CardMovement[]): { month: string | null; movements: CardMovement[] }[] {
  const groups: { month: string | null; movements: CardMovement[] }[] = [], undated: CardMovement[] = [];
  for (const m of list) {
    if (!m.at) { undated.push(m); continue; }
    const month = m.at.slice(0, 7), last = groups[groups.length - 1];
    if (last?.month === month) last.movements.push(m); else groups.push({ month, movements: [m] });
  }
  if (undated.length) groups.push({ month: null, movements: undated });
  return groups;
}
