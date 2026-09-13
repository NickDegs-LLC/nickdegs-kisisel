#!/usr/bin/env python3
# TAKTİK RENDER İŞÇİSİ — genreq mode:"tactical" işini uçtan uca üretir:
# rastgele çekiliş -> Commons landmark -> TTS (rastgele kod + kullanıcı brifingi) ->
# dinamik zaman çizelgesi -> intro/rota/outro render -> bamgüm ses -> R2 -> render-done.
# Kullanım: python3 render_job.py /path/to/job.json
import os, sys, json, math, time, random, shutil, struct, subprocess, urllib.request, urllib.parse

T = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, T)
from pool import draw, MIDCALLS

# 2026-08-01 TEK SUNUCU: movelog-api ve traccar konteynerleri 127.0.0.1'e bind edilmis
# (10.99.0.2 bu makinenin IP'si olsa da o adrese bind YOK -> baglanti reddedilir).
# Cloud Run modunda TAC_PUT_URL set olur ve bu adreslere zaten hic gidilmez.
BACKEND = os.environ.get("TAC_BACKEND", "http://127.0.0.1:8780")
TRACCAR = os.environ.get("TRACCAR_URL", "http://127.0.0.1:8084")
# TAŞIMA (RunPod, 2026-08-30): harita taban ucu env'den. VARSAYILAN = bugünkü yerel proxy ->
# env yokken davranış BİREBİR AYNI. Yalnız taban-URL parametrik; map-matching parametreleri
# (radius 22/45, confidence 0.35, CH=90, OVL=12, 5500 nokta) DOKUNULMADI.
_HT = os.environ.get("HARITA_TABAN", "http://127.0.0.1:8890").rstrip("/")
_H_MATCH = os.environ.get("HARITA_MATCHING", _HT).rstrip("/")
# GÜVENLİK (2026-07-26): hardcoded cred YOK -> env'den. Env boşsa LOKAL secrets dosyasından oku (2026-07-27:
# embedded track'siz rideler fetch_track'te 401 alıyordu). Dosya /opt/matrix/secrets içinde = repo/image DIŞI
# (CR image'ında yok -> orada zaten embedded track kullanılır, fetch_track çağrılmaz).
TUSER = os.environ.get("TRACCAR_USER", ""); TPASS = os.environ.get("TRACCAR_PASS", "")
if not (TUSER and TPASS):
    try:
        _tc = {}
        for _l in open("/opt/matrix/secrets/traccar.conf"):
            if "=" in _l and not _l.strip().startswith("#"):
                _k, _v = _l.strip().split("=", 1); _tc[_k.strip()] = _v.strip()
        TUSER = TUSER or _tc.get("TRACCAR_USER", ""); TPASS = TPASS or _tc.get("TRACCAR_PASS", "")
        if _tc.get("TRACCAR_URL"): TRACCAR = os.environ.get("TRACCAR_URL") or _tc["TRACCAR_URL"]
    except Exception:
        pass
R2C = {}
try:   # RunPod GÜVENLİ MOD: R2 credential dosyası YOK -> presigned PUT URL (TAC_PUT_URL) ile yüklenir
    for _l in open("/opt/matrix/secrets/movelog-r2.conf"):
        if "=" in _l: k, v = _l.strip().split("=", 1); R2C[k] = v
except Exception: pass
# Sır dosyası YEREL render'da okunur. BULUTTA (Cloud Run) dosya yoktur — sırlar imaja gömülmez.
# Bu yüzden env de kabul edilir: Cloud Run job'una RENDER_DONE_SECRET geçilir.
# Yoksa kullanıcı müziği çekilemez, sessizce stok müziğe düşerdi (Barış 2026-08-03 şikâyeti).
SECRET = os.environ.get("RENDER_DONE_SECRET", "")
if not SECRET:
    try:
        for _l in open("/opt/matrix/secrets/movelog-backend.conf"):
            if _l.startswith("RENDER_DONE_SECRET="): SECRET = _l.strip().split("=", 1)[1]
    except Exception: pass

def _music_http(ref, session, dst, user, L=print):
    """Kullanıcı müziğini backend'den HTTP ile çek (scp YERİNE — SSH bağımlılığı yok).
    ref: 'active' | 'upload' | 'lib:<id>'.  Dönüş: 0=başarı, 1=alınamadı.
    Aynı uç 3D hattında da kullanılıyor (`movelog-cloud.py`), yani davranış tutarlı."""
    if not SECRET:
        L("MÜZİK ⚠ RENDER_DONE_SECRET yok — kullanıcı müziği çekilemez")
        return 1
    try:
        q = urllib.parse.urlencode({"user": user, "ref": ref,
                                    "session": int(float(session or 0)), "secret": SECRET})
        r = urllib.request.urlopen(BACKEND + "/api/internal/music?" + q, timeout=30)
        d = r.read()
        if getattr(r, "status", 200) == 200 and len(d) > 500:
            open(dst, "wb").write(d)
            return 0
        L(f"MÜZİK ⚠ uç boş/kısa yanıt döndü ({len(d)} bayt)")
    except Exception as e:
        L("MÜZİK ⚠ çekilemedi:", str(e)[:110])
    return 1


def _scp(remote, dst):
    """Gizli host'tan asset (avatar) çek. Cloud modda (TAC_PUT_URL) private host'a ERİŞİLEMEZ -> atla.
    ⚠️ TEK SUNUCU (2026-08-03): `root@10.99.0.2:/yol` artık AYNI makine ve o adrese SSH çalışmıyor
    ("Host key verification failed") -> asset sessizce gelmiyordu. Önce YEREL dosyayı dene;
    varsa kopyala (SSH'siz, anında). Yoksa eski scp davranışına dön (iki-sunuculu kurulum için)."""
    if os.environ.get("TAC_PUT_URL"):
        return 1
    _yol = remote.split(":", 1)[1] if ":" in remote and not remote.startswith("/") else remote
    if os.path.exists(_yol):
        try:
            shutil.copy(_yol, dst)
            return 0
        except Exception:
            pass
    try:
        return subprocess.run(["scp", "-o", "ConnectTimeout=8", remote, dst], capture_output=True).returncode
    except FileNotFoundError:
        return 1

def sh(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode != 0:
        # stderr kirpmasi 400 -> 3000: DeprecationWarning gibi gurultuler son 400 karakteri doldurup
        # GERCEK hatayi gizliyordu (2026-08-02'de tam bu yuzden teshis yapilamadi).
        raise RuntimeError(f"CMD FAIL {cmd[0]}: {r.stderr[-3000:]}")
    # TANI GORUNURLUGU (2026-08-01): route_gen'in PACING / NV EPIZOT / INCE KENTSEL gibi olcum
    # satirlari capture_output yuzunden HIC gorunmuyordu -> sorun teshisi kor yapiliyordu.
    # TAC_ECHO=1 ile alt surecin ciktisi log'a aynen dokulur (varsayilan davranis DEGISMEZ).
    if os.environ.get("TAC_ECHO") == "1" and r.stdout:
        for _ln in r.stdout.rstrip().split("\n"):
            print(f"  [{os.path.basename(cmd[-1])}] {_ln}", flush=True)
    return r

def adur(p):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                        "-of", "csv=p=0", p], capture_output=True, text=True)
    return float(r.stdout.strip())

def fetch_track(dev, frm, to):
    import base64
    fu = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(frm))
    tu = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(to))
    q = urllib.parse.urlencode({"deviceId": dev, "from": fu, "to": tu})
    req = urllib.request.Request(f"{TRACCAR}/api/positions?{q}")
    req.add_header("Authorization", "Basic " + base64.b64encode(f"{TUSER}:{TPASS}".encode()).decode())
    ps = json.load(urllib.request.urlopen(req, timeout=30))
    return [{"t": p["deviceTime"], "lat": p["latitude"], "lon": p["longitude"],
             "spd": round(p.get("speed", 0) * 1.852, 1), "crs": p.get("course", 0)} for p in ps]

_UA = {"User-Agent": "MoveLogTactical/1.0 (movelog app)"}

def _lm_commons(term):
    """Commons arama API'si -> [(url, height), ...]. Engelliyse boş döner."""
    q = urllib.parse.urlencode({"action": "query", "generator": "search",
        "gsrsearch": f"{term} filetype:bitmap", "gsrlimit": 5, "gsrnamespace": 6,
        "prop": "imageinfo", "iiprop": "url|size", "iiurlwidth": 960, "format": "json"})
    d = json.load(urllib.request.urlopen(
        urllib.request.Request(f"https://commons.wikimedia.org/w/api.php?{q}", headers=_UA), timeout=30))
    out = []
    for p in (d.get("query", {}).get("pages", {}) or {}).values():
        ii = (p.get("imageinfo") or [{}])[0]
        u = ii.get("thumburl") or ii.get("url")
        if u: out.append((u, ii.get("height", 0)))
    return out

def _lm_openverse(term):
    """YEDEK KAYNAK (2026-08-05): Commons API'si Contabo IP bloğunu 403'lüyor
    ('Contabo networks are forbidden due to abuse'), ama upload.wikimedia.org CDN'i AÇIK.
    Openverse aynı Commons içeriğini ayrı bir hostta indeksler + yalnız CC/telifsiz döner,
    yani özgün 'telifsiz landmark' amacı korunur. -> [(url, height), ...]"""
    q = urllib.parse.urlencode({"q": term, "page_size": 8,
                                "license_type": "all-cc,commercial", "extension": "jpg"})
    d = json.load(urllib.request.urlopen(
        urllib.request.Request(f"https://api.openverse.org/v1/images/?{q}", headers=_UA), timeout=30))
    return [(r.get("url"), r.get("height") or 0) for r in (d.get("results") or []) if r.get("url")]

def commons_landmark(term, out_path):
    """Telifsiz landmark fotoğrafı indir (ilk uygun bitmap).
    ⚠️ 2026-08-05: ARAMA çağrısı korumasızdı -> Commons 403 verince TÜM RENDER çöküyordu
    (dekoratif bir foto için video ölüyordu). Artık her kaynak ayrı ayrı yutuluyor ve
    fonksiyon HİÇBİR koşulda exception atmıyor; bulunamazsa False döner, çağıran zaten
    'YOK' diye loglayıp devam ediyor."""
    cands = []
    for src in (_lm_commons, _lm_openverse):
        try:
            cands = src(term)
        except Exception as e:
            # ⚠️ L() modül düzeyinde YOK (main içinde tanımlı) -> burada print şart, yoksa NameError.
            print(f"landmark kaynak '{src.__name__}' atlandı: {str(e)[:110]}", flush=True)
            continue
        if cands: break
    for u, h in sorted(cands, key=lambda x: -x[1]):
        if h and h < 400: continue
        try:
            data = urllib.request.urlopen(urllib.request.Request(u, headers=_UA), timeout=40).read()
            if len(data) < 8000: continue          # bozuk/placeholder
            open(out_path, "wb").write(data)
            return True
        except Exception:
            continue
    return False

def build_ekg(wd, clips, total=31.7):
    """clips: [(wav_yolu, yerleşim_sn)] -> voice_env.json (EKG zarfı)."""
    FPS = 30; SR = 8000
    sigs = []
    for p, off in clips:
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", p, "-f", "s16le", "-ac", "1",
                              "-ar", str(SR), "-"], capture_output=True).stdout
        sigs.append((struct.unpack(f"<{len(raw)//2}h", raw), off))
    env = []
    for f in range(int(FPS * total)):
        t = f / FPS; sv = 0.0
        for sig, off in sigs:
            i0 = int((t - off) * SR)
            if 0 <= i0 < len(sig) - 266:
                seg = sig[i0:i0 + 266]
                sv = max(sv, math.sqrt(sum(x * x for x in seg) / len(seg)) / 32768.0)
        env.append(round(min(1.0, sv * 4.5), 3))
    json.dump(env, open(f"{wd}/voice_env.json", "w"))

def _sun_elev(lat, lon, epoch):
    """Güneşin yükseklik açısı (derece) — verilen konum/anda. <-4° = karanlık (gece görüş için)."""
    jd = epoch / 86400.0 + 2440587.5
    n = jd - 2451545.0
    L = (280.460 + 0.9856474 * n) % 360
    g = math.radians((357.528 + 0.9856003 * n) % 360)
    lam = math.radians(L + 1.915 * math.sin(g) + 0.020 * math.sin(2 * g))
    eps = math.radians(23.439 - 0.0000004 * n)
    dec = math.asin(math.sin(eps) * math.sin(lam))
    ra = math.atan2(math.cos(eps) * math.sin(lam), math.cos(lam))
    gmst = (18.697374558 + 24.06570982441908 * n) % 24
    lst = (gmst * 15 + lon) % 360
    ha = math.radians((lst - math.degrees(ra)) % 360)
    latr = math.radians(lat)
    return math.degrees(math.asin(math.sin(latr) * math.sin(dec) + math.cos(latr) * math.cos(dec) * math.cos(ha)))

def main(jobfile):
    job = json.load(open(jobfile))
    vid = job["vid"]; user = job["user"]
    wd = f"/opt/matrix/routes/tacwork/{vid}"
    os.makedirs(wd, exist_ok=True)
    log = open(f"{wd}/job.log", "a")
    def L(*a): print(*a, file=log, flush=True); print(*a, flush=True)
    try:
        L("TACTICAL başladı:", vid)
        # ÖN-UÇUŞ DERLEME KONTROLÜ: bozuk kod hiçbir kullanıcı işini yakamaz
        import py_compile
        for _g in ("intro_gen.py", "route_gen.py", "outro_gen.py", "tts.py", "pool.py"):
            py_compile.compile(f"{T}/{_g}", doraise=True)
        # ---- 1) rota ----
        track = job.get("track") or fetch_track(job["device"], job["from"], job["to"])
        mov = [p for p in track if p["spd"] > 2] or track
        if len(mov) < 12: raise RuntimeError("az nokta")
        # ---- AYKIRI GPS TEMİZLİĞİ (otonom): imkansız sıçramaları at (ardışık >230 km/h) ----
        def _hav(a, b):
            return math.hypot((a["lat"] - b["lat"]) * 111320,
                              (a["lon"] - b["lon"]) * 111320 * math.cos(math.radians(a["lat"])))
        def _ts(p):
            import datetime as _dt
            _t = p.get("t")
            if isinstance(_t, (int, float)): return float(_t)      # GPX/embed: epoch
            try: return _dt.datetime.fromisoformat(str(_t).replace("Z", "+00:00")).timestamp()
            except Exception: return 0
        clean = [mov[0]]
        for p in mov[1:]:
            dt = max(1.0, _ts(p) - _ts(clean[-1]))
            if _hav(p, clean[-1]) / dt <= 65.0:      # ≤234 km/h makul; üstü GPS sıçraması
                clean.append(p)
        if len(clean) >= 12: mov = clean
        # ---- YOLA TAM NOKTA-ATIŞI (Mapbox Map Matching, YOL GEOMETRİSİ): GPS -> gerçek yol poligonu (her viraj birebir) ----
        def _snap_to_roads(pts):
            try:
                _MB = [l.split('=', 1)[1].strip() for l in open('/opt/matrix/secrets/mapbox.conf')
                       if l.startswith('MAPBOX_PUBLIC_TOKEN=')][0]
            except Exception:
                return pts
            def _ep(p):
                _t = p.get("t")
                if isinstance(_t, (int, float)): return float(_t)
                try:
                    import datetime as _dt
                    return _dt.datetime.fromisoformat(str(_t).replace("Z", "+00:00")).timestamp()
                except Exception: return 0.0
            def _hv(a, b, c, e):
                return math.hypot((c - a) * 111320.0, (e - b) * 111320.0 * math.cos(math.radians(a)))
            def _interp(arr, alx, tgt):
                j = 0
                while j < len(alx) - 1 and alx[j + 1] < tgt: j += 1
                seg = alx[j + 1] - alx[j] if j < len(alx) - 1 else 1.0
                f = (tgt - alx[j]) / seg if seg > 1e-9 else 0.0
                k = min(j + 1, len(arr) - 1)
                return arr[j] + (arr[k] - arr[j]) * f
            src = pts
            if len(src) > 5500:                                  # MAKS DOĞRULUK (Barış 2026-07-27): daha yoğun giriş = daha isabetli eşleşme
                _st = len(src) / 5500.0
                src = [src[int(_i * _st)] for _i in range(5500)]
            result = []; ok_ch = 0; tot_ch = 0; CH = 90; OVL = 12; _i = 0; _pj = None   # 12-nokta ÖRTÜŞME -> dilim sınırında süreklilik
            while _i < len(src):
                ch = src[_i:_i + CH]
                if len(ch) < 3:
                    result.extend([{**_p, "sig": 0.5} for _p in ch]); break
                tot_ch += 1
                coords = ";".join(f"{p['lon']:.6f},{p['lat']:.6f}" for p in ch)
                geom = None; _bestconf = -1.0
                for _rad in (22, 45):                            # SIKI-önce (22m=isabetli, bölünmüş yolda doğru şerit) -> GENİŞ-sonra (45m=gürültülü GPS kurtar)
                    _url = (f"{_H_MATCH}/matching/v5/mapbox/driving/{coords}"
                            f"?geometries=geojson&overview=full&tidy=true&radiuses={';'.join(str(_rad) for _ in ch)}&access_token={_MB}")
                    try:
                        d = json.load(urllib.request.urlopen(_url, timeout=25))
                        ms = d.get("matchings", [])
                        if ms and ms[0].get("geometry", {}).get("coordinates"):
                            _cf = ms[0].get("confidence", 0.0)
                            if _cf > _bestconf:
                                _bestconf = _cf; geom = ms[0]["geometry"]["coordinates"]
                            if _cf >= 0.35: break                # yeterince güvenli eşleşme -> retry'a gerek yok
                    except Exception:
                        pass
                _chpts = []
                if geom and len(geom) >= 2:
                    ok_ch += 1
                    _cal = [0.0]
                    for _k in range(1, len(ch)):
                        _cal.append(_cal[-1] + _hv(ch[_k - 1]["lat"], ch[_k - 1]["lon"], ch[_k]["lat"], ch[_k]["lon"]))
                    _gal = [0.0]
                    for _k in range(1, len(geom)):
                        _gal.append(_gal[-1] + _hv(geom[_k - 1][1], geom[_k - 1][0], geom[_k][1], geom[_k][0]))
                    _ct = [_ep(p) for p in ch]; _cs = [p.get("spd", 0.0) for p in ch]
                    _clen = _cal[-1] or 1.0; _glen = _gal[-1] or 1.0
                    for _gi, (lon, lat) in enumerate(geom):
                        _tgt = (_gal[_gi] / _glen) * _clen             # geom arc-frac -> chunk t/spd
                        # SİNYAL GÜVENİ: geom noktası en yakın HAM GPS'e ne kadar uzak? (uzak=GPS güvenilmez=sinyal zayıf)
                        _md = min(_hv(lat, lon, p["lat"], p["lon"]) for p in ch)
                        _sig = max(0.0, min(1.0, 1.0 - (_md - 25.0) / 70.0))   # <25m=1.0(tam kilit) >95m=0.0(zayıf)
                        _chpts.append({"t": _interp(_ct, _cal, _tgt), "lat": lat, "lon": lon,
                                       "spd": _interp(_cs, _cal, _tgt), "crs": 0, "sig": round(_sig, 2)})
                else:
                    _chpts = [{**_p, "t": _ep(_p), "sig": 0.5} for _p in ch]   # eşleşmezse ham (belirsiz sinyal)
                # ÖRTÜŞME DROP + MONOTON ZAMAN: yalnız son eklenenden SONRAKİ (t artan) noktaları ekle -> örtüşme sınırı süreksizliği yok
                for _q in _chpts:
                    if _pj is None or _q["t"] > _pj + 1e-6:
                        result.append(_q); _pj = _q["t"]
                _i += (CH - OVL)
            if len(result) > 24000:                                     # çok yoğunsa seyrelt (route_gen zaten resample eder)
                _st2 = len(result) / 24000.0
                result = [result[int(_i2 * _st2)] for _i2 in range(24000)]
            L(f"road-snap: {ok_ch}/{tot_ch} segment yola oturtuldu -> {len(result)} nokta")
            return result if (tot_ch and ok_ch > tot_ch * 0.4 and len(result) >= 12) else pts
        mov = _snap_to_roads(mov)
        json.dump(mov, open(f"{wd}/route.json", "w"))
        # BAŞ/SON ÇAPALARI: tek noktaya değil, ilk/son 12 noktanın MEDYANINA bağlan (denize düşme yok)
        import statistics as _st
        _h = mov[:12]; _tl = mov[-12:]
        slat, slon = _st.median(p["lat"] for p in _h), _st.median(p["lon"] for p in _h)
        elat, elon = mov[-1]["lat"], mov[-1]["lon"]   # TAM son nokta (GPS temizlendi) -> outro sıçramaz
        # ---- TAM OTONOM KAMERA (Barış 2026-07-19): rota yayılımından irtifa/dalış/kapanış hesabı ----
        _lats = [p["lat"] for p in mov]; _lons = [p["lon"] for p in mov]
        _span = max((max(_lats) - min(_lats)) * 111320,
                    (max(_lons) - min(_lons)) * 111320 * math.cos(math.radians(sum(_lats) / len(_lats))), 200)
        _view = _span * 1.44 * 460 / 2560          # rota bölümünün YER genişliği (m, yakın pencere)
        if _view <= 450:   DIVEZ = 17              # küçük rota: sokağa kadar dal
        elif _view <= 1000: DIVEZ = 16
        elif _view <= 2200: DIVEZ = 15
        else:               DIVEZ = 13             # dev rota: bölge seviyesinde bırak
        OZ0 = max(7.4, min(16.6, 17.0 - math.log2(max(1.0, _view / 380.0))))   # outro giriş irtifası
        L(f"OTONOM: yayılım {_span/1000:.1f}km, görüş {_view:.0f}m -> dalış z{DIVEZ}, outro z{OZ0:.1f}")
        # ---- 1b) avatar: job'ta yoksa backend'den çek (yoksa silüet) ----
        av = job.get("avatar", "")
        if not av:
            avp = f"{wd}/avatar.jpg"
            if _scp(f"root@10.99.0.2:/opt/movelog/data/avatars/{user}.jpg", avp) == 0 and os.path.exists(avp):
                av = avp
        job["avatar"] = av
        # ---- 2) rastgele çekiliş + landmark'lar ----
        # TEK FORMAT (Barış 2026-07-19): kanıtlanmış düzen KİLİTLİ — yakın kamera + 3 şehir.
        # Kullanıcı SADECE crosshair rengi + müzik seçer; diğer tüm seçimler yok sayılır.
        # 1dk'da 2 ŞEHİR (Barış 2026-08-05, "kısa videoda bir-iki şehir yapabilirsin, tam yetki"):
        # tur penceresi (BOOT..TOUR1) kısaldığı için 3 şehir sığdırmak her şehre ~2.8sn bırakıyor,
        # kesme hissi veriyordu. 2 şehirle her biri daha uzun/oturaklı durur.
        # ⚠️ 3dk 3'te KALIR — "TEK FORMAT ... 3 şehir" kilidi uzun mod için geçerli.
        # ⚠️ `_short1m` BURADA HENÜZ TANIMLI DEĞİL (aşağıda, ses bloğunda atanıyor) -> doğrudan
        # job'tan oku. Değişkeni kullanmak UnboundLocalError veriyor (2026-08-05'te bu hataya düşüldü).
        NCITY = 2 if job.get("speed") != "slow" else 3
        job["camdist"] = "yakin"
        rz = draw(n=NCITY)
        cities = []
        lmname = {}
        for c in rz["cities"]:
            key = c["name"].split()[0].lower()
            ok = commons_landmark(c["landmark"], f"{wd}/lm_{key}.jpg")
            if not ok:
                ok = commons_landmark(c["name"] + " skyline", f"{wd}/lm_{key}.jpg")
            cities.append([c["name"], c["lon"], c["lat"]])
            lmname[c["name"]] = c["landmark"].upper()
            L("şehir:", c["name"], "landmark:", c["landmark"], "ok" if ok else "YOK")
        # ---- 3) TTS: rastgele kod (video başına) + brifing (kullanıcı başına önbellek) ----
        import tts
        name = (job.get("name") or "TARGET").split()[0]
        # 1DK OPTİMİZASYONU (Barış 2026-07-27): kısa (1dk) modda kısa brifing -> intro kısalır, rota uzar. 3dk tam brifing.
        _short1m = job.get("speed") != "slow"
        f_open = tts.line(f"{rz['code_words']}, this is Actual. How copy?", "female")
        f_brief = tts.brief_line(name, job.get("type", "moto"), short=_short1m)
        V = f"{T}/voices"
        d_open = adur(f_open); d_brief = adur(f_brief)
        # ---- 4) dinamik zaman çizelgesi (intro TOTAL=31.7 sabit; sesler kayar) ----
        # 1DK OPTİMİZASYONU (Barış 2026-07-27): boot dead-time (konuşmadan önce) 1dk'da 6.0->3.5 -> konuşma erken
        # başlar, intro kısalır, rota uzar. 3dk (slow) 6.0 kalır. (_short1m yukarıda tanımlı)
        # 1dk'da boot ölü zamanı 3.5 -> 2.5 (Barış 2026-08-05): konuşma daha erken başlar,
        # br_end 1sn kısalır -> TOUR1 tabanına (14.0) oturur -> intro ~1.4sn daha kısalır, rota uzar.
        # 3dk (slow) 6.0'da KALIR — mühürlü.
        t_open = 2.5 if _short1m else 6.0
        _gap = 0.32 if _short1m else 0.45
        # ARA REPLİK (`m_read`, 2.06sn) 1dk'da ÇIKARILIR (Barış 2026-08-05: "konuşmaları da
        # buna göre ayarlarsın"). Akış "açılış -> brifing" olarak kalır; anlam kaybı yok, ara
        # onay repliği düşer. Kazanç 2.06+0.32 = 2.38sn -> TOUR1 aşağı iner -> rotaya süre kalır.
        # ⚠️ 3dk'da replik AYNEN durur (mühürlü).
        _USE_READ = not _short1m
        t_read = t_open + d_open + _gap
        t_brief = (t_read + adur(f"{V}/m_read_p.wav") + _gap) if _USE_READ else t_read
        # SIKIŞTIRMA YOK: brifing doğal süresinde; intro TOUR ucu sese göre uzar
        br_end = t_brief + d_brief
        brief_use = f_brief
        # ---- ZAMAN BÜTÇESİ: intro sese göre, rota kalan süreyi alır (toplam 59.6 sabit) ----
        _BUD = 178.0 if job.get("speed") == "slow" else 59.6   # Kısa=Reels(<=1dk) / Uzun=Gönderi(<=3dk)
        # 1DK OPTİMİZASYONU (Barış 2026-07-27, SADECE 1dk — 3dk'ya DOKUNMA): 1dk'da intro ~31s yiyip rotaya
        # ~15s kalıyordu. Sadece kısa (1dk) modda tur floor'u 20->14 -> intro kısalır, rota uzar. Kilit sekansı
        # (+11) ve ses anchor'ları TOUR1-göreli -> senkron korunur; intro_gen tur şehir sayısını süreye göre ayarlar.
        # TUR TABANI: 1dk'da 14.0 -> 11.5 (Barış 2026-08-05). Taban, tur penceresinin ASGARİSİ;
        # 2 şehirle (yukarıda NCITY=2) daha dar pencere yeterli. Gerçek değer yine
        # `max(taban, br_end+0.75)` -> brifing uzunsa o kazanır, yani KONUŞMA ASLA KESİLMEZ.
        # ⚠️ 3dk 20.0'de KALIR.
        _tourfloor = 11.5 if _BUD <= 60.0 else 20.0
        TOUR1 = max(_tourfloor, br_end + 0.75)
        # KİLİT SEKANSI (Barış 2026-08-05, "1dk intro'yu kısalt, tam yetki"): artık `intro_gen`
        # de `TAC_LOCKSEQ` env'ini okuyup ALT FAZLARI aynı oranla ölçeklüyor -> sayıyı küçültmek
        # gerçekten kısaltıyor (ilk denemede intro_gen 11.0 sabitti, o yüzden video taşmıştı).
        # 8.6 tabanı ÖLÇÜMLE seçildi: sekansın son sesi `mc_moving` TOUR1+7.65'te başlayıp
        # 0.68sn sürüyor -> +8.33'te biter. 8.6 = ses biter + 0.27 pay. Altına inersen ses kesilir.
        # ⚠️ Uzun mod 11.0'de KALIR (mühürlü) ve env GÖNDERİLMEZ.
        _LOCKSEQ = 8.6 if _BUD <= 60.0 else 11.0
        _LK = _LOCKSEQ / 11.0                      # ses çapalarını da AYNI oranla ölçekle (senkron)
        INTRO_TOTAL = round(TOUR1 + _LOCKSEQ, 2)
        # EN-BOY süreden BAĞIMSIZ: kullanıcı seçer (9:16 dikey / 4:5 gönderi) — her sürede geçerli
        if job.get("aspect") == "4:5":
            _VW, _VH, _ASP = 1080, 1350, "4:5"
        else:
            _VW, _VH, _ASP = 1080, 1920, "9:16"
        # ===== 1DK BÜTÇE DENGESİ (Barış 2026-08-05, "1dk tamamen sana bırakıyorum; uzun moda DOKUNMA") =====
        # ÖLÇÜLDÜ: 1dk'da bütçe=59.6 -> intro 26.4 (%44) · rota 20.0 (%34) · outro 13.2 (%22).
        # Uzun modda aynı hesap rotaya %75 veriyor. Yani 1dk'nın asıl derdi rotaya vakit kalmaması.
        # ⚠️ OUTRO BÜTÇESİ 13.2'DE KALIR — DENENDİ, OLMADI (2026-08-05): 9.0'a çekince rota 27.1sn
        # oldu AMA video 65.3sn çıkıp "süre standart dışı" ile REDDEDİLDİ. Sebep: outro'nun gerçek
        # uzunluğu bu sayıyla değil `_LG`(5.6) + logout sekansı + diyalog yerleşimiyle belirleniyor
        # (~13-15sn). Yani bu sayıyı düşürmek outro'yu KISALTMAZ, sadece toplamı taşırır.
        # Outro'yu gerçekten kısaltmak isteyen `_LG` ve `_oq` replik listesine bakmalı.
        # Kazanç intro tarafından alındı (t_open 3.5->2.5, kilit sekansı 11.0->9.5): intro 26.4->23.5.
        _OUTRO_BUD = 13.2
        ROUTE_DUR = round(_BUD - _OUTRO_BUD - INTRO_TOTAL, 2)
        if ROUTE_DUR < 10.5:
            raise RuntimeError(f"brifing çok uzun: rota {ROUTE_DUR}sn kalıyor")
        OUTS = round(INTRO_TOTAL + ROUTE_DUR, 2)
        L(f"SÜRE DAĞILIMI: bütçe={_BUD} intro={INTRO_TOTAL} (tur1={TOUR1}, br_end={br_end:.1f}) "
          f"rota={ROUTE_DUR} outro~{_OUTRO_BUD}")
        # ŞIK KAPANIŞ DİYALOĞU — ERKEN inşa (logout görseli buna senkronlanacak; ASLA yarıda kesilmez)
        import tts as _tts
        # ASKERİ OPERASYONEL RESMİ diyalog — kesik telsiz dili, sıcak/kişisel ifade YOK
        _oq = [("male",   "Command, target is static. Holding on last known grid.",   0.5),
               ("female", "Copy. Visual confirmed on final position.",               2.7),
               ("male",   "Solid copy. Objective complete.",                         4.7),
               ("female", "All stations, mission accomplished. Actual out.",         6.1),
               ("male",   "Copy all, Actual. Mission log secured. Command out.",     8.3)]
        def _place(q, start, gap):
            out=[]; pe=OUTS+start
            for _v,_tx,_an in q:
                pp=_tts.line(_tx,_v)
                st2=max(OUTS+_an, pe+gap) if gap>0.31 else pe
                out.append((pp, round(st2,2), 1.7)); pe=st2+adur(pp)
            return out, pe
        _outlines,_pe=_place(_oq,0.5,0.45)
        if _pe>OUTS+12.0: _outlines,_pe=_place(_oq,0.4,0.24)
        if _pe>OUTS+12.0: _outlines,_pe=_place([_oq[0],_oq[1],_oq[3],_oq[4]],0.4,0.24)   # sığmazsa 3. replik düşer
        # Terminal DAİMA outro'nun son 7.6sn'si (LG sabit); diyalog kuyruğu terminalle örtüşebilir
        # (ör. "Archiving the log" sesi ↔ "ARCHIVING MISSION LOG" ekranı). outro TOTAL=15.0
        _LG=5.6
        t_callsign = t_brief + 0.38 * d_brief          # "Callsign {name}" anı
        TL = {"TL_CALLSIGN": f"{t_callsign:.2f}", "TL_AUTH": f"{t_open+0.5:.2f}",
              "TL_ORDER": f"{t_brief+0.66*d_brief:.2f}", "TL_BRIEFEND": f"{br_end+0.4:.2f}"}
        # ---- 5) EKG ----
        # ERKEK ARALAMA: her replik öncekinin BİTİŞİ+0.4sn'den önce başlayamaz (üst üste binme yok)
        _mnames = ["mc_copy", "mc_scan", "mc_located", "mc_locked", "mc_moving"]
        # ⚠️ `_LK` ile ölçekleniyor: kilit sekansı kısalırsa sesler de aynı oranda öne kayar,
        # yoksa görüntü biter ses devam eder. Uzun modda `_LK`=1.0 -> değerler AYNEN korunur.
        _anchor = {"mc_copy": br_end + 0.55, "mc_scan": TOUR1 + 2.15 * _LK, "mc_located": TOUR1 + 4.4 * _LK,
                   "mc_locked": TOUR1 + 6.95 * _LK, "mc_moving": TOUR1 + 7.65 * _LK}
        fixed = []; _pend = 0.0
        for _nm in _mnames:
            _pp = f"{V}/{_nm}.wav"
            _st = max(_anchor[_nm], _pend + 0.4)
            fixed.append((_pp, round(_st, 2)))
            _pend = _st + adur(_pp)
        # ---- 4b) ZAMAN ÇİZELGESİ DENETİMİ (kalıcı kalite kapısı) ----
        _tlchk = ([("f_open", f_open, t_open)]
                  + ([("m_read", f"{V}/m_read_p.wav", t_read)] if _USE_READ else [])
                  + [("f_brief", brief_use, t_brief)] + [(os.path.basename(p), p, tt) for p, tt in fixed])
        _tlchk.sort(key=lambda x: x[2])
        _prev_end = 0.0; _prev_nm = "-"
        for _nm, _pp, _tt in _tlchk:
            _du = adur(_pp)
            L(f"TL {_nm:>12} @{_tt:6.2f} +{_du:4.2f} -> {_tt+_du:6.2f}")
            if _tt < _prev_end - 0.05:
                raise RuntimeError(f"SES ÇAKIŞMASI: {_nm} ({_tt:.2f}) {_prev_nm} bitmeden ({_prev_end:.2f}) başlıyor")
            _prev_end = _tt + _du; _prev_nm = _nm
        if _prev_end > INTRO_TOTAL:
            raise RuntimeError(f"intro sesleri taşıyor: {_prev_end:.2f} > {INTRO_TOTAL}")
        build_ekg(wd, [(f_open, t_open)] + ([(f"{V}/m_read_p.wav", t_read)] if _USE_READ else [])
                  + [(brief_use, t_brief)] + fixed, total=INTRO_TOTAL)
        # OTONOM GÖRÜŞ MODU (Barış 2026-07-26): theme=auto -> route_gen SÜRÜŞ SAATİNE göre çözer;
        # sürüş gece/gündüz sınırını geçiyorsa video İÇİNDE yumuşak geçiş + sesli komut. from/to geçilir.
        _rtheme = job.get("theme") or "default"
        # ---- 6) render: ROTA önce (route_first için) -> intro -> outro ----
        env = dict(os.environ, TAC_WORKDIR=wd, TAC_LAT=str(slat), TAC_LON=str(slon),
                   TAC_OLAT=str(elat), TAC_OLON=str(elon),
                   TAC_CITIES=json.dumps(cities), TAC_LMNAME=json.dumps(lmname),
                   TAC_NAME=name, TAC_CITY=job.get("city", ""),
                   VIDCODE=rz["code_disp"], ACTTYPE=job.get("type", "moto"),
                   TAC_CAMDIST=job.get("camdist", "orta"),
                   TAC_TOUREND=f"{TOUR1:.2f}", TAC_DUR=f"{ROUTE_DUR:.2f}",
                   TAC_BOOT=("3.0" if _short1m else "5.5"),   # 1dk: boot animasyonu da kısalsın (ses erken başlar, senkron)
                   TAC_LOCKSEQ=f"{_LOCKSEQ:.2f}",             # kilit sekansı uzunluğu (1dk 8.6 / 3dk 11.0)
                   TAC_DIVEZ=str(DIVEZ), TAC_OZ0=f"{OZ0:.2f}", TAC_LOGOUT=f"{_LG:.2f}",
                   TAC_W=str(_VW), TAC_H=str(_VH),
                   TAC_RETCOL=(job.get("dot") or ""),
                   TAC_THEME=_rtheme,               # HUD teması (auto=route_gen dinamik çözer; manuel: thermal/night/day/default)
                   TAC_FROM=str(int(float(job.get("from", 0) or 0))),   # sürüş başlangıç epoch (otonom gece/gündüz için)
                   TAC_TO=str(int(float(job.get("to", 0) or 0))),       # sürüş bitiş epoch
                   TAC_CALLSIGN=(job.get("callsign") or "")[:16],           # kişisel çağrı işareti (operatör)
                   TAC_CHUNKS=os.environ.get("TAC_CHUNKS", "8"),   # PARÇALI PARALEL render (byte-identical kanıtlı) -> min süre; env override
                   AVATAR=job.get("avatar", ""), **TL)
        sh(["python3", f"{T}/route_gen.py"], env=env, cwd=wd)
        if os.environ.get("TAC_VERIFY"):   # DOĞRULAMA: parçalı render tek-thread ile BYTE-IDENTICAL mi? (md5)
            import hashlib as _hl, glob as _gl
            shutil.move(f"{wd}/tacframes", f"{wd}/_seq")
            os.makedirs(f"{wd}/tacframes")
            _env2 = dict(env); _env2["TAC_CHUNKS"] = os.environ["TAC_VERIFY"]
            sh(["python3", f"{T}/route_gen.py"], env=_env2, cwd=wd)
            _a = sorted(_gl.glob(f"{wd}/_seq/f*.jpg")); _b = sorted(_gl.glob(f"{wd}/tacframes/f*.jpg"))
            _m = lambda p: _hl.md5(open(p, "rb").read()).hexdigest()
            _diff = [os.path.basename(x) for x, y in zip(_a, _b) if _m(x) != _m(y)]
            _msg = f"VERIFY chunks={os.environ['TAC_VERIFY']} seq={len(_a)} par={len(_b)} FARKLI={len(_diff)} | ilk: {_diff[:8]}"
            print(_msg, flush=True); open("/tmp/claude-0/-opt-matrix/9999322a-a182-4f50-8317-b7adbe41bf5d/scratchpad/VERIFY.txt", "w").write(_msg + "\n")
            sys.exit(0 if not _diff and len(_a) == len(_b) and _a else 1)
        shutil.copy(f"{wd}/tacframes/f00000.jpg", f"{wd}/route_first.jpg")
        # OUTRO SÜREKLİLİĞİ: outro giriş zoom'unu route'un SON zoom'una eşle -> ışınlanma YOK
        try:
            _re = json.load(open(f"{wd}/route_end.json"))
            env["TAC_OZ0"] = f"{float(_re['oz0']):.2f}"
            env["TAC_OYF"] = f"{float(_re.get('yf',0.42)):.3f}"   # hedef ekran-Y = route SON karesi (sınır zıplaması yok)
            if _re.get("olat") is not None and _re.get("olon") is not None:
                env["TAC_OLAT"] = f"{float(_re['olat']):.7f}"    # outro TAM route'un bıraktığı konumda donsun (gerçek GPS değil)
                env["TAC_OLON"] = f"{float(_re['olon']):.7f}"
            if _re.get("win") is not None:
                env["TAC_OWIN"] = f"{float(_re['win']):.1f}"     # route son pencere metresi -> outro ÖLÇEĞİ birebir eşlensin (zoom uyuşmazlığı yok)
            L(f"OUTRO OZ0={_re['oz0']} yf={_re.get('yf',0.42)} konum={_re.get('olat')},{_re.get('olon')} route sonuna eşlendi")
        except Exception as _e:
            L(f"route_end.json okunamadı, span-tabanlı OZ0 kullanılıyor: {_e!r}")
        # INTRO GECE-FARKINDALIĞI (Barış 2026-07-26): sürüş başlangıcı GECE ise intro da kararsın -> parlak gündüz
        # intro'dan gece rotaya ANİ zıplama YOK. route_gen ile AYNI _nf_el eşiği (tutarlı). Tema-duyarlı.
        def _nf_el(el):
            if el <= -8.0: return 1.0
            if el >= 0.0: return 0.0
            return -el / 8.0
        _from_ep = int(float(job.get("from", 0) or 0))
        _thm = (_rtheme or "").lower()
        if _thm in ("night", "darknight", "thermal", "gece"):
            _night0 = 1.0
        elif _thm == "auto":
            # dusk/akşam (nf~0.48, 20:00) Barış için "gece" -> boost: intro belirgin GECE olsun (route darknight'ıyla eşleşsin).
            _nf0 = _nf_el(_sun_elev(slat, slon, _from_ep)) if _from_ep else 0.0
            _night0 = min(1.0, _nf0 * 1.7)   # 0.48->0.82 (belirgin gece); gündüz (0) yine 0
        else:
            _night0 = 0.0   # day/default -> gündüz intro
        env["TAC_NIGHT"] = f"{_night0:.3f}"
        L(f"INTRO gece faktörü: {_night0:.2f} (0=gündüz, 1=gece) tema={_thm}")
        sh(["python3", f"{T}/intro_gen.py"], env=env, cwd=wd)
        sh(["python3", f"{T}/outro_gen.py"], env=env, cwd=wd)
        L("render'lar tamam")
        # ---- 7) video montaj ----
        for nm, src in (("intro", "sm8frames"), ("tac", "tacframes"), ("outro", "outroframes")):
            sh(["ffmpeg", "-v", "error", "-framerate", "30", "-i", f"{wd}/{src}/f%05d.jpg",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "19", f"{wd}/{nm}.mp4", "-y"])
        sh(["ffmpeg", "-v", "error", "-i", f"{wd}/intro.mp4", "-i", f"{wd}/tac.mp4", "-i", f"{wd}/outro.mp4",
            "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p[v]", "-map", "[v]",
            "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-color_range", "tv",
            "-crf", "23", "-movflags", "+faststart", f"{wd}/master.mp4", "-y"])
        # ---- 8) ses: bamgüm mix + stereo + -7 LUFS ----
        total = _BUD   # Kısa/Uzun bütçesi
        # ROTA-İÇİ TELSİZ HAVUZU: her videoda rastgele 2-3 şık çağrı (artist görünüm)
        _MPOOL = [("clip", f"{V}/cont_clip.wav"),
                  ("clip", f"{V}/m_still_p.wav"),
                  ("male",   "Target is maintaining speed. Tracking is clean."),
                  ("female", "Solid copy. Maintain track."),
                  ("male",   "Target proceeding along the main route."),
                  ("female", "Satellite feed is stable. Continue."),
                  ("male",   "He is picking up the pace. Adjusting track."),
                  ("female", "Maintain overwatch on target."),
                  ("male",   "Still tracking. Target remains unaware."),
                  ("female", "Copy. Overwatch is holding steady."),
                  ("male",   "Target changing heading. Following."),
                  ("female", "Eyes on. This route stays quiet."),
                  ("male",   "Distance is closing. Maintain observation."),
                  ("female", "Bird is locked. Feed is crystal clear."),
                  ("male",   "Extended track in progress. Maintaining contact."),
                  ("female", "Command, we are green across the board.")]
        # ZOOM-ANI özel çağrıları (dalış tetiklendiğinde araya girer) — şık close-up telsizi
        _ZPOOL = [("female", "Enhancing. Tighten the feed on target."),
                  ("male",   "Zooming in. Confirming visual."),
                  ("female", "Close-up locked. Target identity confirmed."),
                  ("male",   "Visual sharp. Still on the move."),
                  ("female", "Detail confirmed. Pulling back out.")]
        _nmc = max(2, min(6, int(ROUTE_DUR // 22) + 2))
        _sel = random.sample(_MPOOL, min(_nmc, len(_MPOOL)))
        _fr = [(i + 1) / (len(_sel) + 1) for i in range(len(_sel))]
        _midcalls = []
        for (_v, _x), _f in zip(_sel, _fr):
            _pp = _x if _v == "clip" else tts.line(_x, _v)
            _midcalls.append((_pp, round(INTRO_TOTAL + ROUTE_DUR * _f, 2), 1.6))
        music = (job.get("music") or "").strip()
        if music == "":
            music = "none"          # YOK seçili = SESSİZ (rastgele için açıkça 'random' gerekir)
        mp = f"{T}/music/{music}.m4a"
        # ⚠️ KULLANICI MÜZİĞİ — scp DEĞİL, HTTP (Barış 2026-08-03: "müzik seçtiğim halde videoda yok")
        # Eskiden `scp root@10.99.0.2:...` ile çekiliyordu. Tek-sunucuya geçişte o adrese SSH
        # çalışmıyor ("Host key verification failed") -> müzik HİÇ gelmiyordu, sessizce stok
        # müziğe düşülüyordu. Kullanıcı müziğini seçiyor ama videoda duymuyordu.
        # Artık 3D hattının da kullandığı `/api/internal/music` ucundan çekiliyor:
        # hem YERELDE hem BULUTTA çalışır, SSH bağımlılığı yok.
        if music in ("active", "upload") or music.startswith("lib:"):
            _mraw = f"{wd}/custom_raw.m4a"
            if _music_http(music, job.get("from", 0), _mraw, user, L) == 0:
                sh(["ffmpeg", "-v", "error", "-vn", "-i", _mraw,
                    "-af", "loudnorm=I=-16:TP=-1.8:LRA=9", "-ar", "44100",
                    "-c:a", "aac", "-b:a", "192k", f"{wd}/custom.m4a", "-y"])
                if os.path.exists(f"{wd}/custom.m4a"):
                    mp = f"{wd}/custom.m4a"; L(f"MÜZİK: kullanıcı müziği kullanılıyor ({music})")
                else:
                    L("MÜZİK ⚠ normalize edilemedi -> stok müziğe düşülüyor")
            else:
                L(f"MÜZİK ⚠ '{music}' ÇEKİLEMEDİ -> stok müziğe düşülüyor")
        if not os.path.exists(mp):
            mp = f"{T}/music/" + random.choice([f for f in os.listdir(f"{T}/music") if f.endswith(".m4a")])
            L("MÜZİK: stok parça:", os.path.basename(mp))
        lines = ([(f_open, t_open, 1.7)] + ([(f"{V}/m_read_p.wav", t_read, 1.6)] if _USE_READ else [])
                 + [(brief_use, t_brief, 1.7)]) + \
                [(p, tt, 1.6) for p, tt in fixed] + \
                _midcalls + _outlines
        SEG = (TOUR1 - 5.5) / NCITY
        _MV = TOUR1 + 7.5
        swell = [5.5 + c * SEG + 0.85 for c in range(NCITY)] + [TOUR1 + 0.6, TOUR1 + 5.4,
                 _MV, _MV + 0.95, _MV + 1.9, _MV + 2.85, OUTS + 2.3, OUTS + 3.5, OUTS + 4.7, OUTS + 5.9]
        _rc = _midcalls[0][1]; _rs = _midcalls[-1][1]
        # KONUŞMA-EYLEM SENKRONU: route_gen'in yazdığı GERÇEK zoom anlarına (cue) göre eşleşen telsiz
        # -> "zooming in" DENİRKEN gerçekten zoom yapılır. Kelime seçimi rastgele (in/out havuzundan).
        _ZIN = [("female", "Enhancing. Tighten the feed on target."), ("male", "Zooming in. Confirming visual."),
                ("female", "Close-up locked. Target identity confirmed."), ("male", "Moving in for a closer look.")]
        _ZOUT = [("male", "Pulling back out. Widening the feed."), ("female", "Detail confirmed. Resuming overwatch.")]
        try:
            _cues = json.load(open(f"{wd}/zoom_cues.json"))[:8]
        except Exception:
            _cues = []
        _rng2 = random.Random(int(sum(p["lat"] for p in mov[:20]) * 1e4))
        for _cue in _cues:
            _dc = INTRO_TOTAL + float(_cue.get("t", 0))
            if not (INTRO_TOTAL + 1.0 < _dc < OUTS - 1.0):
                continue
            _pool = _ZIN if _cue.get("dir") == "in" else _ZOUT
            _v, _x = _pool[_rng2.randrange(len(_pool))]
            _pp = _tts.line(_x, _v)
            lines.append((_pp, round(_dc + 0.1, 2), 1.65))                   # zoom ANINDA telsiz (eylemle senkron)
            swell.append(round(_dc - 0.15, 2))                              # zoom sesi
        sqs = [t_open - 0.35, t_read - 0.25, t_brief - 0.25, br_end + 0.4, TOUR1 + 2.0,
               _rc - 0.15, _rs - 0.15, _outlines[0][1] - 0.15, _outlines[-1][1] - 0.15]
        # ŞEHİR SESLİ ANONS (Barış): geçilen şehri operatör telsizle söyler — şehir seviyesi, SEYREK (sese boğmaz)
        _CITY_PH = ["Passing over {c}.", "Subject transiting {c}.", "Now over {c}, maintaining track.",
                    "{c} sector, eyes on target.", "Crossing into {c}, track is good."]
        try:
            _cityc = json.load(open(f"{wd}/city_cues.json"))[:5]
        except Exception:
            _cityc = []
        for _ci, _cc in enumerate(_cityc):
            _dc = INTRO_TOTAL + float(_cc.get("t", 0)); _cty = _cc.get("city", "")
            if not _cty or not (INTRO_TOTAL + 2.0 < _dc < OUTS - 2.0):
                continue
            _ph = _CITY_PH[_rng2.randrange(len(_CITY_PH))].format(c=_cty)
            _pp = _tts.line(_ph, "male" if _ci % 2 else "female")
            lines.append((_pp, round(_dc, 2), 1.7))
            sqs.append(round(_dc - 0.25, 2))                                  # önce kısa telsiz-squelch
            L(f"ŞEHİR ANONS @{_dc:.1f}: {_ph}")
        # OTONOM GÖRÜŞ GEÇİŞİ (Barış 2026-07-26): sürüş şafağı/batımı geçtiyse o ana sesli telsiz komutu
        try:
            _tr = json.load(open(f"{wd}/theme_transition.json"))
            _trt = INTRO_TOTAL + float(_tr.get("t", 0))
            if INTRO_TOTAL + 2.0 < _trt < OUTS - 2.0:
                _trph = ("Sunrise detected. Switching to day optics."
                         if _tr.get("dir") == "night2day" else "Light is gone. Night vision engaged.")
                lines.append((_tts.line(_trph, "male"), round(_trt, 2), 1.85))
                sqs.append(round(_trt - 0.3, 2))
                L(f"GÖRÜŞ GEÇİŞİ @{_trt:.1f}: {_trph}")
        except Exception as _tre:
            print("görüş geçiş sesi atlandı:", _tre, flush=True)
        # GECE GÖRÜŞ ANONSU (Barış 2026-07-26): yakınlaşınca gece görüşü (NV) açılır -> o ana kısa telsiz komutu (max 3, aralıklı)
        try:
            _thc = json.load(open(f"{wd}/thermal_cues.json")) or []
            _thl = ["Zooming in, night vision engaged.", "Closing in, switching to night vision.", "Tightening on target, night optics active."]
            _last_th = -99.0; _tk = 0
            for _tt in _thc:
                # ⚠️ ÖNCÜLLÜK KLİP SÜRESİ KADAR (Barış 2026-08-05: "NV açıldıktan SONRA komut veriyor adam").
                # Eskiden sabit 1.2sn'ydi: cümle ~3sn sürdüğü için 1.2sn önce BAŞLIYOR ama "night vision
                # engaged" kısmı NV açıldıktan ~2sn SONRA duyuluyordu -> algıda komut geriden geliyor.
                # Artık cümle NV'nin göründüğü anda BİTECEK şekilde öne alınır (ffprobe ile gerçek süre).
                _wv = _tts.line(_thl[_tk % len(_thl)], "male")
                try:
                    _ln = float(subprocess.run(["ffprobe","-v","error","-show_entries","format=duration",
                                                "-of","csv=p=0",_wv], capture_output=True, text=True).stdout.strip() or 0)
                except Exception:
                    _ln = 0.0
                _lead = min(4.0, max(1.2, _ln + 0.25))     # +0.25sn nefes payı; tavan 4sn (aşırı erken olmasın)
                _dt = INTRO_TOTAL + float(_tt) - _lead
                if _dt - _last_th < 8.0 or not (INTRO_TOTAL + 2.0 < _dt < OUTS - 2.0):
                    continue
                lines.append((_wv, round(_dt, 2), 1.8))
                sqs.append(round(_dt - 0.3, 2)); _last_th = _dt; _tk += 1
                L(f"TERMAL ANONS @{_dt:.1f}")
                if _tk >= 3:
                    break
        except Exception as _the:
            print("termal anons atlandı:", _the, flush=True)
        # SES ÇAKIŞMA TEMİZLİĞİ (2026-07-26): rota-fazı anonsları (termal-NV/şehir/zoom/görüş-geçişi) üst üste
        # binip "kadın+erkek iç içe" olmasın. intro sesleri (t<INTRO_TOTAL, brief/open/read) KORUNUR; çakışan
        # DEKORATİF rota anonsu DÜŞÜRÜLÜR. ffprobe ile gerçek süreler. amix üst üste toplarken artık çakışma kalmaz.
        try:
            _occ = [(_t, _t + adur(_p)) for (_p, _t, _v) in lines if _t < INTRO_TOTAL]
            _keep = [x for x in lines if x[1] < INTRO_TOTAL]
            # ÖNCELİK (2026-07-27): önce ÖNEMLİ anonslar (yüksek vol: geçiş 1.85 > NV 1.8 > şehir 1.7 > zoom 1.65)
            # -> NV komutu + sunrise KORUNUR; çakışan DEKORATİF (zoom) düşer. (Eskiden zamana göreydi -> NV düşüyordu.)
            for (_p, _t, _v) in sorted([x for x in lines if x[1] >= INTRO_TOTAL], key=lambda x: (-x[2], x[1])):
                _d = adur(_p); _s, _e = _t, _t + _d
                if any(not (_e <= _a or _s >= _b) for (_a, _b) in _occ):
                    L(f"SES ÇAKIŞMA: anons @{_t:.1f} (vol{_v}) düşürüldü (üst üste binmesin)"); continue
                _keep.append((_p, _t, _v)); _occ.append((_s, _e))
            lines = _keep
        except Exception as _dce:
            print("çakışma temizliği atlandı:", _dce, flush=True)
        FX = f"{T}/fx"
        silent = (music == "none")   # SESSİZ: Reels'te kullanıcı kendi müziğini ekler ('' de buraya düşer)
        inp = ["-i", f"{FX}/loading.wav"] + ([] if silent else ["-stream_loop", "-1", "-i", mp]) + \
              ["-i", f"{FX}/chime.wav", "-i", f"{FX}/beep.wav", "-i", f"{FX}/typing.wav"]
        mch = (f"atrim=4:{4+total},asetpts=PTS-STARTPTS,aresample=44100,"
               "equalizer=f=100:t=q:w=1.1:g=3.5,equalizer=f=210:t=q:w=1.3:g=2.0,"
               "acompressor=threshold=-16dB:ratio=2.4:attack=6:release=120:makeup=2dB")
        _o = 0 if silent else 1   # giriş indeks kayması
        fc = ["[0]adelay=150|150,volume=0.55[g]"]
        if not silent:
            fc.append(f"[1]{mch},volume='if(lt(t,{INTRO_TOTAL}),0.40,0.54)':eval=frame,afade=t=in:d=0.8,"
                      f"afade=t=out:st={OUTS+11.0}:d=2.6,apad=whole_dur={total}[mu]")
        fc += [f"[{1+_o}]adelay={int((TOUR1+6.95)*1000)}|{int((TOUR1+6.6)*1000)},volume=1[chm]", f"[{2+_o}]adelay={int((INTRO_TOTAL-1.6)*1000)}|{int((INTRO_TOTAL-1.6)*1000)},volume=1[bp]",
               f"[{3+_o}]volume=0.9[typ]"]
        mix = ["[g]"] + ([] if silent else ["[mu]"]) + ["[chm]", "[bp]", "[typ]"]; idx = 4 + _o
        for p, tt, vol in lines:
            inp += ["-i", p]; ms = int(tt * 1000)
            fc.append(f"[{idx}]adelay={ms}|{ms},volume={vol}[v{idx}]"); mix.append(f"[v{idx}]"); idx += 1
        for k, tt in enumerate(sqs):
            inp += ["-i", f"{FX}/sq.wav"]; ms = int(tt * 1000)
            fc.append(f"[{idx}]adelay={ms}|{ms},volume=0.4[q{k}]"); mix.append(f"[q{k}]"); idx += 1
        for k, tt in enumerate(swell):
            inp += ["-i", f"{FX}/swell.wav"]; ms = int(tt * 1000)
            fc.append(f"[{idx}]adelay={ms}|{ms},volume={0.4 if tt>58 else 0.5}[w{k}]"); mix.append(f"[w{k}]"); idx += 1
        # ===== LOGOUT SES SEKANSI: komut klavyeleri + [OK] bipleri + güç-kapanış + terminal-off =====
        _LB = OUTS + _LG            # logout ekranı başı (mutlak sn)
        _seq_t = [0.25, 1.05, 1.95, 2.80, 3.70, 4.70]   # görsel SEQ ile birebir
        for _si, _stt in enumerate(_seq_t):
            # her komut: kısa klavye tıkırtısı + biter bitmez [OK] bip
            inp += ["-i", f"{FX}/typing.wav"]; _kt = int((_LB + _stt) * 1000)
            fc.append(f"[{idx}]atrim=0:0.7,asetpts=PTS-STARTPTS,adelay={_kt}|{_kt},volume=0.72[lk{_si}]")
            mix.append(f"[lk{_si}]"); idx += 1
            inp += ["-i", f"{FX}/okbeep.wav"]; _ok = int((_LB + _stt + 0.62) * 1000)
            fc.append(f"[{idx}]adelay={_ok}|{_ok},volume=0.5[ok{_si}]"); mix.append(f"[ok{_si}]"); idx += 1
        # güç-kapanış uğultusu (görsel güç barıyla senkron ~5.3)
        inp += ["-i", f"{FX}/powerdown.wav"]; _pw = int((_LB + 5.3) * 1000)
        fc.append(f"[{idx}]adelay={_pw}|{_pw},volume=0.6[pw]"); mix.append("[pw]"); idx += 1
        # terminal-off thunk (CRT söner ~6.7)
        inp += ["-i", f"{FX}/termoff.wav"]; _to = int((_LB + 6.7) * 1000)
        fc.append(f"[{idx}]adelay={_to}|{_to},volume=0.7[to]"); mix.append("[to]"); idx += 1
        fcs = ";".join(fc) + ";" + "".join(mix) + f"amix=inputs={len(mix)}:normalize=0,alimiter=limit=0.95[out]"
        sh(["ffmpeg", "-v", "error"] + inp + ["-filter_complex", fcs, "-map", "[out]", "-t", str(total),
            "-c:a", "aac", "-b:a", "192k", "-ar", "44100", f"{wd}/mix.m4a", "-y"])
        # stereo + gürlük (ölçüm bazlı, hedef -7)
        sh(["ffmpeg", "-v", "error", "-i", f"{wd}/mix.m4a", "-af",
            "pan=stereo|c0=c0|c1=c0,dynaudnorm=f=400:g=15:p=0.85:m=8,"
            "alimiter=limit=0.95:attack=4:release=80", "-ar", "44100",
            "-c:a", "aac", "-b:a", "192k", f"{wd}/mixL.m4a", "-y"])   # YUMUŞAK: hoparlör patlaması yok
        import re as _re
        r = subprocess.run(["ffmpeg", "-i", f"{wd}/mixL.m4a", "-af", "ebur128=framelog=quiet",
                            "-f", "null", "-"], capture_output=True, text=True)
        cur = float(_re.search(r"I:\s*(-?[\d.]+) LUFS", r.stderr).group(1))
        if abs(cur - (-9.5)) > 0.4:
            sh(["ffmpeg", "-v", "error", "-i", f"{wd}/mixL.m4a", "-af",
                f"volume={(-9.5-cur):.1f}dB,alimiter=limit=0.95:attack=4:release=80",
                "-ar", "44100", "-c:a", "aac", "-b:a", "192k", f"{wd}/mixL2.m4a", "-y"])
            shutil.move(f"{wd}/mixL2.m4a", f"{wd}/mixL.m4a")
        sh(["ffmpeg", "-v", "error", "-i", f"{wd}/master.mp4", "-i", f"{wd}/mixL.m4a",
            "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "copy",
            "-movflags", "+faststart", f"{wd}/final.mp4", "-y"])
        # ---- 8b) ÇIKIŞ DENETİMİ (kalıcı): süre <60sn, stereo, gürlük bandı ----
        _fd = adur(f"{wd}/final.mp4")
        if not (_BUD - 2.8 <= _fd <= _BUD + 0.4):
            raise RuntimeError(f"süre standart dışı: {_fd:.2f}sn (bütçe {_BUD})")
        _pr2 = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries",
                               "stream=channels", "-of", "csv=p=0", f"{wd}/final.mp4"],
                              capture_output=True, text=True)
        if "2" not in _pr2.stdout:
            raise RuntimeError("ses stereo değil")
        import re as _re2
        _r3 = subprocess.run(["ffmpeg", "-i", f"{wd}/final.mp4", "-af", "ebur128=framelog=quiet",
                              "-f", "null", "-"], capture_output=True, text=True)
        _lu = float(_re2.search(r"I:\s*(-?[\d.]+) LUFS", _r3.stderr).group(1))
        if not (-11.5 <= _lu <= -7.5):
            raise RuntimeError(f"gürlük bant dışı: {_lu} LUFS (-11.5..-7.5)")
        L(f"ÇIKIŞ OK: {_fd:.2f}sn, {_lu} LUFS, stereo")
        # ---- 9) R2 yükleme + render-done ----
        key = f"videos/{vid}.mp4"; sz = os.path.getsize(f"{wd}/final.mp4")
        _put = os.environ.get("TAC_PUT_URL", "")
        if _put:
            # RunPod GÜVENLİ MOD: R2 credential/secret RunPod'da YOK. Lokal host'un ürettiği presigned
            # PUT URL'ine yükle; render-done'u lokal reconcile halleder (movelog-pending-reconcile).
            with open(f"{wd}/final.mp4", "rb") as _vf:
                _pr = urllib.request.Request(_put, data=_vf.read(), method="PUT",
                                             headers={"Content-Type": "video/mp4"})
                urllib.request.urlopen(_pr, timeout=300).read()
            L("TAMAM (presigned):", vid, sz, "bytes")
        else:
            import boto3
            s3 = boto3.client("s3", endpoint_url=R2C["R2_ENDPOINT"], aws_access_key_id=R2C["R2_ACCESS_KEY_ID"],
                              aws_secret_access_key=R2C["R2_SECRET_ACCESS_KEY"], region_name="auto")
            B = R2C.get("R2_BUCKET", "movelog")
            s3.upload_file(f"{wd}/final.mp4", B, key, ExtraArgs={"ContentType": "video/mp4"})
            from datetime import datetime, timezone, timedelta
            day = datetime.fromtimestamp(int(job["from"]), timezone(timedelta(hours=3))).strftime("%Y-%m-%d")
            data = json.dumps({"secret": SECRET, "ride_id": vid, "key": key, "user": user,
                               "date": day, "ts": int(job["from"]), "to": int(job["to"]),
                               "type": job.get("type", "moto"), "mode": "tactical",
                               "speed": "medium", "aspect": _ASP, "size": sz}).encode()
            rq = urllib.request.Request(BACKEND + "/api/internal/render-done", data=data,
                                        headers={"Content-Type": "application/json"})
            urllib.request.urlopen(rq, timeout=20).read()
            L("TAMAM:", vid, sz, "bytes")
    except Exception as e:
        L("HATA:", repr(e))
        if not os.environ.get("TAC_PUT_URL"):   # RunPod modda BACKEND erişilemez -> lokal reconcile hatayı halleder
            try:
                data = json.dumps({"secret": SECRET, "ride_id": vid, "user": user,
                                   "reason": "tactical üretim hatası"}).encode()
                rq = urllib.request.Request(BACKEND + "/api/internal/render-failed", data=data,
                                            headers={"Content-Type": "application/json"})
                urllib.request.urlopen(rq, timeout=15).read()
            except Exception:
                pass
        raise
    finally:
        # SUNUCU DİSKİ (Barış 2026-07-26): iş bitince (başarı VEYA hata) TÜM work dir + job dosyası SİL.
        # Video R2'de -> sunucuda hiç yer kaplamaz. (Kill'de finally çalışmaz -> movelog-tacclean.timer güvenlik ağı.)
        if not os.environ.get("TAC_KEEPWD"):   # test/doğrulama: TAC_KEEPWD=1 -> wd + cue dosyaları incelemek için kalır
            try: shutil.rmtree(wd, ignore_errors=True)
            except Exception: pass
            try: os.remove(jobfile)
            except Exception: pass

if __name__ == "__main__":
    main(sys.argv[1])
