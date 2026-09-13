#!/usr/bin/env python3
# TAKTİK RENDER İŞÇİSİ — genreq mode:"tactical" işini uçtan uca üretir:
# rastgele çekiliş -> Commons landmark -> TTS (rastgele kod + kullanıcı brifingi) ->
# dinamik zaman çizelgesi -> intro/rota/outro render -> bamgüm ses -> R2 -> render-done.
# Kullanım: python3 render_job.py /path/to/job.json
import os, sys, json, math, time, random, shutil, struct, subprocess, urllib.request, urllib.parse

T = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, T)
from pool import draw, MIDCALLS

BACKEND = "http://127.0.0.1:8780"
TRACCAR = "http://127.0.0.1:8084"
# TAŞIMA (RunPod, 2026-08-30): harita taban ucu env'den; varsayılan = bugünkü yerel proxy (davranış birebir).
# NOT: bu QA aracı .dockerignore'da -> imaja GİRMEZ, yalnız sunucuda çalışır.
_HT = os.environ.get("HARITA_TABAN", "http://127.0.0.1:8890").rstrip("/")
_H_MATCH = os.environ.get("HARITA_MATCHING", _HT).rstrip("/")
TUSER = "daclen10@gmail.com"; TPASS = "SIR_KALDIRILDI_bkz_etc_nickdegs_traccar_conf"
R2C = {}
for _l in open("/opt/matrix/secrets/movelog-r2.conf"):
    if "=" in _l: k, v = _l.strip().split("=", 1); R2C[k] = v
SECRET = ""
for _l in open("/opt/matrix/secrets/movelog-backend.conf"):
    if _l.startswith("RENDER_DONE_SECRET="): SECRET = _l.strip().split("=", 1)[1]

def sh(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode != 0:
        raise RuntimeError(f"CMD FAIL {cmd[0]}: {r.stderr[-400:]}")
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

def commons_landmark(term, out_path):
    """Commons'tan telifsiz landmark fotoğrafı indir (ilk uygun bitmap)."""
    q = urllib.parse.urlencode({"action": "query", "generator": "search",
        "gsrsearch": f"{term} filetype:bitmap", "gsrlimit": 5, "gsrnamespace": 6,
        "prop": "imageinfo", "iiprop": "url|size", "iiurlwidth": 960, "format": "json"})
    _rq = urllib.request.Request(f"https://commons.wikimedia.org/w/api.php?{q}",
                                 headers={"User-Agent": "MoveLogTactical/1.0 (movelog app)"})
    d = json.load(urllib.request.urlopen(_rq, timeout=30))
    pages = sorted((d.get("query", {}).get("pages", {}) or {}).values(),
                   key=lambda p: -(p.get("imageinfo", [{}])[0].get("height", 0)))
    for p in pages:
        ii = p.get("imageinfo", [{}])[0]
        u = ii.get("thumburl") or ii.get("url")
        if not u: continue
        if ii.get("height", 0) < 400: continue
        try:
            data = urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "MoveLogTactical/1.0"}), timeout=40).read()
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
            if len(src) > 4000:                                  # istek sınırı (geometri çıktısı yine yoğun)
                _st = len(src) / 4000.0
                src = [src[int(_i * _st)] for _i in range(4000)]
            result = []; ok_ch = 0; tot_ch = 0; CH = 90; _i = 0
            while _i < len(src):
                ch = src[_i:_i + CH]
                if len(ch) < 3:
                    result.extend(ch); _i += CH; continue
                tot_ch += 1
                coords = ";".join(f"{p['lon']:.6f},{p['lat']:.6f}" for p in ch)
                rad = ";".join("30" for _ in ch)
                # 2026-08-11: QA aracı da proxy'ye — canlı hattaki SON Mapbox-host referansıydı (bağımsızlık ilanı denetimi)
                url = (f"{_H_MATCH}/matching/v5/mapbox/driving/{coords}"
                       f"?geometries=geojson&overview=full&tidy=true&radiuses={rad}&access_token={_MB}")
                geom = None
                try:
                    d = json.load(urllib.request.urlopen(url, timeout=25))
                    ms = d.get("matchings", [])
                    if ms and ms[0].get("geometry", {}).get("coordinates"):
                        geom = ms[0]["geometry"]["coordinates"]        # yol boyunca YOĞUN [[lon,lat],...]
                except Exception:
                    geom = None
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
                        result.append({"t": _interp(_ct, _cal, _tgt), "lat": lat, "lon": lon,
                                       "spd": _interp(_cs, _cal, _tgt), "crs": 0, "sig": round(_sig, 2)})
                else:
                    for _p in ch: result.append({**_p, "sig": 0.5})    # eşleşmezse ham (belirsiz sinyal)
                _i += CH
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
            r = subprocess.run(["scp", "-o", "ConnectTimeout=8",
                                f"root@10.99.0.2:/opt/movelog/data/avatars/{user}.jpg", avp],
                               capture_output=True)
            if r.returncode == 0 and os.path.exists(avp): av = avp
        job["avatar"] = av
        # ---- 2) rastgele çekiliş + landmark'lar ----
        # TEK FORMAT (Barış 2026-07-19): kanıtlanmış düzen KİLİTLİ — yakın kamera + 3 şehir.
        # Kullanıcı SADECE crosshair rengi + müzik seçer; diğer tüm seçimler yok sayılır.
        NCITY = 3
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
        f_open = tts.line(f"{rz['code_words']}, this is Actual. How copy?", "female")
        f_brief = tts.brief_line(name, job.get("type", "moto"))
        V = f"{T}/voices"
        d_open = adur(f_open); d_brief = adur(f_brief)
        # ---- 4) dinamik zaman çizelgesi (intro TOTAL=31.7 sabit; sesler kayar) ----
        t_open = 6.0
        t_read = t_open + d_open + 0.45
        t_brief = t_read + adur(f"{V}/m_read_p.wav") + 0.45
        # SIKIŞTIRMA YOK: brifing doğal süresinde; intro TOUR ucu sese göre uzar
        br_end = t_brief + d_brief
        brief_use = f_brief
        # ---- ZAMAN BÜTÇESİ: intro sese göre, rota kalan süreyi alır (toplam 59.6 sabit) ----
        TOUR1 = max(20.0, br_end + 0.75)
        INTRO_TOTAL = round(TOUR1 + 11.0, 2)
        _BUD = 178.0 if job.get("speed") == "slow" else 59.6   # Kısa=Reels(<=1dk) / Uzun=Gönderi(<=3dk)
        # EN-BOY süreden BAĞIMSIZ: kullanıcı seçer (9:16 dikey / 4:5 gönderi) — her sürede geçerli
        if job.get("aspect") == "4:5":
            _VW, _VH, _ASP = 1080, 1350, "4:5"
        else:
            _VW, _VH, _ASP = 1080, 1920, "9:16"
        ROUTE_DUR = round(_BUD - 13.2 - INTRO_TOTAL, 2)
        if ROUTE_DUR < 10.5:
            raise RuntimeError(f"brifing çok uzun: rota {ROUTE_DUR}sn kalıyor")
        OUTS = round(INTRO_TOTAL + ROUTE_DUR, 2)
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
        _anchor = {"mc_copy": br_end + 0.55, "mc_scan": TOUR1 + 2.15, "mc_located": TOUR1 + 4.4,
                   "mc_locked": TOUR1 + 6.95, "mc_moving": TOUR1 + 7.65}
        fixed = []; _pend = 0.0
        for _nm in _mnames:
            _pp = f"{V}/{_nm}.wav"
            _st = max(_anchor[_nm], _pend + 0.4)
            fixed.append((_pp, round(_st, 2)))
            _pend = _st + adur(_pp)
        # ---- 4b) ZAMAN ÇİZELGESİ DENETİMİ (kalıcı kalite kapısı) ----
        _tlchk = [("f_open", f_open, t_open), ("m_read", f"{V}/m_read_p.wav", t_read),
                  ("f_brief", brief_use, t_brief)] + [(os.path.basename(p), p, tt) for p, tt in fixed]
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
        build_ekg(wd, [(f_open, t_open), (f"{V}/m_read_p.wav", t_read), (brief_use, t_brief)] + fixed, total=INTRO_TOTAL)
        # ---- 6) render: ROTA önce (route_first için) -> intro -> outro ----
        env = dict(os.environ, TAC_WORKDIR=wd, TAC_LAT=str(slat), TAC_LON=str(slon),
                   TAC_OLAT=str(elat), TAC_OLON=str(elon),
                   TAC_CITIES=json.dumps(cities), TAC_LMNAME=json.dumps(lmname),
                   TAC_NAME=name, TAC_CITY=job.get("city", ""),
                   VIDCODE=rz["code_disp"], ACTTYPE=job.get("type", "moto"),
                   TAC_CAMDIST=job.get("camdist", "orta"),
                   TAC_TOUREND=f"{TOUR1:.2f}", TAC_DUR=f"{ROUTE_DUR:.2f}",
                   TAC_DIVEZ=str(DIVEZ), TAC_OZ0=f"{OZ0:.2f}", TAC_LOGOUT=f"{_LG:.2f}",
                   TAC_W=str(_VW), TAC_H=str(_VH),
                   TAC_RETCOL=(job.get("dot") or ""),
                   AVATAR=job.get("avatar", ""), **TL)
        sh(["python3", f"{T}/route_gen.py"], env=env, cwd=wd)
        shutil.copy(f"{wd}/tacframes/f00000.jpg", f"{wd}/route_first.jpg")
        # OUTRO SÜREKLİLİĞİ: outro giriş zoom'unu route'un SON zoom'una eşle -> ışınlanma YOK
        try:
            _re = json.load(open(f"{wd}/route_end.json"))
            env["TAC_OZ0"] = f"{float(_re['oz0']):.2f}"
            L(f"OUTRO OZ0 route sonuna eşlendi: {_re['oz0']} (ışınlanma yok)")
        except Exception as _e:
            L(f"route_end.json okunamadı, span-tabanlı OZ0 kullanılıyor: {_e!r}")
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
        if music.startswith("lib:"):
            _mid = "".join(c for c in music[4:] if c.isalnum())
            r = subprocess.run(["scp", "-o", "ConnectTimeout=8",
                                f"root@10.99.0.2:/opt/movelog/data/usermusic/{user}/{_mid}.m4a",
                                f"{wd}/custom_raw.m4a"], capture_output=True)
            if r.returncode == 0:
                sh(["ffmpeg", "-v", "error", "-vn", "-i", f"{wd}/custom_raw.m4a",
                    "-af", "loudnorm=I=-16:TP=-1.8:LRA=9", "-ar", "44100",
                    "-c:a", "aac", "-b:a", "192k", f"{wd}/custom.m4a", "-y"])
                mp = f"{wd}/custom.m4a"; L("kütüphane müziği:", _mid)
        if music == "upload":
            # kullanıcının kendi müziği: backend'den çek + seviye kuralına normalize et
            frm_s = str(int(job["from"]))
            r = subprocess.run(["scp", "-o", "ConnectTimeout=8",
                                f"root@10.99.0.2:/opt/movelog/data/ridephotos/{user}_{frm_s}/music.m4a",
                                f"{wd}/custom_raw.m4a"], capture_output=True)
            if r.returncode == 0:
                sh(["ffmpeg", "-v", "error", "-vn", "-i", f"{wd}/custom_raw.m4a",
                    "-af", "loudnorm=I=-16:TP=-1.8:LRA=9", "-ar", "44100",
                    "-c:a", "aac", "-b:a", "192k", f"{wd}/custom.m4a", "-y"])
                mp = f"{wd}/custom.m4a"
                L("kullanıcı müziği kullanılıyor")
        if not os.path.exists(mp):
            mp = f"{T}/music/" + random.choice([f for f in os.listdir(f"{T}/music") if f.endswith(".m4a")])
        lines = [(f_open, t_open, 1.7), (f"{V}/m_read_p.wav", t_read, 1.6), (brief_use, t_brief, 1.7)] + \
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
        # ---- 9) QA ATLA ----
        sz = os.path.getsize(f"{wd}/final.mp4")
        L("QA TAMAM:", vid, sz, "bytes")
    except Exception as e:
        L("HATA:", repr(e))
        try:
            data = json.dumps({"secret": SECRET, "ride_id": vid, "user": user,
                               "reason": "tactical üretim hatası"}).encode()
            rq = urllib.request.Request(BACKEND + "/api/internal/render-failed", data=data,
                                        headers={"Content-Type": "application/json"})
            urllib.request.urlopen(rq, timeout=15).read()
        except Exception:
            pass
        raise

if __name__ == "__main__":
    main(sys.argv[1])
