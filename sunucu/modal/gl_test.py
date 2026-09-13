"""
Modal GL SAĞLIK TESTİ — RunPod'dan Modal'a geçişin TEK belirleyici sorusu.

NEDEN: Move Log render motoru CUDA değil, OPENGL kullanıyor — headless Chrome
`--use-angle=gl-egl --enable-gpu` ile açılıyor (3d/glhealth.js ve render3d.js aynı bayraklar).
Çoğu serverless GPU platformu sürücünün yalnız `compute` yeteneğini açar; `graphics` kapalıysa
Chrome yazılım rasterleştirmeye (llvmpipe/SwiftShader) düşer ve 20 dakikalık iş saatlere çıkar.
MIG tuzağında (bkz. MATRIX-DEVIR.md) birebir bu yaşandı.

Bunu açan ayar imajın İÇİNDE: NVIDIA_DRIVER_CAPABILITIES=all (docker inspect ile doğrulandı),
yani imajla birlikte taşınıyor. Modal'ın çalışma zamanı buna saygı duyuyorsa çalışır.

ÇIKTI:
  OK <renderer>          -> yeşil ışık, geçiş planlanabilir
  BROKEN <sebep>         -> GL yok
  llvmpipe / SwiftShader -> GPU görünüyor ama YAZILIM render'ı = GEÇİŞ YAPILMAZ

KULLANIM:
  1) Modal token:      modal token set --token-id ... --token-secret ...
  2) ghcr kimliği (imaj ÖZEL — anonim çekim 403):
     modal secret create ghcr REGISTRY_USERNAME=NickDegs REGISTRY_PASSWORD=<github_pat_read:packages>
  3) modal run /opt/matrix/modal/gl_test.py
"""
import subprocess
import modal

IMAJ = "ghcr.io/nickdegs/movelog-render:v150"

image = modal.Image.from_registry(IMAJ, secret=modal.Secret.from_name("ghcr"))
app = modal.App("movelog-gl-test")

# Aynı testi birkaç GPU'da koştur: hangisi GL veriyor + hangisi hızlı, ikisini birden gör.
GPULAR = ["L4", "A10G", "T4"]


@app.function(image=image, gpu="L4", timeout=600)
def gl_l4():
    return _kos("L4")


@app.function(image=image, gpu="A10G", timeout=600)
def gl_a10g():
    return _kos("A10G")


@app.function(image=image, gpu="T4", timeout=600)
def gl_t4():
    return _kos("T4")


def _kos(etiket: str) -> str:
    satir = [f"### {etiket}"]
    # 1) sürücü görünüyor mu + GL yetenegi acik mi
    for ad, cmd in (
        ("nvidia-smi", ["nvidia-smi", "--query-gpu=name,driver_version", "--format=csv,noheader"]),
        ("libEGL_nvidia", ["sh", "-c", "ls /usr/lib/x86_64-linux-gnu/libEGL_nvidia* 2>/dev/null || echo YOK"]),
        ("DRIVER_CAPS", ["sh", "-c", "echo ${NVIDIA_DRIVER_CAPABILITIES:-<bos>}"]),
    ):
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            satir.append(f"{ad}: {(r.stdout or r.stderr).strip()[:120]}")
        except Exception as e:
            satir.append(f"{ad}: HATA {str(e)[:80]}")

    # 2) ASIL TEST — uretimdekiyle birebir ayni Chrome bayraklariyla shader derleme
    try:
        r = subprocess.run(["node", "/app/3d/glhealth.js"], capture_output=True, text=True, timeout=180)
        cikti = (r.stdout or "").strip() or (r.stderr or "").strip()
        satir.append(f"glhealth (exit {r.returncode}): {cikti[:300]}")
    except Exception as e:
        satir.append(f"glhealth: HATA {str(e)[:150]}")
    return "\n".join(satir)


@app.local_entrypoint()
def main():
    for f in (gl_l4, gl_a10g, gl_t4):
        try:
            print(f.remote())
        except Exception as e:
            print(f"### {f.__name__}: KOŞTURULAMADI — {str(e)[:200]}")
        print()
