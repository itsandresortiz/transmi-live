import JSZip from "jszip";
import { type GeoPoint, TransitNetwork, classifyRoute } from "@transmi/domain";
import { csvRows } from "./csv";

/** La red ya procesada, en objetos simples (para poder cruzar el límite de un Web Worker). */
export interface NetworkDto {
  routes: { id: string; shortName: string; longName: string; description: string; routeType: string; agencyId: string; color?: string }[];
  stops: { id: string; code: string; name: string; lat: number; lon: number }[];
  headsigns: Record<string, string[]>;
  shapes: { routeId: string; direction: string; headsign: string; pts: number[]; stopIds: string[] }[];
}

const MAX_SHAPE_POINTS = 400;

async function entry(zip: JSZip, name: string): Promise<string | null> {
  const hit = zip.file(name) ?? zip.file(new RegExp(`(^|/)${name.replace(".", "\\.")}$`))[0];
  return hit ? hit.async("string") : null;
}

/** Lee el GTFS reducido (rutas, viajes, paradas, trazados y paradas por recorrido). */
export async function parseGtfsLite(data: ArrayBuffer | Uint8Array): Promise<NetworkDto> {
  const zip = await JSZip.loadAsync(data);
  const dto: NetworkDto = { routes: [], stops: [], headsigns: {}, shapes: [] };

  for (const r of csvRows((await entry(zip, "routes.txt")) ?? "")) {
    dto.routes.push({
      id: r.route_id!, shortName: r.route_short_name || r.route_id!, longName: r.route_long_name ?? "",
      description: r.route_desc ?? "", routeType: r.route_type ?? "", agencyId: r.agency_id ?? "", color: r.route_color ?? "",
    });
  }

  // viajes: el trazado más usado de cada ruta y sentido es el "representativo"
  const shapeCount = new Map<string, number>();
  const firstTrip = new Map<string, string>();
  const heads = new Map<string, Set<string>>();
  for (const t of csvRows((await entry(zip, "trips.txt")) ?? "")) {
    const dir = t.direction_id || "0";
    const key = `${t.route_id}|${dir}|${t.shape_id ?? ""}`;
    shapeCount.set(key, (shapeCount.get(key) ?? 0) + 1);
    if (!firstTrip.has(key)) firstTrip.set(key, t.trip_id!);
    if (t.trip_headsign) (heads.get(t.route_id!) ?? heads.set(t.route_id!, new Set()).get(t.route_id!)!).add(t.trip_headsign);
  }
  for (const [rid, set] of heads) dto.headsigns[rid] = [...set].slice(0, 20);

  const best = new Map<string, { n: number; shape: string; trip: string; headsign: string }>();
  for (const [key, n] of shapeCount) {
    const [rid, dir, shape] = key.split("|") as [string, string, string];
    const k = `${rid}|${dir}`;
    const cur = best.get(k);
    if (!cur || n > cur.n) best.set(k, { n, shape, trip: firstTrip.get(key)!, headsign: "" });
  }

  for (const s of csvRows((await entry(zip, "stops.txt")) ?? "")) {
    const lat = +s.stop_lat!, lon = +s.stop_lon!;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !lat) continue;
    dto.stops.push({ id: s.stop_id!, code: s.stop_code ?? "", name: s.stop_name || s.stop_id!, lat, lon });
  }

  const wantedShapes = new Set([...best.values()].map((b) => b.shape).filter(Boolean));
  const rawShapes = new Map<string, [number, number, number][]>();
  for (const r of csvRows((await entry(zip, "shapes.txt")) ?? "")) {
    if (!wantedShapes.has(r.shape_id!)) continue;
    (rawShapes.get(r.shape_id!) ?? rawShapes.set(r.shape_id!, []).get(r.shape_id!)!).push([+r.shape_pt_sequence!, +r.shape_pt_lat!, +r.shape_pt_lon!]);
  }

  const repTrips = new Map<string, { q: number; id: string }[]>();
  const wantedTrips = new Set([...best.values()].map((b) => b.trip));
  for (const st of csvRows((await entry(zip, "stop_times.txt")) ?? "")) {
    if (!wantedTrips.has(st.trip_id!)) continue;
    (repTrips.get(st.trip_id!) ?? repTrips.set(st.trip_id!, []).get(st.trip_id!)!).push({ q: +st.stop_sequence!, id: st.stop_id! });
  }

  for (const [k, b] of best) {
    const [routeId, direction] = k.split("|") as [string, string];
    const raw = rawShapes.get(b.shape);
    const pts: number[] = [];
    if (raw && raw.length > 1) {
      raw.sort((a, c) => a[0] - c[0]);
      const stride = Math.max(1, Math.floor(raw.length / MAX_SHAPE_POINTS));
      for (let i = 0; i < raw.length; i += stride) pts.push(raw[i]![1], raw[i]![2]);
      const last = raw[raw.length - 1]!;
      pts.push(last[1], last[2]);
    }
    const stopIds = (repTrips.get(b.trip) ?? []).sort((a, c) => a.q - c.q).map((s) => s.id);
    if (pts.length || stopIds.length) dto.shapes.push({ routeId, direction, headsign: b.headsign, pts, stopIds });
  }
  return dto;
}

/** Convierte lo leído en la entidad de dominio. */
export function buildNetwork(dto: NetworkDto): TransitNetwork {
  const net = new TransitNetwork();
  for (const r of dto.routes) {
    net.routes.set(r.id, {
      id: r.id, shortName: r.shortName, longName: r.longName,
      system: classifyRoute({ shortName: r.shortName, longName: r.longName, description: r.description, agencyId: r.agencyId, routeType: r.routeType, routeColor: r.color }),
    });
  }
  for (const s of dto.stops) net.stops.set(s.id, { id: s.id, code: s.code, name: s.name, position: { lat: s.lat, lon: s.lon } });
  for (const [rid, hs] of Object.entries(dto.headsigns)) net.headsigns.set(rid, hs);
  for (const sh of dto.shapes) {
    const points: GeoPoint[] = [];
    for (let i = 0; i < sh.pts.length; i += 2) points.push({ lat: sh.pts[i]!, lon: sh.pts[i + 1]! });
    (net.shapes.get(sh.routeId) ?? net.shapes.set(sh.routeId, []).get(sh.routeId)!).push({
      routeId: sh.routeId, direction: sh.direction, headsign: sh.headsign, points, stopIds: sh.stopIds,
    });
  }
  return net;
}
