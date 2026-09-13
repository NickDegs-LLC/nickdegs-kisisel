#!/usr/bin/env python3
# Garmin Connect bir-kerelik giriş (2FA destekli). Başarıda token'ı kaydeder.
import os, sys, time
sys.path.insert(0, "/opt/matrix/garmin-lib")
from garminconnect import Garmin

EMAIL = os.environ["GARMIN_EMAIL"]; PW = os.environ["GARMIN_PASSWORD"]
TOK = "/opt/matrix/garmin-tokens"
STATUS = "/tmp/garmin_status.txt"; CODEF = "/tmp/garmin_mfa_code.txt"

def status(s):
    open(STATUS, "w").write(s + "\n")

try:
    status("starting")
    g = Garmin(email=EMAIL, password=PW, return_on_mfa=True)
    res = g.login()
    if isinstance(res, tuple) and len(res) == 2 and res[0] == "needs_mfa":
        client_state = res[1]
        status("needs_mfa")
        code = None
        for _ in range(120):  # ~6 dk bekle
            if os.path.exists(CODEF):
                c = open(CODEF).read().strip()
                if c:
                    code = c; break
            time.sleep(3)
        if not code:
            status("error: 2FA kodu zamaninda gelmedi"); sys.exit(1)
        g.resume_login(client_state, code)
    os.makedirs(TOK, exist_ok=True)
    g.client.dump(TOK)
    try:
        name = g.get_full_name()
    except Exception:
        name = "?"
    status("ok: giris basarili (" + str(name) + ")")
except Exception as e:
    status("error: " + repr(e)[:400])
