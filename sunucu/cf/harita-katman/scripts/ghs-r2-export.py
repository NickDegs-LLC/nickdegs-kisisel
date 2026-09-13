#!/usr/bin/env python3
"""GHS-BUILT-H ANBH GeoTIFF'leri → R2 blokları (cf-harita-katman `/yukseklik` sunucusuzlaştırma, 02.09).

Kaynak: /opt/matrix/harita-yukseklik/GHS_BUILT_H_ANBH_E2018_GLOBE_R2023A_54009_100_V1_0_R{5,6}_C{21,22,23}.tif
        (float32, nodata 255, 100 m hücre, World_Mollweide; harita-proxy.py:590-664 bunları rasterio ile örnekler)
Çıktı:  {out}/index.json                      — raster sınırları + dolu-blok bit haritası (src/ghs.js okur)
        {out}/{ad}/{by}_{bx}.bin              — gzip; 256×256 uint16 LITTLE-ENDIAN, satır-öncelikli,
                                                değer = DESİMETRE = Python round(val, 1) * 10; nodata/≤0 = 0.
                                                Kenar blokları 256'ya sıfırla doldurulur; tamamen sıfır blok YAZILMAZ.
Python round(val,1) BİREBİR: float32 × 10 float64'te TAM hesaplanır (24+4 bit < 53) → np.rint (yarım→çift)
tam olarak Python'un ondalık yarım→çift kuralıyla aynı sonucu verir (örnek denetimiyle doğrulanır, aşağıda).
Kullanım: ghs-r2-export.py --out DIZIN [--upload]   (--upload: rclone → r2:harita-match-cache/ghs/)
"""
import argparse
import glob
import gzip
import json
import math
import os
import random
import re
import subprocess
import sys
import time

import numpy as np
import rasterio
from rasterio.windows import Window

BLOK = 256
R2_HEDEF = "r2:harita-match-cache/ghs"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--kaynak", default="/opt/matrix/harita-yukseklik")
    ap.add_argument("--out", required=True)
    ap.add_argument("--upload", action="store_true")
    a = ap.parse_args()

    dosyalar = sorted(glob.glob(os.path.join(a.kaynak, "*.tif")))  # harita-proxy ile AYNI sıra (sonraki ezer)
    if not dosyalar:
        sys.exit("tif yok: " + a.kaynak)
    os.makedirs(a.out, exist_ok=True)
    t0 = time.time()
    rasterlar = []
    toplam_blok = 0
    toplam_bayt = 0
    ornek = []  # (float32 değer, desimetre) — round denetimi
    for f in dosyalar:
        m = re.search(r"_R(\d+)_C(\d+)\.tif$", f)
        ad = f"R{m.group(1)}_C{m.group(2)}" if m else os.path.splitext(os.path.basename(f))[0]
        ds = rasterio.open(f)
        w, h = ds.width, ds.height
        nodata = ds.nodata
        tr = ds.transform
        assert tr.b == 0 and tr.d == 0 and tr.a > 0 and tr.e < 0, "dönmeli/ters raster desteklenmiyor"
        nbx, nby = math.ceil(w / BLOK), math.ceil(h / BLOK)
        dolu = bytearray((nbx * nby + 7) // 8)
        os.makedirs(os.path.join(a.out, ad), exist_ok=True)
        blok_say = 0
        for by in range(nby):
            for bx in range(nbx):
                ww, hh = min(BLOK, w - bx * BLOK), min(BLOK, h - by * BLOK)
                arr = ds.read(1, window=Window(bx * BLOK, by * BLOK, ww, hh))
                gecerli = (arr != nodata) & (arr > 0)
                if not gecerli.any():
                    continue
                dm = np.rint(arr.astype(np.float64) * 10.0)  # TAM çarpım + yarım→çift = Python round(val,1)*10
                dm[~gecerli] = 0
                if dm.max() >= 65536:
                    sys.exit(f"{ad} {by}_{bx}: desimetre taşması {dm.max()}")
                blok = np.zeros((BLOK, BLOK), np.uint16)
                blok[:hh, :ww] = dm.astype(np.uint16)
                if not blok.any():
                    continue  # (0, 0.05) aralığı 0'a yuvarlanır → boş blok yazma
                govde = gzip.compress(blok.astype("<u2").tobytes(), compresslevel=9)
                with open(os.path.join(a.out, ad, f"{by}_{bx}.bin"), "wb") as fp:
                    fp.write(govde)
                i = by * nbx + bx
                dolu[i >> 3] |= 0x80 >> (i & 7)
                blok_say += 1
                toplam_bayt += len(govde)
                if len(ornek) < 4000:
                    ys, xs = np.nonzero(gecerli)
                    for k in random.sample(range(len(ys)), min(20, len(ys))):
                        ornek.append((arr[ys[k], xs[k]], int(blok[ys[k], xs[k]])))
        rasterlar.append({
            "ad": ad,
            "left": ds.bounds.left, "top": ds.bounds.top, "right": ds.bounds.right, "bottom": ds.bounds.bottom,
            "hucre": tr.a,  # 100.0 m (e = -100)
            "w": w, "h": h, "nbx": nbx, "nby": nby,
            "dolu": dolu.hex(),
        })
        toplam_blok += blok_say
        print(f"{ad}: {w}x{h}, {blok_say}/{nbx * nby} dolu blok", flush=True)

    # Python round(val,1) denetimi — hesaplanan desimetre, Python'un kendi round'uyla BİREBİR olmalı
    hata = [(v, d) for v, d in ornek if int(round(round(float(v), 1) * 10)) != d]
    if hata:
        sys.exit(f"round uyumsuzluğu ({len(hata)} örnek): {hata[:5]}")
    indeks = {"surum": 1, "blok": BLOK, "R": 6378137.0, "rasterlar": rasterlar}
    with open(os.path.join(a.out, "index.json"), "w") as fp:
        json.dump(indeks, fp, separators=(",", ":"))
    print(f"toplam {toplam_blok} blok, {toplam_bayt / 1048576:.1f} MB, round denetimi {len(ornek)} örnek TAMAM, "
          f"{time.time() - t0:.1f} s", flush=True)

    if a.upload:
        t1 = time.time()
        subprocess.run(["rclone", "copy", "--transfers", "32", "--checkers", "32", "--no-traverse",
                        a.out, R2_HEDEF], check=True)
        print(f"upload tamam → {R2_HEDEF} ({time.time() - t1:.0f} s)", flush=True)


if __name__ == "__main__":
    main()
