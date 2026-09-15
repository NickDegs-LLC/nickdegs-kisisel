#!/bin/bash
# cf-harita-katman GÖLGE deploy — ROUTE BAĞLAMAZ, workers.dev'de kalır.
# deploy.sh'ın birebir ikizi; TEK farkı: routes[] bloğu çıkarılır + workers_dev=true.
# Canlı trafiğe DOKUNMAZ: harita.nickdegs.com istekleri eski sahibinde kalır.
# Devir günü asıl deploy = ./deploy.sh (route'ları o bağlar, Barış onayıyla).
# ⚠️ Gizli önek loga/ekrana YAZILMAZ; wrangler.toml scratch'te üretilir, iş bitince silinir.
set -euo pipefail
BURA="$(cd "$(dirname "$0")" && pwd)"

source /opt/matrix/secrets/harita-uc.conf          # HARITA_UC_ONEK
: "${HARITA_UC_ONEK:?/opt/matrix/secrets/harita-uc.conf icinde HARITA_UC_ONEK yok}"
# shellcheck disable=SC1091
[ -f /opt/matrix/secrets/movelog-harita-key.conf ] && source /opt/matrix/secrets/movelog-harita-key.conf
MLOG_ONEK="${MLOG_ONEK:-}"
source /usr/local/bin/api-env.sh >/dev/null        # CF_GLOBAL_KEY / CF_EMAIL
export CLOUDFLARE_API_KEY="$CF_GLOBAL_KEY" CLOUDFLARE_EMAIL="$CF_EMAIL"
export CLOUDFLARE_ACCOUNT_ID="45241304800d3e122aced1f0ae599943"

# ORIGIN_COZUM: gri-bulut A kaydı harita-origin.nickdegs.com DEVİR GÜNÜ açılır ve bugün YOK.
# Gölgede route da yok → worker kendi hostuna istek atmaz (döngü imkânsız) → boş bırakılır.
# Böylece forward doğrudan ORIGIN_TABAN'a (canlı uç) gider ve gerçekten ölçülebilir.
GOLGE_ORIGIN_COZUM="${GOLGE_ORIGIN_COZUM:-}"

CALIS="$(mktemp -d)"; trap 'rm -rf "$CALIS"' EXIT
cp -r "$BURA/src" "$CALIS/src"

wrangler r2 bucket create harita-match-cache >/dev/null 2>&1 || true

KV_ID="$(wrangler kv namespace list 2>/dev/null \
  | python3 -c 'import sys,json;print(next((n["id"] for n in json.load(sys.stdin) if n["title"].endswith("HARITA_AYAR")),""))' || true)"
if [ -z "$KV_ID" ]; then
  KV_ID="$(wrangler kv namespace create HARITA_AYAR 2>/dev/null | grep -oE '[0-9a-f]{32}' | head -1)"
fi
: "${KV_ID:?KV namespace olusturulamadi}"

sed -e "s/{ONEK}/$HARITA_UC_ONEK/g" -e "s/{KV_ID}/$KV_ID/" -e "s/{MLOG_ONEK}/$MLOG_ONEK/" \
  "$BURA/wrangler.toml.example" > "$CALIS/wrangler.toml"

# ── GÖLGE FARKI: routes[] bloğunu SİL + workers_dev=true + ORIGIN_COZUM'u boşalt ──
python3 - "$CALIS/wrangler.toml" "$GOLGE_ORIGIN_COZUM" <<'PY'
import re, sys
yol, cozum = sys.argv[1], sys.argv[2]
s = open(yol).read()
yeni, n = re.subn(r'(?ms)^routes\s*=\s*\[.*?^\]\s*\n', '', s)
assert n == 1, f"routes blogu bulunamadi/coklu (n={n}) — GOLGE DEPLOY DURDURULDU"
yeni, n2 = re.subn(r'(?m)^workers_dev\s*=.*$', 'workers_dev = true', yeni)
assert n2 == 1, f"workers_dev satiri bulunamadi (n={n2})"
yeni, n3 = re.subn(r'(?m)^ORIGIN_COZUM\s*=.*$', f'ORIGIN_COZUM = "{cozum}"', yeni)
assert n3 == 1, f"ORIGIN_COZUM satiri bulunamadi (n={n3})"
assert 'routes' not in yeni, "routes hala var — DURDURULDU"
open(yol, 'w').write(yeni)
print("golge yapilandirma: routes SILINDI, workers_dev=true, ORIGIN_COZUM=%r" % cozum)
PY

# Son sigorta: route sızmışsa deploy etme.
if grep -q 'harita.nickdegs.com/' "$CALIS/wrangler.toml"; then
  echo "HATA: yapilandirmada hala route deseni var — deploy IPTAL"; exit 1
fi

( cd "$CALIS" && wrangler deploy )
if [ -n "${MOVELOG_KEY:-}" ]; then
  ( cd "$CALIS" && printf '%s' "$MOVELOG_KEY" | wrangler secret put MOVELOG_KEY ) >/dev/null
  echo "MOVELOG_KEY secret basildi."
fi

# KV tohumları — wrangler 4'te --remote ŞART (varsayılan YEREL).
wrangler kv key put --remote --namespace-id "$KV_ID" osrm_urls '["https://router.project-osrm.org"]'
wrangler kv key put --remote --namespace-id "$KV_ID" profiller '["driving"]'
wrangler kv key put --remote --namespace-id "$KV_ID" match_ttl_gun '30'
wrangler kv key put --remote --namespace-id "$KV_ID" geocoding_forward '1'
echo "GOLGE deploy tamam (kv=$KV_ID). Route YOK — canli trafik degismedi."
