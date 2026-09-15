#!/bin/bash
# cf-harita-katman deploy — GitHub Actions (.github/workflows/cf-deploy.yml) ya da Mac'ten elle.
# 15.09 SUNUCU BAĞIMSIZ: sırlar ENV'den; Mac'te env boşsa ~/.nickdegs/anahtarlar/movelog-sunucu/*.conf okunur.
#   HARITA_UC_ONEK (zorunlu)  · CLOUDFLARE_API_TOKEN (zorunlu; Mac'te MOVELOG_CF_TOKEN) · CLOUDFLARE_ACCOUNT_ID
#   HARITA_KV_ID  (HARITA_AYAR; verilmezse başlığından bulunur, YOKSA HATA — yeni namespace AÇILMAZ)
#   MOVELOG_KEY   (isteğe bağlı muafiyet sırrı) · MLOG_ONEK (isteğe bağlı ayrı muafiyet öneki)
# KV anahtarları YALNIZ YOKSA tohumlanır → canlı şalterler (origin_yedek=0, statik_mod=501) dağıtımda EZİLMEZ.
# ⚠️ Gizli önek loga/ekrana YAZILMAZ; wrangler.toml geçici dizinde üretilir, iş bitince silinir.
set -euo pipefail
BURA="$(cd "$(dirname "$0")" && pwd)"
SIR="${SIR_DIZIN:-$HOME/.nickdegs/anahtarlar/movelog-sunucu}"
yukle() { if [ -f "$SIR/$1" ]; then set -a; . "$SIR/$1"; set +a; fi; }
[ -n "${HARITA_UC_ONEK:-}" ] || yukle harita-uc.conf
[ -n "${MOVELOG_KEY:-}" ] || yukle movelog-harita-key.conf
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then yukle movelog-cf.conf; CLOUDFLARE_API_TOKEN="${MOVELOG_CF_TOKEN:-}"; fi
: "${HARITA_UC_ONEK:?HARITA_UC_ONEK yok (env ya da harita-uc.conf)}"
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN yok}"
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-45241304800d3e122aced1f0ae599943}"
export WRANGLER_SEND_METRICS=false
MLOG_ONEK="${MLOG_ONEK:-}"
wr() { npx --yes wrangler@4 "$@"; }

CALIS="$(mktemp -d)"; trap 'rm -rf "$CALIS"' EXIT
cp -r "$BURA/src" "$CALIS/src"

KV_ID="${HARITA_KV_ID:-}"
if [ -z "$KV_ID" ]; then
  KV_ID="$(wr kv namespace list 2>/dev/null \
    | python3 -c 'import sys,json;print(next((n["id"] for n in json.load(sys.stdin) if n["title"].endswith("HARITA_AYAR")),""))' || true)"
fi
: "${KV_ID:?HARITA_AYAR KV namespace bulunamadi (yeni ACILMAZ - HARITA_KV_ID ver)}"

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

( cd "$CALIS" && wr deploy )
# Muafiyet basligi: vars DEGIL secret (loga/panele duz yazilmasin).
if [ -n "${MOVELOG_KEY:-}" ]; then
  ( cd "$CALIS" && printf '%s' "$MOVELOG_KEY" | wr secret put MOVELOG_KEY ) >/dev/null
fi

# KV tohumlari — YALNIZ anahtar YOKSA yazilir (wrangler 4'te --remote SART; varsayilan YEREL).
# Liste okunamazsa tohum yine sunucusuz varsayilanlari yazar (canliyla ayni degerler).
MEVCUT="$(wr kv key list --remote --namespace-id "$KV_ID" 2>/dev/null \
  | python3 -c 'import sys,json;print(" ".join(k["name"] for k in json.load(sys.stdin)))' 2>/dev/null || true)"
tohum() {
  case " $MEVCUT " in
    *" $1 "*) echo "kv $1: mevcut (dokunulmadi)" ;;
    *) wr kv key put --remote --namespace-id "$KV_ID" "$1" "$2" >/dev/null && echo "kv $1: tohumlandi" ;;
  esac
}
tohum osrm_urls '["https://router.project-osrm.org"]'
tohum profiller '["driving"]'
tohum match_ttl_gun '30'
tohum statik_mod '501'        # 15.09: statik dikis motor yan-servisinde (bkz src/statik.js)
tohum mvt_kaynak 'r2'         # ortak R2 PMTiles + worker-ici harman
tohum geo_kaynak 'nominatim'
tohum origin_yedek '0'        # 15.09 ANA SALTER: sunucu yedegi KAPALI (sunucu bagimsiz)
echo "deploy tamam."
