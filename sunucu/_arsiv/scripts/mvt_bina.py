# -*- coding: utf-8 -*-
"""
MVT BİNA SENTEZİ (2026-08-11, Barış: "çoğu bina yok, HEPSİNİ çek Protomaps'ten")

SORUN (ölçüldü, Sultanahmet): z15 karoda 1753 bina, z14'te 35, z13'te 6, z12'de 4.
Protomaps binaları esas z15'te taşıyor; 3D kamera geniş açıda z13-14 karosu istiyor
-> videoda 3-5 rastgele bina görünüyordu.

ÇÖZÜM: z13-14 bina karosunu z15 TORUNLARINDAN sentezle: 2^d × 2^d z15 karosu oku,
buildings katmanını çöz, koordinatları ebeveyne ölçekle, TEK katmanlı MVT olarak
yeniden kodla. Feature ID'leri KORUNUR (renk id%5 + gerçek yükseklik feature-state
id ile çalışıyor). Etiket taşınmaz (stilimiz kullanmıyor).

z12 sentezlenmez: o ölçekte bina < 1 piksel (görsel katkısı yok, 64 okuma israf).
"""
import struct


# ───────────────────────── protobuf yardımcıları ─────────────────────────

def _varint_oku(b, i):
    r = 0; s = 0
    while True:
        x = b[i]; i += 1
        r |= (x & 0x7F) << s
        if not (x & 0x80):
            return r, i
        s += 7


def _varint(n):
    out = bytearray()
    while True:
        x = n & 0x7F; n >>= 7
        if n:
            out.append(x | 0x80)
        else:
            out.append(x); return bytes(out)


def _zz_coz(n):  return (n >> 1) ^ (-(n & 1))
def _zz(n):      return (n << 1) ^ (n >> 63) if n < 0 else (n << 1)


def _alan(b, i):
    """Bir protobuf alanını oku: (alan_no, tel_tipi, değer_veya_bytes, yeni_i)."""
    key, i = _varint_oku(b, i)
    fno, tel = key >> 3, key & 0x7
    if tel == 0:
        v, i = _varint_oku(b, i); return fno, tel, v, i
    if tel == 2:
        ln, i = _varint_oku(b, i); return fno, tel, b[i:i+ln], i+ln
    if tel == 5:
        return fno, tel, b[i:i+4], i+4
    if tel == 1:
        return fno, tel, b[i:i+8], i+8
    raise ValueError(f"tel tipi {tel}")


# ───────────────────────── çözücü ─────────────────────────

def binalar_coz(ham):
    """Ham MVT -> [(id, extent, rings, height|None), ...] (yalnız buildings katmanı).
    2026-08-11: height etiketi de çözülür (Barış: "Protomaps'in kendi verisinden") —
    kaynak karodaki GERÇEK yükseklik senteze taşınır."""
    out = []
    i = 0
    while i < len(ham):
        fno, tel, v, i = _alan(ham, i)
        if fno != 3 or tel != 2:
            continue
        # katman: önce keys/values tablolarını topla
        adi = None; extent = 4096; feats = []; keys = []; vals = []
        j = 0
        while j < len(v):
            f2, t2, v2, j = _alan(v, j)
            if f2 == 1:
                adi = v2.decode("utf-8", "replace")
            elif f2 == 5:
                extent = v2
            elif f2 == 2:
                feats.append(v2)
            elif f2 == 3:
                keys.append(v2.decode("utf-8", "replace"))
            elif f2 == 4:
                _kk = 0; _val = None
                while _kk < len(v2):
                    _f3, _t3, _v3, _kk = _alan(v2, _kk)
                    if _f3 == 1: _val = _v3.decode("utf-8", "replace")
                    elif _f3 == 2: _val = struct.unpack("<f", _v3)[0]
                    elif _f3 == 3: _val = struct.unpack("<d", _v3)[0]
                    elif _f3 in (4, 5): _val = _v3
                    elif _f3 == 6: _val = (_v3 >> 1) ^ (-(_v3 & 1))
                    break
                vals.append(_val)
        if adi != "buildings":
            continue
        try:
            _hidx = keys.index("height")
        except ValueError:
            _hidx = -1
        for fb in feats:
            fid = 0; tip = 0; geom = b""; hgt = None
            k = 0
            while k < len(fb):
                f3, t3, v3, k = _alan(fb, k)
                if f3 == 1: fid = v3
                elif f3 == 3: tip = v3
                elif f3 == 4: geom = v3
                elif f3 == 2 and _hidx >= 0:
                    _m = 0; _tags = []
                    while _m < len(v3):
                        _t4, _m = _varint_oku(v3, _m); _tags.append(_t4)
                    for _a in range(0, len(_tags) - 1, 2):
                        if _tags[_a] == _hidx:
                            try:
                                hgt = float(vals[_tags[_a + 1]])
                            except Exception:
                                hgt = None
                            break
            if tip != 3 or not geom:      # yalnız POLYGON
                continue
            # geometri komutlarını mutlak halkalara çöz
            rings = []; cur = None; x = y = 0
            g = 0
            while g < len(geom):
                cmd, g = _varint_oku(geom, g)
                cid, cnt = cmd & 0x7, cmd >> 3
                if cid == 1:      # MoveTo
                    for _ in range(cnt):
                        dx, g = _varint_oku(geom, g); dy, g = _varint_oku(geom, g)
                        x += _zz_coz(dx); y += _zz_coz(dy)
                        cur = [(x, y)]; rings.append(cur)
                elif cid == 2:    # LineTo
                    for _ in range(cnt):
                        dx, g = _varint_oku(geom, g); dy, g = _varint_oku(geom, g)
                        x += _zz_coz(dx); y += _zz_coz(dy)
                        cur.append((x, y))
                elif cid == 7:    # ClosePath
                    pass
            if rings:
                out.append((fid, extent, rings, hgt))
    return out


# ───────────────────────── kodlayıcı ─────────────────────────

def _len_alan(fno, data):
    return _varint((fno << 3) | 2) + _varint(len(data)) + data


def bina_karosu_kodla(features, extent=4096):
    """[(id, rings, height|None[, renk|None]), ...] -> tek 'buildings' katmanlı ham MVT.
    keys=['height','renk']: height=double, renk=string hex ('#rrggbb', GERÇEK ÇATI RENGİ —
    2026-08-11 Barış "boyalı kutu gerçekçi değil" -> uydu pikselinden örnekleniyor)."""
    fbs = bytearray()
    hvals = []            # benzersiz value tablosu: [( 'h', float ) | ( 'r', str )]
    hmap = {}
    for f in features:
        fid, rings, hgt = f[0], f[1], f[2]
        renk = f[3] if len(f) > 3 else None
        geom = bytearray(); x = y = 0
        for ring in rings:
            if len(ring) < 3:
                continue
            geom += _varint((1) | (1 << 3))                      # MoveTo ×1
            dx, dy = ring[0][0]-x, ring[0][1]-y
            geom += _varint(_zz(dx)) + _varint(_zz(dy))
            x, y = ring[0]
            geom += _varint((2) | ((len(ring)-1) << 3))          # LineTo ×n-1
            for px, py in ring[1:]:
                geom += _varint(_zz(px-x)) + _varint(_zz(py-y)); x, y = px, py
            geom += _varint(7 | (1 << 3))                        # ClosePath
        if not geom:
            continue
        _tags = []
        if hgt is not None:
            _k = ("h", float(hgt))
            if _k not in hmap:
                hmap[_k] = len(hvals); hvals.append(_k)
            _tags += [0, hmap[_k]]
        if renk:
            _k = ("r", str(renk))
            if _k not in hmap:
                hmap[_k] = len(hvals); hvals.append(_k)
            _tags += [1, hmap[_k]]
        _tagb = b""
        if _tags:
            _tb = b"".join(_varint(t) for t in _tags)
            _tagb = _len_alan(2, _tb)
        fb = (_varint((1 << 3) | 0) + _varint(fid) +             # id
              _tagb +
              _varint((3 << 3) | 0) + _varint(3) +               # type=POLYGON
              _len_alan(4, bytes(geom)))                          # geometry
        fbs += _len_alan(2, fb)                                   # layer.features
    _kv = b""
    if hvals:
        _kv = _len_alan(3, b"height") + _len_alan(3, b"renk")
        for _tip, _v in hvals:
            if _tip == "h":
                _kv += _len_alan(4, _varint((3 << 3) | 1) + struct.pack("<d", float(_v)))
            else:
                _vb = str(_v).encode()
                _kv += _len_alan(4, _len_alan(1, _vb))
    katman = (_varint((15 << 3) | 0) + _varint(2) +               # version=2
              _len_alan(1, b"buildings") +
              bytes(fbs) + _kv +
              _varint((5 << 3) | 0) + _varint(extent))            # extent
    return bytes(_len_alan(3, katman))                            # tile.layers


# ───────────────────────── sentez ─────────────────────────

def sentezle(karo_oku, z, x, y, kaynak_z=15, extent=4096):
    """z13-14 karosunu z15 torunlarından üret. karo_oku(z,x,y)->ham|None (pmtiles_okuyucu)."""
    d = kaynak_z - z
    if d <= 0:
        return None
    feats = []
    n = 1 << d
    for cy in range(n):
        for cx in range(n):
            ham = karo_oku(kaynak_z, (x << d) + cx, (y << d) + cy)
            if not ham:
                continue
            for fid, ext, rings, hgt in binalar_coz(ham):
                yeni = []
                for ring in rings:
                    r2 = [(((px + cx * ext) * extent) // (ext * n),
                           ((py + cy * ext) * extent) // (ext * n)) for px, py in ring]
                    # ardışık aynı noktaları at (ölçek küçülünce çakışır)
                    t = [r2[0]]
                    for p in r2[1:]:
                        if p != t[-1]:
                            t.append(p)
                    if len(t) >= 3:
                        yeni.append(t)
                if yeni:
                    feats.append((fid, yeni, hgt, None))
    if not feats:
        return None
    return bina_karosu_kodla(feats, extent)


# ───────────────────────── OSM + Microsoft HARMAN ─────────────────────────

def harman(karo_oku, z, x, y, ms_db="/opt/matrix/harita-yukseklik/ms-binalar.db"):
    """z13-15 karosu: OSM binaları (z15 ham / z13-14 sentez) + MS ML binaları (OSM'in boş
    bıraktığı yerler; merkez mevcut OSM binasına <12 m ise atlanır). Renk = id-hash (proxy'de
    render3d paleti uyguluyor). Broken-pipe'a dayanıklı: OSM 1 kez retry.
    2026-08-11, Barış: 'ikisini birleştir'."""
    import os, json as _j, math as _m
    EXT = 4096

    def _tbb(z, x, y):
        n = 2 ** z
        w = x / n * 360 - 180; e = (x + 1) / n * 360 - 180
        no = _m.degrees(_m.atan(_m.sinh(_m.pi * (1 - 2 * y / n))))
        so = _m.degrees(_m.atan(_m.sinh(_m.pi * (1 - 2 * (y + 1) / n))))
        return w, so, e, no

    W, S, E, N = _tbb(z, x, y)
    # ① OSM (mount hıçkırığına karşı 2 deneme)
    osm = []
    for _try in range(2):
        if z == 15:
            ham0 = karo_oku(z, x, y)
            osm = binalar_coz(ham0) if ham0 else []
        else:
            sy = sentezle(karo_oku, z, x, y)
            osm = binalar_coz(sy) if sy else []
        if osm:
            break
    feats = [(f[0], f[2], f[3], None) for f in osm]
    omerk = []
    for fid, rings, hg, rk in feats:
        r0 = rings[0]
        mx = sum(p[0] for p in r0) / len(r0); my = sum(p[1] for p in r0) / len(r0)
        omerk.append((W + (mx / EXT) * (E - W), N - (my / EXT) * (N - S)))
    # ② MS ekle
    if os.path.exists(ms_db):
        try:
            import sqlite3 as _sq
            d = 15 - z
            c = _sq.connect(ms_db)
            if z == 15:
                rows = c.execute("SELECT cx,cy,poly FROM ms WHERE x15=? AND y15=?", (x, y)).fetchall()
            else:
                rows = c.execute("SELECT cx,cy,poly FROM ms WHERE x15 BETWEEN ? AND ? AND y15 BETWEEN ? AND ?",
                                 (x << d, ((x + 1) << d) - 1, y << d, ((y + 1) << d) - 1)).fetchall()
            c.close()
            for cx, cy, pj in rows:
                yakin = False
                for ox, oy in omerk:
                    dx = (ox - cx) * 85000; dy = (oy - cy) * 111000
                    if dx * dx + dy * dy < 144:
                        yakin = True; break
                if yakin:
                    continue
                poly = _j.loads(pj)
                ring = [(int((p[0] - W) / (E - W) * EXT), int((N - p[1]) / (N - S) * EXT)) for p in poly]
                t = [ring[0]]
                for p in ring[1:]:
                    if p != t[-1]:
                        t.append(p)
                if len(t) < 3:
                    continue
                pid = 800000000 + (abs(hash((round(cx, 6), round(cy, 6)))) % 90000000)
                feats.append((pid, [t], None, None))
                omerk.append((cx, cy))
        except Exception as e:
            print("harman MS hata:", str(e)[:60], flush=True)
    if not feats:
        return None
    return bina_karosu_kodla(feats, EXT)
