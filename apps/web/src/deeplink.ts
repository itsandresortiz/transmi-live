/** Enlaces que abren la app en una ruta, parada o estación: `…/#/ruta/M82`, `#/parada/ID`, `#/estacion/ID1,ID2`. */
export type Target =
  | { kind: "ruta"; id: string; direction?: string }
  | { kind: "parada"; id: string }
  | { kind: "estacion"; ids: string[] }
  /** Un viaje planeado: de dónde (null = mi ubicación) y a dónde. */
  | { kind: "viaje"; from: { lat: number; lon: number; name: string } | null; to: { lat: number; lon: number; name: string } };

export function formatHash(t: Target): string {
  switch (t.kind) {
    case "ruta": return `#/ruta/${encodeURIComponent(t.id)}${t.direction && t.direction !== "0" ? `?d=${encodeURIComponent(t.direction)}` : ""}`;
    case "parada": return `#/parada/${encodeURIComponent(t.id)}`;
    case "estacion": return `#/estacion/${t.ids.map(encodeURIComponent).join(",")}`;
    case "viaje": {
      const pl = (x: { lat: number; lon: number; name: string }) => `${x.lat.toFixed(5)},${x.lon.toFixed(5)},${encodeURIComponent(x.name)}`;
      return `#/viaje/${t.from ? pl(t.from) : "-"}/${pl(t.to)}`;
    }
  }
}

export function parseHash(hash: string): Target | null {
  const v = /^#\/viaje\/([^/]+)\/([^/]+)$/.exec(hash);
  if (v) {
    const pl = (x: string) => {
      const [la, lo, ...rest] = x.split(",");
      const lat = Number(la), lon = Number(lo);
      let name = "Lugar"; try { name = decodeURIComponent(rest.join(",")) || "Lugar"; } catch { /* nombre dañado */ }
      return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon, name } : null;
    };
    const to = pl(v[2]!), from = v[1] === "-" ? null : pl(v[1]!);
    return to && (v[1] === "-" || from) ? { kind: "viaje", from, to } : null;
  }
  const m = /^#\/(ruta|parada|estacion)\/([^?]+)(?:\?(.*))?$/.exec(hash);
  if (!m) return null;
  try {
    const val = decodeURIComponent(m[2]!);
    if (m[1] === "estacion") {
      const ids = m[2]!.split(",").map(decodeURIComponent).filter(Boolean);
      return ids.length ? { kind: "estacion", ids } : null;
    }
    if (!val) return null;
    if (m[1] === "parada") return { kind: "parada", id: val };
    const d = new URLSearchParams(m[3] ?? "").get("d") ?? undefined;
    return { kind: "ruta", id: val, direction: d };
  } catch { return null; }
}

/** Dirección completa para compartir, sin parámetros ajenos. */
export function shareUrl(t: Target, loc: Pick<Location, "origin" | "pathname"> = location): string {
  return `${loc.origin}${loc.pathname}${formatHash(t)}`;
}
