#!/usr/bin/env python3
# MVT -> SOKAK RASTERİ (motor içi taşıma, 2026-08-31)
#
# KÖKEN: /opt/matrix/scripts/pmtiles_okuyucu.py — MVT çözümü ve raster üretimi bölümleri
# BİREBİR kopyalandı (_varint / _zigzag / mvt_katmanlar / _ozellik_coz / sokak_karosu +
# kalibrasyon sabitleri). TEK FARK: karo BAYTLARININ nereden geldiği.
#   ESKİ: yerel PMTiles arşivi (169.58.151.59 sshfs mount — SUNUCUYA BAĞIMLI)
#   YENİ: HTTP `{MVT_TABAN}/mvt/{z}/{x}/{y}.mvt` (Cloudflare worker — sunucusuz)
#
# 🔒 KALİBRASYON MÜHRÜ: PM_CIZGI=1 / PM_BINA=246 / PM_YOL_TON=180 ve çizim sırası
# (önce buildings polygon, sonra roads line) DEĞİŞMEDİ. Bu üç sabit taktik motorun
# kentsel skorunu ((d-0.055)/0.033) besler; ölçmeden dokunulmaz.
#
# ⚠️ maxz: PMTiles arşivi z0-15'ti; başlıktan okunuyordu. Konteynerde arşiv YOK ->
# sabit MVT_MAXZ=15 (env ile ezilebilir). z16 isteği yine z15 ebeveynden AŞIRI
# YAKINLAŞTIRMA ile üretilir — ESKİSİYLE AYNI KOD YOLU.
import io
import math
import os
import threading
import time
import urllib.error
import urllib.request

from PIL import Image, ImageDraw

MVT_TABAN = os.environ.get("HARITA_MVT", os.environ.get("HARITA_TABAN", "")).rstrip("/")
MVT_MAXZ = int(os.environ.get("MVT_MAXZ", "15"))
_UA = "MoveLogHaritaYan/1.0"
_ZAMAN = float(os.environ.get("MVT_TIMEOUT", "25"))


# ─────────────────────────── varint / protobuf (BİREBİR kopya) ───────────────────────────
def _varint(b, i):
    s = r = 0
    while True:
        x = b[i]; i += 1
        r |= (x & 0x7F) << s
        if not (x & 0x80):
            return r, i
        s += 7


def _zigzag(n):
    return (n >> 1) ^ -(n & 1)


# ─────────────────────────── MVT çözümü (BİREBİR kopya) ───────────────────────────
def mvt_katmanlar(ham, istenen=("roads", "buildings")):
    """MVT -> {katman: [(tip, [[(x,y),...] parça]) ...]} (karo yerel koordinat, extent normalize)."""
    sonuc = {}
    i = 0; n = len(ham)
    while i < n:
        anahtar, i = _varint(ham, i)
        alan, tel = anahtar >> 3, anahtar & 7
        if alan == 3 and tel == 2:                      # layer
            uz, i = _varint(ham, i)
            kat = ham[i:i + uz]; i += uz
            ad, ozellikler, extent = None, [], 4096
            j = 0; m = len(kat)
            while j < m:
                k2, j = _varint(kat, j)
                a2, t2 = k2 >> 3, k2 & 7
                if a2 == 1 and t2 == 2:
                    u2, j = _varint(kat, j); ad = kat[j:j + u2].decode("utf-8", "replace"); j += u2
                elif a2 == 2 and t2 == 2:
                    u2, j = _varint(kat, j); ozellikler.append(kat[j:j + u2]); j += u2
                elif a2 == 5 and t2 == 0:
                    extent, j = _varint(kat, j)
                elif t2 == 2:
                    u2, j = _varint(kat, j); j += u2
                elif t2 == 0:
                    _v, j = _varint(kat, j)
                else:
                    j += {1: 8, 5: 4}.get(t2, 0)
            if ad in istenen:
                sonuc[ad] = [_ozellik_coz(o, extent) for o in ozellikler]
        elif tel == 2:
            uz, i = _varint(ham, i); i += uz
        elif tel == 0:
            _v, i = _varint(ham, i)
        else:
            i += {1: 8, 5: 4}.get(tel, 0)
    return sonuc


def _ozellik_coz(ham, extent):
    """Feature -> (geom_tipi, [parça listesi]) — koordinatlar 0..1 normalize."""
    i = 0; n = len(ham); gtip = 0; geo = None
    while i < n:
        k, i = _varint(ham, i)
        a, t = k >> 3, k & 7
        if a == 3 and t == 0:
            gtip, i = _varint(ham, i)
        elif a == 4 and t == 2:
            u, i = _varint(ham, i); geo = ham[i:i + u]; i += u
        elif t == 2:
            u, i = _varint(ham, i); i += u
        elif t == 0:
            _v, i = _varint(ham, i)
        else:
            i += {1: 8, 5: 4}.get(t, 0)
    parcalar = []
    if not geo:
        return (gtip, parcalar)
    i = 0; x = y = 0; suan = []
    while i < len(geo):
        cmd, i = _varint(geo, i)
        kid, adet = cmd & 7, cmd >> 3
        if kid == 1:                                    # MoveTo
            for _ in range(adet):
                dx, i = _varint(geo, i); dy, i = _varint(geo, i)
                x += _zigzag(dx); y += _zigzag(dy)
                if suan:
                    parcalar.append(suan)
                suan = [(x / extent, y / extent)]
        elif kid == 2:                                  # LineTo
            for _ in range(adet):
                dx, i = _varint(geo, i); dy, i = _varint(geo, i)
                x += _zigzag(dx); y += _zigzag(dy)
                suan.append((x / extent, y / extent))
        elif kid == 7:                                  # ClosePath
            if suan:
                suan.append(suan[0])
    if suan:
        parcalar.append(suan)
    return (gtip, parcalar)


# ─────────────────────────── karo baytları: HTTP (TEK DEĞİŞEN YER) ───────────────────────────
# Yerel PMTiles okuma yerine worker'ın /mvt ucu. Boş karo (204) -> None; ESKİ `karo_oku` da
# karo yoksa None döndürüyordu -> `sokak_karosu` beyaz karo üretiyordu: DAVRANIŞ AYNI.
# KARO FİKSİ deseni (route_gen.py >>>KARO-FIKSI ile aynı sözleşme): geçici hatada yeniden
# deneme, KALICI 4xx'te ısrar YOK, sayaç tutulur (`sayac()` ile okunur).
_TILE_BEKLE = (0.3, 0.8, 2.0)
_kilit = threading.Lock()
_sayac = {"toplam": 0, "hata": 0, "kurtarma": 0, "bos": 0}
_ONBELLEK = os.environ.get("MVT_ONBELLEK", "")          # opsiyonel disk önbelleği (konteyner içi)


def _kalici(e):
    return (isinstance(e, urllib.error.HTTPError)
            and 400 <= int(getattr(e, "code", 0) or 0) < 500
            and int(getattr(e, "code", 0) or 0) not in (408, 429))


def karo_oku(z, x, y):
    """Ham MVT baytı (gzip'siz) döndür; karo yoksa None. Kaynak: worker /mvt ucu."""
    if not MVT_TABAN:
        return None
    cp = os.path.join(_ONBELLEK, f"{z}/{x}/{y}.mvt") if _ONBELLEK else None
    if cp and os.path.exists(cp):
        try:
            d = open(cp, "rb").read()
            return d or None
        except OSError:
            pass
    with _kilit:
        _sayac["toplam"] += 1
    son = None
    for d in range(len(_TILE_BEKLE) + 1):
        try:
            rq = urllib.request.Request(f"{MVT_TABAN}/mvt/{z}/{x}/{y}.mvt",
                                        headers={"User-Agent": _UA})
            with urllib.request.urlopen(rq, timeout=_ZAMAN) as r:
                if r.status == 204:
                    with _kilit:
                        _sayac["bos"] += 1
                    ham = b""
                else:
                    ham = r.read()
            if ham[:2] == b"\x1f\x8b":                  # worker gzip'li döndürürse aç
                import gzip as _gz
                ham = _gz.decompress(ham)
            if d:
                with _kilit:
                    _sayac["kurtarma"] += 1
            if cp:
                try:
                    os.makedirs(os.path.dirname(cp), exist_ok=True)
                    open(cp, "wb").write(ham)
                except OSError:
                    pass
            return ham or None
        except Exception as e:                          # noqa: BLE001 — zincir devam etmeli
            son = e
            if _kalici(e):
                break
            if d < len(_TILE_BEKLE):
                time.sleep(_TILE_BEKLE[d])
    with _kilit:
        _sayac["hata"] += 1
    if os.environ.get("TAC_ECHO") == "1":
        print(f"MVT HATA: z{z}/{x}/{y} -> {type(son).__name__}: {str(son)[:100]}", flush=True)
    return None


def sayac():
    with _kilit:
        return dict(_sayac)


# ─────────────────────────── raster üretimi (BİREBİR kopya) ───────────────────────────
# 🔒 Mapbox streets kenar-yoğunluğu ARALIĞINI taklit eden çizim ayarları.
# (kalibrasyon: bilinen 16 nokta ile ölçülür — ÖLÇMEDEN DOKUNMA)
_CIZGI = int(os.environ.get("PM_CIZGI", "1"))        # yol çizgi kalınlığı (px)
_BINA_DOLGU = int(os.environ.get("PM_BINA", "246"))  # bina gri tonu (255=beyaz zemin, yüksek=silik)
_YOL_TON = int(os.environ.get("PM_YOL_TON", "180"))  # yol gri tonu (yüksek=silik=düşük yoğunluk)

_COZUM = {}          # (z,x,y) -> çözülmüş katmanlar (aynı ebeveyn 16 kez çözülmesin)
_COZUM_MAX = 64


def _katman_getir(z, x, y):
    k = (z, x, y)
    v = _COZUM.get(k)
    if v is not None:
        return v
    ham = karo_oku(z, x, y)
    v = mvt_katmanlar(ham) if ham else {}
    if len(_COZUM) >= _COZUM_MAX:
        _COZUM.clear()
    _COZUM[k] = v
    return v


def sokak_karosu(z, x, y, boyut=512):
    """Tek z/x/y için sokak rasteri (L modu). Karo yoksa boş beyaz döner.
    ⚠️ Protomaps arşivi z0-15; motor z16 (ince mod) istiyor -> AŞIRI YAKINLAŞTIRMA:
    z15 ebeveyn karosu okunur, ilgili çeyrek büyütülerek çizilir (standart over-zoom)."""
    im = Image.new("L", (boyut, boyut), 255)
    maxz = MVT_MAXZ                                   # ESKİ: _basla()["hdr"]["maxz"]
    olcek, sx, sy = 1, 0, 0
    if z > maxz:
        dz = z - maxz
        olcek = 2 ** dz
        sx, sy = x - ((x >> dz) << dz), y - ((y >> dz) << dz)
        x, y, z = x >> dz, y >> dz, maxz
    kat = _katman_getir(z, x, y)
    if not kat:
        return im
    d = ImageDraw.Draw(im)

    def _pt(u, v):
        return ((u * olcek - sx) * boyut, (v * olcek - sy) * boyut)

    for gtip, parcalar in kat.get("buildings", []):
        for p in parcalar:
            if len(p) >= 3:
                d.polygon([_pt(u, v) for u, v in p], fill=_BINA_DOLGU, outline=_YOL_TON)
    kal = max(1, int(round(_CIZGI * (olcek ** 0.5))))   # over-zoom'da çizgi orantılı kalınlaşır
    for gtip, parcalar in kat.get("roads", []):
        for p in parcalar:
            if len(p) >= 2:
                d.line([_pt(u, v) for u, v in p], fill=_YOL_TON, width=kal)
    return im


def _z_xy(lat, lon, z):
    n = 2 ** z
    xt = (lon + 180.0) / 360.0 * n
    yt = (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n
    return xt, yt


def muhur_denetle(kaynak="/opt/matrix/scripts/pmtiles_okuyucu.py"):
    """Taşınan parçalar kaynakla KARAKTER KARAKTER aynı mı? (`sokak_karosu` hariç: orada
    tek satır bilinçli değişti — `_basla()["hdr"]["maxz"]` -> `MVT_MAXZ`.)"""
    import difflib
    import hashlib
    ben = open(os.path.abspath(__file__), encoding="utf-8").read()
    kay = open(kaynak, encoding="utf-8").read()

    def _al(metin, imza, bitis="\n\n\n"):
        i = metin.index(imza)
        return metin[i:metin.index(bitis, i)].rstrip("\n")

    parcalar = [("_varint", "def _varint(b, i):"), ("_zigzag", "def _zigzag(n):"),
                ("mvt_katmanlar", "def mvt_katmanlar(ham,"), ("_ozellik_coz", "def _ozellik_coz(ham, extent):"),
                ("_katman_getir", "def _katman_getir(z, x, y):"), ("_z_xy", "def _z_xy(lat, lon, z):")]
    kirik = 0
    for ad, imza in parcalar:
        a, b = _al(kay, imza), _al(ben, imza)
        ha, hb = (hashlib.sha256(t.encode()).hexdigest() for t in (a, b))
        if ha == hb:
            print(f"  ✓ {ad:16s} sha256={ha[:16]} ({len(a.splitlines())} satır) BİREBİR")
        else:
            kirik = 1
            print(f"  ✗ {ad:16s} SAPMA:")
            for ln in list(difflib.unified_diff(a.splitlines(), b.splitlines(), lineterm=""))[:30]:
                print("     " + ln)
    # sokak_karosu: TEK satır farkı beklenir (maxz kaynağı)
    a, b = _al(kay, "def sokak_karosu(z, x, y, boyut=512):"), _al(ben, "def sokak_karosu(z, x, y, boyut=512):")
    fark = [ln for ln in difflib.unified_diff(a.splitlines(), b.splitlines(), lineterm="")
            if ln[:1] in "+-" and ln[:3] not in ("---", "+++")]
    kod = [ln for ln in fark if "maxz" not in ln and "arşiv z0-15" not in ln and "Protomaps" not in ln]
    print(f"  {'✓' if not kod else '✗'} {'sokak_karosu':16s} beklenen tek fark (maxz kaynağı); "
          f"başka {len(kod)} kod satırı farkı")
    for ln in kod[:20]:
        print("     " + ln)
    if kod:
        kirik = 1
    # kalibrasyon sabitleri
    for ad, sab in (("PM_CIZGI", "_CIZGI"), ("PM_BINA", "_BINA_DOLGU"), ("PM_YOL_TON", "_YOL_TON")):
        sa = kay[kay.index(f"{sab} = int("):kay.index("\n", kay.index(f"{sab} = int("))]
        sb = ben[ben.index(f"{sab} = int("):ben.index("\n", ben.index(f"{sab} = int("))]
        ok = sa.split("#")[0].strip() == sb.split("#")[0].strip()
        print(f"  {'✓' if ok else '✗'} {ad:16s} {sb.split('#')[0].strip()}")
        if not ok:
            kirik = 1
    print("MÜHÜR KIRILDI" if kirik else "MÜHÜR OK — MVT çözümü + kalibrasyon birebir")
    return kirik


def yogunluk(lat, lon, z=16):
    """route_gen._road_density ile AYNI ölçüm — kalibrasyon karşılaştırması için."""
    from PIL import ImageFilter, ImageOps
    xt, yt = _z_xy(lat, lon, z)
    KB = 512
    x0 = int(math.floor(xt - 1024 / (2 * KB))); x1 = int(math.floor(xt + 1024 / (2 * KB)))
    y0 = int(math.floor(yt - 1024 / (2 * KB))); y1 = int(math.floor(yt + 1024 / (2 * KB)))
    mozaik = Image.new("L", ((x1 - x0 + 1) * KB, (y1 - y0 + 1) * KB), 255)
    for gx in range(x0, x1 + 1):
        for gy in range(y0, y1 + 1):
            mozaik.paste(sokak_karosu(z, gx % (2 ** z), gy, KB), ((gx - x0) * KB, (gy - y0) * KB))
    px = (xt - x0) * KB; py = (yt - y0) * KB
    sol = int(px - 512); ust = int(py - 512)
    im = mozaik.crop((sol, ust, sol + 1024, ust + 1024)).resize((128, 128))
    return (sum(ImageOps.grayscale(im).filter(ImageFilter.FIND_EDGES).getdata()) / (128 * 128)) / 255.0


if __name__ == "__main__":
    import sys
    if "--muhur" in sys.argv:
        i = sys.argv.index("--muhur")
        sys.exit(muhur_denetle(sys.argv[i + 1] if len(sys.argv) > i + 1
                               else "/opt/matrix/scripts/pmtiles_okuyucu.py"))
    print("kullanım: python3 mvt_raster.py --muhur [pmtiles_okuyucu.py]")
