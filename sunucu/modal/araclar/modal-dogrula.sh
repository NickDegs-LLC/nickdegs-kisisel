#!/bin/bash
# Sır dizini: Mac'te ~/.nickdegs/anahtarlar/movelog-sunucu, yoksa sunucuda /opt/matrix/secrets
SIR_DIZIN="${SIR_DIZIN:-$HOME/.nickdegs/anahtarlar/movelog-sunucu}"; [ -d "$SIR_DIZIN" ] || SIR_DIZIN=/opt/matrix/secrets
# Kullanım: modal-dogrula.sh [taktik|render]  — bayrak çevrildikten sonraki ilk işi D1/KV/R2 izleriyle doğrular (salt-okuma)
set -a; . $SIR_DIZIN/movelog-cf.conf; set +a
A=https://api.cloudflare.com/client/v4/accounts/$MOVELOG_CF_ACCOUNT_ID; H="Authorization: Bearer $MOVELOG_CF_TOKEN"
DB=84d8e0a0-cc9b-45ec-b355-d1cc08a90dd9; KV=fd5db982178f49c589858c525755fba7
d1() { curl -s -X POST "$A/d1/database/$DB/query" -H "$H" -H "Content-Type: application/json" --data "{\"sql\":\"$1\"}" --max-time 30; }
echo "=== bayraklar ==="; for k in dispatch:motor dispatch:motor-tac bulut-kapali; do v=$(curl -s -w "|%{http_code}" -H "$H" "$A/storage/kv/namespaces/$KV/values/$k" --max-time 15); printf "  %-20s %s\n" $k "$([ "${v##*|}" = 404 ] && echo "(yok)" || echo "${v%|*}" | head -c 60)"; done
echo "=== KV dispatch:son ==="; curl -s -H "$H" "$A/storage/kv/namespaces/$KV/values/dispatch:son" --max-time 15 | head -c 300; echo
echo "=== son 3 pending ==="; d1 "SELECT vid, uid, mode, datetime(queued_at,'unixepoch') q FROM pending_videos ORDER BY queued_at DESC LIMIT 3" | python3 "$(dirname "$0")/d1yaz.py"
echo "=== son 3 video ==="; d1 "SELECT rid, uid, datetime(created_at,'unixepoch') t FROM videos ORDER BY created_at DESC LIMIT 3" | python3 "$(dirname "$0")/d1yaz.py"
echo "=== son 3 başarısız ==="; d1 "SELECT vid, mode, substr(reason,1,70) r, datetime(created_at,'unixepoch') t FROM failed_videos ORDER BY created_at DESC LIMIT 3" | python3 "$(dirname "$0")/d1yaz.py"
echo "=== son park/sebep kayıtları ==="; curl -s -H "$H" "$A/storage/kv/namespaces/$KV/keys?prefix=dispatch%3Apark-sebep%3A&limit=10" --max-time 15 | python3 -c "
import sys,json
j=json.load(sys.stdin)
if not j.get('success'): print('   listelenemedi:', [e.get('message') for e in j.get('errors',[])])
else: print('  ', [k['name'] for k in (j.get('result') or [])] or 'yok')"
echo "şimdi: $(date -u +%H:%M:%S) UTC"
