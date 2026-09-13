#!/usr/bin/env python3
# RunPod CPU serverless — TAKTİK render worker (2026-07-26, taşıma revizyonu 2026-08-30).
# MAKSİMUM GÜVENLİK: RunPod'da HİÇBİR gizli anahtar YOK. R2'ye lokal/CF tarafın ürettiği PRESIGNED
# PUT URL ile yüklenir (job.put_url); render-done'u lokal reconcile halleder. Yalnızca PUBLIC mapbox
# token (client-safe) + harita taban ucu env'den gelir.
#
# TAŞIMA REVİZYONU (2026-08-30) — mühürlü dosyalara DOKUNMADAN kapatılan eksikler:
#   • TIMEOUT: 1500 sn (25 dk) sabitti. `speed=slow` (3 dk video, _BUD=178.0) Cloud Run'da 3300 sn
#     ile koşuyordu -> 25 dk uzun videoyu SESSİZCE kesebilirdi. Artık TAC_TIMEOUT env'i (varsayılan
#     3300 = Cloud Run karşılığı).
#   • AVATAR (keşif E6): cloud modda `_scp` erken `return 1` eder -> avatar gelmez, silüet çıkar.
#     render_job.py:339 `job.get("avatar")` ÖNCELİKLİ olduğu için, job'ta `avatar_url` (presigned
#     GET) varsa burada indirilip `job["avatar"]` YEREL YOLA çevrilir -> mühürlü kod değişmeden çözülür.
#   • Harita taban ucu (HARITA_TABAN/HARITA_STATIK/HARITA_MATCHING/HARITA_GEOCODING) endpoint env'inden
#     gelir ve `dict(os.environ)` ile render_job'a aynen geçer.
import os, json, subprocess, time, urllib.request
import runpod

TAC = "/app/tactical"
TIMEOUT = int(os.environ.get("TAC_TIMEOUT", "3300"))   # sn; Cloud Run JOBS karşılığı


def _indir(url, dst, timeout=90):
    """Presigned GET -> yerel dosya. Başarı=True. Hata ASLA render'ı düşürmez (avatar opsiyonel)."""
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            d = r.read()
        if len(d) < 200:
            return False
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        open(dst, "wb").write(d)
        return True
    except Exception:
        return False


def handler(rpjob):
    t0 = time.time()
    job = rpjob.get("input", {}) or {}
    vid = str(job.get("vid", "x"))
    notlar = []
    try:
        # Yalnızca PUBLIC mapbox token (uydu karoları için; client-side güvenli). Başka secret YOK.
        os.makedirs("/opt/matrix/secrets", exist_ok=True)
        open("/opt/matrix/secrets/mapbox.conf", "w").write(
            f"MAPBOX_PUBLIC_TOKEN={os.environ.get('MAPBOX_PUBLIC','')}\n")
        os.makedirs("/opt/matrix/routes/tacwork", exist_ok=True)

        # AVATAR: presigned GET -> yerel dosya (yoksa silüet; bugünkü cloud davranışı)
        _au = (job.get("avatar_url") or "").strip()
        if _au and not job.get("avatar"):
            _ap = f"/opt/matrix/routes/tacwork/avatar_{vid}.jpg"
            if _indir(_au, _ap):
                job["avatar"] = _ap
                notlar.append("avatar:ok")
            else:
                notlar.append("avatar:inmedi")

        jf = f"/opt/matrix/routes/tacwork/job_{vid}.json"
        json.dump(job, open(jf, "w"))
        env = dict(os.environ)
        env["TAC_PUT_URL"] = job.get("put_url", "")   # presigned R2 PUT URL'i (video buraya yüklenir)
        r = subprocess.run(["python3", f"{TAC}/render_job.py", jf],
                           cwd=TAC, env=env, capture_output=True, text=True, timeout=TIMEOUT)
        ok = (r.returncode == 0)
        return {"ok": ok, "vid": vid, "sec": round(time.time() - t0, 1), "not": ",".join(notlar),
                "log": (r.stdout or "")[-1200:], "err": (r.stderr or "")[-600:] if not ok else ""}
    except subprocess.TimeoutExpired:
        return {"ok": False, "vid": vid, "sec": round(time.time() - t0, 1),
                "err": f"TIMEOUT {TIMEOUT}s asildi (TAC_TIMEOUT ile buyut)"}
    except Exception as e:
        return {"ok": False, "vid": vid, "sec": round(time.time() - t0, 1), "err": str(e)[:600]}


runpod.serverless.start({"handler": handler})
