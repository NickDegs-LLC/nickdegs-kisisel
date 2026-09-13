#!/usr/bin/env python3
# TAKTİK DISPATCH (2026-07-26): LOKAL-ÖNCE (hızlı) + Cloud Run JOBS OVERFLOW (ölçek).
# movelog-cloud bunu DETACHED spawn eder -> render'ı bloklamaz.
#   Lokal slot boş (max 1 render + >=13GB RAM) -> LOKAL render (~11-15dk, hızlı; 2 eşzamanlı = OOM, guard'lı).
#   Lokal dolu -> Cloud Run JOBS: job.json R2'ye -> presigned GET+PUT -> `gcloud run jobs execute` (async).
#     Cloud Run JOBS'un HTTP timeout'u YOK (görev 24s'e kadar) -> uzun video de biter + binlerce paralel görev (ölçek).
# MAKSİMUM GÜVENLİK: Cloud Run'a SIFIR secret. Yalnız presigned GET/PUT (R2 creds LOKAL) + PUBLIC mapbox (job env).
# render-done'u lokal reconcile yapar (worker TAC_PUT_URL varsa render-done ATLAR).
# Kullanım: python3 tac_dispatch.py /path/to/job.json
import sys, json, os, subprocess, time, base64

JOBFILE = sys.argv[1]
job = json.load(open(JOBFILE))
VID = job.get("vid", "x")
REGION = "europe-west3"
CRJOB = "movelog-tactical-job"
R2CONF = "/opt/matrix/secrets/movelog-r2.conf"

def log(*a): print(f"[tac_dispatch {VID}]", *a, flush=True)

def _local_count():
    try: return int(subprocess.run(["pgrep", "-fc", "tactical/render_job.py"], capture_output=True, text=True).stdout or "0")
    except Exception: return 0

def _mem_free():
    try:
        for l in open("/proc/meminfo"):
            if l.startswith("MemAvailable"): return int(l.split()[1]) // 1024
    except Exception: pass
    return 999999

def _local_slot_free():
    """OOM guard: MAX 1 eşzamanlı render (2 uzun video ~10GB -> kernel OOM, 2026-07-26 kanıtlandı) + >=13GB RAM."""
    return _local_count() < 1 and _mem_free() >= 13000

def local_render():
    """LOKAL render + OOM guard; slot yoksa bekle. render_job R2 upload + render-done'u kendi yapar (TAC_PUT_URL YOK)."""
    # HARİTA KATMANI (2026-08-09, Barış: "premium'a temel, ultra'ya en kaliteli harita"):
    # harita-proxy bu dosyayı okuyup kaynak zincirini katmana göre filtreler. Max-1 eşzamanlı
    # lokal render (OOM guard) olduğu için tek dosya yeterli, yarış yok. Kaynaklara katman
    # etiketi Barış'ın offline haritaları inince harita-kaynak.json'da verilecek.
    try:
        open("/opt/matrix/harita-cache/.aktif-katman", "w").write(
            "ultra" if job.get("ultra") else "premium")
    except Exception:
        pass
    while not (_local_count() < 1 and _mem_free() >= 13000):
        time.sleep(20)
    log("LOKAL render başlıyor")
    subprocess.run(["python3", "/opt/matrix/kisisel-app/tactical/render_job.py", JOBFILE])

def cloud_job():
    """Cloud Run JOBS overflow: job.json'u R2'ye koy -> presigned GET+PUT (base64) -> jobs execute (async).
    Başarı -> reconcile render-done yapar (video R2'ye düşünce). True=tetiklendi, False=hata (lokal fallback)."""
    try:
        import boto3
        c = {}
        for l in open(R2CONF):
            if "=" in l: k, v = l.strip().split("=", 1); c[k] = v
        gv = lambda n: [c[k] for k in c if k.upper() == n][0]
        s3 = boto3.client("s3", endpoint_url=gv("R2_ENDPOINT"), aws_access_key_id=gv("R2_ACCESS_KEY_ID"),
                          aws_secret_access_key=gv("R2_SECRET_ACCESS_KEY"), region_name="auto")
        bkt = c.get("R2_BUCKET", "movelog")
        # job.json'u R2'ye koy (Cloud Run private host'a erişemez -> presigned GET ile indirir)
        jkey = f"tacjobs/{VID}.json"
        s3.put_object(Bucket=bkt, Key=jkey, Body=json.dumps(job).encode(), ContentType="application/json")
        get_url = s3.generate_presigned_url("get_object", Params={"Bucket": bkt, "Key": jkey}, ExpiresIn=7200)
        put_url = s3.generate_presigned_url("put_object", Params={"Bucket": bkt, "Key": f"videos/{VID}.mp4",
                                            "ContentType": "video/mp4"}, ExpiresIn=14400)
        jb64 = base64.b64encode(get_url.encode()).decode()
        pb64 = base64.b64encode(put_url.encode()).decode()
    except Exception as e:
        log("presigned/R2 hata -> LOKAL:", str(e)[:150]); return False
    try:
        r = subprocess.run(["gcloud", "run", "jobs", "execute", CRJOB, "--region", REGION,
                            "--update-env-vars", f"JOB_URL_B64={jb64},TAC_PUT_URL_B64={pb64}", "--async"],
                           capture_output=True, text=True, timeout=120,
                           env={**os.environ, "CLOUDSDK_CORE_DISABLE_PROMPTS": "1"})
        if r.returncode == 0:
            log("Cloud Run JOB tetiklendi (async) -> reconcile render-done yapacak")
            try: os.remove(JOBFILE)
            except Exception: pass
            return True
        log("jobs execute non-0 -> LOKAL fallback:", (r.stderr or "")[:200]); return False
    except Exception as e:
        log("jobs execute HATA -> LOKAL fallback:", str(e)[:200]); return False

# CUSTOM MÜZİK -> HER ZAMAN LOKAL (Barış 2026-07-27): cloud render private host'a scp yapamaz -> kullanıcı müziği
# gelmez -> RASTGELE müziğe düşer (bug). Lokal scp ile müziği çeker. lib:/active/upload = kullanıcının seçtiği müzik.
_music = (job.get("music") or "").strip()
if _music.startswith("lib:") or _music in ("active", "upload"):
    log(f"custom müzik ({_music}) -> LOKAL zorunlu (cloud müziği çekemez, rastgeleye düşmesin)")
    local_render(); sys.exit(0)

# ===== GCP'DEN BAĞIMSIZ (Barış 2026-08-05) =====
# Cloud Run taşma yolu KAPATILDI. Sebep: `render-worker` servisinde kaçak yeniden-deneme döngüsü
# 6-16 Temmuz'da 153.374 istek üretip ~15.000 TL fatura çıkardı; Barış GCP hesabını kullanmama
# kararı aldı. Bu yol yalnız TAŞMA içindi (lokal slot doluyken); birincil yol zaten LOKAL'di ve
# custom müzik seçiliyken (kullanıcıların çoğu) ZATEN lokale zorlanıyordu.
# Artık her iş lokale gider; `local_render()` slot boşalana kadar bekler (OOM guard korunur),
# yani iş KAYBOLMAZ, sadece sıraya girer. Sunucuda 48 GB RAM var, tek eşzamanlı render sorunsuz.
# ⚠️ `cloud_job()` fonksiyonu SİLİNMEDİ — ileride hesap tekrar kullanılırsa aşağıdaki iki satırı
# eski hâline döndürmek yeterli (git yerine bu not: `if not cloud_job(): local_render()`).
log("Cloud Run taşma yolu kapalı (GCP bağımsız) -> LOKAL render")
local_render()
sys.exit(0)
