#!/usr/bin/env python3
# HARİTA YAN-SERVİSİ (sidecar) — 2026-08-31
# ══════════════════════════════════════════════════════════════════════════════════════════
# NEDEN: statik birleştirme (mozaik) PIL ister; Cloudflare Worker'da PIL yok, WASM 128 MB
# sınırını aşıyor (ölçümle elendi). Motor imajında Pillow 12.3.0 ZATEN VAR -> dikişi MOTORA
# taşıyoruz. Böylece sunucu (harita-proxy.py) kapansa bile statik üretilir.
#
# MÜHÜR STRATEJİSİ — mühürlü dosyalara TEK SATIR dokunulmadı:
#   route_gen.py / intro_gen.py / outro_gen.py  -> `HARITA_STATIK` env'ini zaten okuyor
#   route-video.py                              -> `HARITA_UC` env'ini zaten okuyor
# Bu servis 127.0.0.1:8890'de MAPBOX STATIC API biçiminde dinler (harita-proxy ile AYNI URL
# sözleşmesi) -> env'i buraya çevirmek yeter, motor kodu değişmez.
#
# BİREBİRLİK GARANTİSİ: `_stitch` ve `_stitch_bbox` harita-proxy.py'den KARAKTER KARAKTER
# kopyalandı (512·2^z ölçeği, bbox fit kuralı `ölçek=min`, >400 karoda zoom düşürme, LANCZOS,
# JPEG q87/q92, önbellek anahtarı biçimi). Kopya `--muhur` bayrağıyla kanıtlanır.
#
# KAYNAK ZİNCİRİ (sunucusuz):
#   sat  : disk -> Esri World_Imagery (public) -> EOX s2cloudless (z<=14, CC BY 4.0)
#          -> uzak /xyz/sat (CF worker; en son çare)
#   str  : disk -> Esri World_Street_Map (public) -> uzak /xyz/str
#   strm : disk -> worker /mvt -> PIL raster (mvt_raster.py, kalibrasyon mühürlü)
#   ⚠️ strm'de Esri YEDEĞİ YOK — BİLEREK. Canlı harita-kaynak.json'daki
#      {"tip":"esri","tur":"strm"} satırı ZATEN ÖLÜ (ESRI sözlüğünde "strm" anahtarı yok ->
#      KeyError -> sessizce atlanır). Bugünkü davranış: strm yoksa BEYAZ/gri karo -> kentsel
#      skor 0 -> NV/zoom AÇILMAZ. Mührün koruduğu yön bu; yedek eklemek davranışı DEĞİŞTİRİR.
import hashlib
import io
import json
import math
import os
import re
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from PIL import Image

CACHE = os.environ.get("HARITA_YAN_CACHE", "/tmp/harita-yan")
PORT = int(os.environ.get("HARITA_YAN_PORT", "8890"))
UZAK = os.environ.get("HARITA_UZAK", os.environ.get("HARITA_TABAN", "")).rstrip("/")
ESRI = {"sat": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        "str": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}"}

# Zincir env ile ezilebilir (JSON) — "sürüm gerekmeden harita değiştir" ilkesi korunur.
_VARSAYILAN_ZINCIR = [
    {"tip": "esri", "tur": "sat", "minz": 0, "maxz": 19},
    {"tip": "eox", "tur": "sat", "minz": 0, "maxz": 14},
    {"tip": "uzak", "tur": "sat", "minz": 0, "maxz": 19},
    {"tip": "mvt", "tur": "strm", "minz": 0, "maxz": 19},
    {"tip": "esri", "tur": "str", "minz": 0, "maxz": 19},
    {"tip": "uzak", "tur": "str", "minz": 0, "maxz": 19},
]


def _kaynaklar():
    ham = os.environ.get("HARITA_KAYNAK_JSON", "")
    if ham:
        try:
            return json.loads(ham)
        except Exception:
            print("HARITA_KAYNAK_JSON bozuk -> varsayılan zincir", flush=True)
    return _VARSAYILAN_ZINCIR


def _fetch(url, timeout=25):
    rq = urllib.request.Request(url, headers={"User-Agent": "MoveLogHaritaYan/1.0"})
    with urllib.request.urlopen(rq, timeout=timeout) as r:
        return r.read()


def _cpath(kind, key):
    p = os.path.join(CACHE, kind, key)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    return p


# 🚦 DIŞ SERVİS FRENİ — harita-proxy.py ile aynı jeton kovası. Konteynerden Esri'ye gidiyoruz;
# sunucunun Hooder ile PAYLAŞTIĞI IP artık devrede değil, o yüzden varsayılan hız yüksek.
# (Frenin görsel çıktıya etkisi YOK; yalnız zamanlama.)
_DIS_HIZ = float(os.environ.get("HARITA_DIS_HIZ", "40"))
_DIS_PATLAMA = float(os.environ.get("HARITA_DIS_PATLAMA", "120"))
_dis_kilit = threading.Lock()
_dis_kova = {"jeton": _DIS_PATLAMA, "t": time.time()}


def _dis_fren():
    while True:
        with _dis_kilit:
            simdi = time.time()
            _dis_kova["jeton"] = min(_DIS_PATLAMA,
                                     _dis_kova["jeton"] + (simdi - _dis_kova["t"]) * _DIS_HIZ)
            _dis_kova["t"] = simdi
            if _dis_kova["jeton"] >= 1.0:
                _dis_kova["jeton"] -= 1.0
                return
            _bek = (1.0 - _dis_kova["jeton"]) / _DIS_HIZ
        time.sleep(min(0.25, max(0.005, _bek)))


# 🔴 ESRİ "VERİ YOK" KAROSU — harita-proxy.py ile AYNI imza (2521 bayt, md5 öneki).
_ESRI_BOS = "f27d9de7f80c"
_ESRI_BOS_BOYUT = 2521


def _bos_karo_mu(data):
    if not data or len(data) != _ESRI_BOS_BOYUT:
        return False
    return hashlib.md5(data).hexdigest().startswith(_ESRI_BOS)


# ── KARO FİKSİ deseni (route_gen.py >>>KARO-FIKSI ile aynı sözleşme) ─────────────────────
_TILE_BEKLE = (0.3, 0.8, 2.0)
_say_kilit = threading.Lock()
_SAYAC = {"toplam": 0, "hata": 0, "kurtarma": 0, "esri_bos": 0, "ustzoom": 0}


def _kalici(e):
    import urllib.error
    return (isinstance(e, urllib.error.HTTPError)
            and 400 <= int(getattr(e, "code", 0) or 0) < 500
            and int(getattr(e, "code", 0) or 0) not in (408, 429))


def _getir(url, timeout=25):
    """_fetch + yeniden deneme + sayaç. Kalıcı 4xx'te ısrar YOK."""
    with _say_kilit:
        _SAYAC["toplam"] += 1
    son = None
    for d in range(len(_TILE_BEKLE) + 1):
        try:
            v = _fetch(url, timeout=timeout)
            if d:
                with _say_kilit:
                    _SAYAC["kurtarma"] += 1
            return v
        except Exception as e:                       # noqa: BLE001 — zincir devam etmeli
            son = e
            if _kalici(e):
                break
            if d < len(_TILE_BEKLE):
                time.sleep(_TILE_BEKLE[d])
    with _say_kilit:
        _SAYAC["hata"] += 1
    if os.environ.get("TAC_ECHO") == "1":
        print(f"KARO HATA: {url[:90]} -> {type(son).__name__}: {str(son)[:90]}", flush=True)
    raise son if isinstance(son, BaseException) else RuntimeError("karo çekilemedi")


def sayac():
    with _say_kilit:
        s = dict(_SAYAC)
    try:
        import mvt_raster
        s["mvt"] = mvt_raster.sayac()
    except Exception:
        pass
    return s


# ══════════════════════════════════════════════════════════════════════════════════════════
#  _tile — harita-proxy.py:132 ile AYNI sözleşme (256px RGB, üst-zoom yedeği, disk önbelleği)
# ══════════════════════════════════════════════════════════════════════════════════════════
# İSTEK BAŞINA KARO SAĞLIĞI: zincir tamamen tükenip "veri yok" karosu döndüğünde bunu
# SAYARIZ. Çoğunluk boşsa görüntü kullanılamaz (gri levha) -> istek uzak uca devredilir.
# Bu, sessiz "bembeyaz/gri video" arızasına karşı sigortadır (V125/V128 dersi).
_istek = threading.local()


_BOS_RENK = ((10, 10), (12, 12), (18, 18))     # düz (10,12,18) = "veri yok" karosu


def _sifirla():
    _istek.n = 0
    _istek.bos = 0


def _saglik():
    """(karo sayısı, boş karo sayısı) — istek başına."""
    return getattr(_istek, "n", 0), getattr(_istek, "bos", 0)


def _tile(kind, osmz, x, y, katman=None, _derinlik=0):
    """`_tile_ic` + istek-başına karo sağlığı sayacı (üst-zoom yedeği tükenmişse de sayar)."""
    im = _tile_ic(kind, osmz, x, y, katman, _derinlik)
    if _derinlik == 0:
        if not hasattr(_istek, "n"):
            _sifirla()
        _istek.n += 1
        if im.getextrema() == _BOS_RENK:
            _istek.bos += 1
    return im


def _tile_ic(kind, osmz, x, y, katman=None, _derinlik=0):
    """Tek 256px karo: önbellek -> zincir. PIL Image döner. (harita-proxy._tile taşıması)"""
    n = 2 ** osmz
    x %= n
    if not (0 <= y < n):
        return Image.new("RGB", (256, 256), (10, 12, 18))
    cp = _cpath(f"tile-{kind}", f"{osmz}/{x}/{y}.jpg")
    if os.path.exists(cp):
        try:
            return Image.open(cp).convert("RGB")
        except Exception:
            pass
    data = None
    for k in _kaynaklar():
        if k.get("tur", kind) != kind:
            continue
        if not (k.get("minz", 0) <= osmz <= k.get("maxz", 19)):
            continue
        try:
            if k.get("tip") == "esri":
                _dis_fren(); data = _getir(ESRI[kind].format(z=osmz, x=x, y=y))
                if _bos_karo_mu(data):
                    with _say_kilit:
                        _SAYAC["esri_bos"] += 1
                    data = None      # "veri yok" levhası -> bu kaynağı ATLA, zincire devam et
            elif k.get("tip") == "eox":
                # EOX Sentinel-2 cloudless (CC BY 4.0). ⚠️ WMTS yol sırası {z}/{y}/{x} — xyz'nin TERSİ.
                _dis_fren()
                data = _getir("https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857"
                              f"/default/g/{osmz}/{y}/{x}.jpg")
            elif k.get("tip") == "xyz":
                _dis_fren(); data = _getir(k["url"].format(z=osmz, x=x, y=y))
            elif k.get("tip") == "uzak":
                if not UZAK:
                    continue
                _dis_fren()
                data = _getir(f"{UZAK}/xyz/{kind}/{osmz}/{x}/{y}.jpg")
            elif k.get("tip") == "mvt":
                # 🔒 harita-proxy.py'nin "pmtiles" dalının BİREBİR karşılığı: 256px sokak
                # rasteri -> RGB -> JPEG q88 -> yeniden çöz. JPEG tur-gidiş-dönüşü DAHİL
                # kopyalandı; kaldırmak piksel değerlerini değiştirirdi.
                import mvt_raster as _pm
                _im = _pm.sokak_karosu(osmz, x, y, 256)
                _b = io.BytesIO(); _im.convert("RGB").save(_b, "JPEG", quality=88)
                data = _b.getvalue()
        except Exception:
            data = None
        if data and len(data) > 200:
            break
        data = None
    if not data:
        # ÜST ZOOM YEDEĞİ (harita-proxy ile aynı): ebeveyn karonun çeyreğini kırp-büyüt.
        if _derinlik < 4 and osmz > 3:
            with _say_kilit:
                _SAYAC["ustzoom"] += 1
            ust = _tile_ic(kind, osmz - 1, x // 2, y // 2, katman, _derinlik + 1)
            cx, cy = (x % 2) * 128, (y % 2) * 128
            return ust.crop((cx, cy, cx + 128, cy + 128)).resize((256, 256), Image.LANCZOS)
        return Image.new("RGB", (256, 256), (10, 12, 18))
    try:
        open(cp, "wb").write(data)
    except Exception:
        pass
    return Image.open(io.BytesIO(data)).convert("RGB")


# ══════════════════════════════════════════════════════════════════════════════════════════
#  >>>MUHUR-BASI  (harita-proxy.py'den KARAKTER KARAKTER kopya — `--muhur` bunu doğrular)
# ══════════════════════════════════════════════════════════════════════════════════════════
def _stitch(kind, lon, lat, z, w, h):
    """Mapbox static {lon},{lat},{z}/{w}x{h}@2x eşdeğeri: 2w x 2h px, m/px=156543*cos/2^(z+1)."""
    outw, outh = 2 * w, 2 * h
    zi = min(19, max(0, int(math.ceil(z)) + 1))          # osm zoom (üstten)
    scale = 2.0 ** (z + 1 - zi)                          # kesirli z telafisi
    n = 2 ** zi
    cx = (lon + 180.0) / 360.0 * n * 256
    sy = math.sin(math.radians(max(-85.05, min(85.05, lat))))
    cy = (0.5 - math.log((1 + sy) / (1 - sy)) / (4 * math.pi)) * n * 256
    # çıktının kaynak-pikselde yarı genişliği
    hw, hh = outw / (2 * scale), outh / (2 * scale)
    x0, y0 = cx - hw, cy - hh
    tx0, ty0 = int(x0 // 256), int(y0 // 256)
    tx1, ty1 = int((cx + hw) // 256), int((cy + hh) // 256)
    mosaic = Image.new("RGB", ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256))
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            mosaic.paste(_tile(kind, zi, tx, ty), ((tx - tx0) * 256, (ty - ty0) * 256))
    crop = mosaic.crop((int(round(x0 - tx0 * 256)), int(round(y0 - ty0 * 256)),
                        int(round(x0 - tx0 * 256 + 2 * hw)), int(round(y0 - ty0 * 256 + 2 * hh))))
    if crop.size != (outw, outh):
        crop = crop.resize((outw, outh), Image.LANCZOS)
    return crop


def _stitch_bbox(kind, lon0, lat0, lon1, lat1, w, h):
    """Mapbox static [minlon,minlat,maxlon,maxlat]/{w}x{h}@2x eşdeğeri.
    ⚠️ MOTOR BUNU KULLANIYOR (route_gen TEK MOZAİK'i böyle çeker) — 2026-08-10'a kadar proxy'de
    YOKTU, taktik üretim 404 alıp kırılıyordu (Mapbox kesildikten sonra fark edilmedi).
    Mapbox davranışı: bbox'ı oranı koruyarak sığdırır (ölçek=min), merkez=bbox merkezi.
    route_gen aynı kuralı varsayıp piksel projeksiyonunu kendi kuruyor -> BİREBİR uymalı."""
    outw, outh = 2 * w, 2 * h

    def _merc(lon, lat):
        x = (lon + 180.0) / 360.0
        sy = math.sin(math.radians(max(-85.05, min(85.05, lat))))
        y = 0.5 - math.log((1 + sy) / (1 - sy)) / (4 * math.pi)
        return x, y

    bx0, by0 = _merc(lon0, lat1)          # üst-sol (kuzey-batı)
    bx1, by1 = _merc(lon1, lat0)          # alt-sağ (güney-doğu)
    if bx1 < bx0:
        bx0, bx1 = bx1, bx0
    if by1 < by0:
        by0, by1 = by1, by0
    gw, gh = max(1e-12, bx1 - bx0), max(1e-12, by1 - by0)
    olcek = min(outw / gw, outh / gh)     # px / birim-merkator (Mapbox "fit" kuralı)
    # kapsanan alan: merkez sabit, çıktı boyutunca genişlet
    mcx, mcy = (bx0 + bx1) / 2.0, (by0 + by1) / 2.0
    kx0, kx1 = mcx - outw / (2 * olcek), mcx + outw / (2 * olcek)
    ky0, ky1 = mcy - outh / (2 * olcek), mcy + outh / (2 * olcek)
    # yeterli çözünürlükte osm zoom seç (1 kaynak px >= 1 çıktı px)
    zi = 0
    while zi < 19 and (2 ** zi) * 256 * (kx1 - kx0) < outw:
        zi += 1
    n = 2 ** zi
    x0, y0 = kx0 * n * 256, ky0 * n * 256
    x1, y1 = kx1 * n * 256, ky1 * n * 256
    tx0, ty0 = int(math.floor(x0 / 256)), int(math.floor(y0 / 256))
    tx1, ty1 = int(math.floor((x1 - 1e-6) / 256)), int(math.floor((y1 - 1e-6) / 256))
    # güvenlik: aşırı karo sayısını sınırla (zoom düşür)
    while (tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 400 and zi > 0:
        zi -= 1; n = 2 ** zi
        x0, y0 = kx0 * n * 256, ky0 * n * 256
        x1, y1 = kx1 * n * 256, ky1 * n * 256
        tx0, ty0 = int(math.floor(x0 / 256)), int(math.floor(y0 / 256))
        tx1, ty1 = int(math.floor((x1 - 1e-6) / 256)), int(math.floor((y1 - 1e-6) / 256))
    mosaic = Image.new("RGB", ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256))
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            mosaic.paste(_tile(kind, zi, tx, ty), ((tx - tx0) * 256, (ty - ty0) * 256))
    crop = mosaic.crop((int(round(x0 - tx0 * 256)), int(round(y0 - ty0 * 256)),
                        int(round(x1 - tx0 * 256)), int(round(y1 - ty0 * 256))))
    if crop.size != (outw, outh):
        crop = crop.resize((outw, outh), Image.LANCZOS)
    return crop


RX = re.compile(r"^/styles/v1/mapbox/([a-z0-9-]+)/static/(-?[\d.]+),(-?[\d.]+),([\d.]+)(?:,[-\d.]+)?/(\d+)x(\d+)(@2x)?")
# BBOX biçimi: /static/[minlon,minlat,maxlon,maxlat]/{w}x{h}@2x  (route_gen TEK MOZAİK)
RXB2 = re.compile(r"^/styles/v1/mapbox/([a-z0-9-]+)/static/[\[%5B]+(-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)[\]%5D]+/(\d+)x(\d+)(@2x)?", re.I)
# ══════════════════════════════════════════════════════════════════════════════════════════
#  <<<MUHUR-SONU
# ══════════════════════════════════════════════════════════════════════════════════════════


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True

    def log_message(self, *a):
        pass

    def _send(self, data, ctype="image/jpeg", code=200):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _uzak_yedek(self):
        """SON ÇARE: yerel zincir görüntü üretemedi -> statiği uzak uçtan (CF katmanı) iste.
        Devir sırasında Worker `statik_mod=origin` iken bu çalışır; `501` olduğunda başarısız
        olur ve çağıran normal hata yolunu görür. 'Kendini onarma' zincirinin son halkası."""
        if not UZAK:
            return None
        try:
            veri = _getir(UZAK + self.path, timeout=90)
            if veri and len(veri) > 200:
                with _say_kilit:
                    _SAYAC["uzak_yedek"] = _SAYAC.get("uzak_yedek", 0) + 1
                print(f"UZAK YEDEK kullanıldı: {self.path[:80]}", flush=True)
                return veri
        except Exception as e:
            print("uzak yedek de başarısız:", str(e)[:90], flush=True)
        return None

    def _uret(self, uretici, q, cp):
        """Mozaiği üret; zincir tükenmişse (çoğu karo 'veri yok') uzak yedeğe düş.
        Dönen: (bayt, hata_metni|None)"""
        _sifirla()
        try:
            im = uretici()
        except Exception as e:
            print("mozaik hata:", str(e)[:120], flush=True)
            return self._uzak_yedek(), f"mozaik uretilemedi: {str(e)[:80]}"
        n, bos = _saglik()
        if n and bos / float(n) > 0.5:
            # Kaynak zinciri tükenmiş: gri levha video demektir (V125/V128 dersi) -> yedeğe git.
            print(f"KARO ZİNCİRİ TÜKENDİ: {bos}/{n} boş karo -> uzak yedek deneniyor", flush=True)
            veri = self._uzak_yedek()
            if veri:
                return veri, None
        b = io.BytesIO()
        im.save(b, "JPEG", quality=q)
        veri = b.getvalue()
        try:
            open(cp, "wb").write(veri)
        except Exception:
            pass
        return veri, None

    def _gecir(self):
        """PASSTHROUGH (31.08 ölçümü): route-video.py matching/geocoding/xyz/mvt/yukseklik için de
        HARITA_UC'yi kullanıyor — sidecar bunları bilmezse 404 döner ve map-match SESSİZCE düşer
        (rota ham GPS izine iner, video çıkar ama yola oturmaz). Bilinmeyen yolu UZAK'a ilet."""
        if not UZAK:
            self._send(b'{"hata":"uzak_yok"}', "application/json", 502); return True
        try:
            req = urllib.request.Request(UZAK + self.path, method=self.command)
            req.add_header("User-Agent", "movelog-yan/1.0")
            for h in ("X-Movelog-Key",):
                v = os.environ.get("MOVELOG_KEY")
                if v: req.add_header(h, v)
            with urllib.request.urlopen(req, timeout=60) as y:
                self._send(y.read(), y.headers.get("Content-Type", "application/json"), y.status)
        except urllib.error.HTTPError as e:
            self._send(e.read()[:2000], e.headers.get("Content-Type", "application/json"), e.code)
        except Exception as e:
            self._send(json.dumps({"hata": str(e)[:200]}).encode(), "application/json", 502)
        return True

    def do_GET(self):
        if self.path.startswith("/saglik"):
            self._send(json.dumps({"ok": True, "katman": "harita-yan",
                                   "uzak": bool(UZAK), "sayac": sayac()}).encode(),
                       "application/json")
            return
        if self.path.startswith(("/matching/", "/geocoding/", "/xyz/", "/mvt/", "/yukseklik")):
            self._gecir(); return
        mb = RXB2.match(self.path)
        if mb:                                    # BBOX biçimi (route_gen TEK MOZAİK)
            stil, a0, b0, a1, b1, w, h, _x2 = mb.groups()
            kind = "strm" if stil.startswith("streets") else "sat"   # bbox: ÖLÇÜM yolu
            lon0, lat0, lon1, lat1 = float(a0), float(b0), float(a1), float(b1)
            w, h = int(w), int(h)
            key = f"{kind}/bbox_{lon0:.5f}_{lat0:.5f}_{lon1:.5f}_{lat1:.5f}_{w}x{h}.jpg"
            cp = _cpath("static", key)
            if os.path.exists(cp):
                self._send(open(cp, "rb").read())
                return
            veri, hata = self._uret(
                lambda: _stitch_bbox(kind, lon0, lat0, lon1, lat1, w, h), 92, cp)
            if not veri:
                self._send((hata or "bbox uretilemedi").encode(), "text/plain", 500)
                return
            self._send(veri)
            return
        m = RX.match(self.path)
        if not m:
            self._send(b"yol taninmadi", "text/plain", 404)
            return
        stil, lon, lat, z, w, h, at2x = m.groups()
        kind = "strm" if stil.startswith("streets") else "sat"   # statik: ÖLÇÜM yolu (soluk mvt)
        lon, lat, z, w, h = float(lon), float(lat), float(z), int(w), int(h)
        key = f"{kind}/{z:.2f}/{lon:.5f}_{lat:.5f}_{w}x{h}.jpg"
        cp = _cpath("static", key)
        if os.path.exists(cp):
            self._send(open(cp, "rb").read())
            return
        veri, hata = self._uret(lambda: _stitch(kind, lon, lat, z, w, h), 87, cp)
        if not veri:
            self._send((hata or "statik uretilemedi").encode(), "text/plain", 500)
            return
        self._send(veri)


# ── MÜHÜR DENETİMİ: `python3 harita_yan.py --muhur <harita-proxy.py>` ─────────────────────
# Kopyalanan blok (MUHUR-BASI..MUHUR-SONU) kaynak dosyadaki karşılığıyla KARAKTER KARAKTER
# aynı mı? Sapma varsa çıkış kodu 1 — CI/derleme öncesi kanıt üretir.
def _muhur_denetle(kaynak):
    """Dört parça AYRI AYRI karşılaştırılır (aradaki `_geocode` gibi taşınmayan kod bulaşmasın).
    Her parça için sha256 basılır; biri bile saparsa çıkış kodu 1."""
    import difflib
    ben = open(os.path.abspath(__file__), encoding="utf-8").read()
    kay = open(kaynak, encoding="utf-8").read()

    def _fonk(metin, imza, bitis):
        i = metin.index(imza)
        return metin[i:metin.index(bitis, i)].rstrip("\n")

    def _satir(metin, onek):
        i = metin.index(onek)
        return metin[i:metin.index("\n", i)]

    parcalar = [
        ("_stitch", _fonk(kay, "def _stitch(kind, lon, lat, z, w, h):", "\ndef _stitch_bbox"),
                    _fonk(ben, "def _stitch(kind, lon, lat, z, w, h):", "\ndef _stitch_bbox")),
        # bitiş işareti "\n\n\n" (iki boş satır): kaynakta ardından `_nom_last/_geocode`,
        # kopyada `RX` geliyor — fonksiyon gövdesi ikisinde de aynı yerde bitiyor.
        ("_stitch_bbox", _fonk(kay, "def _stitch_bbox(kind,", "\n\n\n"),
                         _fonk(ben, "def _stitch_bbox(kind,", "\n\n\n")),
        ("RX", _satir(kay, "RX = re.compile("), _satir(ben, "RX = re.compile(")),
        ("RXB2", _satir(kay, "RXB2 = re.compile("), _satir(ben, "RXB2 = re.compile(")),
    ]
    kirik = 0
    for ad, onun, benim in parcalar:
        a = hashlib.sha256(onun.encode()).hexdigest()
        b = hashlib.sha256(benim.encode()).hexdigest()
        if a == b:
            print(f"  ✓ {ad:14s} sha256={a[:16]}  ({len(onun.splitlines())} satır) BİREBİR")
        else:
            kirik = 1
            print(f"  ✗ {ad:14s} kaynak={a[:16]} kopya={b[:16]}  SAPMA:")
            for ln in list(difflib.unified_diff(onun.splitlines(), benim.splitlines(),
                                                "harita-proxy.py", "harita_yan.py", lineterm=""))[:40]:
                print("     " + ln)
    print("MÜHÜR KIRILDI" if kirik else "MÜHÜR OK — dört parça da karakter karakter aynı")
    return kirik


if __name__ == "__main__":
    if "--muhur" in sys.argv:
        i = sys.argv.index("--muhur")
        kaynak = sys.argv[i + 1] if len(sys.argv) > i + 1 else "/opt/matrix/scripts/harita-proxy.py"
        sys.exit(_muhur_denetle(kaynak))
    os.makedirs(CACHE, exist_ok=True)
    print(f"harita-yan dinliyor 127.0.0.1:{PORT} (cache={CACHE}, uzak={UZAK or 'YOK'})", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
