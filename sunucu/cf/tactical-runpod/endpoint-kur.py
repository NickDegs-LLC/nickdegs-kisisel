#!/usr/bin/env python3
"""TAKTİK RunPod endpoint kurucu (2026-08-30 · 2026-08-31 CPU tuzağı düzeltildi).

DURUM 2026-08-31: endpoint KURULDU -> yvkajd6x7mp1lj (Barış kota onayı: movelog-render 15->12,
boşalan 3 worker taktiğe). Bu script artık YENİDEN KURMA / OLAY SONRASI kurtarma aracıdır;
mevcut endpoint varsa hiçbir şey yapmadan durumu basar.

🔴 ÖLÇÜLEN TUZAK — REST `computeType` SESSİZCE YOK SAYILIYOR:
    POST /v1/endpoints gövdesindeki  computeType:"CPU" + cpuFlavorIds + vcpuCount  uygulanmıyor;
    endpoint GPU olarak kuruluyor (gpuTypeIds dolu, instanceIds boş). REST GET `computeType`
    alanını HİÇ döndürmediği için fark edilmez — 2026-08-31'de ilk deneme (x02n1kbf932caz) bu
    yüzden GPU çıktı ve silindi. Tek güvenilir yol GraphQL:
      kontrol : query { myself { endpoints { id name computeType instanceIds } } }
      düzeltme: mutation { saveEndpoint(input:{ id, templateId, gpuIds:"", instanceIds:[...] ... }) }
    Bu script artık kurduktan SONRA GraphQL ile computeType'ı DOĞRULAR ve GPU çıkarsa saveEndpoint
    ile CPU'ya çevirir. GraphQL'de User-Agent başlığı ŞART (UA'sız 403).

Kullanım:
    python3 /opt/matrix/cf/tactical-runpod/endpoint-kur.py            # kur (+ CPU doğrula/düzelt)
    python3 /opt/matrix/cf/tactical-runpod/endpoint-kur.py --kontrol  # yalnız kota + tip durumu

Kurulduktan SONRA elle yapılacak 3 adım (script hatırlatır):
  1) /opt/matrix/cf/dispatch/wrangler.toml -> RUNPOD_ENDPOINT_TAC = "<id>"
  2) /opt/matrix/cf/cron/wrangler.toml     -> RUNPOD_ENDPOINT_TAC = "<id>"
  3) her ikisinde: npx wrangler deploy  (CLOUDFLARE_API_TOKEN = movelog-cf.conf MOVELOG_CF_TOKEN)
"""
import json
import sys
import urllib.error
import urllib.request

RP_CONF = "/opt/matrix/secrets/runpod.conf"
TAC_CONF = "/opt/matrix/secrets/runpod-tactical.conf"
API = "https://rest.runpod.io/v1"
GQL = "https://api.runpod.io/graphql"

# Keşif ölçümlerinden gelen ayarlar (route_gen.py:880 ~460 karo tavanı ≈ 9 GB tepe → ≥16 GB şart,
# 24 GB tercih; cpu5g/cpu3g = 4 GB RAM/vCPU → 8 vCPU = 32 GB). TAC_CHUNKS=8 ile paralel render.
AYAR = {
    "name": "movelog-tactical",
    "computeType": "CPU",          # ⚠️ REST bunu YOK SAYIYOR — GraphQL düzeltmesi aşağıda ŞART
    "cpuFlavorIds": ["cpu5g", "cpu3g"],
    "vcpuCount": 8,
    "workersMin": 0,
    "workersMax": 3,
    "idleTimeout": 30,
    "scalerType": "REQUEST_COUNT",
    "scalerValue": 1,
    "executionTimeoutMs": 3900000,   # 65 dk (rp_handler TAC_TIMEOUT=3300 sn + yükleme payı)
}
# GraphQL saveEndpoint için CPU instance kimlikleri: {flavor}-{vCPU}-{GB RAM}
INSTANCE_IDS = ["cpu5g-8-32", "cpu3g-8-32"]


def conf(path):
    d = {}
    for satir in open(path):
        satir = satir.strip()
        if satir and not satir.startswith("#") and "=" in satir:
            k, v = satir.split("=", 1)
            d[k.strip()] = v.strip()
    return d


def istek(anahtar, yol, govde=None, method="GET"):
    r = urllib.request.Request(
        f"{API}{yol}",
        data=json.dumps(govde).encode() if govde is not None else None,
        headers={"Authorization": f"Bearer {anahtar}", "Content-Type": "application/json",
                 "User-Agent": "matrix-claude/1.0"},
        method=method)
    with urllib.request.urlopen(r, timeout=60) as y:
        return json.loads(y.read())


def gql(anahtar, sorgu):
    """RunPod GraphQL. User-Agent ŞART (UA'sız 403 — movelog-render-bekci.py:105 dersi).
    computeType/instanceIds YALNIZ burada görünür; REST bu alanları döndürmez."""
    r = urllib.request.Request(
        GQL, data=json.dumps({"query": sorgu}).encode(),
        headers={"Authorization": f"Bearer {anahtar}", "Content-Type": "application/json",
                 "User-Agent": "matrix-claude/1.0"}, method="POST")
    with urllib.request.urlopen(r, timeout=60) as y:
        d = json.loads(y.read())
    if d.get("errors"):
        raise RuntimeError("GraphQL: " + json.dumps(d["errors"])[:400])
    return d["data"]


def tip_bak(anahtar, eid):
    """Endpoint'in GERÇEK compute tipi (REST yalan söyler). -> (computeType, instanceIds)"""
    for e in gql(anahtar, "query { myself { endpoints { id computeType instanceIds } } }")["myself"]["endpoints"]:
        if e["id"] == eid:
            return e.get("computeType"), e.get("instanceIds") or []
    return None, []


def cpuya_cevir(anahtar, eid, tid):
    """REST'in GPU kurduğu endpoint'i saveEndpoint ile CPU'ya çevirir (gpuIds boşaltılır)."""
    iid = json.dumps(INSTANCE_IDS)
    m = (f'mutation {{ saveEndpoint(input: {{ id: "{eid}", name: "{AYAR["name"]}", '
         f'templateId: "{tid}", gpuIds: "", instanceIds: {iid}, '
         f'workersMin: {AYAR["workersMin"]}, workersMax: {AYAR["workersMax"]}, '
         f'idleTimeout: {AYAR["idleTimeout"]}, scalerType: "{AYAR["scalerType"]}", '
         f'scalerValue: {AYAR["scalerValue"]}, executionTimeoutMs: {AYAR["executionTimeoutMs"]} }}) '
         f'{{ id computeType instanceIds workersMax }} }}')
    return gql(anahtar, m)["saveEndpoint"]


def main():
    rp = conf(RP_CONF)
    tac = conf(TAC_CONF)
    anahtar = rp["RUNPOD_API_KEY"]
    tid = tac.get("RUNPOD_TAC_TEMPLATE_ID", "")
    if not tid:
        print("HATA: RUNPOD_TAC_TEMPLATE_ID boş — template kurulmamış.", file=sys.stderr)
        return 2

    uclar = istek(anahtar, "/endpoints")
    kullanim = sum(e.get("workersMax") or 0 for e in uclar)
    print(f"RunPod worker kullanımı: {kullanim}/20")
    for e in sorted(uclar, key=lambda x: -(x.get("workersMax") or 0)):
        if e.get("workersMax"):
            print(f"   {e.get('name'):18} wmax={e.get('workersMax')}")
    gerek = AYAR["workersMax"]
    bos = 20 - kullanim
    if any(e.get("name") == "movelog-tactical" for e in uclar):
        print("\nZATEN KURULU: movelog-tactical endpoint'i var.")
        for e in uclar:
            if e.get("name") == "movelog-tactical":
                eid = e.get("id")
                tip, iid = tip_bak(anahtar, eid)
                print("   id =", eid, " wmax =", e.get("workersMax"))
                print("   computeType =", tip, " instanceIds =", iid)
                if tip != "CPU":
                    print("   🔴 GPU olarak duruyor! Düzeltme: endpoint-kur.py --cpuya-cevir",
                          file=sys.stderr)
                    if "--cpuya-cevir" in sys.argv:
                        print("   ->", cpuya_cevir(anahtar, eid, tid))
        return 0
    print(f"\nBoş kota: {bos} · gereken: {gerek}")
    if "--kontrol" in sys.argv:
        return 0
    if bos < gerek:
        print(f"DURDU: {gerek - bos} worker daha boşaltılmalı. Barış'a sor — hangi endpoint düşürülecek?",
              file=sys.stderr)
        print("  (2026-08-31'de yapılan devir: movelog-render 15→12. Başka endpoint'e DOKUNULMADI.)",
              file=sys.stderr)
        return 3

    govde = dict(AYAR, templateId=tid)
    try:
        d = istek(anahtar, "/endpoints", govde, "POST")
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, e.read().decode()[:600], file=sys.stderr)
        return 4
    eid = d.get("id", "")
    print("\nENDPOINT KURULDU")
    for k in ("id", "name", "workersMin", "workersMax", "idleTimeout", "executionTimeoutMs"):
        print(f"   {k:20} {d.get(k)}")

    # ── CPU DOĞRULAMASI (ŞART) — REST computeType'ı yok sayıyor, GraphQL gerçeği söyler ──
    tip, iid = tip_bak(anahtar, eid)
    print(f"   {'computeType(GQL)':20} {tip}   instanceIds={iid}")
    if tip != "CPU":
        print("   ⚠️ REST GPU kurdu (bilinen tuzak) — GraphQL saveEndpoint ile CPU'ya çevriliyor...")
        s = cpuya_cevir(anahtar, eid, tid)
        print("   ->", s)
        if s.get("computeType") != "CPU":
            print("   🔴 CPU'ya ÇEVRİLEMEDİ — endpoint'i SİL, elle bak.", file=sys.stderr)
            return 5
        print("   ✅ CPU'ya çevrildi.")

    # conf'a yaz
    metin = open(TAC_CONF).read().replace("RUNPOD_TAC_ENDPOINT_ID=", f"RUNPOD_TAC_ENDPOINT_ID={eid}", 1)
    open(TAC_CONF, "w").write(metin)
    print(f"\n{TAC_CONF} güncellendi.")
    print("SIRADAKİ 3 ADIM:")
    print(f'  1) /opt/matrix/cf/dispatch/wrangler.toml -> RUNPOD_ENDPOINT_TAC = "{eid}"')
    print(f'  2) /opt/matrix/cf/cron/wrangler.toml     -> RUNPOD_ENDPOINT_TAC = "{eid}"')
    print("  3) her ikisinde: npx wrangler deploy")
    return 0


if __name__ == "__main__":
    sys.exit(main())
