"""Modal ölçüm koşusunu DIŞARIDAN izler.

Neden ayrı dosya: ilk koşuda çağrı kimliklerini (FunctionCall id) diske yazmamıştım;
yerel bekleyici ölünce sonuçlara ulaşamadım. İşler Modal'da koşmaya devam ediyor.
Bu izleyici iki bağımsız kanıt kaynağı kullanır:
  1) konteyner ömrü  -> Modal'ın FATURALADIĞI süre (container list'ten kaybolunca biter)
  2) R2 nesnesi      -> videonun gerçekten üretildiğinin kanıtı (boyut + zaman)
"""

import json
import os
import subprocess
import sys
import time
import urllib.request

ANAHTARLAR = {"T4": "videos/MODALOLCUMT4.mp4", "L4": "videos/MODALOLCUML4.mp4"}
GPU_USD_SN = {"T4": 0.000164, "L4": 0.000222}
CPU_USD_SN, RAM_USD_SN, CEKIRDEK, RAM_GIB = 0.0000131, 0.00000222, 4, 16
RUNPOD_TABAN_SN, RUNPOD_TABAN_USD = 1195, 0.38


def r2():
    import boto3
    # UA ŞART: RunPod REST'i de Cloudflare gibi varsayılan Python-urllib UA'sını 403'lüyor.
    kaynak = json.load(urllib.request.urlopen(urllib.request.Request(
        "https://rest.runpod.io/v1/templates/aztc1lxmro",
        headers={"Authorization": "Bearer " + os.environ["RUNPOD_API_KEY"],
                 "User-Agent": "movelog-olcum/1.0"})))["env"]
    return boto3.client(
        "s3", endpoint_url=kaynak["R2_ENDPOINT"],
        aws_access_key_id=kaynak["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=kaynak["R2_SECRET_ACCESS_KEY"],
        region_name="auto"), kaynak["R2_BUCKET"]


def konteyner_sayisi():
    p = subprocess.run(
        ["/opt/modal-isci/venv/bin/modal", "container", "list"],
        capture_output=True, text=True, timeout=120,
        env={**os.environ, "COLUMNS": "200"})
    return p.stdout.count("movelog-render")


def maliyet(gpu, sn):
    g = GPU_USD_SN[gpu]
    return round((g + CPU_USD_SN * CEKIRDEK + RAM_USD_SN * RAM_GIB) * sn, 4)


def main(baslangic_epoch):
    s3, kova = r2()
    bulunan = {}
    son = time.time() + 5400
    while time.time() < son:
        for gpu, anahtar in ANAHTARLAR.items():
            if gpu in bulunan:
                continue
            try:
                h = s3.head_object(Bucket=kova, Key=anahtar)
                bitis = h["LastModified"].timestamp()
                bulunan[gpu] = {"sn": round(bitis - baslangic_epoch, 1), "bayt": h["ContentLength"]}
                b = bulunan[gpu]
                print(f"\n  ✅ {gpu}: {b['sn']} sn ({b['sn']/60:.1f} dk) · "
                      f"{b['bayt']/1e6:.1f} MB · ${maliyet(gpu, b['sn'])}", flush=True)
            except Exception:
                pass
        kalan = konteyner_sayisi()
        print(f"  [{time.strftime('%H:%M')}] konteyner: {kalan} · "
              f"biten: {sorted(bulunan)} · geçen: {(time.time()-baslangic_epoch)/60:.0f} dk", flush=True)
        if kalan == 0 and len(bulunan) == len(ANAHTARLAR):
            break
        if kalan == 0 and time.time() - baslangic_epoch > 300:
            print("  ⚠️ konteyner kalmadı ama çıktı eksik — iş düşmüş olabilir", flush=True)
            break
        time.sleep(60)

    print("\n" + "=" * 62)
    print(f"  {'GPU':6s} {'süre':>10s} {'maliyet':>9s} {'RunPod×süre':>12s} {'RunPod×fiyat':>13s}")
    print(f"  {'RunPod':6s} {RUNPOD_TABAN_SN/60:9.1f}dk {'$'+str(RUNPOD_TABAN_USD):>9s} "
          f"{'1.00×':>12s} {'1.00×':>13s}")
    for gpu, b in sorted(bulunan.items()):
        m = maliyet(gpu, b["sn"])
        print(f"  {gpu:6s} {b['sn']/60:9.1f}dk {'$'+str(m):>9s} "
              f"{b['sn']/RUNPOD_TABAN_SN:11.2f}× {m/RUNPOD_TABAN_USD:12.2f}×")
    eksik = set(ANAHTARLAR) - set(bulunan)
    if eksik:
        print(f"  ⚠️ çıktı ÜRETMEYEN: {sorted(eksik)}")
    print("=" * 62)


if __name__ == "__main__":
    main(float(sys.argv[1]))
