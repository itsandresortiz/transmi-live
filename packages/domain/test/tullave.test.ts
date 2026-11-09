import { describe, expect, it } from "vitest";
import { NotTuLlaveError, groupCardNumber, movementsByMonth, parseTuLlave, type CardReading } from "../src";

const be = (n: number, len: number) => Array.from({ length: len }, (_, i) => (n >> (8 * (len - 1 - i))) & 255);
const bcd = (n: number) => ((Math.floor(n / 10) << 4) | n % 10);
const hexOf = (b: number[]) => b.map((x) => x.toString(16).padStart(2, "0")).join("");
/** Arma un registro como lo describe el formato: tipo en 0, saldo después en 3-5, monto en 11-13, fecha BCD en 26-32. */
function record(kind: number, after: number, amount: number, d: [number, number, number, number, number, number, number] = [20, 26, 11, 8, 7, 42, 10]): string {
  const b = new Array(33).fill(0);
  b[0] = kind; be(after, 3).forEach((x, i) => (b[3 + i] = x)); be(amount, 3).forEach((x, i) => (b[11 + i] = x));
  const [c, y, mo, da, h, mi, s] = d; [c, y, mo, da, h, mi, s].forEach((x, i) => (b[26 + i] = bcd(x)));
  return hexOf([...b, 0x90, 0x00]);
}
const reading = (over: Partial<CardReading> = {}): CardReading => ({
  balance: hexOf([...be(12450, 4), 0x90, 0x00]),
  purse: hexOf([0, 0, 0, 0, 0, 0, 0, 0, 0x90, 0x00]),
  cardFile: hexOf([...new Array(8).fill(0), 0x10, 0x10, 0, 0, 0x12, 0x34, 0x56, 0x78, 0x90, 0x00]),
  records: [record(1, 12450, 3350), record(2, 15800, 20000, [20, 26, 10, 30, 18, 5, 0]), null],
  ...over,
});

describe("lectura de la TuLlave", () => {
  it("lee saldo, número y movimientos", () => {
    const c = parseTuLlave(reading());
    expect(c.balance).toBe(12450);
    expect(c.number).toBe("1010000012345678");
    expect(c.movements).toEqual([
      { kind: "trip", at: "2026-11-08T07:42:10", amount: 3350, balanceAfter: 12450 },
      { kind: "topup", at: "2026-10-30T18:05:00", amount: 20000, balanceAfter: 15800 },
    ]);
  });
  it("resta lo que debe el monedero y deja el saldo negativo si hace falta", () => {
    const purse = hexOf([0x01, 0, 0, 0, ...be(15000, 4), 0x90, 0x00]);
    expect(parseTuLlave(reading({ purse })).balance).toBe(12450 - 15000);
  });
  it("una respuesta que no termina en 9000 no es una TuLlave", () => {
    expect(() => parseTuLlave(reading({ balance: "6a82" }))).toThrow(NotTuLlaveError);
  });
  it("ignora registros vacíos o ilegibles y tolera fechas malas", () => {
    const bad = record(1, 100, 100, [20, 26, 13, 40, 7, 42, 10]);        // mes 13 y día 40: no existen
    const c = parseTuLlave(reading({ records: [bad, "", "zz"] }));
    expect(c.movements).toHaveLength(1);
    expect(c.movements[0]!.at).toBeNull();
  });
  it("agrupa por mes y escribe el número en grupos de cuatro", () => {
    const c = parseTuLlave(reading());
    expect(movementsByMonth(c.movements).map((g) => g.month)).toEqual(["2026-11", "2026-10"]);
    expect(groupCardNumber(c.number)).toBe("1010 0000 1234 5678");
  });
});
