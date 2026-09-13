"""Modal render maliyet ÖLÇÜMÜ — tahmin değil, gerçek koşu.

Brief'in 3. uyarısı: "Maliyeti deploy sonrası ÖLÇ. Tek videoluk bir koşuyla
gerçek süreyi gör, sonra hacimle çarp."

RunPod tabanı (D1 gpu_costs'tan ölçülmüş): 1195-1226 GPU-sn / 3B video, $0.38.
Sentetik rota kullanılır — gerçek kullanıcı verisine dokunulmaz.
test=True → rp_handler geri çağrıyı (satır 339) atlar, kimseye bildirim gitmez.
"""

import json
import math
import sys
import time

import modal

# Modal yayınlanmış fiyatlar ($/sn) — GPU + CPU + RAM AYRI faturalanır.
# Brief'teki "2-3 sent" yalnız GPU'yu sayıyordu; CPU/RAM eklenince tablo değişir.
GPU_USD_SN = {"T4": 0.000164, "L4": 0.000222, "A10G": 0.000306, "A100-40GB": 0.000944}
CPU_USD_SN = 0.0000131          # çekirdek başına
RAM_USD_SN = 0.00000222         # GiB başına
CEKIRDEK, RAM_GIB = 4, 16

RUNPOD_TABAN_SN = 1195          # ölçülen ortalama
RUNPOD_TABAN_USD = 0.38


def rota(km=15.0, nokta=450, t0=1757000000):
    """İstanbul Boğaz kıyı hattı boyunca gerçekçi bir iz üretir."""
    b_lat, b_lon = 41.0400, 29.0100          # Beşiktaş civarı
    s_lat, s_lon = 41.1050, 29.0600          # Sarıyer yönü
    p = []
    for i in range(nokta):
        f = i / (nokta - 1)
        # hafif S kıvrımı — düz çizgi değil, yol gibi
        sap = 0.0025 * math.sin(f * math.pi * 3)
        p.append({
            "t": t0 + int(f * 1800),                      # 30 dakikalık sürüş
            "lat": b_lat + (s_lat - b_lat) * f + sap * 0.4,
            "lon": b_lon + (s_lon - b_lon) * f + sap,
            "alt": 30 + 40 * math.sin(f * math.pi),
            "spd": 30 + 25 * math.sin(f * math.pi * 2),
            "hr": 95 + int(20 * math.sin(f * math.pi * 4)),
        })
    return p


def is_yuku(gpu):
    iz = rota()
    return {
        "ride_id": f"MODALOLCUM{gpu.replace('-', '')}",   # BÜYÜK HARF = test (gerçek işler tarihli)
        "user": "appreview",
        "mode": "3d",
        "test": True,                                     # geri çağrı YOK, bildirim YOK
        "premium": True,
        "lang": "tr",
        "aspect": "9:16",
        "name": "Modal Ölçüm",
        "track": iz,
        "from": iz[0]["t"],                               # EPOCH olmalı — yoksa 0 nokta
        "to": iz[-1]["t"],
    }


def maliyet(gpu, sn):
    g = GPU_USD_SN.get(gpu, 0)
    return {
        "gpu": round(g * sn, 4),
        "cpu": round(CPU_USD_SN * CEKIRDEK * sn, 4),
        "ram": round(RAM_USD_SN * RAM_GIB * sn, 4),
        "toplam": round((g + CPU_USD_SN * CEKIRDEK + RAM_USD_SN * RAM_GIB) * sn, 4),
    }


def main(gpular):
    Isci = modal.Cls.from_name("movelog-render", "Isci")
    cagri = {}
    for g in gpular:
        try:
            ornek = Isci.with_options(gpu=g)()
        except Exception as ex:
            print(f"  {g}: with_options desteklenmedi ({type(ex).__name__}) — atlanıyor")
            continue
        cagri[g] = (ornek.render.spawn(is_yuku(g)), time.time())
        print(f"  {g:10s} gönderildi", flush=True)

    print("\n  bekleniyor (RunPod tabanı ~20 dk; T4 daha yavaş olabilir)...\n", flush=True)
    for g, (is_, t0) in cagri.items():
        try:
            r = is_.get(timeout=5400)
            sn = round(time.time() - t0, 1)
            m = maliyet(g, sn)
            hata = r.get("error") if isinstance(r, dict) else None
            print(f"  ── {g} ──")
            print(f"     duvar saati : {sn} sn ({sn/60:.1f} dk)")
            print(f"     handler sn  : {r.get('_modal_sn') if isinstance(r, dict) else '?'}")
            print(f"     maliyet     : ${m['toplam']}  (gpu ${m['gpu']} + cpu ${m['cpu']} + ram ${m['ram']})")
            print(f"     RunPod'a göre: {sn/RUNPOD_TABAN_SN:.2f}× süre, "
                  f"{m['toplam']/RUNPOD_TABAN_USD:.2f}× fiyat")
            print(f"     sonuç       : {'HATA: ' + str(hata) if hata else 'video üretildi'}")
            if isinstance(r, dict):
                print(f"     anahtarlar  : {list(r)[:10]}")
        except Exception as ex:
            print(f"  ── {g} ── BAŞARISIZ: {type(ex).__name__}: {str(ex)[:300]}")
        print(flush=True)


if __name__ == "__main__":
    main(sys.argv[1:] or ["T4", "L4"])
