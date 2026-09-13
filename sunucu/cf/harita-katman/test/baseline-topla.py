#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""baseline-topla.py — DEVİR GÜNÜ temel çizgisi (BUGÜNKÜ canlı uç = mevcut sahibi).

devir-testi.py'yi koşar + sözleşmenin ölçülmesi istenen EK maddelerini ölçer:
  T1  çok noktalı ölçek + piksel imzası (8x8 gri) — devir sonrası <5/255 ile eşleşmeli
  T3  başlık dökümü — ÖNEKSİZ ve ÖNEKLİ yollar AYRI AYRI (GET ile; HEAD 501 tuzağı)
  T6  MVT eksik karo davranışı (bugün 204 mü 404 mü)
  T4  matching: `code` alanı VAR MI, confidence, nokta sayısı, max adım
  B8  geocoding minimal alanlar · /yukseklik biçimi (anahtarlar + ızgara imzası)
  L   3 GERÇEK rota × 70 nokta "karada mı" testi (kaynak: /xyz/str su rengi, kalibre)

Çıktı: tek JSON dosyası. Gizli önek ASLA yazılmaz — `{ONEK}` olarak maskelenir.
Kullanım: python3 test/baseline-topla.py [--uc https://harita.nickdegs.com] [--cikti YOL]
"""
import argparse
import hashlib
import io
import json
import math
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

UA = {"User-Agent": "baseline-topla/1.0"}
_ONEK = ""

# ── kalibrasyon sabitleri ────────────────────────────────────────────────────
SU_RENK = (191, 217, 242)   # /xyz/str rasterinde su dolgusu (ölçüldü 2026-08-31)
SU_TOLERANS = 12            # kanal başına max sapma; en yakın KARA rengi 46 uzakta → çakışma yok
LAND_Z = 16                 # karada testi karo zoom'u
LAND_N = 70                 # rota başına örneklenen nokta

# 3 GERÇEK rota (adım-mesafesi değişkenliği cv>0.05 = gerçek GPS) + 1 KONTROL.
# ⚠️ /opt/movelog/routes altında SENTETİK dosyalar da var: moto/bike_2026-07-14_2108.tcx
# adım mesafesi sabit (cv=0.001) = düz çizgi, üstelik Marmara'nın ÜSTÜNDEN geçiyor.
# Onu kontrol deneyi olarak kullanıyoruz: karada testi ayırt ediciyse BU DÜŞMELİ.
ROTALAR = [
    ("kiyi-istanbul-marmara", "/opt/movelog/routes/moto_2026-07-09_1025.tcx", True),
    ("kiyi-ordu-karadeniz",   "/opt/movelog/routes/moto_2026-07-26_0938.tcx", True),
    ("ic-kesim-dag",          "/opt/movelog/routes/moto_2026-08-01_0624.tcx", True),
    ("KONTROL-deniz-cizgisi", "/opt/movelog/routes/moto_2026-07-14_2108.tcx", False),
]

# T1: (ad, zoom, lon, lat) — karo o zoom'da bulunur, statik z-1'de aynı alanı kapsar (512·2^z)
T1_NOKTA = [
    ("taksim",        16, 28.9850, 41.0369),
    ("kadikoy-sahil", 16, 29.0230, 40.9905),
    ("ordu-sahil",    16, 37.8900, 40.9800),
    ("ankara-kizilay",15, 32.8540, 39.9200),
    ("izmir-konak",   14, 27.1280, 38.4190),
]

MVT_VAKA = [
    ("istanbul-z14",        14,  9640,  6156),
    ("istanbul-z15",        15, 19281, 12312),
    ("arsiv-tavani-ustu-z16", 16, 20000, 30000),
    ("derin-okyanus-z15",   15,  3640, 16384),
    ("derin-okyanus-z14",   14,  1820,  8192),
    ("cok-derin-zoom-z18",  18, 152176, 98248),
]

IZ_YOL = "28.97918,41.02506;28.97850,41.02560;28.97780,41.02620"
GEO_NOKTA = "28.9784,41.0082"
YUK_BBOX = "28.970,41.020,28.990,41.040"


def maskele(s):
    return s.replace(_ONEK, "{ONEK}") if _ONEK and isinstance(s, str) else s


def iste(url, yontem="GET", za=90):
    t0 = time.time()
    r = urllib.request.Request(url, method=yontem, headers=UA)
    try:
        with urllib.request.urlopen(r, timeout=za) as y:
            g = y.read() if yontem != "HEAD" else b""
            return y.status, {k.lower(): v for k, v in y.headers.items()}, g, int((time.time() - t0) * 1000)
    except urllib.error.HTTPError as e:
        g = e.read() if yontem != "HEAD" else b""
        return e.code, {k.lower(): v for k, v in (e.headers or {}).items()}, g, int((time.time() - t0) * 1000)
    except Exception as e:
        return 0, {"x-hata": str(e)[:160]}, b"", int((time.time() - t0) * 1000)


# ── coğrafya ────────────────────────────────────────────────────────────────
def karo_no(lon, lat, z):
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n
    lr = math.radians(lat)
    y = (1.0 - math.log(math.tan(lr) + 1.0 / math.cos(lr)) / math.pi) / 2.0 * n
    return x, y


def karo_merkez(z, xi, yi):
    n = 2 ** z
    lon = (xi + 0.5) / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (yi + 0.5) / n))))
    return lon, lat


def metre(a, b):
    oy = math.radians((a[1] + b[1]) / 2.0)
    return math.hypot((b[0] - a[0]) * 111320 * math.cos(oy), (b[1] - a[1]) * 111320)


# ── görüntü ─────────────────────────────────────────────────────────────────
def imza(b):
    """8x8 gri perceptual imza (hex, 64 hane) — JPEG yeniden kodlamasına dayanıklı."""
    from PIL import Image
    im = Image.open(io.BytesIO(b)).convert("L").resize((8, 8), Image.BILINEAR)
    return "".join("%02x" % p for p in im.getdata())


def piksel_farki(b1, b2):
    from PIL import Image, ImageChops
    a = Image.open(io.BytesIO(b1)).convert("RGB")
    b = Image.open(io.BytesIO(b2)).convert("RGB")
    if a.size != b.size:
        b = b.resize(a.size)
    h = ImageChops.difference(a, b).histogram()
    top = sum(i * h[k * 256 + i] for k in range(3) for i in range(256))
    return top / float(a.size[0] * a.size[1] * 3)


def statik_url(taban, onek, lon, lat, zoom, w=128, h=128, stil="satellite-v9"):
    return (f"{taban}/{onek}/styles/v1/mapbox/{stil}/static/"
            f"{lon:.6f},{lat:.6f},{zoom:.3f},0/{w}x{h}@2x?access_token=pk.x")


# ══ T1 — çok noktalı ölçek + imza ═══════════════════════════════════════════
def t1_coklu(taban, onek, za):
    cikti = []
    for ad, z, lon, lat in T1_NOKTA:
        fx, fy = karo_no(lon, lat, z)
        xi, yi = int(fx), int(fy)
        mlon, mlat = karo_merkez(z, xi, yi)
        kayit = {"ad": ad, "zoom": z, "karo": [z, xi, yi],
                 "karo_merkez": [round(mlon, 7), round(mlat, 7)]}
        dk, _, karo, _ = iste(f"{taban}/xyz/sat/{z}/{xi}/{yi}.jpg", za=za)
        kayit["xyz_durum"] = dk
        kayit["xyz_bayt"] = len(karo)
        if dk != 200 or not karo:
            cikti.append(kayit)
            continue
        kayit["xyz_sha256"] = hashlib.sha256(karo).hexdigest()
        kayit["xyz_imza8x8"] = imza(karo)
        ds, _, st, _ = iste(statik_url(taban, onek, mlon, mlat, z - 1), za=za)
        kayit["statik_durum"] = ds
        kayit["statik_bayt"] = len(st)
        if ds == 200 and st:
            from PIL import Image
            kayit["statik_boyut"] = list(Image.open(io.BytesIO(st)).size)
            kayit["statik_sha256"] = hashlib.sha256(st).hexdigest()
            kayit["statik_imza8x8"] = imza(st)
            kayit["fark_255"] = round(piksel_farki(karo, st), 3)
        # yanlış-ölçek kontrolü (z-2) → ayrımın net olduğunun kanıtı
        dc, _, ct, _ = iste(statik_url(taban, onek, mlon, mlat, z - 2), za=za)
        if dc == 200 and ct:
            kayit["kontrol_yanlis_olcek_fark_255"] = round(piksel_farki(karo, ct), 3)
        cikti.append(kayit)
    return cikti


# ══ T3 — başlık dökümü: ÖNEKSİZ ve ÖNEKLİ AYRI ══════════════════════════════
ILGINC = ("content-type", "content-length", "cache-control", "access-control-allow-origin",
          "cross-origin-resource-policy", "access-control-allow-headers", "etag",
          "cf-cache-status", "x-onbellek", "server", "vary", "age", "expires", "date")


def basliklari_al(taban, yol, za, yontem="GET"):
    d, b, g, ms = iste(taban + yol, yontem=yontem, za=za)
    return {"yol": maskele(yol), "yontem": yontem, "durum": d, "ms": ms, "bayt": len(g),
            "basliklar": {k: b[k] for k in ILGINC if k in b},
            "tum_baslik_adlari": sorted(b.keys())}


def t3_basliklar(taban, onek, za):
    z, xi, yi = 16, 38044, 24562
    oneksiz = [
        f"/xyz/sat/{z}/{xi}/{yi}.jpg",
        f"/xyz/str/{z}/{xi}/{yi}.jpg",
        "/mvt/14/9640/6156.mvt",
        f"/yukseklik?bbox={YUK_BBOX}&n=16",
        "/saglik",
        f"/matching/v5/mapbox/driving/{IZ_YOL}",
        "/styles/v1/mapbox/satellite-v9/static/29.000000,41.000000,10.000,0/64x64@2x",
        f"/geocoding/v5/mapbox.places/{GEO_NOKTA}.json?limit=1",
    ]
    onekli = [
        f"/{onek}/styles/v1/mapbox/satellite-v9/static/28.984680,41.035859,15.000,0/128x128@2x?access_token=pk.x",
        f"/{onek}/styles/v1/mapbox/streets-v12/static/28.984680,41.035859,15.000,0/128x128@2x?access_token=pk.x",
        f"/{onek}/matching/v5/mapbox/driving/{IZ_YOL}?geometries=geojson&overview=full&tidy=true&access_token=pk.x",
        f"/{onek}/geocoding/v5/mapbox.places/{GEO_NOKTA}.json?limit=1&language=tr",
        f"/{onek}/xyz/sat/{z}/{xi}/{yi}.jpg",
        f"/yanlisonek/matching/v5/mapbox/driving/{IZ_YOL}",
    ]
    sonuc = {"oneksiz": [basliklari_al(taban, y, za) for y in oneksiz],
             "onekli": [basliklari_al(taban, y, za) for y in onekli]}
    # HEAD tuzağı — T3'ün neden GET ile koşulduğunun kanıtı
    surl = f"/{onek}/styles/v1/mapbox/satellite-v9/static/28.984680,41.035859,15.000,0/128x128@2x?access_token=pk.x"
    sonuc["head_tuzagi"] = {
        "onekli_statik_HEAD": basliklari_al(taban, surl, za, yontem="HEAD"),
        "oneksiz_xyz_HEAD": basliklari_al(taban, f"/xyz/sat/{z}/{xi}/{yi}.jpg", za, yontem="HEAD"),
    }
    # ikinci istek → kenar önbelleği davranışı
    ik = basliklari_al(taban, f"/xyz/sat/{z}/{xi}/{yi}.jpg", za)
    sonuc["xyz_ikinci_istek_cf_cache_status"] = ik["basliklar"].get("cf-cache-status", "-")
    ik2 = basliklari_al(taban, surl, za)
    sonuc["statik_ikinci_istek_onbellek"] = (ik2["basliklar"].get("x-onbellek")
                                             or ik2["basliklar"].get("cf-cache-status") or "-")
    return sonuc


# ══ T6 — MVT eksik karo davranışı ═══════════════════════════════════════════
def t6_mvt(taban, za):
    cikti = []
    for ad, z, x, y in MVT_VAKA:
        d, b, g, ms = iste(f"{taban}/mvt/{z}/{x}/{y}.mvt", za=za)
        kayit = {"ad": ad, "karo": [z, x, y], "durum": d, "bayt": len(g), "ms": ms,
                 "content_type": b.get("content-type"),
                 "cache_control": b.get("cache-control"),
                 "acao": b.get("access-control-allow-origin")}
        if g:
            try:
                sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
                import mvt_coz
                kayit["katmanlar"] = sorted(mvt_coz.katmanlar(g).keys())
            except Exception as e:
                kayit["katmanlar"] = "cozulemedi: " + str(e)[:60]
        cikti.append(kayit)
    return cikti


# ══ T4 — matching sözleşmesi ════════════════════════════════════════════════
def match_url(taban, onek, profil, iz, rad="25"):
    n = len(iz.split(";"))
    return (f"{taban}/{onek}/matching/v5/mapbox/{profil}/{iz}"
            f"?geometries=geojson&overview=full&tidy=true"
            f"&radiuses={';'.join([rad] * n)}&access_token=pk.x")


def t4_matching(taban, onek, za):
    d, b, g, ms = iste(match_url(taban, onek, "driving", IZ_YOL, "22"), za=za)
    try:
        j = json.loads(g)
    except Exception:
        j = {}
    m0 = (j.get("matchings") or [{}])[0] if j.get("matchings") else {}
    krd = (m0.get("geometry") or {}).get("coordinates") or []
    adim = [metre(krd[i - 1], krd[i]) for i in range(1, len(krd))]
    adim = [a for a in adim if a > 0.01]
    out = {
        "durum": d, "ms": ms,
        "ust_seviye_anahtarlar": sorted(j.keys()),
        "code_alani_var_mi": "code" in j,
        "code": j.get("code"),
        "matching_anahtarlar": sorted(m0.keys()),
        "confidence": m0.get("confidence"),
        "geometry_tipi": (m0.get("geometry") or {}).get("type"),
        "nokta_sayisi": len(krd),
        "max_adim_m": round(max(adim), 2) if adim else None,
        "ort_adim_m": round(sum(adim) / len(adim), 2) if adim else None,
    }
    d3, _, g3, _ = iste(match_url(taban, onek, "driving", "30.5,42.5;30.51,42.51;30.52,42.52", "25"), za=za)
    out["bos_sonuc"] = {"durum": d3, "govde": g3.decode("utf-8", "replace")[:60],
                        "bayt_birebir_mi": g3.strip() == b'{"matchings":[]}'}
    out["profiller"] = {}
    for p in ("driving", "cycling", "walking"):
        dp, _, _, _ = iste(match_url(taban, onek, p, IZ_YOL), za=za)
        out["profiller"][p] = dp
    return out


# ══ B8 geocoding + /yukseklik biçimi ════════════════════════════════════════
def b8_geocoding(taban, onek, za):
    u = (f"{taban}/{onek}/geocoding/v5/mapbox.places/{GEO_NOKTA}.json"
         f"?types=poi,neighborhood,locality,place&limit=1&language=tr")
    d, _, g, ms = iste(u, za=za)
    try:
        j = json.loads(g)
    except Exception:
        j = {}
    f0 = (j.get("features") or [{}])[0] if j.get("features") else {}
    out = {"durum": d, "ms": ms, "ust_anahtarlar": sorted(j.keys()),
           "feature_anahtarlar": sorted(f0.keys()),
           "text": f0.get("text"), "place_name": f0.get("place_name"),
           "context": f0.get("context"), "center": f0.get("center")}
    # activity-detect.py'nin özel modu
    d2, _, g2, _ = iste(f"{taban}/{onek}/geocoding/v5/mapbox.places/{GEO_NOKTA}.json?types=country&limit=1", za=za)
    try:
        j2 = json.loads(g2)
        ff = (j2.get("features") or [{}])[0] if j2.get("features") else {}
        out["types_country"] = {"durum": d2, "text": ff.get("text"),
                                "short_code": (ff.get("properties") or {}).get("short_code")}
    except Exception:
        out["types_country"] = {"durum": d2, "govde": g2[:80].decode("utf-8", "replace")}
    return out


def yukseklik(taban, za):
    d, b, g, ms = iste(f"{taban}/yukseklik?bbox={YUK_BBOX}&n=16", za=za)
    out = {"yol": f"/yukseklik?bbox={YUK_BBOX}&n=16", "durum": d, "ms": ms,
           "bayt": len(g), "content_type": b.get("content-type")}
    try:
        j = json.loads(g)
        out["anahtarlar"] = sorted(j.keys())
        out["n"] = j.get("n")
        out["bbox"] = j.get("bbox")
        out["kule"] = j.get("kule")
        gr = j.get("grid")
        if isinstance(gr, list):
            out["grid_satir"] = len(gr)
            out["grid_sutun"] = len(gr[0]) if gr and isinstance(gr[0], list) else None
            duz = [v for r in gr for v in (r if isinstance(r, list) else [r])]
            sayi = [v for v in duz if isinstance(v, (int, float))]
            out["grid_min"] = min(sayi) if sayi else None
            out["grid_max"] = max(sayi) if sayi else None
            out["grid_ort"] = round(sum(sayi) / len(sayi), 3) if sayi else None
            out["grid_sha256"] = hashlib.sha256(
                json.dumps(gr, sort_keys=True).encode()).hexdigest()
    except Exception as e:
        out["json_hatasi"] = str(e)[:80]
        out["govde_ilk80"] = g[:80].decode("utf-8", "replace")
    return out


# ══ L — 3 gerçek rota × 70 nokta "karada mı" ════════════════════════════════
_KARO_ONB = {}


def str_karo(taban, z, x, y, za):
    k = (z, x, y)
    if k in _KARO_ONB:
        return _KARO_ONB[k]
    from PIL import Image
    d, im = 0, None
    for deneme in range(3):                    # geçici ağ hatası testi kirletmesin
        d, _, g, _ = iste(f"{taban}/xyz/str/{z}/{x}/{y}.jpg", za=za)
        if d == 200 and g:
            try:
                im = Image.open(io.BytesIO(g)).convert("RGB")
                break
            except Exception:
                im = None
        time.sleep(1.5 * (deneme + 1))
    _KARO_ONB[k] = (d, im)
    return _KARO_ONB[k]


def su_mu(taban, lon, lat, za):
    fx, fy = karo_no(lon, lat, LAND_Z)
    xi, yi = int(fx), int(fy)
    d, im = str_karo(taban, LAND_Z, xi, yi, za)
    if im is None:
        return None, d, None
    W, H = im.size
    p = im.getpixel((min(W - 1, int((fx - xi) * W)), min(H - 1, int((fy - yi) * H))))
    uzak = max(abs(p[0] - SU_RENK[0]), abs(p[1] - SU_RENK[1]), abs(p[2] - SU_RENK[2]))
    return (uzak <= SU_TOLERANS), d, {"piksel": list(p), "su_uzakligi": uzak}


def rota_oku(yol):
    t = open(yol, encoding="utf-8", errors="replace").read()
    pts = re.findall(r'lat="(-?[\d.]+)"\s+lon="(-?[\d.]+)"', t)
    if not pts:
        pts = re.findall(r"<LatitudeDegrees>(-?[\d.]+)</LatitudeDegrees>\s*"
                         r"<LongitudeDegrees>(-?[\d.]+)</LongitudeDegrees>", t)
    return [(float(b), float(a)) for a, b in pts]        # (lon, lat)


def seyrelt(pts, hedef):
    if len(pts) <= hedef:
        return pts
    adim = (len(pts) - 1) / float(hedef - 1)
    return [pts[int(round(i * adim))] for i in range(hedef)]


def karada_testi(taban, onek, za):
    cikti = []
    for ad, yol, karada_beklenir in ROTALAR:
        kayit = {"ad": ad, "dosya": yol, "karada_beklenir": karada_beklenir}
        if not os.path.exists(yol):
            kayit["hata"] = "dosya yok"
            cikti.append(kayit)
            continue
        ham = rota_oku(yol)
        kayit["ham_nokta"] = len(ham)
        if len(ham) < 10:
            kayit["hata"] = "yetersiz nokta"
            cikti.append(kayit)
            continue
        iz_pts = seyrelt(ham, 60)
        iz = ";".join(f"{lo:.5f},{la:.5f}" for lo, la in iz_pts)
        d, _, g, ms = iste(match_url(taban, onek, "driving", iz, "25"), za=za)
        kayit["matching_durum"] = d
        kayit["matching_ms"] = ms
        try:
            j = json.loads(g)
        except Exception:
            j = {}
        m0 = (j.get("matchings") or [{}])[0] if j.get("matchings") else {}
        krd = (m0.get("geometry") or {}).get("coordinates") or []
        kayit["eslesen_nokta"] = len(krd)
        kayit["confidence"] = m0.get("confidence")
        if len(krd) < LAND_N:
            kayit["uyari"] = (f"eşleşen geometri {LAND_N} noktadan kısa "
                              f"({len(krd)}) — ham ize düşüldü")
            kayit["kaynak"] = "ham iz (matching oturmadı)"
            krd = seyrelt(ham, min(LAND_N, len(ham)))
        else:
            kayit["kaynak"] = "matching geometrisi"
        ornek = seyrelt(krd, LAND_N)
        kayit["test_nokta"] = len(ornek)
        karada = 0
        sulu = []
        karosuz = 0
        for lo, la in ornek:
            s, dk, det = su_mu(taban, lo, la, za)
            if s is None:
                karosuz += 1
                continue
            if s:
                sulu.append({"lon": round(lo, 6), "lat": round(la, 6),
                             "karo_durum": dk, **det})
            else:
                karada += 1
        kayit["karada"] = karada
        kayit["suda"] = len(sulu)
        kayit["karo_alinamadi"] = karosuz
        kayit["sonuc"] = f"{karada}/{len(ornek)}"
        kayit["gecti"] = ((karada == len(ornek)) == karada_beklenir)
        kayit["olcut"] = ("tüm noktalar KARADA olmalı" if karada_beklenir
                          else "KONTROL: bu iz denizden geçer, karada testi DÜŞMELİ")
        kayit["su_noktalari"] = sulu[:10]
        bb = [min(p[0] for p in ornek), min(p[1] for p in ornek),
              max(p[0] for p in ornek), max(p[1] for p in ornek)]
        kayit["bbox_lon_lat"] = [round(v, 5) for v in bb]
        cikti.append(kayit)
    return cikti


def kalibrasyon(taban, za):
    """Su tespitinin ayırt edici olduğunun kanıtı (T1 kontrol deneyinin muadili)."""
    su = [("bogaz-ortakoy", 29.0300, 41.0480), ("marmara-aci", 28.9000, 40.8500),
          ("halic", 28.9560, 41.0300), ("karadeniz-acik", 29.1000, 41.2500),
          ("izmir-korfez", 27.0800, 38.4400)]
    kara = [("taksim", 28.9850, 41.0369), ("kadikoy", 29.0230, 40.9905),
            ("ankara", 32.8540, 39.9200), ("konya", 32.4900, 37.8700),
            ("izmir-konak", 27.1280, 38.4190)]
    out = {"su_renk": list(SU_RENK), "tolerans": SU_TOLERANS, "zoom": LAND_Z,
           "bilinen_su": [], "bilinen_kara": []}
    for ad, lo, la in su:
        s, d, det = su_mu(taban, lo, la, za)
        out["bilinen_su"].append({"ad": ad, "su_mu": s, "karo_durum": d, **(det or {})})
    for ad, lo, la in kara:
        s, d, det = su_mu(taban, lo, la, za)
        out["bilinen_kara"].append({"ad": ad, "su_mu": s, "karo_durum": d, **(det or {})})
    dogru_su = sum(1 for r in out["bilinen_su"] if r.get("su_mu") is True)
    yanlis_poz = sum(1 for r in out["bilinen_kara"] if r.get("su_mu") is True)
    out["ozet"] = (f"bilinen su {dogru_su}/{len(su)} su sayıldı · "
                   f"bilinen kara {yanlis_poz}/{len(kara)} YANLIŞ su sayıldı")
    en_yakin_kara = min((r.get("su_uzakligi") for r in out["bilinen_kara"]
                         if r.get("su_uzakligi") is not None), default=None)
    out["en_yakin_kara_uzakligi"] = en_yakin_kara
    out["ayrim_net_mi"] = (yanlis_poz == 0 and en_yakin_kara is not None
                           and en_yakin_kara > SU_TOLERANS * 2)
    return out


# ══ devir-testi.py ══════════════════════════════════════════════════════════
def devir_testi(taban, onek):
    kok = os.path.dirname(os.path.abspath(__file__))
    p = subprocess.run([sys.executable, os.path.join(kok, "devir-testi.py"),
                        "--eski", taban, "--onek", onek, "--json"],
                       capture_output=True, text=True, timeout=1800)
    ham = p.stdout
    i = ham.find("\n{\n")
    veri = {}
    if i >= 0:
        try:
            veri = json.loads(ham[i:])
        except Exception as e:
            veri = {"parse_hatasi": str(e)[:120]}
    return {"cikis_kodu": p.returncode, "metin": maskele(ham[:i] if i >= 0 else ham), **veri}


def main():
    global _ONEK
    ap = argparse.ArgumentParser()
    ap.add_argument("--uc", default="https://harita.nickdegs.com")
    ap.add_argument("--onek", default="")
    ap.add_argument("--cikti", default="")
    ap.add_argument("--zaman-asimi", type=int, default=90)
    ap.add_argument("--bolum", default="",
                    help="yalnız bu bölümler (virgüllü): devir,T1,T3,T6,T4,B8,karada. "
                         "Mevcut çıktı dosyası varsa ÜSTÜNE yazılır (diğer bölümler korunur).")
    a = ap.parse_args()

    onek = a.onek
    if not onek:
        onek = re.search(r"HARITA_UC_ONEK=(\S+)",
                         open("/opt/matrix/secrets/harita-uc.conf").read()).group(1)
    _ONEK = onek
    taban = a.uc.rstrip("/")
    za = a.zaman_asimi
    cikti = a.cikti or os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                    "baseline-%s.json" % time.strftime("%Y%m%d"))

    istenen = {x.strip() for x in a.bolum.split(",") if x.strip()}

    def kos(ad):
        return (not istenen) or (ad in istenen)

    b = {}
    if istenen and os.path.exists(cikti):        # kısmi yenileme: eskiyi koru
        b = json.load(open(cikti, encoding="utf-8"))
    b["meta"] = {
        "ne": "harita katmanı DEVİR GÜNÜ temel çizgisi (BUGÜNKÜ canlı uç — mevcut sahibi)",
        "uc": taban,
        "onek": "{ONEK} (maskeli — /opt/matrix/secrets/harita-uc.conf)",
        "zaman_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "zaman_tr": time.strftime("%Y-%m-%d %H:%M:%S %Z"),
        "arac": "test/baseline-topla.py",
        "not": "Devir SONRASI aynı komut YENİ uca koşulur; bu dosya referanstır.",
        "bolumler": sorted(istenen) if istenen else "hepsi",
    }
    if kos("devir"):
        print("1/8 devir-testi.py …", flush=True)
        b["devir_testi"] = devir_testi(taban, onek)
    if kos("T1"):
        print("2/8 T1 çok noktalı ölçek + imza …", flush=True)
        b["T1_olcek"] = t1_coklu(taban, onek, za)
    if kos("T3"):
        print("3/8 T3 başlıklar (öneksiz + önekli) …", flush=True)
        b["T3_basliklar"] = t3_basliklar(taban, onek, za)
    if kos("T6"):
        print("4/8 T6 MVT eksik karo …", flush=True)
        b["T6_mvt"] = t6_mvt(taban, za)
    if kos("T4"):
        print("5/8 T4 matching …", flush=True)
        b["T4_matching"] = t4_matching(taban, onek, za)
    if kos("B8"):
        print("6/8 B8 geocoding + /yukseklik …", flush=True)
        b["B8_geocoding"] = b8_geocoding(taban, onek, za)
        b["yukseklik"] = yukseklik(taban, za)
    if kos("karada"):
        print("7/8 su tespiti kalibrasyonu …", flush=True)
        b["karada_kalibrasyon"] = kalibrasyon(taban, za)
        print("8/8 3 gerçek rota + 1 kontrol × 70 nokta karada testi …", flush=True)
        b["karada_70"] = karada_testi(taban, onek, za)

    metin = json.dumps(b, ensure_ascii=False, indent=1)
    if _ONEK and _ONEK in metin:
        metin = metin.replace(_ONEK, "{ONEK}")
    with open(cikti, "w", encoding="utf-8") as f:
        f.write(metin + "\n")
    print("\nYAZILDI: " + cikti)
    return 0


if __name__ == "__main__":
    sys.exit(main())
