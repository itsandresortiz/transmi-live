#!/usr/bin/env python3
"""Reduce el GTFS.zip de TransMilenio (~116 MB) a un zip liviano que la app puede cargar.

Conserva: todas las rutas, todos los viajes (solo columnas útiles), todas las paradas,
y para cada ruta y sentido un viaje representativo con su trazado y su secuencia de paradas.

Uso: python3 scripts/slim_gtfs.py GTFS.zip gtfs-lite.zip
"""
import csv, io, sys, zipfile
from collections import Counter

def rows(z, name):
    hit = [n for n in z.namelist() if n.split("/")[-1] == name]
    if not hit:
        return
    with z.open(hit[0]) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig", newline=""))

def writer(cols):
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(cols)
    return buf, w

def main(src, dst):
    zin = zipfile.ZipFile(src)
    out = {}

    cols = ["route_id", "route_short_name", "route_long_name", "route_desc", "route_type", "route_color", "agency_id"]
    buf, w = writer(cols)
    for r in rows(zin, "routes.txt"):
        w.writerow([r.get(c, "") for c in cols])
    out["routes.txt"] = buf

    cols = ["route_id", "trip_id", "trip_headsign", "direction_id", "shape_id"]
    buf, w = writer(cols)
    shape_count = Counter()
    first_trip = {}
    trips = []
    for r in rows(zin, "trips.txt"):
        row = [r.get(c, "") for c in cols]
        w.writerow(row)
        key = (r["route_id"], r.get("direction_id", ""), r.get("shape_id", ""))
        shape_count[key] += 1
        first_trip.setdefault(key, r["trip_id"])
    out["trips.txt"] = buf

    best = {}
    for (rid, d, sh), n in shape_count.items():
        cur = best.get((rid, d))
        if cur is None or n > cur[0]:
            best[(rid, d)] = (n, sh, first_trip[(rid, d, sh)])
    rep_trips = {v[2] for v in best.values()}
    rep_shapes = {v[1] for v in best.values() if v[1]}

    cols = ["stop_id", "stop_code", "stop_name", "stop_desc", "stop_lat", "stop_lon"]
    buf, w = writer(cols)
    for r in rows(zin, "stops.txt"):
        w.writerow([r.get(c, "") for c in cols])
    out["stops.txt"] = buf

    cols = ["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence"]
    buf, w = writer(cols)
    for r in rows(zin, "shapes.txt"):
        if r["shape_id"] in rep_shapes:
            w.writerow([r.get(c, "") for c in cols])
    out["shapes.txt"] = buf

    cols = ["trip_id", "stop_id", "stop_sequence"]
    buf, w = writer(cols)
    for r in rows(zin, "stop_times.txt"):
        if r["trip_id"] in rep_trips:
            w.writerow([r.get(c, "") for c in cols])
    out["stop_times.txt"] = buf

    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zo:
        for name, buf in out.items():
            zo.writestr(name, buf.getvalue())
    print({n: len(b.getvalue()) for n, b in out.items()})

if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
