#!/usr/bin/env python3
"""ms-binalar.db → R2 `harita-match-cache/ms-bina/15/{x}/{y}.json` (02.09, sunucusuzlaştırma).

Worker'daki `src/harman.js` (mvt_bina.py portu) Microsoft ML binalarını sunucudaki SQLite yerine
buradan okur. Satır SIRASI birebir: SQLite `ix(x15,y15)` indeksinin verdiği (x15, y15, rowid) —
z13/14 harmanı x15-dış/y15-iç gezerek aynı sırayı üretir.

Kayıt: [[cx, cy, pid, poly], ...]   (poly = [[lon, lat], ...])
  pid = 800000000 + (abs(hash((round(cx,6), round(cy,6)))) % 90000000)  ← Python tuple hash'i
  JS'te üretilemez (renk paletini seçer) → BURADA hesaplanır. Float→JSON repr → JS'te aynı double.

Kullanım:  ms-bina-r2-export.py [--out DIR] [--upload]   (upload = rclone copy → r2:harita-match-cache)
Tek seferlik; DB değişmedikçe tekrar gerekmez (DB 720.605 satır, 5.945 z15 karo).
"""
import argparse, json, os, sqlite3, subprocess, sys, time

DB = "/opt/matrix/harita-yukseklik/ms-binalar.db"
HEDEF = "r2:harita-match-cache/ms-bina/15"

ap = argparse.ArgumentParser()
ap.add_argument("--db", default=DB)
ap.add_argument("--out", required=True)
ap.add_argument("--upload", action="store_true")
a = ap.parse_args()

c = sqlite3.connect(a.db)
t0 = time.time()
n_karo = n_satir = 0
# İndeks sırasıyla tek geçiş (ORDER BY x15,y15,rowid = ix sırası; ayrıca açıkça yazıldı)
cur = c.execute("SELECT x15,y15,cx,cy,poly FROM ms ORDER BY x15,y15,rowid")
mevcut = None
kayit = []

def yaz(k, rows):
    global n_karo
    x, y = k
    d = os.path.join(a.out, str(x))
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, f"{y}.json"), "w") as f:
        json.dump(rows, f, separators=(",", ":"))
    n_karo += 1

for x15, y15, cx, cy, pj in cur:
    k = (x15, y15)
    if k != mevcut:
        if mevcut is not None:
            yaz(mevcut, kayit)
        mevcut, kayit = k, []
    pid = 800000000 + (abs(hash((round(cx, 6), round(cy, 6)))) % 90000000)
    kayit.append([cx, cy, pid, json.loads(pj)])
    n_satir += 1
if mevcut is not None:
    yaz(mevcut, kayit)
c.close()
print(f"yazıldı: {n_karo} karo, {n_satir} satır, {time.time()-t0:.1f} sn → {a.out}", flush=True)

if a.upload:
    # rclone: yalnız Move Log'un kendi kovası (harita-match-cache); hooder-* kovalarına YAZILMAZ
    r = subprocess.run(["rclone", "copy", "--transfers", "32", "--checkers", "32", "--no-traverse",
                        a.out, HEDEF], capture_output=True, text=True)
    print("rclone:", r.returncode, (r.stderr or r.stdout)[-400:], flush=True)
    sys.exit(r.returncode)
