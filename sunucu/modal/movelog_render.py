"""
Movelog rota videosu render'ı — Modal serverless işçisi.

RunPod ile AYNI üretim imajını (ghcr.io/nickdegs/movelog-render) çalıştırır.
Yeni imaj kurmuyoruz: fontlar, Chrome/puppeteer ve 3d varlıkları o imajda
zaten pişmiş. Bu dosya sadece Modal sarmalayıcısıdır.

Tasarım notları
---------------
1) rp_handler.py modül seviyesinde `runpod.serverless.start()` çağırıyor.
   Düz import edersek konteyner RunPod döngüsüne girip kilitlenir. Kaynağı
   AST ile yükleyip o çağrıyı ayıklıyoruz — satır numarasına bağlı değil,
   imaj sürümü değişse de çalışır.

2) ⚠️ EN ÖNEMLİ NOKTA: imajın giriş betiği /app/basla.sh, handler'dan ÖNCE
   `harita_yan.py` yan-servisini 127.0.0.1:8890'de başlatır ve HARITA_UZAK/
   HARITA_MVT env'lerini türetir. Modal kendi runner'ını kullandığı için o
   betik HİÇ çalışmaz. Yan-servis olmadan düz/flyover taban haritası
   "connection refused" alır ve video SESSİZCE bozuk çıkar.
   Bu yüzden `_ortam_hazirla()` basla.sh'in yaptığını birebir tekrarlar ve
   @modal.enter() ile konteyner başına bir kez koşar.

3) RUNPOD_API_KEY / RUNPOD_ENDPOINT_ID bilerek sırra KONULMADI. Handler'ın
   `_redispatch()` fonksiyonu bu ikisi yoksa None döner → Modal'dan RunPod'a
   iş sıçraması olmaz. Bozuk GPU'ya karşı RunPod'un `refresh_worker`
   mekanizmasının Modal karşılığı: GL'yi handler'dan ÖNCE sınayıp bozuksa
   exception fırlatmak — Modal işi taze konteynerde tekrar dener.
"""

import ast
import json
import os
import socket
import subprocess
import time

import modal

IMAJ_ETIKET = "ghcr.io/nickdegs/movelog-render:v151"

IMAJ = modal.Image.from_registry(
    IMAJ_ETIKET,
    secret=modal.Secret.from_name("ghcr"),
    # İmajda `python3` var ama `python` yok; Modal sürümü bulamıyor.
    # add_python KULLANMIYORUZ — o ayrı bir Python kurar ve imajdaki
    # runpod/boto3/PIL/puppeteer bağımlılıkları o yorumlayıcıda olmaz.
    setup_dockerfile_commands=["RUN ln -sf $(command -v python3) /usr/local/bin/python"],
)

SIRLAR = [modal.Secret.from_name("movelog-render")]
GPU = os.environ.get("MODAL_GPU", "T4")

app = modal.App("movelog-render")


# ------------------------------------------------------- basla.sh eşdeğeri
def _port_acik(port, saniye):
    """Portu GERÇEKTEN yokla. sleep ile beklemek yanıltıcı — süreç ölmüş de olabilir."""
    son = time.time() + saniye
    while time.time() < son:
        with socket.socket() as s:
            s.settimeout(0.5)
            if s.connect_ex(("127.0.0.1", port)) == 0:
                return True
        time.sleep(0.2)
    return False


_YAN_SUREC = None


def _ua_duzelt():
    """Cloudflare, kisisel-api.nickdegs.com'da varsayılan Python istemci
    User-Agent'larını (Python-urllib/3.x, python-requests/x.y) 403 ile
    engelliyor — ölçüldü: aynı konteyner+IP'den varsayılan UA 403, özel UA 200.

    rp_handler'ın /api/internal/render-done geri çağrısı urllib kullanıyor.
    Düzeltilmezse: video RENDER OLUR, R2'ye YÜKLENİR, ama geri çağrı sessizce
    düşer ve kullanıcı videoyu ASLA görmez.

    Üretim handler'ına dokunmadan, sadece bu konteynerde varsayılan opener'ı
    değiştiriyoruz; handler'ın kendi Request nesnelerindeki başlıklar korunur.
    """
    import urllib.request

    acici = urllib.request.build_opener()
    acici.addheaders = [("User-Agent", "movelog-render/modal")]
    urllib.request.install_opener(acici)


def _ortam_hazirla():
    """/app/basla.sh'in yaptığını birebir yapar (env türetme + harita yan-servisi)."""
    global _YAN_SUREC

    _ua_duzelt()

    port = os.environ.setdefault("HARITA_YAN_PORT", "8890")
    onbellek = os.environ.setdefault("HARITA_YAN_CACHE", "/tmp/harita-yan")
    os.makedirs(onbellek, exist_ok=True)

    taban = os.environ.get("HARITA_TABAN", "")
    if not os.environ.get("HARITA_UZAK") and taban:
        # kendimizi kaynak gösterme (döngü olur) — basla.sh ile aynı koruma
        if not taban.startswith(("http://127.0.0.1", "http://localhost")):
            os.environ["HARITA_UZAK"] = taban
    if not os.environ.get("HARITA_MVT") and os.environ.get("HARITA_UZAK"):
        os.environ["HARITA_MVT"] = os.environ["HARITA_UZAK"]

    if _YAN_SUREC is None or _YAN_SUREC.poll() is not None:
        _YAN_SUREC = subprocess.Popen(
            ["python3", "-u", "/app/harita_yan.py"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        )

    hazir = _port_acik(int(port), 20)
    return {
        "yan_servis_hazir": hazir,
        "yan_pid": _YAN_SUREC.pid,
        "yan_yasiyor": _YAN_SUREC.poll() is None,
        "harita_uzak_turetildi": bool(os.environ.get("HARITA_UZAK")),
        "harita_mvt_turetildi": bool(os.environ.get("HARITA_MVT")),
    }


# ---------------------------------------------------------------- yükleyici
def _handler_yukle():
    """rp_handler.py'yi `runpod.serverless.start(...)` çağrısı OLMADAN yükler."""
    yol = "/app/rp_handler.py"
    agac = ast.parse(open(yol, encoding="utf-8").read(), filename=yol)

    def _rp_start(d):
        return (
            isinstance(d, ast.Expr)
            and isinstance(d.value, ast.Call)
            and ast.unparse(d.value.func).startswith("runpod.serverless")
        )

    atilan = [ast.unparse(d.value.func) for d in agac.body if _rp_start(d)]
    agac.body = [d for d in agac.body if not _rp_start(d)]

    ad = {"__name__": "rp_handler_modal", "__file__": yol}
    exec(compile(agac, yol, "exec"), ad)  # noqa: S102 — üretim imajının kendi kodu
    return ad, atilan


# ------------------------------------------------------------ sağlık sınavı
# Kural: hiçbir kontrol "dosya var mı" demez — hepsi parçayı KULLANIR.
def _gl_sina():
    """Gerçek GL: Chrome'u başlat, shader derle."""
    p = subprocess.run(
        ["node", "/app/3d/glhealth.js"],
        capture_output=True, text=True, timeout=180, cwd="/app/3d",
    )
    cikti = (p.stdout or "").strip()
    ren = cikti[3:].strip() if cikti.startswith("OK ") else ""
    yazilim = any(
        k in ren.lower() for k in ("llvmpipe", "swiftshader", "softpipe", "mesa offscreen")
    )
    return {
        "ok": p.returncode == 0 and bool(ren) and not yazilim,
        "renderer": ren or cikti[:160],
        "yazilim_render": yazilim,
        "hata": (p.stderr or "")[-200:] if p.returncode else "",
    }


def _font_sina():
    """Fontları GERÇEKTEN ayrıştır + glif ölç. Kesik/LFS-işaretçi dosya da
    'var' görünür ama render'da yazı çıkmaz — bu yüzden yükleyip ölçüyoruz.
    Renkli emoji fontları (CBDT) PIL'de yalnız gömülü bitmap boyutunda açılır;
    o yüzden birkaç boyut denenir, aksi halde YANLIŞ alarm verir."""
    import glob

    try:
        from PIL import ImageFont
    except ImportError:
        return {"ok": False, "neden": "PIL yok — font yüklemesi sınanamadı"}

    yollar = sorted(
        glob.glob("/app/fonts/*.tt[fc]")
        + glob.glob("/usr/share/fonts/truetype/**/*.tt[fc]", recursive=True)
    )
    if not yollar:
        return {"ok": False, "neden": "hiç font bulunamadı"}

    iyi, bozuk = [], []
    for y in yollar[:40]:
        son = None
        for boyut in (32, 109):  # 109 = NotoColorEmoji gömülü bitmap boyutu
            try:
                f = ImageFont.truetype(y, boyut)
                k = f.getbbox("Move Log 123 ĞÜŞİÖÇ")
                if k and k[2] > k[0]:
                    iyi.append(os.path.basename(y))
                    son = None
                    break
                son = "glif ölçülemedi"
            except Exception as ex:
                son = type(ex).__name__
        if son:
            bozuk.append(f"{os.path.basename(y)}: {son}")
    return {"ok": not bozuk and bool(iyi), "yuklenen": len(iyi), "bozuk": bozuk[:5]}


def _r2_sina():
    """R2'ye GERÇEKTEN yaz-oku-sil. Env var kontrolü yanıltıcı: anahtar dolu
    ama yetkisi yoksa render biter, yükleme sessizce düşer."""
    import boto3

    anahtar = f"saglik/modal-probe-{int(time.time())}.txt"
    kova = os.environ["R2_BUCKET"]
    try:
        s3 = boto3.client(
            "s3",
            endpoint_url=os.environ["R2_ENDPOINT"],
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            region_name="auto",
        )
        veri = b"modal saglik probu"
        s3.put_object(Bucket=kova, Key=anahtar, Body=veri)
        geri = s3.get_object(Bucket=kova, Key=anahtar)["Body"].read()
        s3.delete_object(Bucket=kova, Key=anahtar)
        return {"ok": geri == veri, "kova": kova, "yaz_oku_sil": True}
    except Exception as ex:
        return {"ok": False, "hata": f"{type(ex).__name__}: {str(ex)[:160]}"}


def _yan_servis_sina():
    """Yan-servisten GERÇEK taban harita mozaiği iste (Mapbox-static biçimi).
    Port açık olması yetmez — görüntü üretebiliyor mu, ona bakıyoruz."""
    import urllib.request

    uc = (os.environ.get("HARITA_UC") or "").rstrip("/")
    if not uc:
        return {"ok": False, "neden": "HARITA_UC boş"}
    url = (f"{uc}/styles/v1/mapbox/satellite-streets-v12/static/"
           f"28.97,41.01,12,0/320x320@2x?access_token=x")
    try:
        r = urllib.request.urlopen(url, timeout=90)
        gvd = r.read()
        # PNG/JPEG imzası — 200 dönüp HTML hata sayfası vermediğini kanıtlar
        gorsel = gvd[:4] in (b"\x89PNG",) or gvd[:2] == b"\xff\xd8"
        return {"ok": r.status == 200 and gorsel and len(gvd) > 2000,
                "durum": r.status, "bayt": len(gvd), "gercek_gorsel": gorsel}
    except Exception as ex:
        return {"ok": False, "hata": f"{type(ex).__name__}: {str(ex)[:140]}"}


def _uzak_karo_sina():
    """Uzak ham karo ucu (Cloudflare katmanı) — render3d.js buradan çeker.
    URL gizli önek içerdiği için ASLA yazdırılmaz."""
    import urllib.request

    uzak = (os.environ.get("HARITA_UZAK") or "").rstrip("/")
    if not uzak:
        return {"ok": False, "neden": "HARITA_UZAK türetilemedi"}
    try:
        r = urllib.request.urlopen(f"{uzak}/xyz/sat/10/595/384.jpg", timeout=40)
        gvd = r.read()
        return {"ok": r.status == 200 and len(gvd) > 1000, "durum": r.status, "bayt": len(gvd)}
    except Exception as ex:
        return {"ok": False, "hata": f"{type(ex).__name__}: {str(ex)[:140]}"}


def _backend_sina():
    """Geri-çağrı yolu. Bu düşerse render biter ama video kullanıcıya ULAŞMAZ."""
    import urllib.request

    u = (os.environ.get("BACKEND_URL") or "").rstrip("/")
    if not u:
        return {"ok": False, "neden": "BACKEND_URL boş"}
    try:
        r = urllib.request.urlopen(f"{u}/health", timeout=25)
        return {"ok": r.status == 200, "durum": r.status}
    except Exception as ex:
        return {"ok": False, "hata": f"{type(ex).__name__}: {str(ex)[:140]}"}


def _cikis_ip():
    import urllib.request
    try:
        return urllib.request.urlopen("https://api.ipify.org", timeout=15).read().decode()
    except Exception:
        return "?"


@app.function(image=IMAJ, secrets=SIRLAR, gpu=GPU, timeout=900)
def saglik():
    """Render'ın ihtiyaç duyduğu HER parçayı çalıştırarak sınar."""
    sonuc = {"ortam": _ortam_hazirla()}

    try:
        ad, atilan = _handler_yukle()
        k = ad["handler"].__code__
        # v151 AVATAR FİKSİ KANITI (derleyici seviyesi, canlı konteynerde):
        # v150'de `urllib` cellvar'dı (handler içindeki `import urllib.parse` yüzünden yerel)
        # -> avatar satırı her seferinde UnboundLocalError. v151'de global okunmalı.
        sonuc["handler"] = {
            "ok": callable(ad.get("handler")) and "urllib" not in k.co_cellvars
                  and "urllib" in k.co_names,
            "ayiklanan_runpod_cagrisi": atilan,
            "urllib_cellvar": "urllib" in k.co_cellvars,      # True = avatar BOZUK (v150)
            "urllib_global": "urllib" in k.co_names,          # True = avatar SAĞLAM (v151)
        }
    except Exception as ex:
        sonuc["handler"] = {"ok": False, "hata": f"{type(ex).__name__}: {str(ex)[:200]}"}

    for adi, fn in (
        ("gl", _gl_sina), ("font", _font_sina), ("r2", _r2_sina),
        ("yan_servis", _yan_servis_sina), ("uzak_karo", _uzak_karo_sina),
        ("backend", _backend_sina),
    ):
        try:
            sonuc[adi] = fn()
        except Exception as ex:
            sonuc[adi] = {"ok": False, "hata": f"{type(ex).__name__}: {str(ex)[:200]}"}

    sonuc["ortam"]["ok"] = sonuc["ortam"]["yan_servis_hazir"]
    sonuc["imaj"] = IMAJ_ETIKET
    sonuc["gpu"] = GPU
    sonuc["cikis_ip"] = _cikis_ip()
    sonuc["hepsi_ok"] = all(v.get("ok") for v in sonuc.values() if isinstance(v, dict))
    return sonuc


# ------------------------------------------------------------------- render
@app.cls(
    image=IMAJ,
    secrets=SIRLAR,
    gpu=GPU,
    cpu=4,
    memory=16384,
    timeout=5400,          # RunPod'da ölçülen ~20 dk; T4 daha yavaş olabilir
    max_containers=10,
    retries=modal.Retries(max_retries=2, initial_delay=5.0),
)
class Isci:
    @modal.enter()
    def hazirla(self):
        """Konteyner başına bir kez: basla.sh eşdeğeri + handler yüklemesi."""
        self.ortam = _ortam_hazirla()
        self.ad, _ = _handler_yukle()

    @modal.method()
    def render(self, job: dict) -> dict:
        """Üretim handler'ını Modal'da koşturur.

        handler(rpjob) `{"input": {...}}` bekler ve platformdan bağımsızdır:
        R2'ye yükler, backend'e /api/internal/render-done geri çağrısı yapar.
        """
        t0 = time.time()

        if not self.ortam["yan_servis_hazir"]:
            raise RuntimeError(f"harita yan-servisi ayağa kalkmadı: {self.ortam}")

        # RunPod refresh_worker'ının Modal karşılığı: bozuk GPU'da 20-40 dk
        # yakıp beyaz video üretmek yerine HEMEN düş → Modal taze konteynerde dener.
        if job.get("mode") == "3d" and not job.get("test"):
            g = _gl_sina()
            if not g["ok"]:
                raise RuntimeError(f"GL BOZUK, taze konteyner isteniyor: {g}")

        cikti = self.ad["handler"]({"input": job})
        if isinstance(cikti, dict):
            cikti["_modal_sn"] = round(time.time() - t0, 1)
            cikti["_modal_gpu"] = GPU
        return cikti


# ─────────────────────────────────────────────────────── dispatch HTTP ucu
# NEDEN GEREKLİ: Cloudflare Worker'ı Modal'ı Python istemcisiyle çağıramaz.
# RunPod'un `/run` sözleşmesi TAKLİT EDİLİR ({"input": job} al, {"id": ...} dön) →
# dispatch tarafında `runpodGonder` ile birebir aynı şekil, tek satır fark.
#
# GPU İSTEMEZ: bu uç yalnızca `.spawn()` çağırır, render'ı GPU konteyneri yapar.
# Hafif imaj = hızlı soğuk açılış, boşta maliyet ~0.
UC_IMAJ = modal.Image.debian_slim(python_version="3.12").pip_install("fastapi[standard]")
DISPATCH_SIR = [modal.Secret.from_name("movelog-dispatch")]


@app.function(image=UC_IMAJ, secrets=DISPATCH_SIR, timeout=120, min_containers=0)
@modal.fastapi_endpoint(method="POST", label="movelog-render-run")
def run(govde: dict):
    """RunPod /v2/{id}/run eşleniği. Gövde: {"secret": "...", "input": {job}}"""
    from fastapi import HTTPException

    if govde.get("secret") != os.environ["DISPATCH_SECRET"]:
        raise HTTPException(status_code=403, detail="yetkisiz")
    job = govde.get("input") or {}
    if not isinstance(job, dict):
        raise HTTPException(status_code=400, detail="gecersiz is")
    # glcheck = handler'ın kendi tanı modu (saniyeler sürer, render YAPMAZ) → iz istemez.
    # Duman testi bu yoldan geçirilir: HTTP → spawn → GPU → sonuç zinciri ucuza doğrulanır.
    if not job.get("glcheck") and len(job.get("track") or []) < 3:
        raise HTTPException(status_code=400, detail="iz yok/kisa")
    cagri = Isci().render.spawn(job)
    return {"id": cagri.object_id, "status": "IN_QUEUE"}


@app.function(image=UC_IMAJ, secrets=DISPATCH_SIR, timeout=120, min_containers=0)
@modal.fastapi_endpoint(method="POST", label="movelog-render-status")
def durum(govde: dict):
    """RunPod /v2/{id}/status eşleniği — kuyruk bekçisi iş kaybını böyle görür."""
    from fastapi import HTTPException

    if govde.get("secret") != os.environ["DISPATCH_SECRET"]:
        raise HTTPException(status_code=403, detail="yetkisiz")
    try:
        cagri = modal.FunctionCall.from_id(str(govde.get("id", "")))
        return {"status": "COMPLETED", "output": cagri.get(timeout=0)}
    except TimeoutError:
        return {"status": "IN_PROGRESS"}
    except Exception as ex:
        return {"status": "FAILED", "error": f"{type(ex).__name__}: {str(ex)[:200]}"}


@app.function(image=IMAJ, secrets=SIRLAR, timeout=300)
def geri_cagri_sina():
    """Geri çağrı yolunu YAN ETKİSİZ sınar.

    /api/internal/render-done önce sırrı kontrol eder (403), SONRA `key` eksikse
    400 'eksik' dönüp HİÇBİR ŞEY YAZMAZ (grup3.ts:752-754). Doğru sır + eksik key ile:
      · 400 JSON  -> ağ + UA + SIR üçü de sağlam, D1'e kayıt YOK, bildirim YOK  ✅
      · 403 JSON  -> sır yanlış
      · 403 HTML  -> Cloudflare UA/bot engeli (asıl korktuğumuz durum)
    Bütün Modal koşuları test:true ile gittiği için bu yol daha önce HİÇ sınanmamıştı.
    """
    import urllib.error
    import urllib.request

    _ua_duzelt()
    u = (os.environ.get("BACKEND_URL") or "").rstrip("/") + "/api/internal/render-done"
    veri = json.dumps({"secret": os.environ.get("RENDER_DONE_SECRET", ""),
                       "ride_id": "MODALSONDAJ"}).encode()      # `key` BİLEREK YOK
    r = urllib.request.Request(u, data=veri, headers={"Content-Type": "application/json"})
    try:
        y = urllib.request.urlopen(r, timeout=25)
        govde, kod = y.read()[:200], y.status
    except urllib.error.HTTPError as e:
        govde, kod = e.read()[:200], e.code
    except Exception as ex:
        return {"ok": False, "hata": f"{type(ex).__name__}: {str(ex)[:150]}"}

    metin = govde.decode("utf-8", "replace")
    html = metin.lstrip().lower().startswith(("<!doctype", "<html"))
    return {
        "ok": kod == 400 and not html,          # 400 = uygulama katmanına ULAŞTI + sır DOĞRU
        "durum": kod,
        "cloudflare_engeli": html,
        "yanit": metin[:120],
        "yan_etki": "yok (key eksik -> yazmadan 400)",
    }


@app.local_entrypoint()
def main(is_json: str = ""):
    """Yerel test:
      modal run movelog_render.py                 -> sağlık sınavı
      modal run movelog_render.py --is-json '{}'  -> tek iş çalıştır
    """
    import json

    if is_json:
        print(json.dumps(Isci().render.remote(json.loads(is_json)), ensure_ascii=False, indent=2))
    else:
        print(json.dumps(saglik.remote(), ensure_ascii=False, indent=2))
