#!/bin/bash
# kesim-ortak.sh — kesim.sh · geri-donus.sh · kesim-onkontrol.sh ORTAK çekirdeği.
# SALT KÜTÜPHANE: kendi başına hiçbir şey yapmaz, `source` edilir.
# ⚠️ Hiçbir fonksiyon SIR (önek/anahtar/token) BASMAZ. Değer yerine "VAR/YOK" yazılır.

set -uo pipefail

# ── sabitler (hepsi 2026-08-31'de ÖLÇÜLDÜ, tahmin yok) ───────────────────────
CF_ZONE_ID="35a3f18cd979cfd3241765c7a698e120"          # nickdegs.com
CF_ACCOUNT_ID="45241304800d3e122aced1f0ae599943"
SUNUCU_IP="169.58.124.139"
D1_DB="movelog-db"
D1_ID="84d8e0a0-cc9b-45ec-b355-d1cc08a90dd9"
KV_ID="fd5db982178f49c589858c525755fba7"
R2_BUCKET="movelog"
RP_EP_RENDER="q9tw33kjmqx35a"                          # movelog-render  (wmax 12, imaj v140)
RP_EP_TAC="yvkajd6x7mp1lj"                             # movelog-tactical (wmax 3,  imaj v2)
RP_TPL_RENDER="aztc1lxmro"
RP_TPL_TAC="egptl6t4pr"
WMAX_RENDER=12
WMAX_TAC=3
CF_DIR="/opt/matrix/cf"
KAYIT="/opt/matrix/docs/devir-gunu-kayit.txt"
SOSYAL="/opt/movelog/data/social.json"

# workers.dev gölge adresleri (route çevrilmeden ÖNCE tek erişim yolu)
WD_API="https://movelog-api.daclen10.workers.dev"
WD_GPS="https://movelog-gps.daclen10.workers.dev"
WD_DISPATCH="https://movelog-dispatch.daclen10.workers.dev"
WD_CRON="https://movelog-cron.daclen10.workers.dev"
WD_HARITA="https://harita-katman.daclen10.workers.dev"

# ── renkler / işaretler ──────────────────────────────────────────────────────
if [ -t 1 ]; then Y=$'\e[32m'; K=$'\e[31m'; S=$'\e[33m'; M=$'\e[36m'; B=$'\e[1m'; N=$'\e[0m'
else Y=""; K=""; S=""; M=""; B=""; N=""; fi
ok()   { echo "${Y}  ✓${N} $*"; }
kir()  { echo "${K}  ✗${N} $*"; KIRIK=$((KIRIK+1)); KIRIK_LISTE+=("$*"); }
uya()  { echo "${S}  !${N} $*"; UYARI=$((UYARI+1)); }
bil()  { echo "${M}  ·${N} $*"; }
bas()  { echo; echo "${B}$*${N}"; }
KIRIK=0; UYARI=0; KIRIK_LISTE=()

# ── kimlikler ────────────────────────────────────────────────────────────────
# CF global key (deploy.sh ile AYNI yöntem — zone/DNS/route API'si bunu ister)
cf_kimlik() {
  # shellcheck disable=SC1091
  source /usr/local/bin/api-env.sh >/dev/null 2>&1 || true
  [ -n "${CF_GLOBAL_KEY:-}" ] && [ -n "${CF_EMAIL:-}" ]
}
# wrangler oturumu (worker deploy / D1 / KV) — token tabanlı
wr_kimlik() {
  # shellcheck disable=SC1091
  source /opt/matrix/secrets/movelog-cf.conf >/dev/null 2>&1 || true
  export CLOUDFLARE_API_TOKEN="${MOVELOG_CF_TOKEN:-}"
  export CLOUDFLARE_ACCOUNT_ID="${MOVELOG_CF_ACCOUNT_ID:-$CF_ACCOUNT_ID}"
  [ -n "$CLOUDFLARE_API_TOKEN" ]
}
rp_kimlik() {
  # shellcheck disable=SC1091
  source /opt/matrix/secrets/runpod.conf >/dev/null 2>&1 || true
  [ -n "${RUNPOD_API_KEY:-}" ]
}

cfapi() {  # cfapi <METOD> <yol> [gövde]
  local m="$1" yol="$2" gov="${3:-}"
  if [ -n "$gov" ]; then
    curl -s -m 30 -X "$m" "https://api.cloudflare.com/client/v4$yol" \
      -H "X-Auth-Email: $CF_EMAIL" -H "X-Auth-Key: $CF_GLOBAL_KEY" \
      -H "content-type: application/json" --data "$gov"
  else
    curl -s -m 30 -X "$m" "https://api.cloudflare.com/client/v4$yol" \
      -H "X-Auth-Email: $CF_EMAIL" -H "X-Auth-Key: $CF_GLOBAL_KEY"
  fi
}
rpapi() {  # rpapi <METOD> <yol> [gövde]   → rest.runpod.io/v1
  local m="$1" yol="$2" gov="${3:-}"
  if [ -n "$gov" ]; then
    curl -s -m 30 -X "$m" "https://rest.runpod.io/v1$yol" \
      -H "authorization: Bearer $RUNPOD_API_KEY" -H "content-type: application/json" --data "$gov"
  else
    curl -s -m 30 -X "$m" "https://rest.runpod.io/v1$yol" -H "authorization: Bearer $RUNPOD_API_KEY"
  fi
}

jq_al() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval('d$1'))" 2>/dev/null; }

kayit() {  # kayit "<satır>"  — devir-gunu-kayit.txt'ye TEK satır (SIR YAZILMAZ)
  mkdir -p "$(dirname "$KAYIT")"
  echo "$(date -Is) $*" >> "$KAYIT"
}

onay() {  # onay "<ne yapılacak>"  → ENTER bekler; --adim ile tek adım koşarken de sorar
  echo
  echo "${B}${S}⚠️  ONAY GEREKİYOR${N}"
  echo "    $1"
  echo -n "    Devam için ENTER, iptal için Ctrl-C: "
  read -r _ || { echo; echo "iptal"; exit 130; }
}

# DNS kaydını bul: dns_kayit <ad> → "id proxied content"
dns_kayit() {
  cfapi GET "/zones/$CF_ZONE_ID/dns_records?name=$1" | python3 -c "
import sys,json
d=json.load(sys.stdin); r=d.get('result') or []
print(' '.join([r[0]['id'], str(r[0]['proxied']), r[0]['content']]) if r else '')
" 2>/dev/null
}

# Zone'daki tüm worker route'ları: "id|pattern|script" satırları
route_listesi() {
  cfapi GET "/zones/$CF_ZONE_ID/workers/routes" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for r in (d.get('result') or []):
    print('%s|%s|%s' % (r['id'], r['pattern'], r.get('script') or '(YOK)'))
" 2>/dev/null
}
