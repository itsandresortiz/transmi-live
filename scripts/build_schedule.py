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
    shape_count, first_trip, trip_info = Counter(), {}, {}
    for r in rows(z, "trips.txt"):
        key = (r["route_id"], r.get("direction_id", ""), r.get("shape_id", ""))
        shape_count[key] += 1
        first_trip.setdefault(key, r["trip_id"])
        trip_info[r["trip_id"]] = (r["route_id"], day.get(r["service_id"], "wk"))
    best = {}
    for (rid, d, sh), n in shape_count.items():
        cur = best.get((rid, d))
        if cur is None or n > cur[0]: best[(rid, d)] = (n, sh, first_trip[(rid, d, sh)])
    rep = {}                      # route_id -> trip representativo (si una ruta tiene dos sentidos, el de más viajes)
    for (rid, d), (n, sh, tid) in best.items():
        if rid not in rep or n > rep[rid][0]: rep[rid] = (n, tid)
    rep_trip = {rid: tid for rid, (n, tid) in rep.items()}
    rep_ids = set(rep_trip.values())

    # paso 1: paradas del viaje representativo, en orden
    stops_of = defaultdict(list)
    for r in rows(z, "stop_times.txt"):
        if r["trip_id"] in rep_ids: stops_of[r["trip_id"]].append((int(r["stop_sequence"]), r["stop_id"]))
    seq = {rid: [s for _, s in sorted(stops_of[tid])] for rid, tid in rep_trip.items() if tid in stops_of}
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
        if rid not in seq: return
        buf.sort()
        start = buf[0][2]
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

    # --- primera y última parada de cada viaje (stop_times.txt NO viene agrupado por viaje, así que se acumula por viaje) ---
    first, last_t = {}, {}
    for r in rows(z, "stop_times.txt"):
        t, q = r["trip_id"], int(r["stop_sequence"])
        f = first.get(t)
        if f is None or q < f[0]: first[t] = (q, secs(r["arrival_time"]), r["stop_id"])
        l = last_t.get(t)
        if l is None or q > l: last_t[t] = q
    # primer y último viaje por ruta y tipo de día, según su salida del primer punto del recorrido
    ends = {}
    groups = defaultdict(lambda: defaultdict(list))      # (ruta, primera parada) -> tipo de día -> [(salida, viaje)]
    for t, (q, st, stop) in first.items():
        rid, dtype = trip_info.get(t, (None, None))
        if rid is None: continue
        e = ends.setdefault((rid, dtype), [(st, t), (st, t)])
        if st < e[0][0]: e[0] = (st, t)
        if st > e[1][0]: e[1] = (st, t)
        groups[(rid, stop)][dtype].append((st, t))
    # variantes de recorrido de cada ruta = viajes que salen de la misma primera parada (sirve aunque direction_id venga vacío)
    by_route = defaultdict(list)
    for (rid, stop), d in groups.items(): by_route[rid].append((sum(len(v) for v in d.values()), stop))
    keep = {}
    for rid, lst in by_route.items():
        top = max(n for n, _ in lst)
        for n, stop in lst:
            if n >= max(3, top * 0.1): keep[(rid, stop)] = n
    sample_ids = {}
    for t, (rid, dtype) in trip_info.items():
        f = first.get(t)
        if f and (rid, f[2]) in keep:
            lst = sample_ids.setdefault((rid, f[2]), [])
            if len(lst) < 4: lst.append(t)
    want = {t for lst in sample_ids.values() for t in lst}
    rows_of = defaultdict(list)
    for r in rows(z, "stop_times.txt"):
        if r["trip_id"] in want: rows_of[r["trip_id"]].append((int(r["stop_sequence"]), r["stop_id"], secs(r["arrival_time"])))
    dep = {"v": 2, "routes": {}}
    for (rid, stop), tids in sample_ids.items():
        runs = []
        for t in tids:
            rr = sorted(rows_of.get(t, []))
            if len(rr) >= 2: runs.append(([x[1] for x in rr], [x[2] - rr[0][2] for x in rr]))
        if not runs: continue
        stops = runs[0][0]
        offs = [o for ss, o in runs if ss == stops]
        entry = {"stops": stops, "off": [round(statistics.median(c)) for c in zip(*offs)]}
        for dtype in ("wk", "sa", "su"):
            v = sorted(st for st, _ in groups[(rid, stop)].get(dtype, []))
            if v: entry[dtype] = [v[0]] + [b - a for a, b in zip(v, v[1:])]
        dep["routes"].setdefault(rid, {})[stop] = entry
    with open(dst.replace("schedule", "departures"), "w") as f:
        json.dump(dep, f, separators=(",", ":"))
    print("rutas con horas de paso:", len(dep["routes"]), "variantes", sum(len(v) for v in dep["routes"].values()), "viajes con primera parada", len(first))

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
