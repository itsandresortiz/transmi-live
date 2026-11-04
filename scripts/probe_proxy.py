#!/usr/bin/env python3
"""Prueba el intermediario de Supabase: respuesta, CORS, tamaño, frescura del dato y tiempos."""
import gzip, json, sys, time, urllib.request

BASE = sys.argv[1].rstrip("/")

def varint(b, p):
    r = m = 0
    while True:
        x = b[p]; p += 1; r += (x & 127) << m; m += 7
        if x < 128:
            return r, p

def fields(b, s=0, e=None):
    e = len(b) if e is None else e; p = s; out = []
    while p < e:
        k, p = varint(b, p); f, w = k >> 3, k & 7
        if w == 0: v, p = varint(b, p); out.append((f, w, v))
        elif w == 2: l, p = varint(b, p); out.append((f, w, (p, p + l))); p += l
        elif w == 5: p += 4
        elif w == 1: p += 8
        else: break
    return out

def batch_ts(b):
    for f, w, v in fields(b):
        if f == 2:
            for f2, _, v2 in fields(b, *v):
                if f2 == 4:
                    for f3, _, x in fields(b, *v2):
                        if f3 == 5: return x
    return 0

def get(path, gz=False):
    h = {"User-Agent": "probe", "Origin": "https://itsandresortiz.github.io"}
    if gz: h["Accept-Encoding"] = "gzip"
    t = time.time()
    try:
        r = urllib.request.urlopen(urllib.request.Request(BASE + path, headers=h), timeout=40)
        body = r.read(); dt = time.time() - t
        if r.headers.get("content-encoding") == "gzip": body = gzip.decompress(body)
        return r.status, {k.lower():v for k,v in r.headers.items()}, body, dt
    except urllib.error.HTTPError as e:
        return e.code, {k.lower():v for k,v in e.headers.items()}, e.read(), time.time() - t

print("== preflight (lo que hace el navegador antes del GET con cache:no-store)")
rq = urllib.request.Request(BASE + "/meta", method="OPTIONS", headers={"Origin": "https://itsandresortiz.github.io", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "cache-control,pragma", "User-Agent": "probe"})
try:
    r = urllib.request.urlopen(rq, timeout=30)
    print("OPTIONS", r.status, {k.lower(): v for k, v in r.headers.items() if k.lower().startswith("access-control")})
except urllib.error.HTTPError as e:
    print("OPTIONS", e.code, e.read()[:200])
print("== meta x3 (cada 6 s)")
last = None
for i in range(3):
    st, h, body, dt = get("/meta")
    print(f"{time.strftime('%H:%M:%S')} HTTP {st} {dt:.2f}s  {body[:140].decode(errors='replace')}")
    if i == 0: print("   GET CORS:", h.get("access-control-allow-origin"), "| content-type:", h.get("content-type"))
    time.sleep(6)

print("== positions")
st, h, body, dt = get("/positions", gz=True)
if st == 200:
    ts = batch_ts(body)
    n = sum(1 for f, w, v in fields(body) if f == 2)
    print(f"HTTP {st} {dt:.2f}s  {len(body)} bytes descomprimido, {n} vehiculos, lote de hace {time.time()-ts:.0f}s, encoding={h.get('content-encoding')}")
else:
    print("HTTP", st, body[:300].decode(errors="replace"))
for name in ("tripupdates", "alerts"):
    st, h, body, dt = get("/" + name, gz=True)
    print(f"{name}: HTTP {st} {dt:.2f}s {len(body)} bytes")
