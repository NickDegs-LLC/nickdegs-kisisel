#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
devir-testi.py — DEVİR GÜNÜ tek-komut doğrulama aracı (harita katmanı).

Neden .py (uyum-test.mjs .mjs iken): T1 ölçek deneyi JPEG'i PİKSEL PİKSEL çözmeyi gerektirir.
Sözleşmedeki referans sayılar (0.21 / 1.39 / 64.8 /255) PIL ile ölçüldü — aynı çözücüyle
ölçmek eşiklerin karşılaştırılabilir kalmasını sağlar. Node tarafında JPEG çözücü yok
(bağımlılık kurulmayacak). Saf JSON/başlık testleri için `test/uyum-test.mjs` ayrı durur.

NE YAPAR — ESKİ uç ile YENİ uç arasında:
  T1  Ölçek deneyi   : aynı koordinat+zoom statik görüntü ↔ XYZ karo piksel farkı < 5/255
                       (+ yanlış-ölçek KONTROL deneyi: ayrımın gerçekten net olduğunu kanıtlar)
  T3  Başlık kontrolü: GET ile (HEAD DEĞİL — origin 501 döner, tuzak kanıtı da basılır)
  T6  MVT kuralı     : eksik karo 204, 404 ASLA; İstanbul z14/z15 200 + doğru Content-Type
  T4  Matching       : code:"Ok" · confidence · ~20 m sürekli çizgi · boş biçim bayt-birebir
  T11 Önek denetimi  : öneksiz/yanlış önekli motor ucu → 404
  B8  Geocoding      : minimal alan sözleşmesi (features[0].text)
  K*  Karşılaştırma  : iki uç da verildiyse statik piksel farkı + matching geometri paritesi

KULLANIM
  python3 test/devir-testi.py                         # yalnız ESKİ uç (temel çizgi)
  python3 test/devir-testi.py --yeni https://...      # ESKİ ↔ YENİ tam karşılaştırma
  python3 test/devir-testi.py --sadece-yeni --yeni ...# devir sonrası tek uç
  python3 test/devir-testi.py --json                  # makine okunur çıktı
Seçenekler: --eski (vars. https://harita.nickdegs.com) · --onek (vars. secrets dosyası)
            --zaman-asimi (vars. 90 sn) · --atla T1,T6 · --hizli (T5 sınıfı uzun işleri atla)

⚠️ Gizli önek ASLA ekrana yazılmaz — çıktıda `{ONEK}` olarak maskelenir.
Çıkış kodu: 0 = FAIL yok · 1 = en az bir FAIL · 2 = araç hatası.
"""

import argparse
import io
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.request

# ── sözleşme sabitleri (HARITA-TUKETIM-SOZLESMESI.md) ────────────────────────
T1_ESIK = 5.0            # /255 ortalama mutlak fark (referans 0.21-1.39; yanlış ölçek 64.8)
T1_KONTROL_ALT = 20.0    # yanlış-ölçek kontrol deneyi bunun ÜSTÜNDE olmalı (ayrım net mi)
PARITE_ESIK_M = 1.0      # ESKİ↔YENİ matching nokta sapması (hedef 0.000 m)
KARO_CC = "max-age=2592000"
MVT_TIP = "application/vnd.mapbox-vector-tile"

# T1 deneyi: Taksim z16 karosu + coğrafi merkezi (512·2^z ⇒ z15 statik 128x128@2x ile birebir)
Z16 = (16, 38044, 24562)
Z16_MERKEZ = (28.98468017578125, 41.03585891144299)
MVT_ISTANBUL_Z14 = (14, 9640, 6156)
MVT_ISTANBUL_Z15 = (15, 19281, 12312)
# Bugünkü origin'de gerçek "eksik karo" vakası = arşiv tavanı (z0-15 yerli, A7) ÜSTÜ.
# ⚠️ Okyanus karosu 204 DEĞİL: arşivde her yerde ~73 B'lik asgari karo var (30.08 ölçüldü) —
# T6'yı yalnız okyanusla sınamak yanıltır; ikisi de koşulur, ikisinde de 404 YASAK.
MVT_EKSIK = (16, 20000, 30000)
MVT_OKYANUS = (15, 3640, 16384)     # Pasifik ortası

IZ_YOL = "28.97918,41.02506;28.97850,41.02560;28.97780,41.02620"
IZ_PARITE = ("28.97918,41.02506;28.97850,41.02560;28.97780,41.02620;"
             "28.97700,41.02680;28.97620,41.02740")
IZ_DENIZ = "30.5,42.5;30.51,42.51;30.52,42.52"
GEO_NOKTA = "28.9784,41.0082"

OK, FAIL, BILGI, FARK = "OK", "FAIL", "BILGI", "FARK"

_ONEK = ""      # maskeleme için


def maskele(s):
    return s.replace(_ONEK, "{ONEK}") if _ONEK else s


class Sonuc:
    def __init__(self):
        self.satir = []

    def ekle(self, uc, test, durum, ad, detay=""):
        self.satir.append({"uc": uc, "test": test, "durum": durum,
                           "ad": ad, "detay": maskele(str(detay))})
        return durum

    def fail_sayisi(self):
        return sum(1 for s in self.satir if s["durum"] == FAIL)


SON = Sonuc()


# ── HTTP ─────────────────────────────────────────────────────────────────────
def iste(url, yontem="GET", zaman_asimi=90):
    """(durum, basliklar_dict_kucuk_harf, govde_bytes, sure_ms). Ağ hatası → durum=0."""
    t0 = time.time()
    r = urllib.request.Request(url, method=yontem,
                               headers={"User-Agent": "devir-testi/1.0"})
    try:
        with urllib.request.urlopen(r, timeout=zaman_asimi) as y:
            g = y.read() if yontem != "HEAD" else b""
            b = {k.lower(): v for k, v in y.headers.items()}
            return y.status, b, g, int((time.time() - t0) * 1000)
    except urllib.error.HTTPError as e:
        g = e.read() if yontem != "HEAD" else b""
        b = {k.lower(): v for k, v in (e.headers or {}).items()}
        return e.code, b, g, int((time.time() - t0) * 1000)
    except Exception as e:                                    # ağ/TLS/zaman aşımı
        return 0, {"x-hata": str(e)[:160]}, b"", int((time.time() - t0) * 1000)


def statik_url(taban, onek, lon, lat, zoom, w=128, h=128, stil="satellite-v9"):
    return (f"{taban}/{onek}/styles/v1/mapbox/{stil}/static/"
            f"{lon:.6f},{lat:.6f},{zoom:.3f},0/{w}x{h}@2x?access_token=pk.x")


# ── görüntü ──────────────────────────────────────────────────────────────────
def gorsel(b):
    from PIL import Image
    return Image.open(io.BytesIO(b)).convert("RGB")


def piksel_farki(b1, b2):
    """Ortalama mutlak kanal farkı (/255). Boyut farklıysa ikincisi birinciye ölçeklenir."""
    from PIL import ImageChops
    a, b = gorsel(b1), gorsel(b2)
    if a.size != b.size:
        b = b.resize(a.size)
    f = ImageChops.difference(a, b)
    h = f.histogram()
    top = sum(i * h[k * 256 + i] for k in range(3) for i in range(256))
    return top / float(a.size[0] * a.size[1] * 3)


# ── coğrafya ─────────────────────────────────────────────────────────────────
def metre(a, b):
    oy = math.radians((a[1] + b[1]) / 2.0)
    return math.hypot((b[0] - a[0]) * 111320 * math.cos(oy), (b[1] - a[1]) * 111320)


# ══════════════════════════════════════════════════════════════════════════════
# T1 — ÖLÇEK DENEYİ (750 m kayma sigortası; B4 512·2^z)
# ══════════════════════════════════════════════════════════════════════════════
def t1_olcek(ad, taban, onek, za):
    z, x, y = Z16
    lon, lat = Z16_MERKEZ
    dk, _, karo, _ = iste(f"{taban}/xyz/sat/{z}/{x}/{y}.jpg", zaman_asimi=za)
    if dk != 200 or not karo:
        return SON.ekle(ad, "T1", FAIL, "XYZ referans karosu alınamadı", f"durum={dk}")
    ds, _, st, _ = iste(statik_url(taban, onek, lon, lat, z - 1), zaman_asimi=za)
    if ds != 200 or not st:
        return SON.ekle(ad, "T1", FAIL, "statik z15 128x128@2x alınamadı", f"durum={ds}")
    try:
        g = gorsel(st)
        SON.ekle(ad, "T1", OK if g.size == (256, 256) else FAIL,
                 "statik @2x çıktısı 2W×2H (256×256)", f"boyut={g.size[0]}x{g.size[1]}")
        fark = piksel_farki(karo, st)
    except Exception as e:
        return SON.ekle(ad, "T1", FAIL, "görüntü çözülemedi", str(e)[:120])
    SON.ekle(ad, "T1", OK if fark < T1_ESIK else FAIL,
             f"z15 statik ↔ z16 karo ortalama fark < {T1_ESIK}/255",
             f"fark={fark:.2f}/255 (referans 0.21-1.39)")

    # KONTROL: yanlış-ölçek hipotezi (1024·2^z) z14 statiğe denk gelir → fark BÜYÜK olmalı.
    # Bu testin ayırt edici olduğunun kanıtı; küçük çıkarsa T1 sonucu GÜVENİLMEZ.
    dc, _, ct, _ = iste(statik_url(taban, onek, lon, lat, z - 2), zaman_asimi=za)
    if dc == 200 and ct:
        try:
            kf = piksel_farki(karo, ct)
            SON.ekle(ad, "T1", OK if kf > T1_KONTROL_ALT else FAIL,
                     f"kontrol: yanlış ölçek (z14) farkı > {T1_KONTROL_ALT}/255",
                     f"fark={kf:.2f}/255 (referans 64.8) — ayrım net mi")
        except Exception as e:
            SON.ekle(ad, "T1", BILGI, "kontrol deneyi çözülemedi", str(e)[:120])
    else:
        SON.ekle(ad, "T1", BILGI, "kontrol deneyi atlandı", f"durum={dc}")
    return None


# ══════════════════════════════════════════════════════════════════════════════
# T3 — BAŞLIK KONTROLÜ (⚠️ GET ile; HEAD tuzağı ayrıca kanıtlanır)
# ══════════════════════════════════════════════════════════════════════════════
def t3_basliklar(ad, taban, onek, za, yeni_mi):
    z, x, y = Z16
    kurl = f"{taban}/xyz/sat/{z}/{x}/{y}.jpg"
    d, b, g, _ = iste(kurl, zaman_asimi=za)
    SON.ekle(ad, "T3", OK if d == 200 and g else FAIL, "/xyz 200 + gövde", f"durum={d} n={len(g)}")
    SON.ekle(ad, "T3", OK if b.get("access-control-allow-origin") == "*" else FAIL,
             "/xyz ACAO:*  (yoksa WebGL karo çekemez → video BEMBEYAZ)",
             b.get("access-control-allow-origin"))
    SON.ekle(ad, "T3", OK if "cross-origin" in (b.get("cross-origin-resource-policy") or "") else FAIL,
             "/xyz CORP: cross-origin", b.get("cross-origin-resource-policy"))
    SON.ekle(ad, "T3", OK if KARO_CC in (b.get("cache-control") or "") else FAIL,
             "/xyz Cache-Control 30 g", b.get("cache-control"))
    SON.ekle(ad, "T3", OK if "image/jpeg" in (b.get("content-type") or "") else FAIL,
             "/xyz Content-Type image/jpeg", b.get("content-type"))
    _, b2, _, _ = iste(kurl, zaman_asimi=za)                  # 2. istek: kenar önbelleği
    SON.ekle(ad, "T3", BILGI, "/xyz ikinci istek cf-cache-status",
             b2.get("cf-cache-status") or b2.get("x-onbellek") or "-")

    z, x, y = MVT_ISTANBUL_Z14
    d, b, g, _ = iste(f"{taban}/mvt/{z}/{x}/{y}.mvt", zaman_asimi=za)
    SON.ekle(ad, "T3", OK if d == 200 and MVT_TIP in (b.get("content-type") or "") else FAIL,
             "/mvt Content-Type + 200", f"durum={d} ct={b.get('content-type')}")
    SON.ekle(ad, "T3", OK if b.get("access-control-allow-origin") == "*" else FAIL,
             "/mvt ACAO:*", b.get("access-control-allow-origin"))
    SON.ekle(ad, "T3", OK if KARO_CC in (b.get("cache-control") or "") else FAIL,
             "/mvt Cache-Control 30 g", b.get("cache-control"))

    # Statik: bugünkü origin başlıksız (B11, canlı ölçümle kanıtlı) → ESKİ'de BİLGİ.
    # Katman ekliyor (bonus) → YENİ'de ZORUNLU + ikinci istekte X-Onbellek: cache-api.
    surl = statik_url(taban, onek, *Z16_MERKEZ, 15)
    d, b, g, _ = iste(surl, zaman_asimi=za)
    cc = b.get("cache-control") or ""
    SON.ekle(ad, "T3", OK if d == 200 and g else FAIL, "statik 200 + gövde", f"durum={d} n={len(g)}")
    if yeni_mi:
        SON.ekle(ad, "T3", OK if KARO_CC in cc else FAIL, "statik Cache-Control 30 g (katman ekler)", cc or "YOK")
        SON.ekle(ad, "T3", OK if b.get("access-control-allow-origin") == "*" else FAIL,
                 "statik ACAO:* (katman ekler)", b.get("access-control-allow-origin"))
        _, b2, _, _ = iste(surl, zaman_asimi=za)
        ob = b2.get("x-onbellek") or b2.get("cf-cache-status") or "-"
        SON.ekle(ad, "T3", OK if ob in ("cache-api", "HIT") else BILGI,
                 "statik ikinci istek önbellekten", ob)
    else:
        SON.ekle(ad, "T3", BILGI, "statik Cache-Control (bugün YOK — B11 fiili durum)", cc or "YOK")

    # HEAD TUZAĞI: T3 neden GET ile koşuluyor — kanıt satırı (asla FAIL etmez).
    dh, _, _, _ = iste(surl, yontem="HEAD", zaman_asimi=za)
    SON.ekle(ad, "T3", BILGI, "HEAD tuzağı (bu yüzden GET kullanılır)", f"HEAD statik → {dh}")


# ══════════════════════════════════════════════════════════════════════════════
# T6 — MVT 204 KURALI (404 ASLA: 10×404 = eski IPS sınıfı ban riski + MapLibre 204'ü yutar)
# ══════════════════════════════════════════════════════════════════════════════
def t6_mvt(ad, taban, za):
    for etiket, (z, x, y), bekle_dolu in (
        ("İstanbul z14", MVT_ISTANBUL_Z14, True),
        ("İstanbul z15", MVT_ISTANBUL_Z15, True),
        ("eksik karo (arşiv tavanı üstü z16)", MVT_EKSIK, False),
        ("derin okyanus z15", MVT_OKYANUS, False),
    ):
        d, b, g, _ = iste(f"{taban}/mvt/{z}/{x}/{y}.mvt", zaman_asimi=za)
        SON.ekle(ad, "T6", OK if d != 404 else FAIL,
                 f"{etiket}: 404 DÖNMÜYOR", f"durum={d}")
        if bekle_dolu:
            SON.ekle(ad, "T6", OK if d == 200 and len(g) > 100 else FAIL,
                     f"{etiket}: 200 + dolu karo", f"durum={d} n={len(g)}")
            SON.ekle(ad, "T6", OK if MVT_TIP in (b.get("content-type") or "") else FAIL,
                     f"{etiket}: Content-Type", b.get("content-type"))
        else:
            SON.ekle(ad, "T6", OK if d in (204, 200) else FAIL,
                     f"{etiket}: 204 (ya da asgari 200 karo)",
                     f"durum={d} n={len(g)}" + ("  ← 204 kuralı" if d == 204 else ""))


# ══════════════════════════════════════════════════════════════════════════════
# T4 — MATCHING SÖZLEŞMESİ (code:"Ok" + confidence + ~20 m + boş biçim)
# ══════════════════════════════════════════════════════════════════════════════
def match_url(taban, onek, profil, iz, rad="32"):
    n = len(iz.split(";"))
    return (f"{taban}/{onek}/matching/v5/mapbox/{profil}/{iz}"
            f"?geometries=geojson&overview=full&tidy=true"
            f"&radiuses={';'.join([rad] * n)}&access_token=pk.x")


def t4_matching(ad, taban, onek, za, yeni_mi):
    d, b, g, ms = iste(match_url(taban, onek, "driving", IZ_YOL, "22"), zaman_asimi=za)
    try:
        j = json.loads(g)
    except Exception:
        j = {}
    m0 = (j.get("matchings") or [{}])[0] if j.get("matchings") else {}
    SON.ekle(ad, "T4", OK if d == 200 else FAIL, "driving 200", f"durum={d} {ms} ms")
    kod = j.get("code")
    if yeni_mi:
        SON.ekle(ad, "T4", OK if kod == "Ok" else FAIL,
                 'code:"Ok" (A5 — 4 tüketici bunu ŞART koşuyor)', f"code={kod!r}")
    else:
        SON.ekle(ad, "T4", FARK if kod is None else OK,
                 'code:"Ok" — ESKİ uçta YOK (bilinen kusur, A5; katman EKLEYECEK)', f"code={kod!r}")
    krd = (m0.get("geometry") or {}).get("coordinates") or []
    SON.ekle(ad, "T4", OK if isinstance(m0.get("confidence"), (int, float)) else FAIL,
             "confidence alanı var (taktik ≥0.35 ile erken kabul eder)", m0.get("confidence"))
    SON.ekle(ad, "T4", OK if (m0.get("geometry") or {}).get("type") == "LineString" and len(krd) >= 2 else FAIL,
             "LineString + dolu geometri", f"n={len(krd)}")
    if len(krd) >= 3:
        adim = [metre(krd[i - 1], krd[i]) for i in range(1, len(krd))]
        adim = [a for a in adim if a > 0.01]
        en = max(adim) if adim else 0
        SON.ekle(ad, "T4", OK if en < 45 else FAIL,
                 "~20 m yeniden örnekleme: max adım < 45 m (kamera penceresi buna kalibre)",
                 f"max={en:.1f} m")

    for rad in ("30", "32", "45"):
        d2, _, g2, _ = iste(match_url(taban, onek, "driving", IZ_YOL, rad), zaman_asimi=za)
        SON.ekle(ad, "T4", OK if d2 == 200 else FAIL, f"radiuses={rad} kabul (yutulur)", f"durum={d2}")

    d3, _, g3, _ = iste(match_url(taban, onek, "driving", IZ_DENIZ, "25"), zaman_asimi=za)
    SON.ekle(ad, "T4", OK if d3 == 200 and g3.strip() == b'{"matchings":[]}' else FAIL,
             'oturmayan iz → bayt-birebir {"matchings":[]}',
             f"durum={d3} govde={g3[:40]!r}")

    for p in ("cycling", "walking"):
        dp, _, _, _ = iste(match_url(taban, onek, p, IZ_YOL), zaman_asimi=za)
        SON.ekle(ad, "T4", BILGI if dp in (200, 404) else FAIL,
                 f"{p} profili (KV `profiller` politikası)",
                 f"durum={dp} " + ("→ 404 = bugünkü davranış birebir" if dp == 404 else "→ 3 profil AÇIK"))


# ══════════════════════════════════════════════════════════════════════════════
# T11 önek denetimi + B8 geocoding
# ══════════════════════════════════════════════════════════════════════════════
def t11_onek(ad, taban, za):
    for etiket, yol in (
        ("matching", f"/matching/v5/mapbox/driving/{IZ_YOL}"),
        ("styles", "/styles/v1/mapbox/satellite-v9/static/29.000000,41.000000,10.000,0/64x64@2x"),
        ("geocoding", f"/geocoding/v5/mapbox.places/{GEO_NOKTA}.json?limit=1"),
    ):
        d, _, _, _ = iste(taban + yol, zaman_asimi=za)
        SON.ekle(ad, "T11", OK if d == 404 else FAIL, f"öneksiz /{etiket} → 404", f"durum={d}")
    d, _, _, _ = iste(f"{taban}/yanlisonek/matching/v5/mapbox/driving/{IZ_YOL}", zaman_asimi=za)
    SON.ekle(ad, "T11", OK if d == 404 else FAIL, "yanlış önek → 404", f"durum={d}")
    d, _, g, _ = iste(f"{taban}/saglik", zaman_asimi=za)
    SON.ekle(ad, "T11", OK if d == 200 else FAIL, "/saglik anonim 200", f"durum={d} {g[:60]!r}")


def b8_geocoding(ad, taban, onek, za):
    u = (f"{taban}/{onek}/geocoding/v5/mapbox.places/{GEO_NOKTA}.json"
         f"?types=poi,neighborhood,locality,place&limit=1&language=tr")
    d, b, g, _ = iste(u, zaman_asimi=za)
    try:
        j = json.loads(g)
    except Exception:
        j = {}
    f0 = (j.get("features") or [{}])[0] if j.get("features") else {}
    SON.ekle(ad, "B8", OK if d == 200 else FAIL, "geocoding 200 (A4: katmanda kalır)", f"durum={d}")
    SON.ekle(ad, "B8", OK if isinstance(f0.get("text"), str) and f0["text"] else FAIL,
             "minimal alan sözleşmesi: features[0].text", f0.get("text"))
    SON.ekle(ad, "B8", OK if isinstance(f0.get("context"), list) else BILGI,
             "context[] var", str(f0.get("context"))[:80])


# ══════════════════════════════════════════════════════════════════════════════
# K* — ESKİ ↔ YENİ KARŞILAŞTIRMA
# ══════════════════════════════════════════════════════════════════════════════
def karsilastir(eski, yeni, onek, za):
    ad = "ESKİ↔YENİ"
    # K1 statik piksel farkı: aynı URL iki uçtan → görsel olarak AYNI olmalı
    u = lambda t: statik_url(t, onek, *Z16_MERKEZ, 15)
    d1, _, g1, _ = iste(u(eski), zaman_asimi=za)
    d2, _, g2, _ = iste(u(yeni), zaman_asimi=za)
    if d1 == 200 and d2 == 200 and g1 and g2:
        try:
            f = piksel_farki(g1, g2)
            SON.ekle(ad, "K1", OK if f < T1_ESIK else FAIL,
                     f"statik görüntü farkı < {T1_ESIK}/255", f"fark={f:.2f}/255")
        except Exception as e:
            SON.ekle(ad, "K1", FAIL, "statik karşılaştırması çözülemedi", str(e)[:120])
    else:
        SON.ekle(ad, "K1", FAIL, "statik iki uçtan alınamadı", f"eski={d1} yeni={d2}")

    # K2 matching geometri paritesi (hedef: nokta sayısı aynı, max sapma 0.000 m)
    def koord(taban):
        d, _, g, _ = iste(match_url(taban, onek, "driving", IZ_PARITE), zaman_asimi=za)
        try:
            j = json.loads(g)
            return d, (((j.get("matchings") or [{}])[0].get("geometry") or {}).get("coordinates") or [])
        except Exception:
            return d, []
    de, ke = koord(eski)
    dy, ky = koord(yeni)
    if de == 200 and dy == 200 and ke and ky:
        SON.ekle(ad, "K2", OK if len(ke) == len(ky) else FAIL,
                 "matching nokta sayısı aynı", f"eski={len(ke)} yeni={len(ky)}")
        if len(ke) == len(ky):
            sap = max(metre(a, b) for a, b in zip(ke, ky))
            SON.ekle(ad, "K2", OK if sap < PARITE_ESIK_M else FAIL,
                     f"nokta-nokta max sapma < {PARITE_ESIK_M} m (hedef 0.000)", f"sapma={sap:.3f} m")
    else:
        SON.ekle(ad, "K2", FAIL, "matching iki uçtan alınamadı", f"eski={de} yeni={dy}")

    # K3 MVT bayt eşitliği (bilgi: Hooder hattı yeniden üretiyorsa bayt farkı normal)
    z, x, y = MVT_ISTANBUL_Z14
    _, _, m1, _ = iste(f"{eski}/mvt/{z}/{x}/{y}.mvt", zaman_asimi=za)
    _, _, m2, _ = iste(f"{yeni}/mvt/{z}/{x}/{y}.mvt", zaman_asimi=za)
    SON.ekle(ad, "K3", BILGI, "MVT bayt eşitliği (bilgi)",
             f"eski={len(m1)} B yeni={len(m2)} B " + ("AYNI" if m1 == m2 else "FARKLI"))


# ══════════════════════════════════════════════════════════════════════════════
def uc_takimi(ad, taban, onek, za, yeni_mi, atla):
    print(f"\n══ {ad}: {taban} (önek gizli) ══")
    if "T11" not in atla:
        t11_onek(ad, taban, za)
    if "T1" not in atla:
        t1_olcek(ad, taban, onek, za)
    if "T3" not in atla:
        t3_basliklar(ad, taban, onek, za, yeni_mi)
    if "T6" not in atla:
        t6_mvt(ad, taban, za)
    if "T4" not in atla:
        t4_matching(ad, taban, onek, za, yeni_mi)
    if "B8" not in atla:
        b8_geocoding(ad, taban, onek, za)
    yaz(ad)


def yaz(ad):
    for s in SON.satir:
        if s.get("_y") or s["uc"] != ad:
            continue
        s["_y"] = True
        im = {OK: "  OK  ", FAIL: " FAIL ", BILGI: " bilgi", FARK: " FARK "}[s["durum"]]
        print(f"{im} [{s['test']}] {s['ad']}" + (f" — {s['detay']}" if s["detay"] else ""))


def main():
    global _ONEK
    p = argparse.ArgumentParser(add_help=True)
    p.add_argument("--eski", default=os.environ.get("ESKI", "https://harita.nickdegs.com"))
    p.add_argument("--yeni", default=os.environ.get("YENI", ""))
    p.add_argument("--sadece-yeni", action="store_true")
    p.add_argument("--onek", default=os.environ.get("ONEK", ""))
    p.add_argument("--zaman-asimi", type=int, default=90)
    p.add_argument("--atla", default="")
    p.add_argument("--json", action="store_true")
    a = p.parse_args()

    onek = a.onek
    if not onek:
        try:
            onek = re.search(r"HARITA_UC_ONEK=(\S+)",
                             open("/opt/matrix/secrets/harita-uc.conf").read()).group(1)
        except Exception:
            print("HATA: önek yok — --onek ver ya da /opt/matrix/secrets/harita-uc.conf koy",
                  file=sys.stderr)
            return 2
    _ONEK = onek
    atla = {x.strip().upper() for x in a.atla.split(",") if x.strip()}
    eski = a.eski.rstrip("/")
    yeni = a.yeni.rstrip("/")

    print("harita katmanı — DEVİR GÜNÜ TESTİ (T1 ölçek · T3 başlık · T6 MVT-204 · T4 matching)")
    print(f"eşikler: T1<{T1_ESIK}/255 (kontrol>{T1_KONTROL_ALT}) · parite<{PARITE_ESIK_M} m")

    if not a.sadece_yeni:
        uc_takimi("ESKİ", eski, onek, a.zaman_asimi, False, atla)
    if yeni:
        uc_takimi("YENİ", yeni, onek, a.zaman_asimi, True, atla)
        if not a.sadece_yeni:
            print("\n══ ESKİ ↔ YENİ karşılaştırması ══")
            karsilastir(eski, yeni, onek, a.zaman_asimi)
            yaz("ESKİ↔YENİ")
    else:
        print("\n══ YENİ uç verilmedi ══")
        print("  Karşılaştırma HAZIR: devir günü aynı komuta `--yeni https://harita.nickdegs.com`")
        print("  ekleyin (route çevrildikten sonra) ya da worker'ın workers.dev adresini verin.")
        print("  Yukarıdaki ESKİ sonuçları TEMEL ÇİZGİdir — YENİ uç bunları tutturmalı.")

    n = {k: sum(1 for s in SON.satir if s["durum"] == k) for k in (OK, FAIL, BILGI, FARK)}
    print(f"\nSONUÇ: {n[OK]} OK · {n[FAIL]} FAIL · {n[FARK]} beklenen-fark · {n[BILGI]} bilgi")
    if a.json:
        temiz = [{k: v for k, v in s.items() if not k.startswith("_")} for s in SON.satir]
        print(json.dumps({"ozet": n, "satir": temiz}, ensure_ascii=False, indent=1))
    return 1 if n[FAIL] else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(2)
