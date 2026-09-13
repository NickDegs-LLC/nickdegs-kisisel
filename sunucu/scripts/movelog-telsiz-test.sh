#!/bin/bash
# LiveKit UÇTAN UCA test — üretim yolunun tamamı.
#   uygulama JWT'si (JWT_SECRET) → worker ucu (/api/voicecall/token, /api/intercom/:cid/token)
#   → dönen {url, token, room} → LiveKit doğrulaması (/rtc/validate) → aynı odada GERÇEK SES
# Sırlar yalnız dosyadan okunur, ASLA ekrana basılmaz.
set -uo pipefail
S="$(cd "$(dirname "$0")" && pwd)"
# JWT_SECRET yerelde SAKLANMAZ: her çalıştırmada yedek tar'dan geçici dosyaya çıkarılır, çıkışta silinir.
CFG="$(mktemp /dev/shm/.lktestXXXX)"; chmod 600 "$CFG"
trap 'rm -f "$CFG"' EXIT
tar -I zstd -xf /opt/matrix/yedek/movelog-sunucu-20260902.tar.zst -O opt/movelog/backend/config.env 2>/dev/null | grep -E '^JWT_SECRET=' > "$CFG"
[ -s "$CFG" ] || { echo "JWT_SECRET yedekten okunamadi"; exit 1; }
API="${API:-https://kisisel-api.nickdegs.com}"
A_UID="${A_UID:-u69be3f7e960e}"   # alkimbaris
B_UID="${B_UID:-$(bash /opt/matrix/scripts/.lk-d1.sh "SELECT friend_uid AS u FROM friends WHERE uid='u69be3f7e960e' LIMIT 1" | python3 -c 'import sys,json;print(json.load(sys.stdin)[0]["u"])')}"
OK=0; FAIL=0
ok(){ echo "  ✅ $*"; OK=$((OK+1)); }
ko(){ echo "  ❌ $*"; FAIL=$((FAIL+1)); }

appjwt(){ # $1=uid $2=tv → uygulama Bearer token'ı (HS256, {sub,exp,tv})
  CFG="$CFG" python3 - "$1" "$2" <<'PY'
import sys, os, json, time, hmac, hashlib, base64
sec=None
for l in open(os.environ["CFG"]):
    if l.startswith("JWT_SECRET="): sec=l.split("=",1)[1].strip()
b=lambda x: base64.urlsafe_b64encode(x).rstrip(b"=").decode()
h=b(json.dumps({"alg":"HS256","typ":"JWT"},separators=(",",":")).encode())
p=b(json.dumps({"sub":sys.argv[1],"exp":int(time.time())+3600,"tv":int(sys.argv[2])},separators=(",",":")).encode())
print(f"{h}.{p}."+b(hmac.new(sec.encode(),f"{h}.{p}".encode(),hashlib.sha256).digest()))
PY
}

echo "═══ 1) Worker uçları: uygulama token'ı ile GERÇEK çağrı ═══"
TA=$(appjwt "$A_UID" 0)
R=$(curl -s --max-time 20 -H "Authorization: Bearer $TA" "$API/api/voicecall/token?peer=$B_UID")
URL=$(echo "$R" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("url",""))' 2>/dev/null)
TOK=$(echo "$R" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))' 2>/dev/null)
ROOM=$(echo "$R" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("room",""))' 2>/dev/null)
PEER=$(echo "$R" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("peer_name",""))' 2>/dev/null)
[ -n "$URL" ] && ok "/api/voicecall/token 200 → url=$URL room=$ROOM peer=$PEER" \
              || { ko "/api/voicecall/token başarısız: $(echo "$R" | head -c 200)"; }
[ -n "$TOK" ] && ok "LiveKit token üretildi (uzunluk ${#TOK})" || ko "token yok"

echo "═══ 2) LiveKit token'ı GERÇEKTEN kabul ediyor mu (/rtc/validate) ═══"
HOST=$(echo "$URL" | sed -E 's#^wss?://##; s#/.*##')
V=$(curl -s --max-time 20 "https://$HOST/rtc/validate?access_token=$TOK")
[ "$V" = "success" ] && ok "sunucu token'ı kabul etti: '$V'" || ko "doğrulama reddi: $V"

echo "═══ 3) Karşı taraf (davet edilen) da token alabiliyor mu ═══"
TB=$(appjwt "$B_UID" 0)
R2=$(curl -s --max-time 20 -H "Authorization: Bearer $TB" "$API/api/voicecall/token?peer=$A_UID")
ROOM2=$(echo "$R2" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("room",""))' 2>/dev/null)
TOK2=$(echo "$R2" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))' 2>/dev/null)
[ -n "$ROOM2" ] && [ "$ROOM2" = "$ROOM" ] && ok "iki taraf AYNI odayı alıyor ($ROOM)" || ko "oda uyuşmuyor: '$ROOM' vs '$ROOM2'"
V2=$(curl -s --max-time 20 "https://$HOST/rtc/validate?access_token=$TOK2")
[ "$V2" = "success" ] && ok "karşı tarafın token'ı da kabul edildi" || ko "karşı taraf reddi: $V2"

echo "═══ 4) GERÇEK SES: worker'ın verdiği odada 2 yayıncı + 2 abone ═══"
LKC=/opt/matrix/secrets/livekit-cloud.conf
K=$(awk -F= '$1=="LIVEKIT_KEY"{print $2}' "$LKC"); SE=$(awk -F= '$1=="LIVEKIT_SECRET"{sub(/^[^=]*=/,"");print}' "$LKC")
OUT=$(timeout 220 docker run --rm -e LIVEKIT_URL="$URL" -e LIVEKIT_API_KEY="$K" -e LIVEKIT_API_SECRET="$SE" \
  livekit/livekit-cli:latest load-test --room "$ROOM" --audio-publishers 2 --subscribers 2 --duration 12s 2>&1)
echo "$OUT" | grep -E '^\│ Total' | sed 's/^/     /'
TOT=$(echo "$OUT" | grep -E '^\│ Total' | sed -E 's/.*│ *([0-9]+)\/([0-9]+) *│.*/\1 \2/')
ERRS=$(echo "$OUT" | grep -cE 'could not establish|error')
set -- $TOT
if [ "${1:-0}" = "${2:-1}" ] && [ "${1:-0}" != "0" ]; then ok "tüm izler abone oldu ($1/$2), ses aktı"; else ko "iz eksik: ${1:-?}/${2:-?}"; fi
echo "$OUT" | grep -qE '0 \(0%\)' && ok "paket kaybı %0" || ko "paket kaybı var"

echo "═══ 5) Kulüp interkomu: gerçek Ultra üye + gerçek kulüp ═══"
read CID MUID <<<"$(bash /opt/matrix/scripts/.lk-d1.sh "SELECT cm.cid AS cid, cm.uid AS uid FROM club_members cm JOIN users u ON u.uid=cm.uid WHERE u.ultra=1 LIMIT 1" | python3 -c 'import sys,json;r=json.load(sys.stdin)[0];print(r["cid"],r["uid"])' 2>/dev/null)"
if [ -n "${MUID:-}" ]; then
  TM=$(appjwt "$MUID" 0)
  RI=$(curl -s --max-time 25 -H "Authorization: Bearer $TM" "$API/api/intercom/$CID/token")
  IU=$(echo "$RI" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("url",""))' 2>/dev/null)
  IT=$(echo "$RI" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))' 2>/dev/null)
  IR=$(echo "$RI" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("room",""))' 2>/dev/null)
  [ "$IU" = "$URL" ] && ok "interkom da aynı adresi veriyor ($IU), oda=$IR" || ko "interkom url='$IU'"
  IV=$(curl -s --max-time 25 "https://$HOST/rtc/validate?access_token=$IT")
  [ "$IV" = "success" ] && ok "interkom token'ı kabul edildi" || ko "interkom token reddi: $IV"
  IO=$(timeout 220 docker run --rm -e LIVEKIT_URL="$IU" -e LIVEKIT_API_KEY="$K" -e LIVEKIT_API_SECRET="$SE" \
    livekit/livekit-cli:latest load-test --room "$IR" --audio-publishers 3 --subscribers 3 --duration 10s 2>&1)
  echo "$IO" | grep -a "Total" | tail -1 | sed 's/^/     /'
  echo "$IO" | grep -a "Total" | tail -1 | grep -q "9/9" && ok "kulüp odasında ses aktı (9/9)" || ko "kulüp sesi akmadı"
  # Ultra OLMAYAN biri 402 almalı (kapı hâlâ duruyor mu)
  NU=$(bash /opt/matrix/scripts/.lk-d1.sh "SELECT uid AS u FROM users WHERE COALESCE(ultra,0)=0 LIMIT 1" | python3 -c 'import sys,json;print(json.load(sys.stdin)[0]["u"])' 2>/dev/null)
  if [ -n "$NU" ]; then
    KOD=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -H "Authorization: Bearer $(appjwt "$NU" 0)" "$API/api/intercom/$CID/token")
    [ "$KOD" = "402" ] && ok "Ultra olmayan 402 alıyor — kapı sağlam" || ko "Ultra kapısı: $KOD (402 bekleniyordu)"
  fi
else ko "D1'de Ultra kulüp üyesi bulunamadı"; fi

echo
echo "═══ SONUÇ: $OK geçti, $FAIL kaldı ═══"
[ "$FAIL" = 0 ]
