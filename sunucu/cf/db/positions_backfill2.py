#!/usr/bin/env python3
"""Traccar geçmişini D1 positions'a aktar — dayanıklı + gerçekten idempotent.

NEDEN YENİ BETİK (2026-09-01): positions_backfill.py iki noktada yetersizdi.
  1) İlk D1 hatasında `raise` edip TÜM döngüyü kesiyordu → 31.08 turunda yalnız ilk birkaç
     cihaz geçti, Semra dahil çoğu kullanıcı aktarılmadı (video isteği boş izle gidip öldü).
  2) `INSERT OR IGNORE` mükerreri engellemiyor: (device,ts) indeksi UNIQUE DEĞİL.
     Betiği tekrar koşturmak noktaları ikizliyordu (D1'de hâlihazırda 9316 fazla satır var).

BU BETİK:
  - cihaz başına try/except: biri patlarsa diğerleri devam eder, sonda özet verir
  - D1'de o cihaz için VAR OLAN ts'leri okur, yalnız eksik olanları yazar (şema değişikliği yok)
  - Traccar'ı pencereye bölerek çeker (uzun aralıkta bellek/timeout riski)
  - yalnız Move Log kullanıcısına bağlı cihazları alır (users.tracker_id) — başka projelerin
    cihazlarına dokunmaz

Kullanım:
  positions_backfill2.py --dry                 # hiçbir şey yazmaz, ne yapacağını gösterir
  positions_backfill2.py --cihaz 70251257      # tek cihaz
  positions_backfill2.py                       # tüm Move Log cihazları
  [--gun 400] [--pencere 15]
"""
import sys, os, json, base64, urllib.request, datetime as dt, subprocess, tempfile

GUN = int(next((a.split("=")[1] for a in sys.argv if a.startswith("--gun=")), "400"))
PENCERE = int(next((a.split("=")[1] for a in sys.argv if a.startswith("--pencere=")), "15"))
TEK = next((a.split("=")[1] for a in sys.argv if a.startswith("--cihaz=")), None)
DRY = "--dry" in sys.argv
TR_CONF = "/etc/nickdegs/traccar.conf"
PARCA = 400          # 31.08: 2000 -> SQLITE_TOOBIG


def tconf():
    c = {}
    for l in open(TR_CONF):
        if "=" in l and not l.strip().startswith("#"):
            k, v = l.strip().split("=", 1)
            c[k] = v.strip().strip('"')
    return c.get("TRACCAR_USER", ""), c.get("TRACCAR_PASS", "")


TU, TP = tconf()


def traccar(q, timeout=120):
    r = urllib.request.Request("http://127.0.0.1:8084/api" + q)
    r.add_header("Authorization", "Basic " + base64.b64encode(f"{TU}:{TP}".encode()).decode())
    r.add_header("Accept", "application/json")
    return json.load(urllib.request.urlopen(r, timeout=timeout))


def ep(s):
    return int(dt.datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp())


_ENV = None


def cf_env():
    """wrangler kimliği conf'tan — script kendi env'inde koşuyor.
    (31.08: bu eksikti → 124.009 satır 'yazıldı' göründü ama D1'e hiçbiri girmedi.)"""
    global _ENV
    if _ENV is None:
        e = dict(os.environ)
        for l in open("/opt/matrix/secrets/movelog-cf.conf"):
            if l.startswith("MOVELOG_CF_TOKEN="):
                e["CLOUDFLARE_API_TOKEN"] = l.split("=", 1)[1].strip()
            if l.startswith("MOVELOG_CF_ACCOUNT_ID="):
                e["CLOUDFLARE_ACCOUNT_ID"] = l.split("=", 1)[1].strip()
        _ENV = e
    return _ENV


def _cagir(cmd, timeout=300):
    r = subprocess.run(cmd, cwd="/opt/matrix/cf/gps", capture_output=True, text=True,
                       env=cf_env(), timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout)[-260:])
    return r.stdout


def d1_oku(sql):
    """Okuma --command ile: --file + --json birlikte JSON döndürmüyor (kuru turda patladı)."""
    out = _cagir(["npx", "wrangler", "d1", "execute", "movelog-db", "--remote", "-y",
                  "--json", "--command", sql])
    d = json.loads(out[out.index("["):] if out.lstrip().startswith("[") else out)
    return (d[0] if isinstance(d, list) else d["result"][0])["results"]


def d1_yaz(sql):
    """Yazma --file ile: toplu INSERT komut satırı sınırını aşıyor."""
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False) as f:
        f.write(sql + ";\n")
        yol = f.name
    try:
        _cagir(["npx", "wrangler", "d1", "execute", "movelog-db", "--remote", "-y", "--file", yol])
    finally:
        os.unlink(yol)


def mevcut_ts(dev, bas, son):
    """D1'de bu cihaz+aralıkta ZATEN olan ts kümesi — mükerrer yazmamak için."""
    r = d1_oku(f"SELECT ts FROM positions WHERE device='{dev}' AND ts BETWEEN {bas} AND {son}")
    return {int(x["ts"]) for x in r}


simdi = int(dt.datetime.now(dt.UTC).timestamp())
bas_ts = simdi - GUN * 86400

hedef = json.load(open("/tmp/trackers.json"))
if TEK:
    hedef = {k: v for k, v in hedef.items() if k == TEK}

devs = traccar("/devices")
esle = {str(d.get("uniqueId")): d["id"] for d in devs}

print(f"  {len(hedef)} cihaz · son {GUN} gün · {PENCERE} günlük pencerelerle"
      + ("  [KURU]" if DRY else ""))
toplam_yeni = toplam_atlanan = 0
sorunlu = []

for dev, bilgi in sorted(hedef.items(), key=lambda x: x[1]["ad"] != "SEMRA"):   # Semra ilk
    ad = bilgi.get("ad") or bilgi["uid"][:12]
    did = esle.get(dev)
    if not did:
        print(f"   {ad:20s} {dev:<12} Traccar'da cihaz YOK — atlandı")
        continue
    try:
        var = mevcut_ts(dev, bas_ts, simdi)
        yeni, atlanan = [], 0
        p0 = bas_ts
        while p0 < simdi:
            p1 = min(p0 + PENCERE * 86400, simdi)
            F = dt.datetime.fromtimestamp(p0, dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
            T = dt.datetime.fromtimestamp(p1, dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
            try:
                pos = traccar(f"/positions?deviceId={did}&from={F}&to={T}")
            except Exception as e:
                sorunlu.append(f"{ad} {F[:10]}: {str(e)[:60]}")
                p0 = p1
                continue
            for p in pos:
                t = ep(p.get("fixTime") or p.get("deviceTime"))
                if t in var:
                    atlanan += 1
                    continue
                var.add(t)                     # aynı tur içinde de tekrar etmesin
                a = p.get("attributes") or {}
                batt = a.get("batteryLevel")
                yeni.append("('{}',{},{},{},{},{},{},{},{},{},{})".format(
                    dev.replace("'", ""), t, p["latitude"], p["longitude"],
                    p.get("speed") or 0, p.get("altitude") or 0, p.get("accuracy") or 0,
                    p.get("course") or 0,
                    int(batt) if batt is not None else "NULL",
                    1 if a.get("charge") else 0, simdi))
            p0 = p1

        if yeni and not DRY:
            for i in range(0, len(yeni), PARCA):
                d1_yaz("INSERT INTO positions (device,ts,lat,lon,spd,alt,acc,brg,batt,charge,created_at)"
                   " VALUES " + ",".join(yeni[i:i + PARCA]))
        toplam_yeni += len(yeni)
        toplam_atlanan += atlanan
        print(f"   {ad:20s} {dev:<12} +{len(yeni):6d} yeni · {atlanan:6d} zaten vardı")
    except Exception as e:
        sorunlu.append(f"{ad} ({dev}): {str(e)[:90]}")
        print(f"   {ad:20s} {dev:<12} HATA — devam ediliyor")

print(f"\n  TOPLAM: +{toplam_yeni} yeni nokta · {toplam_atlanan} zaten vardı")
if sorunlu:
    print(f"  SORUNLU ({len(sorunlu)}):")
    for s in sorunlu[:10]:
        print("   -", s)
