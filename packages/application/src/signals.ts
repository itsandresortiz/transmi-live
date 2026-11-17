/** Una fila de `semaforos.json`: [lon, lat, dirección, localidad, tipo, carros, TransMilenio, peatones, bicis, fases, operación].
 *  Las últimas seis llegan desde el 2026-11-17; los archivos viejos traen solo las cinco primeras. */
export type SignalRow = readonly [number, number, string, string, string, number?, number?, number?, number?, number?, string?, (readonly SignalHead[])?];
/** Un semáforo con su posición (de OpenStreetMap): [lon, lat, «c» carros | «t» TransMilenio]. */
export type SignalHead = readonly [number, number, "c" | "t"];

/** Los puntos a dibujar en el mapa: cada semáforo en su sitio si se sabe; si no, el punto del cruce. `label`: «TM» en los de TransMilenio,
 *  la dirección del cruce en el punto de un cruce sin posiciones. */
export function signalPoints(rows: readonly SignalRow[]): { lon: number; lat: number; label: string; tm: boolean; title: string; text: string }[] {
  const out: { lon: number; lat: number; label: string; tm: boolean; title: string; text: string }[] = [];
  for (const r of rows) {
    const i = signalInfo(r), heads = r[11];
    if (heads?.length) for (const h of heads) out.push({ lon: h[0], lat: h[1], label: h[2] === "t" ? "TM" : "", tm: h[2] === "t", title: i.title, text: i.text });
    else out.push({ lon: r[0], lat: r[1], label: r[2], tm: false, title: i.title, text: i.text });
  }
  return out;
}

/** Cuántos grupos de señal hay en un campo de la Secretaría de Movilidad («1,2,3» → 3; «N/A» o vacío → 0). */
export function countSignalGroups(field: unknown): number {
  const s = String(field ?? "").trim();
  if (!s || /^n\/?a$/i.test(s)) return 0;
  return s.split(",").map((x) => x.trim()).filter((x) => x && !/^n\/?a$/i.test(x)).length;
}

/** Lo que se dice al tocar un semáforo en el mapa: el cruce, cuántos semáforos tiene y para quién, sus fases y si está en un plan de obras.
 *  Cada punto es un CRUCE (un controlador), no cada semáforo de la calle: un cruce suele tener varios. */
export function signalInfo(r: SignalRow): { title: string; text: string } {
  const [, , dir, loc, , car = 0, brt = 0, ped = 0, bici = 0, fases = 0, op = ""] = r;
  // semáforos que no están en la lista oficial de Movilidad (solo se sabe dónde están, por OpenStreetMap)
  if (op === "OSM") return { title: "Semáforo", text: `${car > 1 ? `${car} semáforos` : "Semáforo"} que no aparece${car > 1 ? "n" : ""} en la lista oficial de la Secretaría de Movilidad; la posición viene de OpenStreetMap.` };
  const parts: string[] = [];
  if (car) parts.push(`${car} para carros`);
  if (brt) parts.push(`${brt} para TransMilenio`);
  if (ped) parts.push(`${ped} peatonales`);
  if (bici) parts.push(`${bici} para bicicletas`);
  const total = car + brt + ped + bici;
  const lines = [total ? `Cruce con ${total} semáforo${total === 1 ? "" : "s"}: ${parts.join(", ")}.` : "Cruce con semáforo."];
  if (fases) lines.push(`Cambia en ${fases} fase${fases === 1 ? "" : "s"} por ciclo.`);
  if (/pmt|desv/i.test(op)) lines.push("Ahora funciona con un plan de manejo de tránsito (obras o desvíos).");
  if (loc) lines.push(`Localidad: ${loc}.`);
  return { title: dir || "Semáforo", text: lines.join(" ") };
}
