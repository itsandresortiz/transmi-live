#!/usr/bin/env python3
"""Mide el ritmo real de los lotes que entrega el intermediario: huecos, errores y movimiento por lote."""
import gzip, json, math, statistics, sys, time, urllib.request

BASE = sys.argv[1].rstrip("/"); DUR = int(sys.argv[2]) if len(sys.argv) > 2 else 240

def req(path, gz=False):
    h = {"User-Agent": "probe"}
    if gz: h["Accept-Encoding"] = "gzip"
    t = time.time()
    try:
        r = urllib.request.urlopen(urllib.request.Request(BASE + path, headers=h), timeout=40)
        b = r.read()
        if r.headers.get("content-encoding") == "gzip": b = gzip.decompress(b)
        return r.status, b, time.time() - t
    except Exception as e:
        return getattr(e, "code", 0), str(e).encode(), time.time() - t

def varint(b, p):
    r = m = 0
    while True:
        x = b[p]; p += 1; r += (x & 127) << m; m += 7
        if x < 128: return r, p
def fields(b, s=0, e=None):
    import struct
    e = len(b) if e is None else e; p = s; out = []
    while p < e:
        k, p = varint(b, p); f, w = k >> 3, k & 7
        if w == 0: v, p = varint(b, p); out.append((f, w, v))
        elif w == 2: l, p = varint(b, p); out.append((f, w, (p, p + l))); p += l
        elif w == 5: out.append((f, w, struct.unpack("<f", b[p:p+4])[0])); p += 4
        elif w == 1: p += 8
        else: break
    return out
def parse(b):
    V = {}; ts = 0
    for f, w, v in fields(b):
        if f != 2: continue
        d = {}
        for f2, _, v2 in fields(b, *v):
            if f2 == 4:
                for f3, _, x in fields(b, *v2):
                    if f3 == 2:
                        for a, _, y in fields(b, *x):
                            if a == 1: d["lat"] = y
                            if a == 2: d["lon"] = y
                    if f3 == 5: d["ts"] = x
                    if f3 == 8:
                        for a, _, y in fields(b, *x):
                            if a == 1: d["id"] = b[y[0]:y[1]].decode()
        if "id" in d and "lat" in d: V[d["id"]] = d; ts = max(ts, d.get("ts", 0))
    return V, ts

def dist(a, b):
    return math.hypot((b["lat"]-a["lat"])*111320, (b["lon"]-a["lon"])*111320*math.cos(math.radians(a["lat"])))

t0 = time.time(); last_sig = None; last_V = None; last_ts = None; changes = []; errors = 0; polls = 0; lat = []
print(f"{'hora(UTC)':>9} {'evento':<8} detalle")
while time.time() - t0 < DUR:
    st, body, dt = req("/meta"); polls += 1; lat.append(dt)
    now = time.time()
    if st != 200:
        errors += 1; print(f"{time.strftime('%H:%M:%S', time.gmtime(now))} ERROR    meta HTTP {st} en {dt:.1f}s {body[:80]!r}")
    else:
        sig = json.loads(body).get("pos")
        if sig and sig != last_sig:
            st2, pb, dt2 = req("/positions?v=" + sig, gz=True)
            if st2 == 200:
                V, ts = parse(pb)
                moved = 0; total = 0
                if last_V:
                    for k, v in V.items():
                        if k in last_V:
                            total += 1
                            if dist(last_V[k], v) > 3: moved += 1
                gap = (ts - last_ts) if last_ts else 0
                changes.append((now, ts, gap))
                print(f"{time.strftime('%H:%M:%S', time.gmtime(now))} LOTE     ts={time.strftime('%H:%M:%S', time.gmtime(ts))} hueco_entre_lotes={gap:>3}s  detectado_{now-ts:>3.0f}s_despues  vehiculos={len(V)} se_movieron={moved}/{total}")
                last_V, last_ts = V, ts
            last_sig = sig
    time.sleep(3)
gaps = [g for _, _, g in changes if g > 0]
print("\n== resumen", f"({DUR}s, {polls} consultas, {errors} errores, latencia meta mediana {statistics.median(lat):.2f}s, max {max(lat):.2f}s)")
if gaps:
    gs = sorted(gaps)
    print(f"lotes nuevos: {len(changes)} | huecos entre lotes: min {gs[0]}s, mediana {statistics.median(gs):.0f}s, p90 {gs[int(.9*(len(gs)-1))]}s, max {gs[-1]}s")
    print(f"huecos > 25 s: {sum(1 for g in gaps if g > 25)} de {len(gaps)} | huecos > 40 s: {sum(1 for g in gaps if g > 40)}")
    # modelo de la pagina: el bus se desliza 1.3x el hueco anterior, luego espera
    quiet = 0.0; total_t = 0.0
    for i in range(1, len(gaps)):
        d = min(90, 1.3 * gaps[i-1]); g = gaps[i]; total_t += g; quiet += max(0, g - d)
    print(f"tiempo quieto estimado con el modelo actual (desliza 1.3x el hueco anterior): {100*quiet/max(total_t,1):.0f}% del tiempo")
