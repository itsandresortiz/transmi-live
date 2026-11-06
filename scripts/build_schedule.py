#!/usr/bin/env python3
"""Perfil de tiempos por tramo sacado del horario programado (stop_times.txt) del GTFS.

Para cada ruta y su recorrido representativo (el mismo que usa gtfs-lite.zip) guarda:
  - seg:   segundos típicos de cada tramo entre paradas consecutivas (mediana de todos los viajes),
  - scale: cuánto más lento o rápido se programa por tipo de día y franja horaria (1 = típico).
Uso: python3 scripts/build_schedule.py GTFS.zip schedule.json
"""
import csv, io, json, statistics, sys, zipfile
from collections import Counter, defaultdict

BUCKETS = [(0, 5), (5, 7), (7, 9), (9, 12), (12, 15), (15, 17), (17, 20), (20, 48)]   # horas del día (el horario pasa de 24 h)

def bucket(h):
    for i, (a, b) in enumerate(BUCKETS):
        if a <= h < b: return i
    return len(BUCKETS) - 1

def rows(z, name):
    hit = [n for n in z.namelist() if n.split("/")[-1] == name]
    with z.open(hit[0]) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig", newline=""))

def secs(t):
    h, m, s = t.split(":")
    return int(h) * 3600 + int(m) * 60 + int(s)

def main(src, dst):
    z = zipfile.ZipFile(src)
    # tipo de día de cada servicio
    day = {}
    for r in rows(z, "calendar.txt"):
        wk = any(r[d] == "1" for d in ("monday", "tuesday", "wednesday", "thursday", "friday"))
        day[r["service_id"]] = "wk" if wk else ("sa" if r["saturday"] == "1" and r["sunday"] != "1" else "su")
        if r["saturday"] == "1" and r["sunday"] == "1": day[r["service_id"]] = "su"
    # fechas con un horario distinto al de su día de la semana (festivos): fecha -> tipo de día de los servicios que se agregan
    special = defaultdict(Counter)
    try:
        for r in rows(z, "calendar_dates.txt"):
            if r["exception_type"] == "1" and r["service_id"] in day: special[r["date"]][day[r["service_id"]]] += 1
    except IndexError:
        pass
    dates = {d: c.most_common(1)[0][0] for d, c in special.items()}
    # viaje representativo por ruta y sentido (igual que slim_gtfs.py)
    shape_count, first_trip, trip_info, trip_meta = Counter(), {}, {}, {}
    for r in rows(z, "trips.txt"):
        key = (r["route_id"], r.get("direction_id", ""), r.get("shape_id", ""))
        shape_count[key] += 1
        first_trip.setdefault(key, r["trip_id"])
        trip_info[r["trip_id"]] = (r["route_id"], day.get(r["service_id"], "wk"))
        trip_meta[r["trip_id"]] = (r["route_id"], day.get(r["service_id"], "wk"), r.get("direction_id", ""), r.get("shape_id", ""))
    best = {}
    for (rid, d, sh), n in shape_count.items():
        cur = best.get((rid, d))
        if cur is None or n > cur[0]: best[(rid, d)] = (n, sh, first_trip[(rid, d, sh)])
    rep = {}                      # route_id -> trip representativo (si una ruta tiene dos sentidos, el de más viajes)
    for (rid, d), (n, sh, tid) in best.items():
        if rid not in rep or n > rep[rid][0]: rep[rid] = (n, tid)
    rep_trip = {rid: tid for rid, (n, tid) in rep.items()}
    rep_ids = set(rep_trip.values())
    # recorrido principal de cada ruta en CADA sentido (para las horas de paso por parada)
    dir_shape = {k: v[1] for k, v in best.items()}
    dir_trip = {k: v[2] for k, v in best.items()}
    dir_ids = set(dir_trip.values())

    # paso 1: paradas del viaje representativo, en orden
    stops_of = defaultdict(list)
    for r in rows(z, "stop_times.txt"):
        if r["trip_id"] in rep_ids or r["trip_id"] in dir_ids: stops_of[r["trip_id"]].append((int(r["stop_sequence"]), r["stop_id"]))
    seq = {rid: [s for _, s in sorted(stops_of[tid])] for rid, tid in rep_trip.items() if tid in stops_of}
    dir_stops = {k: [st for _, st in sorted(stops_of[t])] for k, t in dir_trip.items() if t in stops_of}
    starts = defaultdict(list)    # (ruta, sentido, tipo de día) -> salidas (segundos) de los viajes del recorrido principal
    offs = defaultdict(list)      # (ruta, sentido) -> [segundos desde la salida hasta cada parada] de unos cuantos viajes
    pair = {}                     # (ruta, parada_i, parada_i+1) -> índice del tramo
    for rid, ss in seq.items():
        for i in range(len(ss) - 1): pair[(rid, ss[i], ss[i + 1])] = i

    # paso 2: tiempos de tramo de todos los viajes (cada tramo entre paradas consecutivas del recorrido representativo)
    samples = defaultdict(list)   # (ruta, tramo) -> [(segundos, tipo de día, franja)]
    ends = {}                     # (ruta, tipo de día) -> [(salida más temprana, viaje), (salida más tardía, viaje)]
    cur_trip, buf = None, []
    def flush():
        if not buf: return
        rid, dtype = trip_info.get(cur_trip, (None, "wk"))
        buf.sort()
        start = buf[0][2]
        meta = trip_meta.get(cur_trip)
        if meta and dir_shape.get((meta[0], meta[2])) == meta[3]:
            k = (meta[0], meta[2])
            starts[(k[0], k[1], meta[1])].append(start)
            if len(offs[k]) < 30 and [st for _, st, _ in buf] == dir_stops.get(k): offs[k].append([t - start for _, _, t in buf])
        if rid not in seq: return
        e = ends.setdefault((rid, dtype), [(start, cur_trip), (start, cur_trip)])
        if start < e[0][0]: e[0] = (start, cur_trip)
        if start > e[1][0]: e[1] = (start, cur_trip)
        for (a_seq, a_stop, a_t), (b_seq, b_stop, b_t) in zip(buf, buf[1:]):
            i = pair.get((rid, a_stop, b_stop))
            if i is None: continue
            d = b_t - a_t
            if 5 <= d <= 1800: samples[(rid, i)].append((d, dtype, bucket(a_t // 3600)))
    for r in rows(z, "stop_times.txt"):
        if r["trip_id"] != cur_trip:
            flush(); cur_trip, buf = r["trip_id"], []
        buf.append((int(r["stop_sequence"]), r["stop_id"], secs(r["arrival_time"])))
    flush()

    out = {"v": 1, "buckets": [list(b) for b in BUCKETS], "routes": {}}
    scale_acc = defaultdict(lambda: defaultdict(list))     # ruta -> (tipo, franja) -> [razón]
    for rid, ss in seq.items():
        seg = []
        for i in range(len(ss) - 1):
            ds = samples.get((rid, i))
            seg.append(round(statistics.median(d for d, _, _ in ds)) if ds else 0)
        for i in range(len(ss) - 1):
            if seg[i] <= 0: continue
            for d, dtype, b in samples[(rid, i)]: scale_acc[rid][(dtype, b)].append(d / seg[i])
        scale = {}
        for dtype in ("wk", "sa", "su"):
            row = []
            for b in range(len(BUCKETS)):
                v = scale_acc[rid].get((dtype, b))
                row.append(round(statistics.median(v), 2) if v and len(v) >= 5 else 0)
            scale[dtype] = row
        out["routes"][rid] = {"stops": ss, "seg": seg, "scale": scale}
    with open(dst, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    # primer y último viaje programado de cada ruta por tipo de día: sirve para marcar «último servicio»
    se = {"v": 2, "routes": {}, "dates": dates}
    for (rid, dtype), (first, last) in ends.items():
        r = se["routes"].setdefault(rid, {})
        r[dtype] = {"first": [first[1], first[0]], "last": [last[1], last[0]]}
    # horas de salida de cada ruta y sentido (recorrido principal) y cuánto tarda en llegar a cada parada
    dep = {"v": 1, "routes": {}}
    for (rid, d), ss in dir_stops.items():
        samples_o = offs.get((rid, d))
        if not samples_o: continue
        off = [round(statistics.median(col)) for col in zip(*samples_o)]
        entry = {"stops": ss, "off": off}
        for dtype in ("wk", "sa", "su"):
            v = sorted(starts.get((rid, d, dtype), []))
            if v: entry[dtype] = [v[0]] + [b - a for a, b in zip(v, v[1:])]
        dep["routes"].setdefault(rid, {})[d or "0"] = entry
    with open(dst.replace("schedule", "departures"), "w") as f:
        json.dump(dep, f, separators=(",", ":"))
    print("rutas con horas de paso:", len(dep["routes"]))
    with open(dst.replace("schedule", "service-ends"), "w") as f:
        json.dump(se, f, separators=(",", ":"))
    print("rutas con primer/último viaje:", len(se["routes"]))
    import os
    n_seg = sum(len(r["seg"]) for r in out["routes"].values())
    print("rutas", len(out["routes"]), "tramos", n_seg, "bytes", os.path.getsize(dst))
    # ejemplo legible
    for rid, r in list(out["routes"].items())[:3]:
        print("ejemplo", rid, r["seg"][:8], r["scale"]["wk"])

if __name__ == "__main__":
    if len(sys.argv) != 3: sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
