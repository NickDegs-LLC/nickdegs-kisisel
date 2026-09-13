#!/usr/bin/env python3
"""Traccar geçmişini D1 positions'a aktar (idempotent).

NEDEN: 31.08 kesiminde GPS ingest D1'e alındı ama TARİHSEL iz Traccar'da kaldı.
Dispatch, video işine izi D1'den dolduruyor → geçmiş olmadan ESKİ rotaların videosu
üretilemez ("iş 200 alır, boş döner"). Yeni rotalar etkilenmez (ingest zaten D1'e yazıyor).

Kullanım: positions_backfill.py [--gun 120] [--dry]
"""
import sys, os, json, base64, urllib.request, datetime as dt, subprocess, tempfile

GUN = int(next((a.split("=")[1] for a in sys.argv if a.startswith("--gun=")), "120"))
DRY = "--dry" in sys.argv
TR_CONF = "/etc/nickdegs/traccar.conf"

def tconf():
    c = {}
    for l in open(TR_CONF):
        if "=" in l and not l.strip().startswith("#"):
            k, v = l.strip().split("=", 1); c[k] = v.strip().strip('"')
    return c.get("TRACCAR_USER", "daclen10@gmail.com"), c.get("TRACCAR_PASS", "SIR_KALDIRILDI_bkz_etc_nickdegs_traccar_conf")

TU, TP = tconf()
def traccar(q):
    r = urllib.request.Request("http://127.0.0.1:8084/api" + q)
    r.add_header("Authorization", "Basic " + base64.b64encode(f"{TU}:{TP}".encode()).decode())
    return json.load(urllib.request.urlopen(r, timeout=90))

def ep(s):
    return int(dt.datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp())

def _cf_env():
    """wrangler kimliği: script kendi env'inde koştuğu için TOKEN'ı conf'tan okur.
    (31.08: bu eksikti -> 124.009 satır 'yazıldı' göründü ama D1'e HİÇBİRİ girmedi.)"""
    e = dict(os.environ)
    for l in open("/opt/matrix/secrets/movelog-cf.conf"):
        if l.startswith("MOVELOG_CF_TOKEN="): e["CLOUDFLARE_API_TOKEN"] = l.split("=",1)[1].strip()
        if l.startswith("MOVELOG_CF_ACCOUNT_ID="): e["CLOUDFLARE_ACCOUNT_ID"] = l.split("=",1)[1].strip()
    return e

_ENV = None
def d1(sql_dosya):
    global _ENV
    if DRY: return "(dry)"
    if _ENV is None: _ENV = _cf_env()
    r = subprocess.run(
        ["npx", "wrangler", "d1", "execute", "movelog-db", "--remote", "-y", "--file", sql_dosya],
        cwd="/opt/matrix/cf/gps", capture_output=True, text=True, env=_ENV)
    if r.returncode != 0:
        raise RuntimeError("D1 yazma BASARISIZ: " + (r.stderr or r.stdout)[-300:])
    return 0

simdi = int(dt.datetime.now(dt.UTC).timestamp())
bas = simdi - GUN * 86400
F = dt.datetime.fromtimestamp(bas, dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
T = dt.datetime.fromtimestamp(simdi, dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

devs = traccar("/devices")
print(f"  {len(devs)} cihaz · son {GUN} gün ({F} → {T})")
toplam = 0
for d in devs:
    did, ad = d["id"], d.get("name", "?")
    try:
        pos = traccar(f"/positions?deviceId={did}&from={F}&to={T}")
    except Exception as e:
        print(f"   {ad:22s} ATLANDI ({str(e)[:40]})"); continue
    if not pos:
        print(f"   {ad:22s} 0 nokta"); continue
    # uniqueId = telefonun gönderdiği tracker id (D1 users.tracker_id ile eşleşen)
    dev = str(d.get("uniqueId") or did)
    satir = []
    for p in pos:
        t = ep(p.get("fixTime") or p.get("deviceTime"))
        a = p.get("attributes") or {}
        satir.append("({},{},{},{},{},{},{},{},{},{})".format(
            "'" + dev.replace("'", "") + "'", t, p["latitude"], p["longitude"],
            p.get("speed") or 0, p.get("altitude") or 0, p.get("accuracy") or 0,
            p.get("course") or 0,
            int(a.get("batteryLevel") or 0) if a.get("batteryLevel") is not None else "NULL",
            1 if a.get("charge") else 0))
    # parça parça yaz (D1 dosya sınırı)
    for i in range(0, len(satir), 400):   # 31.08: 2000 -> SQLITE_TOOBIG
        parca = satir[i:i + 400]
        govde = ",".join(x[:-1] + f",{simdi})" for x in parca)
        sql = ("INSERT OR IGNORE INTO positions "
               "(device,ts,lat,lon,spd,alt,acc,brg,batt,charge,created_at) VALUES " + govde)
        with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False) as f:
            f.write(sql + ";\n"); yol = f.name
        d1(yol); os.unlink(yol)
    toplam += len(satir)
    print(f"   {ad:22s} {len(satir):6d} nokta → dev={dev}")
print(f"  TOPLAM: {toplam} nokta")
