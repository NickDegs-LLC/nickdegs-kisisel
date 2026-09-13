#!/bin/bash
# cf-harita-katman deploy (KARAR.md #3) — ELLE, DEVİRDEN SONRA çalıştırılır.
# ÖN KOŞUL: Barış onayı + dev10 ile route koordinasyonu (hooder-kapi tablosu) + gri-bulut
# DNS kaydı harita-origin.nickdegs.com → sunucu IP (proxy KAPALI). Bkz README.md.
# ⚠️ Gizli önek loga/ekrana YAZILMAZ; wrangler.toml scratch'te üretilir, iş bitince silinir.
set -euo pipefail
BURA="$(cd "$(dirname "$0")" && pwd)"

source /opt/matrix/secrets/harita-uc.conf          # HARITA_UC_ONEK
: "${HARITA_UC_ONEK:?/opt/matrix/secrets/harita-uc.conf icinde HARITA_UC_ONEK yok}"
# K0 §A3 muafiyet sirlari (varsa). MLOG_ONEK bos = muafiyet onegi = capability onegi (onerilen).
# shellcheck disable=SC1091
[ -f /opt/matrix/secrets/movelog-harita-key.conf ] && source /opt/matrix/secrets/movelog-harita-key.conf
MLOG_ONEK="${MLOG_ONEK:-}"                        # elle: MLOG_ONEK=xxx ./deploy.sh
source /usr/local/bin/api-env.sh >/dev/null        # CF_GLOBAL_KEY / CF_EMAIL
export CLOUDFLARE_API_KEY="$CF_GLOBAL_KEY" CLOUDFLARE_EMAIL="$CF_EMAIL"
export CLOUDFLARE_ACCOUNT_ID="45241304800d3e122aced1f0ae599943"

CALIS="$(mktemp -d)"; trap 'rm -rf "$CALIS"' EXIT
cp -r "$BURA/src" "$CALIS/src"

# R2 bucket (varsa hata yutulur)
wrangler r2 bucket create harita-match-cache >/dev/null 2>&1 || true

# KV namespace id: var olanı bul, yoksa oluştur
KV_ID="$(wrangler kv namespace list 2>/dev/null \
  | python3 -c 'import sys,json;print(next((n["id"] for n in json.load(sys.stdin) if n["title"].endswith("HARITA_AYAR")),""))' || true)"
if [ -z "$KV_ID" ]; then
  KV_ID="$(wrangler kv namespace create HARITA_AYAR 2>/dev/null | grep -oE '[0-9a-f]{32}' | head -1)"
fi
: "${KV_ID:?KV namespace olusturulamadi}"

sed -e "s/{ONEK}/$HARITA_UC_ONEK/g" -e "s/{KV_ID}/$KV_ID/" -e "s/{MLOG_ONEK}/$MLOG_ONEK/" \
  "$BURA/wrangler.toml.example" > "$CALIS/wrangler.toml"

# Ayri muafiyet onegi verildiyse ayni iki ucun ikiz route'lari eklenir (K0 §A3).
if [ -n "$MLOG_ONEK" ]; then
  python3 - "$CALIS/wrangler.toml" "$MLOG_ONEK" <<'PY'
import sys
yol, mo = sys.argv[1], sys.argv[2]
s = open(yol).read()
ek = ('  { pattern = "harita.nickdegs.com/%s/matching/*",  zone_name = "nickdegs.com" },\n'
      '  { pattern = "harita.nickdegs.com/%s/styles/*",    zone_name = "nickdegs.com" },\n'
      '  { pattern = "harita.nickdegs.com/%s/geocoding/*", zone_name = "nickdegs.com" },\n'
      # 31.08: uc yeni sunucusuzlastirma ucu de muafiyet oneginden karsilanmali; yoksa
      # MLOG_ONEK acildigi gun /xyz /mvt /yukseklik o onekten 404 doner (sessiz beyaz harita).
      '  { pattern = "harita.nickdegs.com/%s/xyz/*",       zone_name = "nickdegs.com" },\n'
      '  { pattern = "harita.nickdegs.com/%s/mvt/*",       zone_name = "nickdegs.com" },\n'
      '  { pattern = "harita.nickdegs.com/%s/yukseklik*",  zone_name = "nickdegs.com" },\n'
      % (mo, mo, mo, mo, mo, mo))
i = s.index("routes = [") + len("routes = [\n")
open(yol, "w").write(s[:i] + ek + s[i:])
PY
fi

( cd "$CALIS" && wrangler deploy )
# Muafiyet basligi: vars DEGIL secret (loga/panele duz yazilmasin).
if [ -n "${MOVELOG_KEY:-}" ]; then
  ( cd "$CALIS" && printf '%s' "$MOVELOG_KEY" | wrangler secret put MOVELOG_KEY ) >/dev/null
fi

# KV tohumları — wrangler 4'te --remote ŞART (varsayılan YEREL; Hooder tuzak defteri)
wrangler kv key put --remote --namespace-id "$KV_ID" osrm_urls '["https://router.project-osrm.org"]'
wrangler kv key put --remote --namespace-id "$KV_ID" profiller '["driving"]'
wrangler kv key put --remote --namespace-id "$KV_ID" match_ttl_gun '30'
# ── SUNUCUSUZLASTIRMA ANAHTARLARI (31.08). Hepsi KOD VARSAYILANIYLA AYNI deger; acikca
#    yaziliyor ki KV panelinde durum gorunsun ve degistirmek icin dosya aramak gerekmesin.
# statik_mod: motor yan-servisi canliya cikinca '501' yaz (bkz src/statik.js basligi).
wrangler kv key put --remote --namespace-id "$KV_ID" statik_mod 'origin'
# mvt_kaynak (02.09): 'r2' = ortak R2 PMTiles + worker-ici harman (mvt_bina.py portu, bayt bayt
# ayni, test/uyum-harman.mjs) -> sunucusuz. Eski: 'origin-once'. Acil: 'yalniz-hooder'.
wrangler kv key put --remote --namespace-id "$KV_ID" mvt_kaynak 'r2'
wrangler kv key put --remote --namespace-id "$KV_ID" geo_kaynak 'nominatim'
# ANA SALTER: sunucu kalici kapaninca '0' yaz -> hicbir uc origin'e dokunmaz.
wrangler kv key put --remote --namespace-id "$KV_ID" origin_yedek '1'
# ESKI ANAHTAR: geocoding artik worker ICINDE (Nominatim) -> bu anahtar okunmuyor, silinir.
wrangler kv key delete --remote --namespace-id "$KV_ID" geocoding_forward >/dev/null 2>&1 || true
echo "deploy tamam (kv=$KV_ID). Simdi README 'Devir gunu' testlerini kos."
