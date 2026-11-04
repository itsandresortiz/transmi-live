import {
  ALERT_EFFECT_BY_CODE, type ServiceAlert, type TripUpdate, type VehicleReport,
} from "@transmi/domain";
import { FeedDecodeError, Reader } from "./reader";

export type FeedKind = "positions" | "tripupdates" | "alerts";

/** Entidades del mensaje FeedMessage (campo 2). */
function* entities(r: Reader) {
  for (const f of r.fields()) if (f.field === 2 && f.wire === 2) yield f.range;
}

export function sniffFeed(buf: Uint8Array): FeedKind | null {
  const r = new Reader(buf);
  for (const e of entities(r)) {
    for (const f of r.fields(e)) {
      if (f.field === 4) return "positions";
      if (f.field === 3) return "tripupdates";
      if (f.field === 5) return "alerts";
    }
    break;
  }
  return null;
}

/** Posiciones de los vehículos (VehiclePosition). */
export function decodePositions(buf: Uint8Array): VehicleReport[] {
  const r = new Reader(buf);
  const out: VehicleReport[] = [];
  for (const e of entities(r)) {
    let entityId = "";
    let tripId: string | undefined, routeId = "", stopId: string | undefined;
    let lat = NaN, lon = NaN, ts = 0;
    let vid: string | undefined, label: string | undefined, plate: string | undefined;
    for (const f of r.fields(e)) {
      if (f.field === 1) entityId = r.text(f.range);
      if (f.field !== 4 || f.wire !== 2) continue;
      for (const v of r.fields(f.range)) {
        if (v.field === 1)
          for (const t of r.fields(v.range)) {
            if (t.field === 1) tripId = r.text(t.range);
            if (t.field === 5) routeId = r.text(t.range);
          }
        else if (v.field === 2)
          for (const p of r.fields(v.range)) {
            if (p.field === 1) lat = p.num;
            if (p.field === 2) lon = p.num;
          }
        else if (v.field === 5) ts = v.num;
        else if (v.field === 7) stopId = r.text(v.range);
        else if (v.field === 8)
          for (const d of r.fields(v.range)) {
            if (d.field === 1) vid = r.text(d.range);
            if (d.field === 2) label = r.text(d.range);
            if (d.field === 3) plate = r.text(d.range);
          }
      }
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({
      id: vid ?? (entityId || `${lat},${lon}`),
      plate, label, routeId, tripId, nextStopId: stopId,
      position: { lat, lon }, reportedAt: ts,
    });
  }
  return out;
}

/** Retrasos y próximas llegadas (TripUpdate). */
export function decodeTripUpdates(buf: Uint8Array): TripUpdate[] {
  const r = new Reader(buf);
  const out: TripUpdate[] = [];
  for (const e of entities(r)) {
    for (const f of r.fields(e)) {
      if (f.field !== 3 || f.wire !== 2) continue;
      let tripId = "", routeId: string | undefined, delay: number | null = null, ts: number | undefined;
      let next: TripUpdate["nextStop"];
      let stopDelay: number | null = null;
      for (const u of r.fields(f.range)) {
        if (u.field === 1)
          for (const t of r.fields(u.range)) {
            if (t.field === 1) tripId = r.text(t.range);
            if (t.field === 5) routeId = r.text(t.range);
          }
        else if (u.field === 2 && !next) {
          let stopId = "", at: number | undefined;
          for (const s of r.fields(u.range)) {
            if (s.field === 4) stopId = r.text(s.range);
            if (s.field === 2 || s.field === 3)
              for (const a of r.fields(s.range)) {
                if (a.field === 2) at = a.num;
                if (a.field === 1) stopDelay = a.num;
              }
          }
          if (stopId) next = { stopId, arrivalAt: at };
        } else if (u.field === 4) ts = u.num;
        else if (u.field === 5) delay = u.num;
      }
      if (tripId) out.push({ tripId, routeId, delaySeconds: delay ?? stopDelay, nextStop: next, reportedAt: ts });
    }
  }
  return out;
}

/** Avisos de servicio (Alert). */
export function decodeAlerts(buf: Uint8Array): ServiceAlert[] {
  const r = new Reader(buf);
  const out: ServiceAlert[] = [];
  const translated = (range: readonly [number, number]) => {
    for (const t of r.fields(range))
      if (t.field === 1) for (const x of r.fields(t.range)) if (x.field === 1) return r.text(x.range);
    return "";
  };
  let id = 0;
  for (const e of entities(r)) {
    for (const f of r.fields(e)) {
      if (f.field !== 5 || f.wire !== 2) continue;
      const routes = new Set<string>(), stops = new Set<string>();
      let effect = 0, headline = "", description = "", start: number | undefined, end: number | undefined;
      for (const a of r.fields(f.range)) {
        if (a.field === 1)
          for (const p of r.fields(a.range)) {
            if (p.field === 1) start = p.num;
            if (p.field === 2) end = p.num;
          }
        else if (a.field === 5)
          for (const ie of r.fields(a.range)) {
            if (ie.field === 2) routes.add(r.text(ie.range));
            if (ie.field === 5) stops.add(r.text(ie.range));
          }
        else if (a.field === 7) effect = a.num;
        else if (a.field === 10) headline = translated(a.range);
        else if (a.field === 11) description = translated(a.range);
      }
      out.push({
        id: id++, headline, description, effect: ALERT_EFFECT_BY_CODE[effect] ?? "other",
        routeIds: [...routes], stopIds: [...stops], startsAt: start, endsAt: end,
      });
    }
  }
  return out;
}

export { FeedDecodeError };
