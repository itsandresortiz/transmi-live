import type { GeoPoint } from "@transmi/domain";
import type { PlanPlace } from "@transmi/application";

/** Búsqueda de direcciones y lugares de Bogotá con Photon (OpenStreetMap, servicio público que admite búsqueda mientras se escribe). */
const BASE = "https://photon.komoot.io";
const BBOX = "-74.30,4.45,-73.99,4.85";             // Bogotá: oeste, sur, este, norte

interface PhotonFeature { geometry: { coordinates: [number, number] }; properties: { name?: string; street?: string; housenumber?: string; locality?: string; district?: string; city?: string } }

function toPlace(f: PhotonFeature): PlanPlace | null {
  const p = f.properties, [lon, lat] = f.geometry.coordinates;
  const street = [p.street, p.housenumber].filter(Boolean).join(" # ");
  const name = p.name || street;
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const detail = [p.name ? street : "", p.locality || p.district].filter(Boolean).join(", ");
  return { name: detail ? `${name} · ${detail}` : name, position: { lat, lon } };
}

export async function geocode(text: string, near?: GeoPoint | null, signal?: AbortSignal): Promise<PlanPlace[]> {
  /** La ubicación que sale del teléfono hacia el buscador de direcciones se redondea a ~100 m: basta para ordenar resultados cercanos. */
  const round3 = (n: number) => Math.round(n * 1000) / 1000;
  const q = new URLSearchParams({ q: text, limit: "8", bbox: BBOX, lang: "es", lat: String(near ? round3(near.lat) : 4.65), lon: String(near ? round3(near.lon) : -74.1) });
  const r = await fetch(`${BASE}/api/?${q}`, { signal });
  if (!r.ok) throw new Error(String(r.status));
  const j = (await r.json()) as { features?: PhotonFeature[] };
  const seen = new Set<string>();
  return (j.features ?? []).map(toPlace).filter((x): x is PlanPlace => !!x && !seen.has(x.name) && !!seen.add(x.name));
}

/** Nombre aproximado de un punto tocado en el mapa («Cra. 7 # 72, Chapinero»); si no hay red, «Punto en el mapa». */
export async function reverse(p: GeoPoint, signal?: AbortSignal): Promise<PlanPlace> {
  try {
    const r = await fetch(`${BASE}/reverse?lat=${p.lat}&lon=${p.lon}&limit=1&lang=es`, { signal });
    const j = (await r.json()) as { features?: PhotonFeature[] };
    const pl = j.features?.[0] ? toPlace(j.features[0]) : null;
    if (pl) return { name: pl.name, position: p };
  } catch { /* sin red: se usa el nombre genérico */ }
  return { name: "Punto en el mapa", position: p };
}
