/** Una línea CSV con comillas. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  const n = line.length;
  let i = 0;
  while (i <= n) {
    if (line[i] === '"') {
      let v = "";
      i++;
      while (i < n) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') { v += '"'; i += 2; } else { i++; break; }
        } else v += line[i++];
      }
      out.push(v);
      if (line[i] === ",") i++; else break;
    } else {
      const j = line.indexOf(",", i);
      if (j < 0) { out.push(line.slice(i)); break; }
      out.push(line.slice(i, j));
      i = j + 1;
      if (i === n) { out.push(""); break; }
    }
  }
  return out;
}

/** Filas de un CSV como objetos, sin cargar todas a la vez. */
export function* csvRows(text: string): Generator<Record<string, string>> {
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let nl = text.indexOf("\n", pos);
  if (nl < 0) nl = text.length;
  const head = parseCsvLine(text.slice(pos, nl).replace(/\r$/, "")).map((h) => h.trim());
  pos = nl + 1;
  while (pos < text.length) {
    nl = text.indexOf("\n", pos);
    if (nl < 0) nl = text.length;
    const line = text.slice(pos, nl).replace(/\r$/, "");
    pos = nl + 1;
    if (!line) continue;
    const f = parseCsvLine(line);
    const o: Record<string, string> = {};
    for (let k = 0; k < head.length; k++) o[head[k]!] = f[k] ?? "";
    yield o;
  }
}
