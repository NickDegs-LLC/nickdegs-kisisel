#!/usr/bin/env python3
# RunPod SERVERLESS render handler — Cloud Run worker.py'nin RunPod karşılığı.
# RunPod /run ile {"input": <job>} gelir; aynı route-video.py hattını GPU'da koşar,
# mp4'ü R2'ye yükler, backend'e render-done der. Serverless = scale-to-zero (lazım olunca çalışır).
import os, json, subprocess, tempfile, glob, urllib.request, time
import runpod
import boto3

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


def handler(rpjob):
    _t0 = time.time()   # MALİYET TELEMETRİSİ: işin GPU duvar süresi render-done ile backend'e gider
    job = rpjob.get("input", {}) or {}
    track = job.get("track", [])
    if len(track) < 3:
        return {"error": "no track"}
    out = tempfile.mkdtemp()
    tf = os.path.join(out, "track.json")
    json.dump({"points": track}, open(tf, "w"))
    mode = job.get("mode", "flyover")
    args = ["python3", "/app/scripts/route-video.py", job.get("day", "2026-01-01"),
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
            import urllib.parse
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
            if _gh.returncode != 0 and ("createShader null" in _gs or "shader derlenemedi" in _gs):
                _r = _redispatch("GL SAĞLIK BOZUK: " + _gs[:120])
                if _r: return _r
        except Exception as ex:
            print("gl sağlık testi çalışmadı (devam):", ex, flush=True)

    # SÜRE SINIRI KALDIRILDI (Barış: "5 saat sürse de üretsin"): uzun/çok noktalı rotalar tile yüklemede yavaş.
    # 3D/pacman -> 5 saat, diğerleri 1 saat. (Endpoint executionTimeoutMs=6 saate çıkarıldı.)
    _to = 18000 if (job.get("cam") == "pacman" or mode == "3d") else 3600
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
        try:
            req = urllib.request.Request(BACKEND_URL.rstrip("/") + "/api/internal/render-done",
                                         data=json.dumps(done).encode(),
                                         headers={"Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=20).read()
            print("RENDER-DONE bildirildi", rid, flush=True)
        except Exception as ex:
            print("render-done hata:", ex, flush=True)
    return {"key": key, "size": sz, "ride_id": rid, "g3d_dbg": _g3d_dbg}


runpod.serverless.start({"handler": handler})
