# İzi km penceresine kırp: kirp.py girdi.json cikti.json bas_km bit_km
import sys, json, math
src, dst, a, b = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
P = json.load(open(src))['points']
def hav(p, q):
    R = 6371000; r = math.pi / 180; dla = (q['lat'] - p['lat']) * r; dlo = (q['lon'] - p['lon']) * r
    x = math.sin(dla / 2) ** 2 + math.cos(p['lat'] * r) * math.cos(q['lat'] * r) * math.sin(dlo / 2) ** 2
    return 2 * R * math.asin(math.sqrt(x))
d = 0; out = []
for i, p in enumerate(P):
    if i: d += hav(P[i - 1], p)
    if a * 1000 <= d <= b * 1000: out.append(p)
json.dump({'points': out}, open(dst, 'w')); print(dst, len(out), 'nokta', round((out[-1]['t'] - out[0]['t'])), 'sn')
