#!/usr/bin/env python3
"""STATİK BİREBİRLİK TESTİ (RunPod'suz, $0) — 2026-08-31

Soru: statik birleştirme motora (harita_yan.py) taşınınca çıktı bugünküyle aynı mı?

⚠️ DOĞRU TABAN NEDİR — ilk denemede yanlış seçildi, ölçümle düzeltildi:
   Disk'teki `harita-cache/static/**` dosyaları GEÇMİŞTE üretilmiş; aradan geçen zamanda
   Esri karoları tazelenmiş olabiliyor. Ölçüldü: 40 üretim çıktısının 4'ünde CANLI PROXY'nin
   KENDİSİ de bugün aynı farkı veriyor (proxy_vs_disk = yan_vs_disk = 221/212). Yani o fark
   TAŞIMANIN değil, önbelleğin yaşının eseri. Bu yüzden doğru taban:
        CANLI harita-proxy.py'nin BUGÜN ürettiği görüntü
   ve karşılaştırma AYNI karo baytlarıyla yapılır.

AŞAMALAR
  A) DİKİŞ İZOLASYONU — iki taraf da karoları canlı önbellekten okur (AYNI baytlar).
     Yalnız dikiş/kırpma/ölçek/JPEG kodu karşılaştırılır. Ağ YOK. Beklenen: maks fark 0.
  B) UÇTAN UCA — yan-servis KENDİ sunucusuz zincirini kullanır (Esri doğrudan + /mvt HTTP),
     canlı proxy kendi zincirini (önbellek/Esri/pmtiles mount). Gerçek devir sapmasını ölçer.

Kullanım:  python3 test_statik_parite.py [A|B] [adet]
"""
import io
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, "/opt/matrix/scripts")
os.environ.setdefault("HARITA_YAN_CACHE", "/tmp/harita-yan-test")

from PIL import Image, ImageChops  # noqa: E402

CANLI = "/opt/matrix/harita-cache"
PROXY = "/opt/matrix/scripts/harita-proxy.py"
NOKTA = re.compile(r"^(sat|strm|str)/([\d.]+)/(-?[\d.]+)_(-?[\d.]+)_(\d+)x(\d+)\.jpg$")
BBOX = re.compile(r"^(sat|strm|str)/bbox_(-?[\d.]+)_(-?[\d.]+)_(-?[\d.]+)_(-?[\d.]+)_(\d+)x(\d+)\.jpg$")


def proxy_yukle():
    """Canlı harita-proxy.py'yi MODÜL olarak yükle (servisi başlatmaz: __main__ değil)."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("harita_proxy_canli", PROXY)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def isler():
    """Canlı statik önbelleğindeki her GERÇEK ÜRETİM çıktısı -> test koordinatı."""
    kok = os.path.join(CANLI, "static")
    for dizin, _, adlar in os.walk(kok):
        for ad in adlar:
            bagil = os.path.relpath(os.path.join(dizin, ad), kok)
            m = NOKTA.match(bagil)
            if m:
                yield ("nokta", m.group(1), (float(m.group(3)), float(m.group(4)),
                                             float(m.group(2)), int(m.group(5)), int(m.group(6))), bagil)
                continue
            m = BBOX.match(bagil)
            if m:
                yield ("bbox", m.group(1), (float(m.group(2)), float(m.group(3)), float(m.group(4)),
                                            float(m.group(5)), int(m.group(6)), int(m.group(7))), bagil)


def karo_onbellekten(kind, osmz, x, y, katman=None, _derinlik=0):
    """AŞAMA A: karo baytları CANLI önbellekten, SALT-OKUMA. Eksikse istisna -> iş atlanır."""
    n = 2 ** osmz
    x %= n
    if not (0 <= y < n):
        return Image.new("RGB", (256, 256), (10, 12, 18))
    cp = os.path.join(CANLI, f"tile-{kind}", f"{osmz}/{x}/{y}.jpg")
    if not os.path.exists(cp):
        raise FileNotFoundError(cp)
    return Image.open(cp).convert("RGB")


def jpeg_tur(im, q):
    t = io.BytesIO()
    im.convert("RGB").save(t, "JPEG", quality=q)
    t.seek(0)
    return Image.open(t).convert("RGB")


def olc(a, b):
    if a.size != b.size:
        return None
    d = ImageChops.difference(a, b)
    enb = max(k[1] for k in d.getextrema())
    g = d.convert("L")
    veri = list(g.getdata())
    return enb, sum(veri) / len(veri), 100.0 * sum(1 for p in veri if p > 5) / len(veri)


def main():
    asama = (sys.argv[1] if len(sys.argv) > 1 else "A").upper()
    tavan = int(sys.argv[2]) if len(sys.argv) > 2 else 40
    hp = proxy_yukle()
    import harita_yan as hy

    if asama == "A":
        hp._tile = karo_onbellekten
        hy._tile = karo_onbellekten
        print("AŞAMA A — DİKİŞ İZOLASYONU: her iki taraf AYNI karo baytlarını kullanır (ağ YOK)")
    else:
        print(f"AŞAMA B — UÇTAN UCA: yan-servis kendi zinciri (uzak={hy.UZAK or 'YOK'}, "
              f"mvt={os.environ.get('HARITA_MVT') or 'YOK'}) ↔ canlı proxy kendi zinciri")
    print(f"taban = CANLI harita-proxy.py'nin BUGÜNKÜ çıktısı  ·  en fazla {tavan} iş\n")

    sayim = {"ayni": 0, "kucuk": 0, "buyuk": 0, "atlandi": 0, "hata": 0}
    tur = {}
    satirlar = []
    bakilan = 0
    for tip, kind, par, bagil in sorted(isler(), key=lambda t: t[3]):
        if bakilan >= tavan:
            break
        t0 = time.time()
        try:
            if tip == "nokta":
                lon, lat, z, w, h = par
                a = hp._stitch(kind, lon, lat, z, w, h)
                b = hy._stitch(kind, lon, lat, z, w, h)
                q = 87
                etiket = f"{kind} z{z:g} {lat:.4f},{lon:.4f} {w}x{h}"
            else:
                lon0, lat0, lon1, lat1, w, h = par
                a = hp._stitch_bbox(kind, lon0, lat0, lon1, lat1, w, h)
                b = hy._stitch_bbox(kind, lon0, lat0, lon1, lat1, w, h)
                q = 92
                etiket = f"{kind} bbox {lat0:.3f}..{lat1:.3f} {w}x{h}"
        except FileNotFoundError:
            sayim["atlandi"] += 1
            continue
        except Exception as e:
            sayim["hata"] += 1
            satirlar.append(f"  HATA   {bagil[-46:]}  {type(e).__name__}: {str(e)[:60]}")
            bakilan += 1
            continue
        bakilan += 1
        s = olc(jpeg_tur(a, q), jpeg_tur(b, q))
        sure = time.time() - t0
        if s is None:
            sayim["hata"] += 1
            satirlar.append(f"  BOYUT  {etiket}: {a.size} != {b.size}")
            continue
        enb, ort, yuzde = s
        anahtar = f"{kind}/{tip}"
        d = tur.setdefault(anahtar, {"n": 0, "maks": 0})
        d["n"] += 1
        d["maks"] = max(d["maks"], enb)
        if enb == 0:
            sayim["ayni"] += 1; isaret = "✓ BİREBİR"
        elif enb <= 5:
            sayim["kucuk"] += 1; isaret = "✓ <=5/255"
        else:
            sayim["buyuk"] += 1; isaret = "✗ SAPMA"
        satirlar.append(f"  {isaret:10s} maks={enb:3d} ort={ort:5.2f} >5px=%{yuzde:5.2f} "
                        f"({sure:4.1f}sn)  {etiket}")
    for s in satirlar:
        print(s)
    print(f"\nTÜRE GÖRE: " + "  ".join(f"{k}={v['n']} (maks {v['maks']})" for k, v in sorted(tur.items())))
    print(f"ÖZET: birebir={sayim['ayni']}  <=5/255={sayim['kucuk']}  SAPMA={sayim['buyuk']}  "
          f"atlandı(karo yok)={sayim['atlandi']}  hata={sayim['hata']}")
    if asama != "A":
        print("yan-servis sayaç:", hy.sayac())
    return 1 if (sayim["buyuk"] or sayim["hata"]) else 0


if __name__ == "__main__":
    sys.exit(main())
