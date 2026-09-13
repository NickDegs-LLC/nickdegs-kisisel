#!/usr/bin/env python3
# Google Cloud Run HTTP handler — TAKTİK render (2026-07-26). MAKSİMUM GÜVENLİK:
# Cloud Run'da HİÇBİR gizli anahtar yok. R2'ye presigned PUT URL (job.put_url) ile yüklenir,
# render-done'u lokal reconcile halleder. Yalnızca PUBLIC mapbox token (client-safe) env'de.
import os, json, subprocess, time
from flask import Flask, request, jsonify

app = Flask(__name__)
TAC = "/app/tactical"

@app.route("/", methods=["GET"])
def health():
    return "ok", 200

@app.route("/render", methods=["POST"])
def render():
    t0 = time.time()
    job = request.get_json(force=True, silent=True) or {}
    vid = str(job.get("vid", "x"))
    try:
        os.makedirs("/opt/matrix/secrets", exist_ok=True)
        open("/opt/matrix/secrets/mapbox.conf", "w").write(
            f"MAPBOX_PUBLIC_TOKEN={os.environ.get('MAPBOX_PUBLIC','')}\n")
        os.makedirs("/opt/matrix/routes/tacwork", exist_ok=True)
        jf = f"/opt/matrix/routes/tacwork/job_{vid}.json"
        json.dump(job, open(jf, "w"))
        env = dict(os.environ)
        env["TAC_PUT_URL"] = job.get("put_url", "")   # lokal host'un ürettiği presigned R2 PUT URL'i
        r = subprocess.run(["python3", f"{TAC}/render_job.py", jf],
                           cwd=TAC, env=env, capture_output=True, text=True, timeout=3300)
        ok = (r.returncode == 0)
        return jsonify({"ok": ok, "vid": vid, "sec": round(time.time() - t0, 1),
                        "log": (r.stdout or "")[-1000:],
                        "err": (r.stderr or "")[-500:] if not ok else ""}), (200 if ok else 500)
    except Exception as e:
        return jsonify({"ok": False, "vid": vid, "err": str(e)[:500]}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))
