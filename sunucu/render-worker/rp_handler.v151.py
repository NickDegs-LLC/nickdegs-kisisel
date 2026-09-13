#!/usr/bin/env python3
# RunPod SERVERLESS render handler — Cloud Run worker.py'nin RunPod karşılığı.
# RunPod /run ile {"input": <job>} gelir; aynı route-video.py hattını GPU'da koşar,
# mp4'ü R2'ye yükler, backend'e render-done der. Serverless = scale-to-zero (lazım olunca çalışır).
import os, json, subprocess, tempfile, glob, urllib.request, urllib.parse, time
import runpod
import boto3

# ─────────── v151 (07.09) — İKİ SESSİZ ARIZA ───────────
# 1) AVATAR HİÇ İNMİYORDU. `handler()` gövdesinde (müzik bloğu, eski satır 168) yerel bir
#    `import urllib.parse` vardı. Python'da bu, `urllib`'i O DAL HİÇ ÇALIŞMASA BİLE tüm
#    fonksiyon için YEREL isim yapar -> avatar indirme satırı her seferinde
#    `UnboundLocalError: cannot access local variable 'urllib'` atıyor, `except` yutuyor,
#    log'a "avatar indirilemedi" yazıp geçiyordu. Minimal tekrar üretimle kanıtlandı.
#    FİKS: `urllib.parse` modül seviyesine alındı, fonksiyon içindeki import SİLİNDİ.
#    (Müzik etkilenmiyordu: o kod import'tan SONRA çalışıyor.)
# 2) VARSAYILAN PYTHON UA'SI CLOUDFLARE'DE 403. Ölçüldü (aynı konteyner, aynı çıkış IP'si):
#    `Python-urllib/3.x` -> 403 · tarayıcı UA -> 200 · `movelog-render/1.0` -> 200.
#    Riski: render biter, mp4 R2'ye yüklenir, ama /api/internal/render-done geri çağrısı
#    sessizce düşer -> video kullanıcıya ULAŞMAZ (pending-reconcile'ın (a) maddesinin imzası).
#    FİKS: varsayılan opener'a kimlikli UA. Handler'ın kendi Request nesnelerindeki başlıklar
#    korunur (opener addheaders yalnız EKSİK başlığı tamamlar).
_acici = urllib.request.build_opener()
_acici.addheaders = [("User-Agent", "movelog-render/1.0")]
urllib.request.install_opener(_acici)

R2 = boto3.client("s3", endpoint_url=os.environ["R2_ENDPOINT"],
                  aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
                  aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"], region_name="auto")
BUCKET = os.environ["R2_BUCKET"]
BACKEND_URL = os.environ.get("BACKEND_URL", "")
RENDER_DONE_SECRET = os.environ.get("RENDER_DONE_SECRET", "")


def _run(args, env, to, errf):
    try:
        with open(errf, "w") as ef, open(errf + ".out", "w") as of:
            # stdout'u da yakala: route-video'nun "deneme 2/parlaklık/WEBGL CONTEXT LOST" mesajları teşhis için ŞART
            rc = subprocess.run(args, env=env, timeout=to, stderr=ef, stdout=of).returncode
        if rc != 0:
            try: print("RENDER STDERR>>", open(errf).read()[-2500:], flush=True)
            except Exception: pass
        return rc
    except subprocess.TimeoutExpired:
        try: print("RENDER STDERR(timeout)>>", open(errf).read()[-2000:], flush=True)
        except Exception: pass
        return -9



# ─────────── KARO ÖN-ISITMA (2026-09-01) ───────────
# NEDEN: yeni harita katmanında SOĞUK karo 3-5 sn sürüyor (ölçüldü: Giresun 3.6-5.2sn,
# İstanbul sıcak 0.17sn). Render karoları sırayla çekiyor -> soğuk bölgede render sürünüyor,
# 3B zaman aşımına düşüp sessizce flyover'a çevriliyordu.
# ÇÖZÜM: render başlamadan önce rotanın karolarını PARALEL çek. Cloudflare önbelleği veri
# merkezi başına olduğu için ısıtma RENDER'IN KENDİ MAKİNESİNDEN yapılmalı (dispatch'ten
# yapılsaydı başka bir PoP ısınırdı, işe yaramazdı).
_HARITA = os.environ.get("HARITA_TABAN", "https://harita.nickdegs.com/24579d9db6c7c001")


def _karo(lat, lon, z):
    import math
    n = 2 ** z
    x = int((lon + 180.0) / 360.0 * n)
    la = math.radians(max(min(lat, 85.05), -85.05))
    y = int((1.0 - math.log(math.tan(la) + 1.0 / math.cos(la)) / math.pi) / 2.0 * n)
    return x, y


def _onisit(track, katman="premium", tavan=600):
    """Rota boyunca karoları paralel çekip CF önbelleğine ısıtır. Hata YUTULUR (ısıtma
    zorunlu değil, sadece hızlandırma). Dönen: (istek, basarili, saniye)."""
    if not track:
        return (0, 0, 0.0)
    try:
        from concurrent.futures import ThreadPoolExecutor
    except Exception:
        return (0, 0, 0.0)
    hedef = set()
    # rotayı ~150 noktaya indir (yan yana noktalar aynı karoya düşüyor)
    adim = max(1, len(track) // 150)
    for p in track[::adim]:
        try:
            la, lo = float(p["lat"]), float(p["lon"])
        except Exception:
            continue
        for z in (13, 14, 15):
            x, y = _karo(la, lo, z)
            for dx in (-1, 0, 1):          # kamera kenarları da lazım
                for dy in (-1, 0, 1):
                    hedef.add((z, x + dx, y + dy))
    urller = []
    for z, x, y in hedef:
        urller.append(f"{_HARITA}/mvt/{z}/{x}/{y}.mvt")
        if z <= 14:
            urller.append(f"{_HARITA}/xyz/sat/{z}/{x}/{y}.jpg?k={katman}")
    urller = urller[:tavan]

    def _cek(u):
        try:
            rq = urllib.request.Request(u, headers={"User-Agent": "movelog-onisit/1"})
            with urllib.request.urlopen(rq, timeout=25) as r:
                r.read(1)
                return 1
        except Exception:
            return 0

    t0 = time.time()
    with ThreadPoolExecutor(max_workers=32) as ex:
        ok = sum(ex.map(_cek, urller))
    return (len(urller), ok, round(time.time() - t0, 1))


def handler(rpjob):
    _t0 = time.time()   # MALİYET TELEMETRİSİ: işin GPU duvar süresi render-done ile backend'e gider
    job = rpjob.get("input", {}) or {}
    # 01.09 TANI MODU (glcheck=1): render YAPMADAN sadece GL kimliğini döndürür.
    # Amaç: worker gerçekten GPU mu kullanıyor yoksa llvmpipe (yazılımsal, ~50x yavaş) mı —
    # saniyeler sürer, GPU saati yakmaz.
    if job.get("glcheck"):
        try:
            _g = subprocess.run(["node", "/app/3d/glhealth.js"], capture_output=True,
                                text=True, timeout=120, cwd="/app/3d")
            return {"gl": (_g.stdout or "")[-500:], "gl_err": (_g.stderr or "")[-300:],
                    "rc": _g.returncode}
        except Exception as ex:
            return {"gl_hata": str(ex)[:300]}
    track = job.get("track", [])
    if len(track) < 3:
        return {"error": "no track"}
    out = tempfile.mkdtemp()
    tf = os.path.join(out, "track.json")
    json.dump({"points": track}, open(tf, "w"))
    mode = job.get("mode", "flyover")
    # 01.09: API req'inde 'day' YOK -> sabit "2026-01-01" varsayılanı videoya "1 Oca 2026"
    # yazdırıyordu (Semra'nın 30 Ağustos videosunda görüldü). from epoch'undan TR gününü türet.
    _gun = job.get("day")
    if not _gun:
        try:
            _gun = time.strftime("%Y-%m-%d", time.gmtime(int(float(job.get("from", 0))) + 3 * 3600))
        except Exception:
            _gun = "2026-01-01"
    args = ["python3", "/app/scripts/route-video.py", _gun,
            "paid" if job.get("premium") else "free", job.get("speed", "medium"),
            mode, job.get("aspect", "16:9"),
            f"track={tf}", f"from={int(job['from'])}", f"to={int(job['to'])}",
            f"dev={job.get('device', 1)}", "dry"]
    if job.get("name"): args.append(f"name={job['name']}")
    # GRUP SÜRÜŞ (v113): N eş sürücü — mates listesi [{track,name,line,dot}...]; legacy track2 tek eşe çevrilir
    _mates = job.get("mates") or []
    if not _mates and job.get("track2"):
        _mates = [{"track": job["track2"], "name": job.get("name2", ""),
                   "line": job.get("line2", ""), "dot": job.get("dot2", "")}]
    if _mates:
        mf = os.path.join(out, "mates.json")
        json.dump([{"points": m.get("track") or [], "name": m.get("name", ""),
                    "line": m.get("line", ""), "dot": m.get("dot", "")} for m in _mates], open(mf, "w"))
        args.append(f"mates={mf}")
    if job.get("type"): args.append(f"acttype={job['type']}")
    if job.get("line"): args.append(f"line={job['line']}")
    if job.get("dot"): args.append(f"dot={job['dot']}")
    if job.get("camdist"): args.append(f"camdist={job['camdist']}")   # kamera mesafesi yakın/orta/uzak
    # 05.09: sokak pano butcesi (satin alinan hak x 700) — route-video -> streetview.py _MAXP
    if job.get("sv_pano"): args.append(f"sv_pano={int(job['sv_pano'])}")
    if job.get("lang"): args.append(f"lang={job['lang']}")            # VİDEO DİLİ: aktivite adı + ay kısaltması
    if job.get("cam"): args.append(f"cam={job['cam']}")               # 3d kamera modu: chase=tam arkadan
    if job.get("ultra"): args.append("ultra=1")                        # Ultra=cila efekti
    if job.get("kabartma"): args.append("kabartma=1")                  # KABARTMALI: 3B binalar (Premium+Ultra)
    if job.get("seg"): args.append(f"seg={job['seg']}")                # PARALEL SEGMENT: "k/n" kare dilimi
    if job.get("matched"): args.append("matched=1")
    if job.get("nohud"): args.append("nohud=1")   # PROMO: video içi yazı yok                    # iz fanout'ta yola oturtuldu -> map-match atla
    if job.get("reel"): args.append("reel")       # Faz 3c: ~15sn dikey paylaşım teaser'ı
    user = job.get("user")
    if user and BACKEND_URL:
        try:
            avp = os.path.join(out, "avatar.img")
            r = urllib.request.urlopen(BACKEND_URL.rstrip("/") + f"/api/profile/photo/{user}", timeout=15)
            data = r.read()
            if r.status == 200 and len(data) > 500:
                open(avp, "wb").write(data); args.append(f"avatar={avp}")
        except Exception as ex:
            print("avatar indirilemedi:", ex, flush=True)
    # MÜZİK: kullanıcının global/seçili müziğini backend'den çek (avatar gibi) -> route-video music=
    if user and BACKEND_URL and job.get("music"):
        try:
            # (v151) yerel `import urllib.parse` SİLİNDİ — `urllib`'i tüm fonksiyon için
            # yerelleştirip yukarıdaki avatar indirmesini bozuyordu. Artık modül seviyesinde.
            _mq = urllib.parse.urlencode({"user": user, "ref": job.get("music", ""),
                                          "session": int(float(job.get("from", 0) or 0)), "secret": RENDER_DONE_SECRET})
            mp = os.path.join(out, "music.m4a")
            r = urllib.request.urlopen(BACKEND_URL.rstrip("/") + "/api/internal/music?" + _mq, timeout=25)
            mdata = r.read()
            if r.status == 200 and len(mdata) > 500:
                open(mp, "wb").write(mdata); args.append(f"music={mp}")
                print("müzik uygulandı:", job.get("music"), len(mdata), "bayt", flush=True)
        except Exception as ex:
            print("müzik indirilemedi (sessiz devam):", ex, flush=True)
    e = dict(os.environ); e["ROUTE_OUT"] = out
    # HIZ: uzun/otonom videolarda süperörnekleme 1.25 -> 1.0 (~%40 hız; telefonda fark minimal).
    # Kısa/orta videolar 1.25 keskinlikte kalır.
    if mode == "3d" and job.get("speed") in ("slow", "auto"):
        e["RENDER3D_SCALE"] = "1.0"
    errf = os.path.join(out, "render.err")

    def _redispatch(reason):
        """İşi FRESH worker'a yeniden gönder + BU worker'ı ÖLDÜR (refresh_worker) — bozuk GPU bir daha iş alamaz."""
        _attempt = int(job.get("_attempt", 0))
        RK = os.environ.get("RUNPOD_API_KEY"); EID = os.environ.get("RUNPOD_ENDPOINT_ID")
        if _attempt < 6 and RK and EID:
            try:
                nj = dict(job); nj["_attempt"] = _attempt + 1
                req = urllib.request.Request(f"https://api.runpod.ai/v2/{EID}/run",
                    data=json.dumps({"input": nj}).encode(),
                    headers={"Content-Type": "application/json", "Authorization": "Bearer " + RK})
                urllib.request.urlopen(req, timeout=30).read()
                print(f"{reason} -> re-dispatch (attempt {_attempt+1}) + refresh_worker (bozuk worker ÖLDÜRÜLÜYOR)", flush=True)
                return {"refresh_worker": True, "requeued": job.get("ride_id"), "attempt": _attempt + 1, "why": reason}
            except Exception as ex:
                print("re-dispatch FAIL:", ex, flush=True)
        return None

    # GPU SAĞLIK TESTİ (KÖK ÇÖZÜM): 3D işten ÖNCE ~10sn'de WebGL+shader derlemeyi dene.
    # Bozuk-GL worker (shaderSource hatası) 25-35dk render yakmadan YAKALANIR -> iş fresh worker'a, bu worker ÖLÜR.
    if mode == "3d" and not job.get("test"):
        try:
            _gh = subprocess.run(["node", "/app/3d/glhealth.js"], capture_output=True, text=True, timeout=90)
            _gs = (_gh.stdout or "").strip()
            print("GL SAĞLIK:", _gs[:160], flush=True)
            # SADECE KESİN bozukluk imzasında öldür (createShader null / shader derleme = bilinen bozuk-GL türü).
            # Diğer fail'ler (launch/flag sorunları) YANLIŞ ALARM olabilir -> sadece logla, render şansını dene.
            # (v66 dersi: genel fail=öldür yaklaşımı sağlıklı worker'ları da öldürüp churn yarattı.)
            # v146 (01.09): "llvmpipe" da KESİN imza — MIG diliminde donanım GL yok, Chrome yazılımsal Mesa'ya
            # düşer; shader derlenir ama 3B ~50x yavaş -> 180sn zaman aşımı -> flyover. Bu worker'a 3B verilmez:
            # iş fresh worker'a (_attempt<6), worker refresh_worker ile ölür. (glhealth.js llvmpipe'ı BROKEN sayar.)
            if _gh.returncode != 0 and ("createShader null" in _gs or "shader derlenemedi" in _gs
                                        or "llvmpipe" in _gs):
                _r = _redispatch("GL SAĞLIK BOZUK: " + _gs[:120])
                if _r: return _r
        except Exception as ex:
            print("gl sağlık testi çalışmadı (devam):", ex, flush=True)

    # SÜRE SINIRI KALDIRILDI (Barış: "5 saat sürse de üretsin"): uzun/çok noktalı rotalar tile yüklemede yavaş.
    # 3D/pacman -> 5 saat, diğerleri 1 saat. (Endpoint executionTimeoutMs=6 saate çıkarıldı.)
    _to = 18000 if (job.get("cam") == "pacman" or mode == "3d") else 3600
    try:
        _n, _ok_, _sn = _onisit(job.get("track") or [], "ultra" if job.get("ultra") else "premium")
        print(f"KARO ÖN-ISITMA: {_ok_}/{_n} karo, {_sn}sn", flush=True)
    except Exception as _ex:
        print("ön-ısıtma atlandı:", _ex, flush=True)
    rc = _run(args, e, _to, errf)
    mp4s = glob.glob(os.path.join(out, "rota_*.mp4"))

    def _clean():
        for x in glob.glob(os.path.join(out, "rota_*.mp4*")):
            try: os.remove(x)
            except Exception: pass

    # TANI: route-video google3d hata çıktısını out/g3d.err'e yazar (fallback olsa bile) -> output'a taşı
    _g3d_dbg = ""
    try:
        _gerf = os.path.join(out, "g3d.err")
        if os.path.exists(_gerf):
            _g3d_dbg = open(_gerf).read()[-1800:]
            if _g3d_dbg.strip(): print("GOOGLE3D ERR>>", _g3d_dbg[-800:], flush=True)
    except Exception: pass
    # ULTRA: Google 3D olmadıysa Mapbox/flyover ASLA verme (müşteri para verdi) -> FRESH worker'a re-dispatch.
    # Render başarısızlığı = bu worker'ın GPU'su güvenilmez (context loss/GL bozuk) -> refresh_worker ile ÖLDÜR,
    # bir daha iş almasın (eskiden sıcak kalıp sonraki işleri de yakıyordu — asıl zaman kaybı buydu).
    if (rc != 0 or not mp4s) and mode == "3d" and job.get("ultra") and not job.get("test"):
        _r = _redispatch("ULTRA Google 3D olmadı")
        if _r:
            _r["g3d_dbg"] = _g3d_dbg
            try:  # route-video stdout kuyruğu (deneme/parlaklık/context-loss teşhisi)
                _r["rv_log"] = open(errf + ".out").read()[-1200:]
            except Exception: pass
            return _r
        # 6 denemede de olmadı (astronomik) / re-dispatch edilemedi -> son çare video garanti: flyover
        print("ULTRA re-dispatch tükendi -> son çare flyover (video garanti)", flush=True)
        _clean()
        a2 = [x for x in args if x != "ultra=1"]; a2[5] = "flyover"
        rc = _run(a2, e, 3600, errf)
        mp4s = glob.glob(os.path.join(out, "rota_*.mp4"))
    # PREMIUM 3D: route-video kendi içinde Mapbox 3D->flyover düşer (rc=0), rp_handler ek işlem yapmaz
    if rc != 0 or not mp4s:
        return {"error": f"render failed rc={rc}", "g3d_dbg": _g3d_dbg}
    mp4 = max(mp4s, key=os.path.getmtime)
    rid = job.get("ride_id") or os.path.basename(mp4)[5:-4]
    # PARALEL SEGMENT: bu iş bir kare dilimiyse segs/ altına yükle; birleştirme+render-done movelog-cloud stitcher'da
    if job.get("seg"):
        _k, _n = job["seg"].split("/")
        skey = f"segs/{rid}_{int(_k)}_{int(_n)}.mp4"
        R2.upload_file(mp4, BUCKET, skey, ExtraArgs={"ContentType": "video/mp4"})
        print("SEG UPLOADED", skey, os.path.getsize(mp4), "bytes", flush=True)
        return {"seg": skey, "size": os.path.getsize(mp4), "g3d_dbg": _g3d_dbg}
    key = f"videos/{rid}.mp4"
    sz = os.path.getsize(mp4)

    # ── ÇIKTI KAPISI (v147, 04.09): BEYAZ VİDEO YAYINLANMASIN ────────────────────────
    # VAKA: 04.09'da Semra'ya giden 3B videonun 9,267. saniyesinden sonuna kadar (karelerin %73'ü)
    # ekran saf beyazdı — GPU/WebGL bağlamı çöktüğü için harita da HUD tuvali de boşalmıştı.
    # Hiçbir kontrol olmadığı için dosya "başarılı" sayılıp R2'ye yüklendi ve kullanıcıya sunuldu.
    # Motor tarafına GL kaybı bekçisi eklendi (render3d: webglcontextlost + isContextLost -> exit 7);
    # bu ise SON SAVUNMA: sebebi ne olursa olsun (GL, sürücü, ffmpeg) beyaz çıktıyı yakalar.
    # Yöntem: videodan ~12 kare örnekle, gri ortalamalarına bak. >235 = pratikte beyaz.
    # Eşik %40: gerçek videolarda kar/deniz/gökyüzü sahneleri birkaç kareyi parlatabilir ama
    # ölçülen sağlam videolarda beyaz kare oranı %0'dı (28.08 ve 01.09 videoları, 24 ve 36 kare).
    def _beyaz_oran(_yol):
        try:
            # ⚠️ TÜM videodan örnekle. İlk sürümde `fps=1/2` + `-frames:v 12` vardı: yalnız t=0..22 sn
            # örnekleniyordu, 24. saniyeden SONRA beyazlaşan video kapıdan GEÇİYORDU. Süreyi ölçüp
            # örnekleme hızını ona göre kur → kaç saniyelik video olursa olsun ~16 örnek, baştan sona.
            _sure = 0.0
            try:
                _pr = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                      "-of", "csv=p=0", _yol], capture_output=True, text=True, timeout=30)
                _sure = float((_pr.stdout or "0").strip() or 0)
            except Exception:
                _sure = 0.0
            _n = 16
            _hiz = "fps=1/2" if _sure <= 0 else "fps=%.6f" % max(0.05, _n / max(_sure, 1.0))
            _p = subprocess.run(
                ["ffmpeg", "-v", "error", "-i", _yol,
                 "-vf", _hiz + ",scale=64:64,format=gray,signalstats,metadata=print:file=-",
                 "-f", "null", "-"],
                capture_output=True, text=True, timeout=180)
            _v = [float(l.split("=")[1]) for l in _p.stdout.splitlines() if "YAVG" in l]
            if not _v:
                return -1.0, 0                      # ölçemedik -> kapıyı UYGULAMA (yanlış pozitif riski yok)
            return sum(1 for x in _v if x > 235) / len(_v), len(_v)
        except Exception as _e:
            print("beyaz kontrolü yapılamadı:", _e, flush=True)
            return -1.0, 0
    _oran, _n = _beyaz_oran(mp4)
    if _oran >= 0.40:
        print(f"BEYAZ VİDEO TESPİT: {_n} örnek karenin %{_oran*100:.0f}'i beyaz -> YÜKLEME İPTAL", flush=True)
        # ⚠️ Beyaz dalında deneme tavanı 1 (GL sağlık dalı 6'ya kadar gidebilir). Sistematik bir
        # yanlış-pozitif (ör. gerçekten çok parlak kar/deniz rotası) 7 tam render yakardı:
        # ~$0.38-0.74/video × 7 ≈ $2.7-5.2. Bir kez taze worker'da dene, yine beyazsa DUR.
        if int(job.get("_attempt", 0)) >= 1:
            print("beyaz tekrar -> deneme tavanı (1) doldu, iş başarısız bildiriliyor", flush=True)
            return {"error": "beyaz-video-tekrar", "white_ratio": round(_oran, 3), "ride_id": rid}
        _r = _redispatch(f"beyaz video (%{_oran*100:.0f})")
        if _r:
            return _r
        # re-dispatch de olmadıysa: bozuk dosyayı YAYINLAMA, işi başarısız bildir
        return {"error": "beyaz-video", "white_ratio": round(_oran, 3), "ride_id": rid}
    elif _oran >= 0:
        print(f"çıktı kapısı OK: {_n} örnekte beyaz oranı %{_oran*100:.0f}", flush=True)

    R2.upload_file(mp4, BUCKET, key, ExtraArgs={"ContentType": "video/mp4"})
    print("UPLOADED", key, sz, "bytes", flush=True)
    _pm = os.path.basename(mp4).split("_")
    _BILINEN = ("3d", "flyover", "flat", "tactical")
    # dosya adı gerçeği söyler; TANINMAYAN biçimde eski davranışa dön (istenen modu bildir)
    _uretilen_mod = _pm[3] if len(_pm) > 3 and _pm[3] in _BILINEN else mode
    if _uretilen_mod != mode:
        print(f"MOD DÜŞÜŞÜ: istenen={mode} üretilen={_uretilen_mod}", flush=True)
    if BACKEND_URL and RENDER_DONE_SECRET and not job.get("test"):
        done = {"secret": RENDER_DONE_SECRET, "ride_id": rid, "key": key,
                "user": job.get("user"), "date": job.get("day"),
                "ts": int(job.get("from", 0)), "to": int(job.get("to", 0)),
                # 01.09: ÜRETİLEN mod bildirilir. Eskiden istenen mod ("3d") gönderiliyordu;
                # 3B düşüp flyover üretildiğinde bile D1'e "3d" yazılıp kullanıcıya 3B diye sunuluyordu.
                "type": job.get("type", ""), "mode": _uretilen_mod, "mode_req": mode,
                "speed": job.get("speed", "medium"), "aspect": job.get("aspect", "16:9"),
                "size": sz,
                "gpu_secs": int(time.time() - _t0),               # maliyet telemetrisi
                "ultra": bool(job.get("ultra")),
                "users": job.get("users") or [],                  # GRUP SÜRÜŞ: ortak video -> tüm kullanıcılara kayıt+push
                "group": bool(job.get("track2") or job.get("mates"))}
        # FIKS 05.09 (uctan uca tarama): tek deneme vardi ve hata SESSIZCE yutuluyordu; ardindan
        # is BASARILI donuyordu. Yani callback dusmezse D1'e hicbir kayit girmiyor, kullanici
        # videoyu goremiyor ama GPU parasi harcanmis oluyordu. OLCULDU: 05.09'daki 6 otomatik
        # videonun hicbiri gpu_costs'u artirmamis - hepsi cron'un LAND yolundan kurtarilmisti;
        # LAND yolu olmayan `_ozet_` videolari ise tamamen kaybolmustu (2/2, ~36 MB + ~50 dk GPU).
        # Artik 3 deneme (2/5/10 sn) ve kalici basarisizlikta is HATA ile biter -> RunPod'da
        # gorunur olur, kuyruk/bekci hatti isi yeniden ele alabilir.
        _bildirildi = False
        _sonhata = ""
        for _d in range(1, 4):
            try:
                req = urllib.request.Request(BACKEND_URL.rstrip("/") + "/api/internal/render-done",
                                             data=json.dumps(done).encode(),
                                             headers={"Content-Type": "application/json"})
                urllib.request.urlopen(req, timeout=20).read()
                print("RENDER-DONE bildirildi", rid, "deneme", _d, flush=True)
                _bildirildi = True
                break
            except Exception as ex:
                _sonhata = str(ex)[:200]
                print("render-done hata (deneme %d/3): %s" % (_d, _sonhata), flush=True)
                if _d < 3:
                    time.sleep((2, 5, 10)[_d - 1])
        if not _bildirildi:
            # Video R2'de DURUYOR (key asagida). Isi basarili gostermek yerine hata don:
            # boylece pending-reconcile/yetim supurgesi ve bekciler devreye girebilir.
            print("RENDER-DONE KALICI BASARISIZ", rid, key, flush=True)
            return {"error": "render-done bildirilemedi: " + _sonhata,
                    "key": key, "size": sz, "ride_id": rid}
    return {"key": key, "size": sz, "ride_id": rid, "g3d_dbg": _g3d_dbg}


runpod.serverless.start({"handler": handler})
