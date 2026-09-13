#!/usr/bin/env python3
# Google Cloud Run JOBS entrypoint — TAKTİK render (2026-07-26). Cloud Run Service (HTTP, 55dk timeout) yerine
# Cloud Run JOBS: görev 24 saate kadar çalışır -> uzun video (~60dk) sorunsuz biter + binlerce paralel görev (ölçek).
# MAKSİMUM GÜVENLİK: Cloud Run'da HİÇBİR gizli anahtar yok. Her execution env override ile gelir:
#   JOB_URL_B64      = presigned R2 GET (job.json'u indir)   [base64 — özel karakter sorunu olmasın]
#   TAC_PUT_URL_B64  = presigned R2 PUT (final videoyu yükle) [base64]
#   MAPBOX_PUBLIC    = PUBLIC mapbox token (client-safe, job config'de sabit)
# render-done'u lokal reconcile halleder (worker TAC_PUT_URL varsa render-done ATLAR).
import os, sys, json, base64, subprocess, urllib.request

TAC = "/app/tactical"

def _b64(name):
    v = os.environ.get(name, "")
    if not v:
        return ""
    return base64.b64decode(v).decode()

def main():
    job_url = _b64("JOB_URL_B64")
    put_url = _b64("TAC_PUT_URL_B64")
    if not job_url or not put_url:
        print("HATA: JOB_URL_B64 / TAC_PUT_URL_B64 eksik", flush=True); sys.exit(2)

    # 1) job.json'u presigned GET ile indir
    with urllib.request.urlopen(job_url, timeout=120) as r:
        job = json.loads(r.read().decode())
    vid = str(job.get("vid", "x"))
    print(f"[cr_job {vid}] job indirildi ({len(job.get('track') or [])} nokta)", flush=True)

    # 2) mapbox.conf (PUBLIC token) + job dosyası
    os.makedirs("/opt/matrix/secrets", exist_ok=True)
    open("/opt/matrix/secrets/mapbox.conf", "w").write(
        f"MAPBOX_PUBLIC_TOKEN={os.environ.get('MAPBOX_PUBLIC','')}\n")
    os.makedirs("/opt/matrix/routes/tacwork", exist_ok=True)
    jf = f"/opt/matrix/routes/tacwork/job_{vid}.json"
    json.dump(job, open(jf, "w"))

    # 3) render_job (TAC_PUT_URL -> presigned PUT + render-done ATLA; reconcile finalize eder)
    env = dict(os.environ); env["TAC_PUT_URL"] = put_url
    env.setdefault("TAC_CHUNKS", "4")   # PARÇALI PARALEL render (4 vCPU -> 4 parça, byte-identical) -> Cloud Run ~60dk yerine ~15dk
    r = subprocess.run(["python3", f"{TAC}/render_job.py", jf], cwd=TAC, env=env)
    print(f"[cr_job {vid}] render_job exit={r.returncode}", flush=True)
    sys.exit(r.returncode)

if __name__ == "__main__":
    main()
