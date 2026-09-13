# TAKTİK RunPod CPU serverless worker — ghcr.io/nickdegs/movelog-tactical:v1 (2026-08-30)
#
# Cloud Run sürümünün GÖZDEN GEÇİRİLMİŞ/TAMAMLANMIŞ hâli. Keşifte bulunan 3 bloke eden eksik giderildi:
#   E1  `runpod` paketi kurulmuyordu -> rp_handler_tac.py:17 `import runpod` ANINDA ölürdü.   ✅ eklendi
#   E2  CMD Cloud Run'a aitti (gunicorn cr_handler_tac:app) -> serverless handler hiç başlamazdı.
#       ✅ CMD artık rp_handler_tac.py (RunPod serverless döngüsü).
#   E3  `openssh-client` yoktu (render_job.py:87 `scp`). Cloud modda `_scp` TAC_PUT_URL varken zaten
#       erken `return 1` eder (ÇAĞRILMAZ); yine de FileNotFoundError riskini sıfırlamak için kuruldu.  ✅
#   +   `libsndfile1` eklendi (soundfile'ın C kütüphanesi; wheel'de gömülü gelse de garanti).
#
# ── TABAN İMAJ SEÇİMİ: python:3.14-slim KORUNDU (ölçümle doğrulandı, 2026-08-30) ──────────────
# Önce host paritesi için ubuntu:24.04 (Python 3.12.3 + ffmpeg 6.1.1) denendi ve build ÇÖKTÜ.
# Sebep — chatterbox-tts 0.1.7 metadata'sı (host'tan okundu):
#     numpy<2.0.0 ; python_version <  "3.13"     |  numpy>=2.0.0 ; python_version >= "3.13"
#     torch==2.6.0 ; python_version <  "3.14"    |  torch>=2.9.0 ; python_version >= "3.14"
# Yani Python 3.12'de chatterbox numpy'ı 2.0 ALTINA, torch'u 2.6.0'a (CUDA, 766 MB) ZORLUYOR;
# host'un kanıtlanmış numpy 2.4.6 + torch 2.13.0+cpu kombinasyonu ancak Python **3.14**'te
# çakışmasız kuruluyor. Eski imajın 3.14 seçimi ISABETLİYDİ — geri alınmadı.
#
# 🔴 PARİTE NOTU (eski yorumun "sürümler pinli" iddiası YALANDI, ölçüldü):
#   Pillow    host 12.3.0  <-> imaj 12.2.0  ->  ✅ DÜZELTİLDİ (12.3.0'a pinlendi; görsel çıktı için KRİTİK)
#   numpy     host 2.4.6   <-> imaj pinsiz  ->  ✅ pinlendi
#   soundfile host 0.14.0  <-> imaj pinsiz  ->  ✅ pinlendi
#   torch     host 2.13.0+cpu / torchaudio 2.11.0+cpu -> ✅ zaten aynı
#   Python    host 3.12.3  <-> imaj 3.14    ->  ⚠️ KABUL (chatterbox pini yukarıdaki gibi zorluyor)
#   ffmpeg    host 6.1.1   <-> imaj 7.x     ->  ⚠️ KABUL (Cloud Run taktik hattı AYNI trixie ffmpeg'iyle
#             aylarca üretim yaptı — saha-kanıtlı; render_job zaten çıkışı süre+LUFS ile doğruluyor)
#
# GÜVENLİK (değişmedi): RunPod'da HİÇBİR gizli anahtar YOK. Video R2'ye job.put_url (presigned PUT)
# ile yüklenir, render-done'u lokal reconcile halleder. Yalnız PUBLIC mapbox token + harita ucu env'de.
FROM python:3.14-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg libsndfile1 curl ca-certificates openssh-client fontconfig build-essential python3-dev \
    && rm -rf /var/lib/apt/lists/*

# torch/torchaudio CPU-only (GPU parası yok), host'la pinli.
# Python 3.14 olduğu için chatterbox'ın `torch>=2.9.0` dalı geçerli -> aşağıdaki kurulum bunu EZMEZ.
RUN pip install --no-cache-dir torch==2.13.0 torchaudio==2.11.0 \
      --index-url https://download.pytorch.org/whl/cpu

# render + TTS + RunPod SDK. Pillow/numpy/soundfile HOST SÜRÜMÜNE pinli (görsel parite KRİTİK).
# runpod = E1. boto3: render_job.py:812 presigned-DIŞI dalda import ediyor (RunPod'da kullanılmaz ama import edilebilir olmalı).
RUN pip install --no-cache-dir \
      "Pillow==12.3.0" "numpy==2.4.6" "soundfile==0.14.0" \
      "chatterbox-tts==0.1.7" boto3 "runpod==1.7.10"

# PARİTE MÜHRÜ: sürümler build log'una basılır; sapma olursa burada yakalanır.
# Beklenen: Pillow 12.3.0 / numpy 2.4.6 / soundfile 0.14.0 / torch 2.13.0+cpu / torchaudio 2.11.0+cpu
RUN python3 - <<'PY'
import sys, subprocess, PIL, numpy, soundfile, torch, torchaudio, runpod
print("=== PARITE RAPORU ===")
for ad, v in (("python", sys.version.split()[0]), ("Pillow", PIL.__version__), ("numpy", numpy.__version__),
              ("soundfile", soundfile.__version__), ("torch", torch.__version__),
              ("torchaudio", torchaudio.__version__), ("runpod", getattr(runpod, "__version__", "?"))):
    print(f"  {ad:11} {v}")
print("  ffmpeg     ", subprocess.run(["ffmpeg","-version"],capture_output=True,text=True).stdout.split("\n")[0])
assert PIL.__version__ == "12.3.0", "PARITE KIRILDI: Pillow != 12.3.0"
assert torch.__version__.startswith("2.13.0"), "PARITE KIRILDI: torch != 2.13.0 (chatterbox CUDA torch'u ezdi mi?)"
assert numpy.__version__ == "2.4.6", "PARITE KIRILDI: numpy != 2.4.6"
print("PARITE OK")
PY

# Chatterbox modelini imaja göm (cold-start'ta HF inmesin). tactical dosyalarına ihtiyacı YOK
# -> COPY'den ÖNCE (kod değişince yalnız son layer bozulur, model cache korunur).
RUN python3 -c "from chatterbox.tts import ChatterboxTTS; ChatterboxTTS.from_pretrained(device='cpu'); print('MODEL BAKED')" \
    || echo "model bake atlandi (runtime iner)"

# taktik motoru + varlıklar EN SONA (fonts/ assets/ fx/ music/ voices/ — .dockerignore fx/typing_src.wav'ı atar)
COPY . /app/tactical/
WORKDIR /app/tactical
RUN chmod +x /app/tactical/basla.sh

# ── v5 (2026-08-31): STATİK MOZAİK MOTORA TAŞINDI ────────────────────────────────────────
# Statik birleştirme sunucudaki harita-proxy.py'ye (PIL) iniyordu -> sunucu kapanınca 502.
# Artık konteynerin İÇİNDE: harita_yan.py (127.0.0.1:8890) + mvt_raster.py.
#   · `_stitch`/`_stitch_bbox`/RX/RXB2 -> harita-proxy.py'den KARAKTER KARAKTER kopya
#     (kanıt: `python3 harita_yan.py --muhur /opt/matrix/scripts/harita-proxy.py` = 4/4 BİREBİR)
#   · strm rasteri -> mvt_raster.py; PM_CIZGI=1 / PM_BINA=246 / PM_YOL_TON=180 kalibrasyonu
#     ve MVT çözümü pmtiles_okuyucu.py ile birebir (kanıt: `mvt_raster.py --muhur`, tek
#     bilinçli fark `maxz` kaynağı: yerel PMTiles başlığı -> MVT_MAXZ=15).
# 🔒 MÜHÜR: route_gen.py / render_job.py / intro_gen.py / outro_gen.py'de SIFIR satır değişti.
#    Yönlendirme yalnız env ile: template'te `HARITA_STATIK=http://127.0.0.1:8890`.
#    `HARITA_MATCHING` / `HARITA_GEOCODING` Cloudflare katmanında KALIR (PIL gerektirmezler).
# Yan-servis önce kalkar, sonra handler PID 1 olarak exec edilir (E2 + sinyal/timeout korunur).
CMD ["/bin/sh", "/app/tactical/basla.sh"]
