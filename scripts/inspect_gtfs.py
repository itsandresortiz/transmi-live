#!/usr/bin/env python3
"""Inspección temporal: ¿el GTFS trae horarios por parada? ¿coinciden con los viajes en vivo?"""
import csv, io, sys, zipfile, collections
z = zipfile.ZipFile(sys.argv[1])
print("ARCHIVOS", [(i.filename, i.file_size) for i in z.infolist()])
def rows(name):
    with z.open(name) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig", newline=""))
live = ["TTBD21837.2.13173","TTBD20507.9.13826","CN4320006.4.13514","CD2790010.4.12894","KE4740022.3.13945","CO2990014.4.13092","CE0AF0004.15.10684","TC5EF0022.5.12956"]
with z.open("stop_times.txt") as f:
    head = io.TextIOWrapper(f, encoding="utf-8-sig").readline().strip()
print("STOP_TIMES_CABECERA", head)
n = 0; with_time = 0; sample = []; trips_with = collections.Counter(); live_found = {}
for r in rows("stop_times.txt"):
    n += 1
    if r.get("arrival_time"): with_time += 1
    if len(sample) < 6: sample.append(r)
    if r["trip_id"] in live and r["trip_id"] not in live_found:
        live_found[r["trip_id"]] = []
    if r["trip_id"] in live_found and len(live_found[r["trip_id"]]) < 5:
        live_found[r["trip_id"]].append((r["stop_sequence"], r["stop_id"], r.get("arrival_time"), r.get("departure_time")))
print("STOP_TIMES filas", n, "con arrival_time", with_time)
print("MUESTRA", sample)
print("VIAJES_EN_VIVO_ENCONTRADOS", len(live_found), "de", len(live))
for k, v in live_found.items(): print("  ", k, v)
if "frequencies.txt" in [i.filename.split("/")[-1] for i in z.infolist()]:
    fr = list(rows([i.filename for i in z.infolist() if i.filename.endswith("frequencies.txt")][0]))
    print("FREQUENCIES", len(fr), fr[:3])
else:
    print("FREQUENCIES no existe")
for nm in ("calendar.txt", "calendar_dates.txt"):
    hit = [i.filename for i in z.infolist() if i.filename.endswith(nm)]
    if hit:
        rs = list(rows(hit[0])); print(nm.upper(), len(rs), rs[:3])
trips = list(rows("trips.txt"))
print("TRIPS", len(trips), trips[:2])
sc = collections.Counter(t.get("service_id") for t in trips)
print("SERVICE_IDS", sc.most_common(10))
