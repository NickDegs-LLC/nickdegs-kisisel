#!/usr/bin/env python3
"""Test JWT üret (HS256, backend ile aynı sır). Kullanım: tools/jwt.py <sub> [saniye]
Sır: /opt/movelog/backend/config.env JWT_SECRET (gölge modda Worker'a da aynı sır yüklenir)."""
import sys, json, time, base64, hmac, hashlib
def _c():
    for l in open("/opt/movelog/backend/config.env"):
        if l.startswith("JWT_SECRET="): return l.split("=",1)[1].strip().strip('"').strip("'")
    raise SystemExit("JWT_SECRET yok")
b = lambda x: base64.urlsafe_b64encode(x).decode().rstrip("=")
sub = sys.argv[1] if len(sys.argv) > 1 else "qatest"
exp = int(time.time()) + (int(sys.argv[2]) if len(sys.argv) > 2 else 3600)
h = b(json.dumps({"alg":"HS256","typ":"JWT"}).encode()); p = b(json.dumps({"sub":sub,"exp":exp}).encode())
print(f"{h}.{p}.{b(hmac.new(_c().encode(), f'{h}.{p}'.encode(), hashlib.sha256).digest())}")
