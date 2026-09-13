#!/bin/bash
# kesim-onkontrol.sh — KESİMDEN HEMEN ÖNCE koşar. TAMAMEN SALT-OKUMA.
#
# Hiçbir şeyi değiştirmez: route yazmaz, DNS'e dokunmaz, servis durdurmaz,
# RunPod'a PATCH atmaz, gerçek render işi göndermez, ORTAM'ı değiştirmez.
#
# Kullanım:
#   ./kesim-onkontrol.sh                 # tam tarama (muafiyet HAFİF sonda: 5 karo)
#   ./kesim-onkontrol.sh --tam-muafiyet  # muafiyet için 300 karoluk seri (⚠️ Hooder zone'una yük)
#   ./kesim-onkontrol.sh --hizli         # RunPod + D1 + R2 atlanır (yalnız /health + route + DNS)
#
# Çıktı: her başlık altında ✓ / ✗ / ! ; sonda "KESİME HAZIR" ya da kırık maddelerin listesi.
# Çıkış kodu: 0 = hazır · 1 = kırık madde var · 2 = kimlik/araç eksik.
BURA="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$BURA/kesim-ortak.sh"

TAM_MUAFIYET=0; HIZLI=0
for a in "$@"; do
  case "$a" in
    --tam-muafiyet) TAM_MUAFIYET=1 ;;
    --hizli) HIZLI=1 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
  esac
done

echo "${B}KESİM ÖN KONTROL${N} — $(date -Is)"
echo "salt-okuma · hiçbir canlı yönlendirme/servis/RunPod durumu DEĞİŞTİRİLMEZ"

# ─────────────────────────────────────────────────────────────────────────────
bas "1) DÖRT WORKER /health (gölge workers.dev)"
saglik() { # saglik <ad> <url> <beklenen-anahtar>
  local ad="$1" url="$2" bek="$3" kod govde
  kod=$(curl -s -m 15 -o /tmp/.onk.$$ -w '%{http_code}' "$url/health" 2>/dev/null)
  govde=$(head -c 200 /tmp/.onk.$$ 2>/dev/null); rm -f /tmp/.onk.$$
  if [ "$kod" = "200" ] && echo "$govde" | grep -q "$bek"; then
    ok "$ad → 200 · $(echo "$govde" | head -c 110)"
  else
    kir "$ad → HTTP $kod · gövde: $(echo "$govde" | head -c 110)"
  fi
}
saglik "movelog-api     " "$WD_API"      '"ok":true'
saglik "movelog-gps     " "$WD_GPS"      '"worker":"movelog-gps"'
saglik "movelog-dispatch" "$WD_DISPATCH" '"worker":"movelog-dispatch"'
saglik "movelog-cron    " "$WD_CRON"     '"worker":"movelog-cron"'
kod=$(curl -s -m 15 -o /dev/null -w '%{http_code}' "$WD_HARITA/saglik" 2>/dev/null)
[ "$kod" = "200" ] && ok "harita-katman   → /saglik 200 (gölge deploy YAPILMIŞ)" \
                   || uya "harita-katman   → /saglik HTTP $kod (deploy edilmemiş olabilir — D adımı)"

# ─────────────────────────────────────────────────────────────────────────────
bas "2) ORTAM bayrağı (kesim öncesi HEPSİ 'golge' olmalı)"
for w in api gps dispatch cron; do
  v=$(grep -oE '^ORTAM *= *"[a-z]+"' "$CF_DIR/$w/wrangler.toml" 2>/dev/null | grep -oE '"[a-z]+"' | tr -d '"')
  if [ "$v" = "golge" ]; then ok "movelog-$w wrangler.toml ORTAM=golge"
  elif [ "$v" = "canli" ]; then uya "movelog-$w ORTAM=canli (kesim ZATEN yapılmış olabilir)"
  else kir "movelog-$w ORTAM okunamadı (wrangler.toml)"; fi
done
c=$(curl -s -m 15 "$WD_CRON/health" | grep -oE '"ortam":"[a-z]+"' | cut -d'"' -f4)
[ -n "$c" ] && bil "canlı cron worker ORTAM='$c' (dağıtılmış değer)"

# ─────────────────────────────────────────────────────────────────────────────
bas "3) CANLI YÖNLENDİRME DURUMU (kesim öncesi TEMİZ olmalı)"
if cf_kimlik; then
  rl="$(route_listesi)"
  n=$(echo "$rl" | grep -c . )
  if [ -z "$rl" ]; then ok "zone worker route sayısı = 0 (hiçbir canlı trafik yeni tarafta)"
  else uya "zone'da $n route VAR:"; echo "$rl" | sed 's/^/       /'; fi

  for h in gpsdata.nickdegs.com kisisel-api.nickdegs.com harita.nickdegs.com; do
    r="$(dns_kayit "$h")"
    if [ -z "$r" ]; then kir "$h DNS kaydı YOK"; continue; fi
    set -- $r; kid="$1"; prox="$2"; icerik="$3"
    if [ "$h" = "harita.nickdegs.com" ]; then
      [ "$prox" = "True" ] && ok "$h proxied=True (route bağlanabilir)" \
                           || kir "$h proxied=False — Worker route'u ÇALIŞMAZ"
    else
      if [ "$prox" = "False" ]; then
        uya "$h proxied=${K}False${N} → $icerik ${S}(ROUTE İÇİN TURUNCU BULUT ŞART — kesim.sh adım 1/2 bunu ister)${N}"
      else
        ok "$h proxied=True → $icerik"
      fi
    fi
  done
  r="$(dns_kayit harita-origin.nickdegs.com)"
  [ -n "$r" ] && ok "harita-origin.nickdegs.com VAR ($r)" \
              || uya "harita-origin.nickdegs.com YOK — harita statik forward'ı için gri-bulut kaydı gerekli (checklist D1)"
else
  kir "CF kimliği yüklenemedi (api-env.sh → CF_GLOBAL_KEY/CF_EMAIL) — route/DNS kontrolü YAPILAMADI"
fi

# ─────────────────────────────────────────────────────────────────────────────
bas "4) D1 sayımları ↔ social.json"
if [ "$HIZLI" = "1" ]; then bil "atlandı (--hizli)"
elif ! wr_kimlik; then kir "wrangler kimliği yok (/opt/matrix/secrets/movelog-cf.conf → MOVELOG_CF_TOKEN)"
else
  SJ=$(python3 - <<'PY' 2>/dev/null
import json
d = json.load(open('/opt/movelog/data/social.json'))
print(len(d.get('profiles', {})), len(d.get('detected_rides', {})), len(d.get('clubs', {})),
      sum(len(v) for v in d.get('dm', {}).values()),
      sum(len(v) for v in d.get('friends', {}).values()), len(d.get('invites', {})))
PY
)
  D1=$(cd "$CF_DIR" && timeout 120 npx wrangler d1 execute "$D1_DB" --remote --json --command \
    "SELECT (SELECT COUNT(*) FROM users) a,(SELECT COUNT(*) FROM rides) b,(SELECT COUNT(*) FROM clubs) c,(SELECT COUNT(*) FROM dm_messages) d,(SELECT COUNT(*) FROM friends) e,(SELECT COUNT(*) FROM invites) f" 2>/dev/null \
    | python3 -c "import sys,json;r=json.load(sys.stdin)[0]['results'][0];print(r['a'],r['b'],r['c'],r['d'],r['e'],r['f'])" 2>/dev/null)
  if [ -z "$SJ" ] || [ -z "$D1" ]; then kir "sayım alınamadı (social.json='$SJ' d1='$D1')"
  else
    set -- $SJ; s1=$1 s2=$2 s3=$3 s4=$4 s5=$5 s6=$6
    set -- $D1; d1=$1 d2=$2 d3=$3 d4=$4 d5=$5 d6=$6
    kar() { if [ "$2" = "$3" ]; then ok "$1: D1=$3 ↔ social.json=$2"; else kir "$1: D1=$3 ≠ social.json=$2"; fi; }
    kar "users   " "$s1" "$d1"; kar "rides   " "$s2" "$d2"; kar "clubs   " "$s3" "$d3"
    kar "dm_msg  " "$s4" "$d4"; kar "friends " "$s5" "$d5"; kar "invites " "$s6" "$d6"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
bas "5) R2 varlıkları (bucket movelog)"
if [ "$HIZLI" = "1" ]; then bil "atlandı (--hizli)"
else
# python SADECE ölçer; ✓/✗ kararını ve renklendirmeyi bash verir (SONUC:/BILGI: satırları)
R2CIK=$(python3 - <<'PY'
import re, sys, collections
try:
    import boto3
    from botocore.config import Config
except Exception as e:
    print("SONUC:KIRIK:boto3 yok: %s" % e); sys.exit(0)
conf = {}
for yol in ('/opt/matrix/secrets/movelog-r2.conf', '/opt/matrix/secrets/r2.conf'):
    try:
        for s in open(yol):
            m = re.match(r'^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*"?([^"\n#]+)"?', s)
            if m: conf.setdefault(m.group(1), m.group(2).strip())
    except FileNotFoundError: pass
ak = conf.get('R2_ACCESS_KEY_ID'); sk = conf.get('R2_SECRET_ACCESS_KEY')
if not ak or not sk:
    print("SONUC:KIRIK:R2 kimliği bulunamadı (movelog-r2.conf)"); sys.exit(0)
s3 = boto3.client('s3', endpoint_url='https://45241304800d3e122aced1f0ae599943.r2.cloudflarestorage.com',
                  aws_access_key_id=ak, aws_secret_access_key=sk, region_name='auto',
                  config=Config(signature_version='s3v4', retries={'max_attempts': 2}))
c = collections.Counter(); n = 0; b = 0; tok = None
try:
    while True:
        kw = dict(Bucket='movelog', MaxKeys=1000)
        if tok: kw['ContinuationToken'] = tok
        r = s3.list_objects_v2(**kw)
        for o in r.get('Contents', []):
            n += 1; b += o['Size']; c[o['Key'].split('/')[0] if '/' in o['Key'] else '(kok)'] += 1
        if not r.get('IsTruncated'): break
        tok = r.get('NextContinuationToken')
except Exception as e:
    print("SONUC:KIRIK:R2 listelenemedi: %s" % str(e)[:100]); sys.exit(0)
# TEMEL ÇİZGİ 2026-08-31: 68 nesne / 1891 MB (videos/ R2 lifecycle 1 gün → ±birkaç nesne normal)
mesaj = "R2 movelog: %d nesne · %.0f MB (temel çizgi 31.08: 68 / 1891 MB)" % (n, b / 1048576)
print(("SONUC:OK:" if n >= 60 else "SONUC:KIRIK:") + mesaj)
print("BILGI:" + " · ".join("%s=%d" % kv for kv in c.most_common(8)))
PY
)
while IFS= read -r s; do
  case "$s" in
    SONUC:OK:*)    ok "${s#SONUC:OK:}" ;;
    SONUC:KIRIK:*) kir "${s#SONUC:KIRIK:}" ;;
    BILGI:*)       echo "       ${s#BILGI:}" ;;
    *) [ -n "$s" ] && echo "       $s" ;;
  esac
done <<< "$R2CIK"
fi

# ─────────────────────────────────────────────────────────────────────────────
bas "6) RunPod: bakiye · workersMax · imaj sürümü · /health"
if [ "$HIZLI" = "1" ]; then bil "atlandı (--hizli)"
elif ! rp_kimlik; then kir "RUNPOD_API_KEY yok (/opt/matrix/secrets/runpod.conf)"
else
  bak=$(curl -s -m 25 -X POST -H 'content-type: application/json' -H 'user-agent: movelog-onkontrol/1.0' \
        -d '{"query":"query { myself { clientBalance } }"}' \
        "https://api.runpod.io/graphql?api_key=$RUNPOD_API_KEY" \
        | python3 -c "import sys,json;print(json.load(sys.stdin).get('data',{}).get('myself',{}).get('clientBalance') or 0)" 2>/dev/null)
  if [ -z "$bak" ]; then kir "bakiye okunamadı (GraphQL — User-Agent şart)"
  else
    yeter=$(python3 -c "print(1 if float('$bak')>=2.0 else 0)" 2>/dev/null)
    [ "$yeter" = "1" ] && ok "bakiye \$$(printf '%.2f' "$bak") (eşik \$2.00)" \
                       || kir "bakiye \$$(printf '%.2f' "$bak") — \$2.00 eşiğinin ALTINDA"
  fi
  ep_kontrol() { # ep_kontrol <ad> <id> <beklenen-wmax> <tpl> <beklenen-imaj>
    local ad="$1" id="$2" bw="$3" tpl="$4" bi="$5" j w t
    j=$(rpapi GET "/endpoints/$id")
    w=$(echo "$j" | python3 -c "import sys,json;print(json.load(sys.stdin).get('workersMax','?'))" 2>/dev/null)
    t=$(echo "$j" | python3 -c "import sys,json;print(json.load(sys.stdin).get('templateId','?'))" 2>/dev/null)
    if [ "$w" = "$bw" ]; then ok "$ad workersMax=$w (beklenen $bw)"
    elif [ "$w" = "0" ]; then kir "$ad workersMax=0 → SESSİZ ARIZA (/run 409; runpod-saglik bekçisi onarır)"
    else uya "$ad workersMax=$w (beklenen $bw)"; fi
    [ "$t" = "$tpl" ] || uya "$ad templateId=$t (beklenen $tpl)"
    local im; im=$(rpapi GET "/templates/$tpl" | python3 -c "import sys,json;print(json.load(sys.stdin).get('imageName','?'))" 2>/dev/null)
    [ "$im" = "$bi" ] && ok "$ad imaj = $im" || kir "$ad imaj = $im (beklenen $bi)"
    local h; h=$(curl -s -m 20 -o /dev/null -w '%{http_code}' -H "authorization: Bearer $RUNPOD_API_KEY" \
                 "https://api.runpod.ai/v2/$id/health")
    [ "$h" = "200" ] && ok "$ad /health 200" || kir "$ad /health $h (402 = bakiye bitti)"
  }
  # 2026-08-31 GÖREV B: statik mozaik sidecar'ı imaja girdi -> v140→v141, v4→v5.
  ep_kontrol "movelog-render  " "$RP_EP_RENDER" "$WMAX_RENDER" "$RP_TPL_RENDER" "ghcr.io/nickdegs/movelog-render:v141"
  ep_kontrol "movelog-tactical" "$RP_EP_TAC"    "$WMAX_TAC"    "$RP_TPL_TAC"    "ghcr.io/nickdegs/movelog-tactical:v5"
  # dispatch worker'ın gördüğü taktik id'si aynı mı
  wid=$(grep -oE 'RUNPOD_ENDPOINT_TAC *= *"[a-z0-9]+"' "$CF_DIR/dispatch/wrangler.toml" | grep -oE '"[a-z0-9]+"' | tr -d '"')
  [ "$wid" = "$RP_EP_TAC" ] && ok "dispatch wrangler.toml RUNPOD_ENDPOINT_TAC = $RP_EP_TAC" \
                            || kir "dispatch RUNPOD_ENDPOINT_TAC='$wid' ≠ $RP_EP_TAC"
fi

# ─────────────────────────────────────────────────────────────────────────────
bas "7) Gölge GET-diff son skoru"
son=$(ls -t "$CF_DIR"/tools/diff-rapor-*.md 2>/dev/null | head -1)
if [ -z "$son" ]; then kir "diff raporu bulunamadı ($CF_DIR/tools/diff-rapor-*.md)"
else
  esit=$(grep -oE '^\| EŞİT \| [0-9]+' "$son" | grep -oE '[0-9]+$')
  bfark=$(grep -oE '^\| BİLİNEN-FARK \| [0-9]+' "$son" | grep -oE '[0-9]+$')
  farkli=$(grep -oE '^\| FARKLI \| [0-9]+' "$son" | grep -oE '[0-9]+$')
  bil "rapor: $(basename "$son") ($(date -r "$son" -Is))"
  if [ "${farkli:-0}" != "0" ] && [ -n "${farkli:-}" ]; then
    kir "GET paritesi: EŞİT=${esit:-?} · BİLİNEN-FARK=${bfark:-0} · ${K}FARKLI=${farkli}${N} → açıklanmamış fark var"
  elif [ "${esit:-0}" -ge 35 ] 2>/dev/null; then
    ok "GET paritesi: EŞİT=${esit} · BİLİNEN-FARK=${bfark:-0} · FARKLI=0 (temel çizgi 35/38)"
  else
    kir "GET paritesi düşük: EŞİT=${esit:-?} (beklenen ≥35)"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
bas "8) HOODER MUAFİYETİ (K0 §A3 · checklist B3/R3)"
# shellcheck disable=SC1091
source /opt/matrix/secrets/harita-uc.conf 2>/dev/null || true
if [ -z "${HARITA_UC_ONEK:-}" ]; then
  kir "HARITA_UC_ONEK yok (/opt/matrix/secrets/harita-uc.conf) — muafiyet ölçülemez"
else
  ok "gizli önek yüklendi (${#HARITA_UC_ONEK} karakter — DEĞER BASILMAZ)"
    # cb: CF onbellegi ESKI basliklari HIT ile dondurup yanlis negatif veriyordu (31.08 olculdu)
    H=$(curl -s -m 20 -o /dev/null -D - "https://harita.nickdegs.com/$HARITA_UC_ONEK/xyz/sat/14/9600/6100.jpg?cb=$$" 2>/dev/null | tr -d '\r')
  kod=$(echo "$H" | grep -oE '^HTTP/[0-9.]+ [0-9]+' | grep -oE '[0-9]+$' | head -1)
  acao=$(echo "$H" | grep -ci '^access-control-allow-origin:')
  corp=$(echo "$H" | grep -ci '^cross-origin-resource-policy:')
  [ "$kod" = "200" ] && ok "önekli /xyz → 200" || kir "önekli /xyz → HTTP $kod"
  if [ "$acao" -ge 1 ] && [ "$corp" -ge 1 ]; then
    ok "R3: önekli /xyz ACAO + CORP VAR (tarayıcı tüketicileri güvende)"
  else
    kir "R3 EKSİK: önekli /xyz ACAO=$acao CORP=$corp → ${K}video BEMBEYAZ çıkar${N} (checklist F1/T3, EK-2)"
  fi
  if [ "$TAM_MUAFIYET" = "1" ]; then
    echo "     300 karoluk seri koşuluyor (bot imzası taklidi)…"
    kotu=0
    for i in $(seq 1 300); do
      c=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "https://harita.nickdegs.com/$HARITA_UC_ONEK/xyz/sat/14/$((9600+i))/6160.jpg")
      case "$c" in 403|429) kotu=$((kotu+1)); echo "       istek $i → $c" ;; esac
    done
    [ "$kotu" = "0" ] && ok "300/300 istek temiz (403/429 YOK) → muafiyet ÖLÇÜLDÜ" \
                      || kir "300 istekte $kotu adet 403/429 → ${K}MUAFİYET EKSİK, harita route'u ÇEVRİLMEZ${N}"
  else
    kotu=0
    for i in 1 2 3 4 5; do
      c=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "https://harita.nickdegs.com/$HARITA_UC_ONEK/xyz/sat/14/$((9600+i))/6160.jpg")
      case "$c" in 403|429) kotu=$((kotu+1)) ;; esac
    done
    [ "$kotu" = "0" ] && bil "hafif seri 5/5 temiz — ${S}gerçek sınav 300'lük seri: --tam-muafiyet${N}" \
                      || kir "hafif seride bile $kotu adet 403/429 → muafiyet YOK"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
bas "9) 🔴 KESİMİ DURDURAN YAPISAL BOŞLUKLAR (ölçüldü 31.08)"

# 9a — push tüketicisi
tuketici=$(grep -rl "push:bekleyen" "$CF_DIR/cron/src/gorevler/" 2>/dev/null \
           | xargs grep -l "pushGonder\|api.runpod\|api.push.apple.com\|fcm.googleapis" 2>/dev/null | wc -l)
cagri=$(grep -rn "pushGonder" "$CF_DIR"/api/src "$CF_DIR"/cron/src --include=*.ts 2>/dev/null \
        | grep -v "lib/push.ts" | wc -l)
if [ "$tuketici" -ge 1 ] || [ "$cagri" -ge 1 ]; then
  ok "push:bekleyen tüketicisi VAR (çağrı sayısı=$cagri)"
else
  kir "${K}push:bekleyen kuyruğunun TÜKETİCİSİ YOK${N} — api/src/lib/push.ts:178 pushGonder() hiçbir yerden çağrılmıyor;"
  echo "       25 cron görevinin hiçbiri bu öneki boşaltmıyor (broadcast.ts:4 'Faz 3 tüketicisi gönderecek')."
  echo "       ORTAM=canli olursa: PTT sessiz push'u · arkadaşlık · video-hazır · haftalık recap"
  echo "       KV'de birikir ve 7 gün TTL ile SESSİZCE ÖLÜR. Kullanıcı hiçbir bildirim almaz."
fi
if wr_kimlik; then
  for p in push:bekleyen: bildirim:bekleyen: dispatch:bekleyen: render:kuyruk:; do
    n=$(cd "$CF_DIR" && timeout 60 npx wrangler kv key list --namespace-id "$KV_ID" --remote --prefix "$p" 2>/dev/null \
        | python3 -c "import sys,json;print(len(json.load(sys.stdin)))" 2>/dev/null)
    bil "KV '$p*' → ${n:-?} kayıt"
  done
fi

# 9b — /api/motor3d (kisisel-api route'u bunu YUTAR)
if grep -q "location = /api/motor3d" /etc/nginx/sites-available/cf-kisisel-api 2>/dev/null; then
  if grep -rq "motor3d" "$CF_DIR/api/src" 2>/dev/null; then
    ok "/api/motor3d worker'da karşılanıyor"
  else
    bugun=$(grep -c "motor3d" /var/log/nginx/access.log 2>/dev/null); bugun=${bugun:-0}
    dun=$(grep -c "motor3d" /var/log/nginx/access.log.1 2>/dev/null); dun=${dun:-0}
    if [ "$((bugun+dun))" = "0" ]; then
      uya "/api/motor3d nginx'te harita-proxy'ye gidiyor, worker'da YOK — ama trafik 0 (bugün $bugun, dün $dun). kisisel-api/api/* route'u bunu 404 yapar."
    else
      kir "/api/motor3d worker'da YOK ve CANLI trafiği var (bugün $bugun, dün $dun) → telefon 3B motoru kırılır"
    fi
  fi
fi
# 9c — Faz-2'de kalan yerel harita yolları (kisisel-api route'u geniş olursa ölür)
for y in "/harita/" "/vektor/"; do
  n=$(grep -c " $y" /var/log/nginx/access.log 2>/dev/null); n=${n:-0}
  bil "kisisel-api $y (harita-proxy'ye yerel) — bugünkü istek: $n · route DAR tutulmalı (/api/*, /auth/*, /health)"
done
# 9d — harita-proxy kesimde DURDURULAMAZ (harita-katman'ın origin'i)
if systemctl is-active --quiet harita-proxy; then
  ok "harita-proxy çalışıyor — ${S}kesimde DURDURULMAZ${N} (harita-katman statik/geocoding forward'ının origin'i + Faz-2 app karoları)"
else
  kir "harita-proxy ÇALIŞMIYOR — harita katmanının forward hedefi yok"
fi

# ─────────────────────────────────────────────────────────────────────────────
bas "10) Sunucu tarafı: durdurulacak birimler yerinde mi"
docker ps --format '{{.Names}}' 2>/dev/null | grep -qx movelog-api \
  && ok "docker movelog-api ayakta (127.0.0.1:8780)" || kir "docker movelog-api YOK"
for s in movelog-cloud movelog-ptt; do
  systemctl is-active --quiet "$s" && ok "$s.service aktif" || uya "$s.service pasif"
done
DURDURULACAK=$(systemctl list-units --type=timer --all --no-pager 2>/dev/null \
  | grep -oE '^\s*(activity-detect|movelog-(pending-reconcile|render-bekci|broadcast|genreq|rangereq|grupsurus|rearm|integrity-auto|olay-watch|video-kontrol|gunluk-rapor|hava|ilkvideo-nudge|rozet|kulup-karne|weekly-recap|wrapped|yorum-watch))\.timer' \
  | tr -d ' ' | sort -u)
n=$(echo "$DURDURULACAK" | grep -c .)
[ "$n" -ge 15 ] && ok "durdurulacak timer sayısı = $n (taşınan 20 görevin sunucuda VAR olanları)" \
                || uya "durdurulacak timer sayısı = $n (beklenen 19)"
systemctl is-enabled movelog-tacclean.timer >/dev/null 2>&1 \
  && bil "movelog-tacclean.timer + traccar-gpx.timer TAŞINMAZ → ${S}durdurulmayacak${N}"

# ─────────────────────────────────────────────────────────────────────────────
bas "11) Sırlar (değer BASILMAZ)"
[ -s /opt/matrix/secrets/harita-uc.conf ]       && ok "harita-uc.conf VAR"        || kir "harita-uc.conf YOK"
[ -s /opt/matrix/secrets/movelog-cf.conf ]      && ok "movelog-cf.conf VAR"       || kir "movelog-cf.conf YOK"
[ -s /opt/matrix/secrets/runpod.conf ]          && ok "runpod.conf VAR"           || kir "runpod.conf YOK"
[ -s /opt/matrix/secrets/runpod-tactical.conf ] && ok "runpod-tactical.conf VAR"  || kir "runpod-tactical.conf YOK"
[ -s /opt/matrix/secrets/movelog-r2.conf ]      && ok "movelog-r2.conf VAR"       || uya "movelog-r2.conf YOK (R2 presign)"
[ -s /opt/matrix/secrets/movelog-harita-key.conf ] && ok "movelog-harita-key.conf VAR (MLOG_ONEK/MOVELOG_KEY)" \
  || bil "movelog-harita-key.conf YOK → MLOG_ONEK = capability öneği (önerilen, tüketicide sıfır değişiklik)"

# ─────────────────────────────────────────────────────────────────────────────
bas "11b) WORKER'A BASILMIŞ sırlar (2026-08-31 denetiminde eklendi)"
echo "  ${S}Yukarıdaki 11. bölüm yalnız SUNUCUDAKİ DOSYAYI görür.${N} Kesimde belirleyici olan,"
echo "  sırrın Worker'a GERÇEKTEN basılmış olmasıdır — SECRETS.md 'push Faz 2'de' diyor."
if ! wr_kimlik; then
  kir "wrangler kimliği yok — worker sırları doğrulanamadı"
else
  # SECRETS.md bölüm 1'deki 'api' ataması; boşsa kodun fail-closed dalı devreye girer.
  API_ZORUNLU="JWT_SECRET RENDER_DONE_SECRET GIFT_ADMIN_SECRET USERS TWILIO_SID TWILIO_TOKEN TWILIO_VERIFY_SID REVIEW_PHONE REVIEW_CODE"
  API_ONEMLI="R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY APNS_AUTH_KEY FCM_SERVICE_ACCOUNT LIVEKIT_KEY LIVEKIT_SECRET LIVEKIT_URL TRACCAR_URL TRACCAR_USER TRACCAR_PASS"
  VAR_LIST="$(cd "$CF_DIR/api" && npx wrangler secret list 2>/dev/null \
    | python3 -c 'import sys,json;print(" ".join(x["name"] for x in json.load(sys.stdin)))' 2>/dev/null)"
  if [ -z "$VAR_LIST" ]; then
    kir "movelog-api sır listesi okunamadı"
  else
    EKSIK=""; for s in $API_ZORUNLU; do
      echo " $VAR_LIST " | grep -q " $s " || EKSIK="$EKSIK $s"; done
    EKSIK2=""; for s in $API_ONEMLI; do
      echo " $VAR_LIST " | grep -q " $s " || EKSIK2="$EKSIK2 $s"; done
    if [ -n "$EKSIK" ]; then
      kir "movelog-api'de ZORUNLU sır EKSİK:$EKSIK
       → RENDER_DONE_SECRET yoksa /api/internal/render-done KALICI 403 (auth.ts:136 secretOk
         boş sırda her zaman false) → RunPod biten videoyu BİLDİREMEZ, hepsi 'Hazırlanıyor'da kalır.
       → TWILIO_*/REVIEW_* yoksa SMS-OTP girişi 503 + App Store inceleme bypass'ı ÖLÜ (grup3.ts:548-554).
       → USERS yoksa parolalı giriş fail-closed (grup3.ts:101). Çözüm: tools/secrets-push.sh"
    else ok "movelog-api zorunlu sırların hepsi basılmış"; fi
    [ -n "$EKSIK2" ] && uya "movelog-api'de önemli/opsiyonel sır eksik:$EKSIK2 (R2 presign yoksa /videourl göreli URL'ye düşer — grup1.ts:672)"
  fi
  for w in dispatch cron; do
    VL="$(cd "$CF_DIR/$w" && npx wrangler secret list 2>/dev/null \
      | python3 -c 'import sys,json;print(" ".join(x["name"] for x in json.load(sys.stdin)))' 2>/dev/null)"
    case "$w" in
      dispatch) GEREK="RUNPOD_API_KEY RENDER_DONE_SECRET" ;;
      cron)     GEREK="RENDER_DONE_SECRET" ;;
    esac
    E=""; for s in $GEREK; do echo " $VL " | grep -q " $s " || E="$E $s"; done
    [ -z "$E" ] && ok "movelog-$w sırları tam ($GEREK)" \
                || kir "movelog-$w sır EKSİK:$E (SECRETS.md bölüm 1)"
  done
fi

# ─────────────────────────────────────────────────────────────────────────────
echo
if [ "$KIRIK" = "0" ]; then
  echo "${B}${Y}════ KESİME HAZIR ════${N}  (uyarı: $UYARI)"
  echo "Not: 'HAZIR' teknik ön koşulları karşılar — ${B}kesim yine de Barış onayı ister${N} (kesim.sh onay noktaları)."
  exit 0
else
  echo "${B}${K}════ KESİME HAZIR DEĞİL — $KIRIK kırık madde ════${N}  (uyarı: $UYARI)"
  i=1; for m in "${KIRIK_LISTE[@]}"; do echo "  $i) $m"; i=$((i+1)); done
  exit 1
fi
