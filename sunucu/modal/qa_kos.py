"""Tek T4 koşusu — GÖRSEL QA için videoyu SAKLAR (ölçüm koşusu artıkları silinmişti).

Duran kural: "her videoyu biter bitmez tek tek kontrol et". Ölçüm koşusunda
süre/maliyet alındı ama video gözle görülmeden temizlendi; bu koşu o eksiği kapatır.

Çağrı kimliği diske yazılır → yerel süreç ölse bile sonuca yeniden bağlanılabilir
(ölçüm koşusunda bunu yapmamıştım, bekleyici ölünce sonuçlara ulaşamadım).
"""

import json
import sys
import time

import modal

from olcum import is_yuku

KIMLIK_DOSYA = "/opt/matrix/modal/.qa_call_id"


def gonder():
    Isci = modal.Cls.from_name("movelog-render", "Isci")
    job = is_yuku("T4")
    job["ride_id"] = "MODALQA"
    cagri = Isci.with_options(gpu="T4")().render.spawn(job)
    json.dump({"id": cagri.object_id, "t0": time.time(), "rid": job["ride_id"]},
              open(KIMLIK_DOSYA, "w"))
    print(f"  gönderildi: {cagri.object_id} (rid={job['ride_id']})", flush=True)
    return cagri


def bekle():
    k = json.load(open(KIMLIK_DOSYA))
    cagri = modal.FunctionCall.from_id(k["id"])
    r = cagri.get(timeout=5400)
    sn = round(time.time() - k["t0"], 1)
    print(f"\n  süre: {sn} sn ({sn/60:.1f} dk)")
    print(f"  dönüş: {json.dumps(r, ensure_ascii=False)[:600]}")
    return r


if __name__ == "__main__":
    if sys.argv[1:] and sys.argv[1] == "bekle":
        bekle()
    else:
        gonder()
        bekle()
