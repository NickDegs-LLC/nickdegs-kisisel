# OSRM (public demo) -> 25 m seyreltilmiş iz + gerçekçi zaman damgası. Kullanım: rota.py ad kmh "lon,lat;lon,lat;..."
import sys, json, math, urllib.request, time
ad, kmh, wp = sys.argv[1], float(sys.argv[2]), sys.argv[3]
u = "https://router.project-osrm.org/route/v1/driving/%s?overview=full&geometries=geojson&continue_straight=true" % wp
j = json.load(urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'movelog-promo/1.0'}), timeout=60))
if j.get('code') != 'Ok' or not j.get('routes'): raise SystemExit('OSRM rota yok: ' + str(j)[:200])
co = j['routes'][0]['geometry']['coordinates']; dist = j['routes'][0]['distance']
def hav(a, b):
    R = 6371000; r = math.pi / 180; dla = (b[1] - a[1]) * r; dlo = (b[0] - a[0]) * r
    x = math.sin(dla / 2) ** 2 + math.cos(a[1] * r) * math.cos(b[1] * r) * math.sin(dlo / 2) ** 2
    return 2 * R * math.asin(math.sqrt(x))
# 25 m'de bir nokta (ara enterpolasyon)
pts = [co[0]]; acc = 0.0
for a, b in zip(co, co[1:]):
    d = hav(a, b)
    if d == 0: continue
    n = int((acc + d) // 25)
    for k in range(1, n + 1):
        s = (k * 25 - acc) / d
        if 0 < s <= 1: pts.append([a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s])
    acc = (acc + d) % 25
pts.append(co[-1])
t0 = 1790000000.0; v = kmh / 3.6; t = t0; out = []
for i, p in enumerate(pts):
    if i: t += hav(pts[i - 1], p) / v
    out.append({"lat": round(p[1], 6), "lon": round(p[0], 6), "t": round(t, 1), "spd": round(v * 1.94384, 1)})
json.dump({"points": out}, open(ad + ".json", "w"))
print("%s: %.1f km, %d nokta, %d sn sürüş (%.0f km/sa)" % (ad, dist / 1000, len(out), t - t0, kmh))
