# -*- coding: utf-8 -*-
"""Asgari MVT (Mapbox Vector Tile) cozucu — bagimlilik yok.
Amac: /mvt ucundan gelen karodaki `water` katmani poligonlarini cikarip
nokta-karada mi sorusunu KAYNAK VERIDEN cevaplamak (renk sezgisi DEGIL)."""
import struct


def _varint(b, i):
    r = 0
    s = 0
    while True:
        c = b[i]
        i += 1
        r |= (c & 0x7F) << s
        if not (c & 0x80):
            return r, i
        s += 7


def _alanlar(b, i, son):
    """(alan_no, tel_tipi, deger|dilim, yeni_i) uretir."""
    while i < son:
        anahtar, i = _varint(b, i)
        alan, tel = anahtar >> 3, anahtar & 7
        if tel == 0:
            v, i = _varint(b, i)
            yield alan, tel, v, i
        elif tel == 1:
            v = b[i:i + 8]
            i += 8
            yield alan, tel, v, i
        elif tel == 2:
            n, i = _varint(b, i)
            v = b[i:i + n]
            i += n
            yield alan, tel, v, i
        elif tel == 5:
            v = b[i:i + 4]
            i += 4
            yield alan, tel, v, i
        else:
            raise ValueError("bilinmeyen tel tipi %d" % tel)


def _packed(b):
    out = []
    i = 0
    while i < len(b):
        v, i = _varint(b, i)
        out.append(v)
    return out


def _zig(v):
    return (v >> 1) ^ -(v & 1)


def _geometri(cmds):
    """MVT komut akisi -> halka listesi [[(x,y),...], ...] (tile-yerel koordinat)."""
    halkalar = []
    cur = []
    x = y = 0
    i = 0
    while i < len(cmds):
        c = cmds[i]
        i += 1
        kid, adet = c & 0x7, c >> 3
        if kid == 1:                      # MoveTo
            for _ in range(adet):
                x += _zig(cmds[i]); y += _zig(cmds[i + 1]); i += 2
                if cur:
                    halkalar.append(cur)
                cur = [(x, y)]
        elif kid == 2:                    # LineTo
            for _ in range(adet):
                x += _zig(cmds[i]); y += _zig(cmds[i + 1]); i += 2
                cur.append((x, y))
        elif kid == 7:                    # ClosePath
            if cur:
                halkalar.append(cur)
                cur = []
        else:
            break
    if cur:
        halkalar.append(cur)
    return halkalar


def katmanlar(karo_bytes):
    """{ad: {"extent":int, "ozellikler":[(tip, halkalar), ...]}}"""
    sonuc = {}
    for alan, tel, v, _ in _alanlar(karo_bytes, 0, len(karo_bytes)):
        if alan != 3 or tel != 2:
            continue
        ad, extent, ozellikler = None, 4096, []
        for a2, t2, v2, _ in _alanlar(v, 0, len(v)):
            if a2 == 1 and t2 == 2:
                ad = v2.decode("utf-8", "replace")
            elif a2 == 5 and t2 == 0:
                extent = v2
            elif a2 == 2 and t2 == 2:      # Feature
                tip, geo = 0, []
                for a3, t3, v3, _ in _alanlar(v2, 0, len(v2)):
                    if a3 == 3 and t3 == 0:
                        tip = v3
                    elif a3 == 4 and t3 == 2:
                        geo = _geometri(_packed(v3))
                ozellikler.append((tip, geo))
        if ad:
            sonuc[ad] = {"extent": extent, "ozellikler": ozellikler}
    return sonuc


def _alan2(halka):
    """Ayakkabi bagi alani (isaretli). MVT'de dis halka SAAT YONU (y asagi) -> pozitif."""
    s = 0.0
    n = len(halka)
    for k in range(n):
        x1, y1 = halka[k]
        x2, y2 = halka[(k + 1) % n]
        s += x1 * y2 - x2 * y1
    return s / 2.0


def _icinde(px, py, halka):
    icinde = False
    n = len(halka)
    j = n - 1
    for k in range(n):
        xi, yi = halka[k]
        xj, yj = halka[j]
        if (yi > py) != (yj > py):
            if px < (xj - xi) * (py - yi) / float(yj - yi) + xi:
                icinde = not icinde
        j = k
    return icinde


def poligon_icinde(px, py, ozellikler):
    """Cift-yon kurali: dis halkalarin icinde ve ic halkalarin (delik) disinda mi."""
    for tip, halkalar in ozellikler:
        if tip != 3:                     # yalniz POLYGON
            continue
        dis_var = False
        delikte = False
        for h in halkalar:
            if len(h) < 3:
                continue
            a = _alan2(h)
            ic = _icinde(px, py, h)
            if a > 0:                    # dis halka
                if ic:
                    dis_var = True
            else:                        # delik
                if ic:
                    delikte = True
        if dis_var and not delikte:
            return True
    return False
