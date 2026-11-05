/** Lector mínimo de Protocol Buffers, con comprobación estricta de límites:
 *  un lote cortado o corrupto lanza `FeedDecodeError` en lugar de producir datos falsos. */
export class FeedDecodeError extends Error {
  constructor(message: string) { super(message); this.name = "FeedDecodeError"; }
}

export type Range = readonly [start: number, end: number];
export interface Field { field: number; wire: number; num: number; range: Range }

const DECODER = new TextDecoder();

export class Reader {
  private readonly view: DataView;
  constructor(readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  private varint(p: { pos: number; end: number }): number {
    let result = 0;
    let mul = 1;
    const start = p.pos;
    let n = 0;
    for (;;) {
      if (p.pos >= p.end) throw new FeedDecodeError("varint cortado");
      const b = this.buf[p.pos++]!;
      result += (b & 127) * mul;
      mul *= 128;
      n++;
      if (b < 128) break;
      if (n > 10) throw new FeedDecodeError("varint demasiado largo");
    }
    if (n >= 10) {
      // enteros negativos de 64 bits (p. ej. retrasos adelantados): se interpretan con signo
      let big = 0n;
      for (let i = 0; i < n; i++) big |= BigInt(this.buf[start + i]! & 127) << BigInt(7 * i);
      return Number(BigInt.asIntN(64, big));
    }
    return result;
  }

  /** Recorre los campos de un mensaje. Para campos de longitud variable, `range` apunta a su contenido. */
  *fields(range: Range = [0, this.buf.length]): Generator<Field> {
    const p = { pos: range[0], end: range[1] };
    while (p.pos < p.end) {
      const key = this.varint(p);
      const field = Math.floor(key / 8);
      const wire = key & 7;
      if (wire === 0) yield { field, wire, num: this.varint(p), range: [0, 0] };
      else if (wire === 2) {
        const len = this.varint(p);
        if (len < 0 || p.pos + len > p.end) throw new FeedDecodeError("campo de longitud variable cortado");
        yield { field, wire, num: 0, range: [p.pos, p.pos + len] };
        p.pos += len;
      } else if (wire === 5) {
        if (p.pos + 4 > p.end) throw new FeedDecodeError("float cortado");
        yield { field, wire, num: this.view.getFloat32(p.pos, true), range: [0, 0] };
        p.pos += 4;
      } else if (wire === 1) {
        if (p.pos + 8 > p.end) throw new FeedDecodeError("double cortado");
        yield { field, wire, num: this.view.getFloat64(p.pos, true), range: [0, 0] };
        p.pos += 8;
      } else throw new FeedDecodeError(`tipo de campo no soportado (${wire})`);
    }
  }

  text(r: Range): string {
    const n = r[1] - r[0];
    if (n <= 40) {
      // casi todo son identificadores ASCII cortos: se arman a mano (TextDecoder es mucho más lento por llamada)
      let s = "";
      for (let i = r[0]; i < r[1]; i++) { const c = this.buf[i]!; if (c > 127) return DECODER.decode(this.buf.subarray(r[0], r[1])); s += String.fromCharCode(c); }
      return s;
    }
    return DECODER.decode(this.buf.subarray(r[0], r[1]));
  }
}
