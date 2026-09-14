"""
Movelog taktik videosu render'ı — Modal serverless işçisi.

RunPod ile AYNI üretim imajını (ghcr.io/nickdegs/movelog-tactical:v6) çalıştırır.
Yeni imaj kurmuyoruz: fontlar, TTS modeli ve mühürlü motor o imajda pişmiş.
Bu dosya sadece Modal sarmalayıcısıdır. Mühürlü dört dosyaya (route_gen /
render_job / intro_gen / outro_gen) ve rp_handler_tac.py'ye DOKUNULMAZ.

Tasarım notları
---------------
1) rp_handler_tac.py modül seviyesinde `runpod.serverless.start()` çağırıyor.
   Düz import edersek konteyner RunPod döngüsüne girip kilitlenir. Kaynağı
   AST ile yükleyip o çağrıyı ayıklıyoruz — satır numarasına bağlı değil,
   imaj sürümü değişse de çalışır. (movelog_render.py ile aynı teknik.)

2) ⚠️ EN ÖNEMLİ NOKTA: imajın giriş betiği /app/tactical/basla.sh, handler'dan
   ÖNCE `harita_yan.py` yan-servisini 127.0.0.1:8890'de başlatır ve HARITA_UZAK/
   HARITA_MVT env'lerini türetir. Modal kendi runner'ını kullandığı için o
   betik HİÇ çalışmaz. Yan-servis olmadan taban harita "connection refused"
   alır ve video SESSİZCE bozuk çıkar.
   Bu yüzden `_ortam_hazirla()` basla.sh'in yaptığını birebir tekrarlar ve
   @modal.enter() ile konteyner başına bir kez koşar.

   basla.sh:29-31 — portun açık olması YETMEZ. /saglik yanıtında
   `"katman": "harita-yan"` aranır; aksi halde yanlış servise render yaptırırdık.
   (3B sarmalayıcısındaki `_port_acik` yalnız porta bakar — taktikte kimlik
   de şart.)

3) ÖZEL MÜZİK: mühürlü render_job.py müziği TAC_BACKEND + RENDER_DONE_SECRET
   ile `/api/internal/music`'ten çeker. Bulutta gerçek sır YOK → `_music_http`
   ilk satırda return 1 → sessizce stok müziğe düşer (Barış 2026-08-03).
   Sarmalayıcı 127.0.0.1:8780'de mini bir uç açar; query'yi umursamaz,
   job.music_url'deki presigned R2 GET'ten baytları döner. Gerçek sır
   konteynere GİRMEZ — RENDER_DONE_SECRET yer tutucu (`yerel`).

   EŞZAMANLILIK: music_url job'a özel, mini sunucu konteynere ait.
   @modal.concurrent / allow_concurrent_inputs KULLANILMAZ — konteyner
   başına tek iş bu tasarımın şartı.
"""

import ast
import os
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

import modal

IMAJ_ETIKET = "ghcr.io/nickdegs/movelog-tactical:v6"
HANDLER_YOL = "/app/tactical/rp_handler_tac.py"
YAN_YOL = "/app/tactical/harita_yan.py"
RENDER_JOB_YOL = "/app/tactical/render_job.py"
MUZIK_PORT = 8780
YAN_PORT_VARSAYILAN = "8890"

IMAJ = modal.Image.from_registry(
    IMAJ_ETIKET,
    secret=modal.Secret.from_name("ghcr"),
    # İmajda `python3` var ama `python` yok; Modal sürümü bulamıyor.
    # add_python KULLANMIYORUZ — o ayrı bir Python kurar ve imajdaki
    # runpod/boto3/PIL/chatterbox bağımlılıkları o yorumlayıcıda olmaz.
    setup_dockerfile_commands=["RUN ln -sf $(command -v python3) /usr/local/bin/python"],
)

SIRLAR = [modal.Secret.from_name("movelog-tactical")]

app = modal.App("movelog-tactical")


# ------------------------------------------------------- basla.sh eşdeğeri
_YAN_SUREC = None
_MUZIK_SUNUCU = None

# Mini müzik ucunun okuduğu, o an işlenen job'ın presigned GET'i.
# Konteyner başına tek iş varsayımı — eşzamanlı girdi AÇILMAZ.
_GUNCEL_IS = {"music_url": ""}


def _ua_duzelt():
    """Cloudflare, kisisel-api.nickdegs.com'da varsayılan Python istemci
    User-Agent'larını (Python-urllib/3.x, python-requests/x.y) 403 ile
    engelliyor — ölçüldü: aynı konteyner+IP'den varsayılan UA 403, özel UA 200.

    rp_handler_tac urllib kullanıyor (avatar indir, müzik uç). Düzeltilmezse
    istekler sessizce düşer.

    Üretim handler'ına dokunmadan, sadece bu konteynerde varsayılan opener'ı
    değiştiriyoruz; handler'ın kendi Request nesnelerindeki başlıklar korunur.
    """
    acici = urllib.request.build_opener()
    acici.addheaders = [("User-Agent", "movelog-tactical/modal")]
    urllib.request.install_opener(acici)


def _yan_kimlik(port):
    """/saglik gövdesinde `"katman": "harita-yan"` var mı — basla.sh:29-41."""
    try:
        g = urllib.request.urlopen(
            f"http://127.0.0.1:{port}/saglik", timeout=1,
        ).read().decode("utf-8", "replace")
        return '"katman": "harita-yan"' in g
    except Exception:
        return False


def _yan_hazir(port, saniye):
    """Port yoklamak yetmez: süreç yaşamalı VE kimlik doğru olmalı."""
    son = time.time() + saniye
    while time.time() < son:
        if _YAN_SUREC is not None and _YAN_SUREC.poll() is not None:
            return False
        if _yan_kimlik(port):
            return True
        time.sleep(0.2)
    return False


class _MuzikIsleyici(BaseHTTPRequestHandler):
    """Yalnız GET /api/internal/music. Query (secret/user/ref) umursanmaz —
    dispatch tarafı zaten çözdü; burası presigned R2 GET'i proxy'ler."""

    def log_message(self, *_a):
        return

    def do_GET(self):
        if not self.path.startswith("/api/internal/music"):
            self.send_error(404)
            return
        url = (_GUNCEL_IS.get("music_url") or "").strip()
        if not url:
            self.send_response(404)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"yok")
            return
        try:
            with urllib.request.urlopen(url, timeout=25) as r:
                veri = r.read()
            if len(veri) < 500:
                raise OSError("kisa")
            self.send_response(200)
            self.send_header("Content-Type", "audio/mp4")
            self.send_header("Content-Length", str(len(veri)))
            self.end_headers()
            self.wfile.write(veri)
        except Exception:
            self.send_response(404)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"yok")


def _mini_muzik_baslat():
    """127.0.0.1:8780 — mühürlü _music_http'nin TAC_BACKEND varsayılanı.

    RENDER_DONE_SECRET gerçek sır değil, boş-olmayan yer tutucu: yoksa
    `_music_http` ucu hiç çağırmadan 1 döner. Gerçek sır konteynere GİRMEZ.
    """
    global _MUZIK_SUNUCU
    os.environ["TAC_BACKEND"] = f"http://127.0.0.1:{MUZIK_PORT}"
    os.environ["RENDER_DONE_SECRET"] = "yerel"
    if _MUZIK_SUNUCU is not None:
        return
    try:
        srv = HTTPServer(("127.0.0.1", MUZIK_PORT), _MuzikIsleyici)
    except OSError:
        return
    t = threading.Thread(target=srv.serve_forever, daemon=True, name="mini-muzik")
    t.start()
    _MUZIK_SUNUCU = srv


def _ortam_hazirla():
    """/app/tactical/basla.sh'in yaptığını birebir yapar
    (env türetme + harita yan-servisi + kimlik denetimi) ve mini müzik ucunu açar."""
    global _YAN_SUREC

    _ua_duzelt()
    _mini_muzik_baslat()

    port = os.environ.setdefault("HARITA_YAN_PORT", YAN_PORT_VARSAYILAN)
    onbellek = os.environ.setdefault("HARITA_YAN_CACHE", "/tmp/harita-yan")
    os.makedirs(onbellek, exist_ok=True)

    taban = os.environ.get("HARITA_TABAN", "")
    if not os.environ.get("HARITA_UZAK") and taban:
        # kendimizi kaynak gösterme (döngü olur) — basla.sh:14-19 ile aynı koruma
        if not taban.startswith(("http://127.0.0.1", "http://localhost")):
            os.environ["HARITA_UZAK"] = taban
    if not os.environ.get("HARITA_MVT") and os.environ.get("HARITA_UZAK"):
        os.environ["HARITA_MVT"] = os.environ["HARITA_UZAK"]

    if _YAN_SUREC is None or _YAN_SUREC.poll() is not None:
        _YAN_SUREC = subprocess.Popen(
            ["python3", "-u", YAN_YOL],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        )

    # basla.sh 50×0.2s = 10 sn tavan; kimlik geçmezse yan_servis_hazir=False
    hazir = _yan_hazir(int(port), 10)
    return {
        "yan_servis_hazir": hazir,
        "yan_pid": _YAN_SUREC.pid,
        "yan_yasiyor": _YAN_SUREC.poll() is None,
        "harita_uzak_turetildi": bool(os.environ.get("HARITA_UZAK")),
        "harita_mvt_turetildi": bool(os.environ.get("HARITA_MVT")),
        "mini_muzik": _MUZIK_SUNUCU is not None or _port_dinliyor(MUZIK_PORT),
    }


def _port_dinliyor(port):
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


# ---------------------------------------------------------------- yükleyici
def _handler_yukle():
    """rp_handler_tac.py'yi `runpod.serverless.start(...)` çağrısı OLMADAN yükler."""
    agac = ast.parse(open(HANDLER_YOL, encoding="utf-8").read(), filename=HANDLER_YOL)

    def _rp_start(d):
        return (
            isinstance(d, ast.Expr)
            and isinstance(d.value, ast.Call)
            and ast.unparse(d.value.func).startswith("runpod.serverless")
        )

    atilan = [ast.unparse(d.value.func) for d in agac.body if _rp_start(d)]
    agac.body = [d for d in agac.body if not _rp_start(d)]

    ad = {"__name__": "rp_handler_tac_modal", "__file__": HANDLER_YOL}
    exec(compile(agac, HANDLER_YOL, "exec"), ad)  # noqa: S102 — üretim imajının kendi kodu
    return ad, atilan


# ------------------------------------------------------------ sağlık sınavı
# Kural: hiçbir kontrol "dosya var mı" demez — hepsi parçayı KULLANIR.
# GPU/GL yok: taktik CPU hattı.
def _font_sina():
    """Fontları GERÇEKTEN ayrıştır + glif ölç. Kesik/LFS-işaretçi dosya da
    'var' görünür ama render'da yazı çıkmaz — bu yüzden yükleyip ölçüyoruz.
    Taktik HUD fontları /app/tactical/fonts altında (Chakra Petch)."""
    import glob

    try:
        from PIL import ImageFont
    except ImportError:
        return {"ok": False, "neden": "PIL yok — font yüklemesi sınanamadı"}

    yollar = sorted(
        glob.glob("/app/tactical/fonts/*.tt[fc]")
        + glob.glob("/app/fonts/*.tt[fc]")
        + glob.glob("/usr/share/fonts/truetype/**/*.tt[fc]", recursive=True)
    )
    if not yollar:
        return {"ok": False, "neden": "hiç font bulunamadı"}

    iyi, bozuk = [], []
    for y in yollar[:40]:
        son = None
        for boyut in (32, 109):
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


def _yan_servis_sina():
    """Kimlik denetimi: /saglik içinde `"katman": "harita-yan"` — port yetmez."""
    port = os.environ.get("HARITA_YAN_PORT", YAN_PORT_VARSAYILAN)
    try:
        g = urllib.request.urlopen(
            f"http://127.0.0.1:{port}/saglik", timeout=5,
        ).read().decode("utf-8", "replace")
        kimlik = '"katman": "harita-yan"' in g
        return {"ok": kimlik, "kimlik": kimlik, "yanit": g[:160]}
    except Exception as ex:
        return {"ok": False, "hata": f"{type(ex).__name__}: {str(ex)[:140]}"}


def _uzak_karo_sina():
    """Uzak ham karo ucu (Cloudflare katmanı). URL gizli önek içerdiği için ASLA yazdırılmaz."""
    uzak = (os.environ.get("HARITA_UZAK") or "").rstrip("/")
    if not uzak:
        return {"ok": False, "neden": "HARITA_UZAK türetilemedi"}
    try:
        r = urllib.request.urlopen(f"{uzak}/xyz/sat/10/595/384.jpg", timeout=40)
        gvd = r.read()
        return {"ok": r.status == 200 and len(gvd) > 1000, "durum": r.status, "bayt": len(gvd)}
    except Exception as ex:
        return {"ok": False, "hata": f"{type(ex).__name__}: {str(ex)[:140]}"}


def _mini_muzik_sina():
    """Mini uç cevap veriyor mu? music_url yokken 404 beklenir — bağlantı reddi değil."""
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{MUZIK_PORT}/api/internal/music", timeout=5)
        return {"ok": True, "durum": 200}
    except urllib.error.HTTPError as e:
        return {"ok": e.code in (200, 404), "durum": e.code}
    except Exception as ex:
        return {"ok": False, "hata": f"{type(ex).__name__}: {str(ex)[:140]}"}


def _render_job_sina():
    """render_job.py import edilebiliyor mu — mühürlü motorun sarmalayıcıya görünürlüğü."""
    import importlib.util
    import sys

    if "/app/tactical" not in sys.path:
        sys.path.insert(0, "/app/tactical")
    try:
        spec = importlib.util.spec_from_file_location("render_job_modal_saglik", RENDER_JOB_YOL)
        if spec is None or spec.loader is None:
            return {"ok": False, "neden": "spec yok"}
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return {"ok": callable(getattr(mod, "_music_http", None))}
    except Exception as ex:
        return {"ok": False, "hata": f"{type(ex).__name__}: {str(ex)[:200]}"}


def _cikis_ip():
    try:
        return urllib.request.urlopen("https://api.ipify.org", timeout=15).read().decode()
    except Exception:
        return "?"


@app.function(image=IMAJ, secrets=SIRLAR, cpu=2, memory=4096, timeout=900)
def saglik():
    """Taktik hattın ihtiyaç duyduğu HER parçayı çalıştırarak sınar. GPU/GL yok."""
    sonuc = {"ortam": _ortam_hazirla()}

    try:
        ad, atilan = _handler_yukle()
        sonuc["handler"] = {
            "ok": callable(ad.get("handler")),
            "ayiklanan_runpod_cagrisi": atilan,
        }
    except Exception as ex:
        sonuc["handler"] = {"ok": False, "hata": f"{type(ex).__name__}: {str(ex)[:200]}"}

    for adi, fn in (
        ("yan_servis", _yan_servis_sina),
        ("uzak_karo", _uzak_karo_sina),
        ("font", _font_sina),
        ("mini_muzik", _mini_muzik_sina),
        ("render_job", _render_job_sina),
    ):
        try:
            sonuc[adi] = fn()
        except Exception as ex:
            sonuc[adi] = {"ok": False, "hata": f"{type(ex).__name__}: {str(ex)[:200]}"}

    sonuc["ortam"]["ok"] = bool(sonuc["ortam"].get("yan_servis_hazir"))
    sonuc["imaj"] = IMAJ_ETIKET
    sonuc["donanim"] = "cpu-8-32"
    sonuc["cikis_ip"] = _cikis_ip()
    sonuc["hepsi_ok"] = all(v.get("ok") for v in sonuc.values() if isinstance(v, dict))
    return sonuc


# ------------------------------------------------------------------- render
# EŞZAMANLILIK YOK: mini müzik ucu job.music_url'i modül seviyesinde tutar.
# Konteyner başına tek iş varsayımı bu tasarımın şartı.
# @modal.concurrent / allow_concurrent_inputs KULLANILMAZ.
@app.cls(
    image=IMAJ,
    secrets=SIRLAR,
    cpu=8,
    memory=32768,
    timeout=3900,          # handler içi TAC_TIMEOUT=3300 + pay
    max_containers=10,
    retries=modal.Retries(max_retries=2, initial_delay=5.0),
)
class Isci:
    @modal.enter()
    def hazirla(self):
        """Konteyner başına bir kez: basla.sh eşdeğeri + mini müzik + handler yüklemesi."""
        self.ortam = _ortam_hazirla()
        self.ad, _ = _handler_yukle()

    @modal.method()
    def render(self, job: dict) -> dict:
        """Üretim handler'ını Modal'da koşturur.

        handler(rpjob) `{"input": {...}}` bekler ve platformdan bağımsızdır:
        put_url (presigned PUT) ile R2'ye yükler; render-done'u reconcile halleder.
        """
        t0 = time.time()

        if not self.ortam["yan_servis_hazir"]:
            raise RuntimeError(f"harita yan-servisi ayağa kalkmadı: {self.ortam}")

        _GUNCEL_IS["music_url"] = str(job.get("music_url") or "")
        try:
            cikti = self.ad["handler"]({"input": job})
        finally:
            _GUNCEL_IS["music_url"] = ""
        if isinstance(cikti, dict):
            cikti["_modal_sn"] = round(time.time() - t0, 1)
            cikti["_modal_donanim"] = "cpu-8-32"
        return cikti


# ─────────────────────────────────────────────────────── dispatch HTTP ucu
# NEDEN GEREKLİ: Cloudflare Worker'ı Modal'ı Python istemcisiyle çağıramaz.
# RunPod'un `/run` sözleşmesi TAKLİT EDİLİR ({"input": job} al, {"id": ...} dön) →
# dispatch tarafında `taktikGonder` ile birebir aynı şekil, tek satır fark.
#
# GPU İSTEMEZ: bu uç yalnızca `.spawn()` çağırır, render'ı CPU konteyneri yapar.
UC_IMAJ = modal.Image.debian_slim(python_version="3.12").pip_install("fastapi[standard]")
DISPATCH_SIR = [modal.Secret.from_name("movelog-dispatch")]


@app.function(image=UC_IMAJ, secrets=DISPATCH_SIR, timeout=120, min_containers=0)
@modal.fastapi_endpoint(method="POST", label="movelog-tactical-run")
def run(govde: dict):
    """RunPod /v2/{id}/run eşleniği. Gövde: {"secret": "...", "input": {job}}"""
    from fastapi import HTTPException

    if govde.get("secret") != os.environ["DISPATCH_SECRET"]:
        raise HTTPException(status_code=403, detail="yetkisiz")
    job = govde.get("input") or {}
    if not isinstance(job, dict):
        raise HTTPException(status_code=400, detail="gecersiz is")
    if not isinstance(job.get("track"), list) or len(job.get("track") or []) < 1:
        raise HTTPException(status_code=400, detail="iz yok")
    cagri = Isci().render.spawn(job)
    return {"id": cagri.object_id, "status": "IN_QUEUE"}


@app.function(image=UC_IMAJ, secrets=DISPATCH_SIR, timeout=120, min_containers=0)
@modal.fastapi_endpoint(method="POST", label="movelog-tactical-status")
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


@app.local_entrypoint()
def main(is_json: str = ""):
    """Yerel test:
      modal run movelog_tactical.py                 -> sağlık sınavı
      modal run movelog_tactical.py --is-json '{}'  -> tek iş çalıştır
    """
    import json

    if is_json:
        print(json.dumps(Isci().render.remote(json.loads(is_json)), ensure_ascii=False, indent=2))
    else:
        print(json.dumps(saglik.remote(), ensure_ascii=False, indent=2))
