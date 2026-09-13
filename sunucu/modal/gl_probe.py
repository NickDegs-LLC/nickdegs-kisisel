"""
Modal GRAFİK YETENEĞİ SONDASI — RunPod→Modal geçişinin TEK belirleyici sorusu.

Özel imaja GEREK YOK: soru platformun sürücü `graphics` yeteneğini açıp açmadığı.
Açmıyorsa hiçbir imaj kurtaramaz (libEGL_nvidia host sürücüsünden gelir).
Açıyorsa bizim imajımız (NVIDIA_DRIVER_CAPABILITIES=all + libGLESv2 + Chrome/ANGLE) çalışır.

ARANAN: libEGL_nvidia.so* VAR + eglInitialize başarılı + renderer NVIDIA (llvmpipe DEĞİL).
"""
import subprocess
import modal

# Herkese açık CUDA imajı + EGL sondası için minik paketler
img = (
    modal.Image.from_registry("nvidia/cuda:12.4.1-runtime-ubuntu22.04", add_python="3.11")
    .apt_install("libegl1", "libgles2", "mesa-utils", "pciutils")
)
app = modal.App("movelog-gl-probe")

SONDA_C = r'''
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GLES2/gl2.h>
#include <stdio.h>
int main(){
  EGLDisplay d = eglGetDisplay(EGL_DEFAULT_DISPLAY);
  if(d==EGL_NO_DISPLAY){ printf("EGL_NO_DISPLAY\n"); return 1; }
  EGLint ma,mi;
  if(!eglInitialize(d,&ma,&mi)){ printf("eglInitialize BASARISIZ (0x%x)\n", eglGetError()); return 2; }
  printf("EGL %d.%d vendor=%s\n", ma, mi, eglQueryString(d,EGL_VENDOR));
  EGLint cfgn; EGLConfig cfg;
  EGLint attr[]={EGL_SURFACE_TYPE,EGL_PBUFFER_BIT,EGL_RENDERABLE_TYPE,EGL_OPENGL_ES2_BIT,EGL_NONE};
  if(!eglChooseConfig(d,attr,&cfg,1,&cfgn)||cfgn<1){ printf("config yok\n"); return 3; }
  eglBindAPI(EGL_OPENGL_ES_API);
  EGLint ca[]={EGL_CONTEXT_CLIENT_VERSION,2,EGL_NONE};
  EGLContext c=eglCreateContext(d,cfg,EGL_NO_CONTEXT,ca);
  if(c==EGL_NO_CONTEXT){ printf("context yok\n"); return 4; }
  EGLint pa[]={EGL_WIDTH,64,EGL_HEIGHT,64,EGL_NONE};
  EGLSurface s=eglCreatePbufferSurface(d,cfg,pa);
  if(!eglMakeCurrent(d,s,s,c)){ printf("makeCurrent basarisiz\n"); return 5; }
  printf("GL_RENDERER=%s\n", (const char*)glGetString(GL_RENDERER));
  printf("GL_VENDOR=%s\n", (const char*)glGetString(GL_VENDOR));
  return 0;
}
'''


def _kos(etiket: str) -> str:
    out = [f"### {etiket}"]

    def ko(ad, cmd, t=120):
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=t, shell=isinstance(cmd, str))
            out.append(f"{ad}: {((r.stdout or '') + (r.stderr or '')).strip()[:220] or '(boş)'}")
        except Exception as e:
            out.append(f"{ad}: HATA {str(e)[:120]}")

    ko("GPU", ["nvidia-smi", "--query-gpu=name,driver_version", "--format=csv,noheader"])
    ko("DRIVER_CAPS", "echo ${NVIDIA_DRIVER_CAPABILITIES:-<ayarlanmamis>}")
    ko("libEGL_nvidia", "ls /usr/lib/x86_64-linux-gnu/libEGL_nvidia* 2>/dev/null || echo YOK")
    ko("libGLX_nvidia", "ls /usr/lib/x86_64-linux-gnu/libGLX_nvidia* 2>/dev/null || echo YOK")
    ko("egl vendor json", "cat /usr/share/glvnd/egl_vendor.d/*.json 2>/dev/null | tr -d '\\n' | head -c 160 || echo YOK")
    # ASIL SONDA: gerçekten EGL bağlamı açılıp GL_RENDERER okunuyor mu
    open("/tmp/p.c", "w").write(SONDA_C)
    ko("derle", "apt-get install -y -qq libegl1-mesa-dev libgles2-mesa-dev gcc >/dev/null 2>&1; "
                "gcc /tmp/p.c -o /tmp/p -lEGL -lGLESv2 2>&1 | tail -3 || echo DERLENEMEDI", 300)
    ko("EGL SONDASI", "/tmp/p 2>&1 || echo '(sonda calismadi)'")
    return "\n".join(out)


@app.function(image=img, gpu="L4", timeout=900)
def l4():
    return _kos("L4")


@app.function(image=img, gpu="T4", timeout=900)
def t4():
    return _kos("T4")


@app.local_entrypoint()
def main():
    for f in (l4, t4):
        try:
            print(f.remote())
        except Exception as e:
            print(f"### {f.__name__}: KOŞTURULAMADI — {str(e)[:300]}")
        print()
