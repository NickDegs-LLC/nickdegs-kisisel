#!/bin/bash
# kesim.sh — Move Log → Cloudflare KESİM (canlıya geçiş), ADIM ADIM.
# =============================================================================
# 🔴 VARSAYILAN KURU'DUR. Hiçbir şey yapmaz, ne YAPACAĞINI gösterir.
#    Gerçekten uygulamak için: --uygula  (ve her adımda ayrıca ENTER onayı).
#
# Kullanım:
#   ./kesim.sh                      # 5 adımın tamamını KURU göster (güvenli)
#   ./kesim.sh --adim 3             # yalnız 3. adımı KURU göster
#   ./kesim.sh --uygula             # sırayla uygula, her adımda ENTER sorar
#   ./kesim.sh --adim 1 --uygula    # yalnız 1. adımı uygula (yine ENTER sorar)
#
# ADIMLAR
#   1  movelog-gps      → gpsdata.nickdegs.com          (turuncu bulut + route)
#   2  movelog-api      → kisisel-api.nickdegs.com      (turuncu bulut + DAR route)
#   3  ORTAM golge→canli (api · gps · dispatch · cron)   ← bekçiler ONARMAYA başlar
#   4  harita katmanı route'ları                         (YALNIZ muafiyet doğrulanmışsa)
#   5  sunucu servislerini DURDUR (stop; disable/sil YOK)
#
# SIRA BAĞLAYICIDIR. 4 ⊄ 3 değil ama 5 mutlaka EN SON.
# Her adım devir-gunu-kayit.txt'ye yazılır (geri-donus.sh onu okur).
# =============================================================================
BURA="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$BURA/kesim-ortak.sh"

UYGULA=0; TEK_ADIM=""
while [ $# -gt 0 ]; do
  case "$1" in
    --uygula) UYGULA=1 ;;
    --adim) TEK_ADIM="$2"; shift ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) echo "bilinmeyen argüman: $1"; exit 2 ;;
  esac; shift
done

if [ "$UYGULA" = "1" ]; then
  MOD="${K}${B}UYGULA${N}"
else
  MOD="${M}KURU (hiçbir şey değişmez)${N}"
fi
echo "${B}MOVE LOG KESİM${N} — mod: $MOD — $(date -Is)"

# yap <açıklama> <komut...>  → KURU'da yalnız yazar, --uygula'da çalıştırır
yap() {
  local ac="$1"; shift
  if [ "$UYGULA" = "1" ]; then
    echo "  ${B}»${N} $ac"
    "$@" || { echo "  ${K}HATA${N}: '$ac' başarısız (çıkış $?)"; echo "  → geri-donus.sh düşün"; return 1; }
  else
    echo "  ${M}[KURU]${N} $ac"
    echo "         komut: $*"
  fi
}
# KURU turda ENTER beklenmez — onay noktası yalnız GÖSTERİLİR (script asılmasın)
if [ "$UYGULA" != "1" ]; then
  onay() { echo; echo "  ${S}⚠️ ONAY NOKTASI (KURU'da sorulmaz)${N}: $1"; }
fi
gecit() {  # gecit <mesaj>  — kırık ön koşulda DURDURUR
  echo "  ${K}✗ ÖN KOŞUL SAĞLANMADI${N}: $1"
  echo "  ${K}ADIM DURDURULDU.${N}"
  return 1
}

# ═════════════════════════════════════════════════════════════════════════════
adim1() {
cat <<'EOF'

═══ ADIM 1 — movelog-gps → gpsdata.nickdegs.com ══════════════════════════════
NE DEĞİŞİR: telefonun konum gönderimi (OsmAnd protokolü) Traccar yerine D1'e düşer.

⚠️ ÖLÇÜLMÜŞ GERÇEK — "backend /api/tracker'ın yeni ingest adresini döndürmesi" için
   YAPILACAK BİR CONFIG DEĞİŞİKLİĞİ YOKTUR. Adres KOD SABİTİDİR, iki tarafta da AYNI:
     · /opt/movelog/backend/main.py:2745       → return {... "url": "https://gpsdata.nickdegs.com"}
     · cf/api/src/routes/grup7.ts:771          → return c.json({... url: 'https://gpsdata.nickdegs.com' })
     · cf/contracts/api.md:177 zaten böyle not düşmüş ("sabit string kodda, satır 2745")
   config.env'de, D1 `config` tablosunda ve KV'de bu adres YOKTUR (arandı, bulunamadı).
   DOĞRU YOL: hostname'e DOKUNMA — yalnız o hostname'in HEDEFİNİ değiştir (aşağıdaki route).
   Böylece sahadaki her istemci (eski sürümler dahil) hiçbir güncelleme olmadan geçer.
EOF
echo
echo "  ── ÖN DOĞRULAMA ──"
kod=$(curl -s -m 15 -o /dev/null -w '%{http_code}' "$WD_GPS/health"); echo "  \$ curl $WD_GPS/health → $kod   (beklenen 200)"
[ "$kod" = "200" ] || { gecit "movelog-gps gölge /health $kod"; return 1; }
b=$(grep -c 'gpsdata.nickdegs.com' /opt/movelog/backend/main.py)
w=$(grep -c 'gpsdata.nickdegs.com' "$CF_DIR/api/src/routes/grup7.ts")
echo "  \$ grep -c gpsdata.nickdegs.com  backend=$b  worker=$w   (ikisi de ≥1 → adres birebir aynı)"
[ "$b" -ge 1 ] && [ "$w" -ge 1 ] || { gecit "ingest adresi iki tarafta aynı değil"; return 1; }
cf_kimlik || { gecit "CF kimliği yok"; return 1; }
r="$(dns_kayit gpsdata.nickdegs.com)"; set -- $r; DNSID="${1:-}"; PROX="${2:-}"
echo "  \$ DNS gpsdata.nickdegs.com → proxied=$PROX  (route için True ŞART)"
[ -n "$DNSID" ] || { gecit "gpsdata DNS kaydı yok"; return 1; }

cat <<'EOF'

  ── YAN ETKİ (Barış'a söylenmeden geçilmez) ──
  Traccar (127.0.0.1:5147) bu andan sonra HİÇ konum almaz. Ona bağlı olan ve
  CF'e TAŞINMAYAN tek iş: traccar-gpx.timer (Barış'ın kişisel günlük rota GPX'i
  → Element). O akış kesimden sonra boş GPX üretir. Move Log kullanıcılarını
  etkilemez (aktivite algılama D1 positions'tan okuyor).
EOF
onay "gpsdata.nickdegs.com TURUNCU BULUT'a alınacak ve /* movelog-gps worker'ına bağlanacak.
    Geri dönüş: route sil + proxied=false (geri-donus.sh adım G2.1)."
yap "DNS gpsdata → proxied=true" \
  cfapi PATCH "/zones/$CF_ZONE_ID/dns_records/$DNSID" '{"proxied":true}' || return 1
yap "route ekle: gpsdata.nickdegs.com/* → movelog-gps" \
  cfapi POST "/zones/$CF_ZONE_ID/workers/routes" '{"pattern":"gpsdata.nickdegs.com/*","script":"movelog-gps"}' || return 1
[ "$UYGULA" = "1" ] && kayit "UYGULANDI: adim1 gpsdata-route + turuncu-bulut"

echo
echo "  ── SON DOĞRULAMA (route yayılması ~10-30 sn) ──"
cat <<'EOF'
  $ sleep 20; curl -s https://gpsdata.nickdegs.com/health
    beklenen: {"ok":true,"rows":<sayı>,"worker":"movelog-gps","ortam":"golge"}
    ("worker":"movelog-gps" YOKSA route bağlanmamıştır → Traccar cevap veriyordur)

  $ curl -s -o /dev/null -w '%{http_code}\n' \
      'https://gpsdata.nickdegs.com/?id=99999999&lat=41.0&lon=29.0&timestamp='$(date +%s)
    beklenen: 200 (Traccar sözleşmesi: boş gövde + 200)
    ⚠️ id=99999999 D1 users.tracker_id'de YOK → satır yazılır ama kimseye bağlanmaz (zararsız)

  $ curl -s https://kisisel-api.nickdegs.com/api/tracker -H "Authorization: Bearer <JWT>" | head -c 120
    beklenen: {"deviceId":"...","url":"https://gpsdata.nickdegs.com"}  ← adres DEĞİŞMEDİ, hedefi değişti
EOF
if [ "$UYGULA" = "1" ]; then
  sleep 20
  echo -n "  ölçüm: "; curl -s -m 15 "https://gpsdata.nickdegs.com/health" | head -c 140; echo
fi
}

# ═════════════════════════════════════════════════════════════════════════════
adim2() {
cat <<'EOF'

═══ ADIM 2 — movelog-api → kisisel-api.nickdegs.com ══════════════════════════
NE DEĞİŞİR: app'in TÜM API trafiği docker backend (127.0.0.1:8780) yerine Worker'a düşer.

🔴 ROUTE **DAR** OLMALI — 'kisisel-api.nickdegs.com/*' YAZMA. Ölçüldü (nginx cf-kisisel-api):
     /harita/        → 127.0.0.1:8890/xyz/   (app harita karoları — Faz-2, TAŞINMADI)
     /vektor/        → 127.0.0.1:8890/mvt/   (RunPod 3B MVT      — Faz-2, TAŞINMADI)
     /<gizli-önek>/  → 127.0.0.1:8890/       (motor uçları        — TAŞINMADI)
     /api/motor3d    → 127.0.0.1:8890/motor3d (telefon 3B motoru — worker'da YOK!)
   Geniş route bu dördünü de yutar → app haritası bembeyaz + telefon motoru 404.
   Bu yüzden yalnız ÜÇ dar desen bağlanır: /api/*  ·  /auth/*  ·  /health
EOF
echo
echo "  ── ÖN DOĞRULAMA ──"
kod=$(curl -s -m 15 -o /dev/null -w '%{http_code}' "$WD_API/health"); echo "  \$ curl $WD_API/health → $kod   (beklenen 200)"
[ "$kod" = "200" ] || { gecit "movelog-api gölge /health $kod"; return 1; }
son=$(ls -t "$CF_DIR"/tools/diff-rapor-*.md 2>/dev/null | head -1)
esit=$(grep -oE '^\| EŞİT \| [0-9]+' "$son" 2>/dev/null | grep -oE '[0-9]+$')
echo "  \$ gölge GET paritesi ($(basename "${son:-YOK}")) → EŞİT=${esit:-?}   (beklenen ≥35)"
[ "${esit:-0}" -ge 35 ] 2>/dev/null || { gecit "GET paritesi ≥35 değil"; return 1; }
m3=$(grep -rc "motor3d" "$CF_DIR/api/src" 2>/dev/null | grep -v ':0$' | wc -l)
t3=$(grep -c "motor3d" /var/log/nginx/access.log 2>/dev/null); t3=${t3:-0}
echo "  \$ /api/motor3d: worker'da dosya=$m3 · bugünkü canlı istek=$t3"
if [ "$m3" = "0" ] && [ "$t3" -gt 0 ]; then
  gecit "/api/motor3d worker'da YOK ama CANLI kullanılıyor ($t3 istek) — önce ya worker'a ekle ya route'u böl"; return 1
fi
[ "$m3" = "0" ] && uya "/api/motor3d worker'da yok; trafiği 0 → kabul edilebilir risk (kesimden sonra 404 döner)"
# 🔴 SIR GEÇİDİ (2026-08-31 denetimi) — bu kontrol ÖNCEDEN YOKTU ve ölçümde 8/9 sır EKSİK çıktı.
# Route bağlandığı an TÜM API trafiği worker'a düşer; sır yoksa uçlar fail-closed olur.
if wr_kimlik; then
  VL="$(cd "$CF_DIR/api" && npx wrangler secret list 2>/dev/null \
     | python3 -c 'import sys,json;print(" ".join(x["name"] for x in json.load(sys.stdin)))' 2>/dev/null)"
  EKSIK=""
  for s in JWT_SECRET RENDER_DONE_SECRET GIFT_ADMIN_SECRET USERS TWILIO_SID TWILIO_TOKEN TWILIO_VERIFY_SID REVIEW_PHONE REVIEW_CODE; do
    echo " $VL " | grep -q " $s " || EKSIK="$EKSIK $s"
  done
  echo "  \$ movelog-api basılmış sır sayısı → $(echo $VL | wc -w)   (SECRETS.md 'api' ataması: 19)"
  if [ -n "$EKSIK" ]; then
    gecit "movelog-api'de ZORUNLU sır EKSİK:$EKSIK
         RENDER_DONE_SECRET yoksa /api/internal/render-done kalıcı 403 verir (lib/auth.ts:136) →
         RunPod biten videoyu bildiremez, tüm videolar 'Hazırlanıyor'da asılı kalır.
         TWILIO_*/REVIEW_* yoksa SMS-OTP girişi 503 + App Store inceleme bypass'ı ölür (grup3.ts:548).
         Çözüm: /opt/matrix/cf/tools/secrets-push.sh — sonra bu adımı tekrar koş."
    return 1
  fi
  ok_sir=1
else
  gecit "wrangler kimliği yok — worker sırları doğrulanamadan route bağlanmaz"; return 1
fi
cf_kimlik || { gecit "CF kimliği yok"; return 1; }
r="$(dns_kayit kisisel-api.nickdegs.com)"; set -- $r; DNSID="${1:-}"; PROX="${2:-}"
echo "  \$ DNS kisisel-api.nickdegs.com → proxied=$PROX   (route için True ŞART)"
[ -n "$DNSID" ] || { gecit "kisisel-api DNS kaydı yok"; return 1; }

onay "kisisel-api.nickdegs.com TURUNCU BULUT + ÜÇ DAR route (/api/*, /auth/*, /health) → movelog-api.
    /harita/ /vektor/ /<önek>/ /api/motor3d origin'de (harita-proxy) KALIR."
yap "DNS kisisel-api → proxied=true" \
  cfapi PATCH "/zones/$CF_ZONE_ID/dns_records/$DNSID" '{"proxied":true}' || return 1
for d in "kisisel-api.nickdegs.com/api/*" "kisisel-api.nickdegs.com/auth/*" "kisisel-api.nickdegs.com/health"; do
  yap "route ekle: $d → movelog-api" \
    cfapi POST "/zones/$CF_ZONE_ID/workers/routes" "{\"pattern\":\"$d\",\"script\":\"movelog-api\"}" || return 1
done
[ "$UYGULA" = "1" ] && kayit "UYGULANDI: adim2 kisisel-api 3 dar route + turuncu-bulut"

echo
echo "  ── SON DOĞRULAMA ──"
cat <<'EOF'
  $ curl -s https://kisisel-api.nickdegs.com/health
    beklenen: {"ok":true,"rides":<sayı>}       ← Worker'ın grup7 /health'i
  $ curl -s https://kisisel-api.nickdegs.com/api/mapconfig | head -c 80
    beklenen: JSON (403/404 DEĞİL)
  $ curl -s -o /dev/null -w '%{http_code}\n' https://kisisel-api.nickdegs.com/harita/sat/14/9600/6100.jpg
    beklenen: 200  ← ROUTE YUTMADI (hâlâ origin/harita-proxy). 404 görürsen route ÇOK GENİŞ → geri-donus.sh
EOF
if [ "$UYGULA" = "1" ]; then
  sleep 20
  echo -n "  /health   : "; curl -s -m 15 "https://kisisel-api.nickdegs.com/health" | head -c 90; echo
  echo -n "  /harita/  : "; curl -s -m 15 -o /dev/null -w '%{http_code}\n' "https://kisisel-api.nickdegs.com/harita/sat/14/9600/6100.jpg"
fi
}

# ═════════════════════════════════════════════════════════════════════════════
adim3() {
cat <<'EOF'

═══ ADIM 3 — ORTAM: golge → canli (api · gps · dispatch · cron) ══════════════
NE DEĞİŞİR (bu adım GERİ DÖNÜŞÜ EN ZOR olan):
  · api      → gerçek APNs/FCM push kodu etkinleşir (push.ts:200 'YALNIZ ORTAM=canli')
  · dispatch → ride_id 'golge:' öneki DÜŞER → işler GERÇEKTEN RunPod'a gider (para harcanır)
  · cron     → 7 bekçi KURU'dan çıkar: runpod-saglik artık workersMax'a PATCH ATAR,
               kuyruk-bekcisi işi yeniden kuyruklar, render-bekci 'bulut-kapali' bayrağı yazar
  · gps      → bayrak yalnız /health'te görünür (ingest zaten koşulsuz yazıyor)
SIRA: api → gps → dispatch → **cron EN SON** (bekçiler ancak diğerleri canlıyken doğru ölçer).
EOF
echo
echo "  ── ÖN DOĞRULAMA ──"
"$BURA/kesim-onkontrol.sh" --hizli >/dev/null 2>&1; oc=$?
echo "  \$ kesim-onkontrol.sh --hizli → çıkış $oc   (beklenen 0)"
cagri=$(grep -rn "pushGonder" "$CF_DIR"/api/src "$CF_DIR"/cron/src --include=*.ts 2>/dev/null | grep -vc "lib/push.ts")
echo "  \$ push:bekleyen tüketici çağrısı → $cagri   (beklenen ≥1)"
if [ "${cagri:-0}" -lt 1 ]; then
cat <<'EOF'

  🔴 ÖLÇÜLMÜŞ BOŞLUK: cf/api/src/lib/push.ts:178 pushGonder() ve :229 pushGonderSessiz()
     HİÇBİR YERDEN ÇAĞRILMIYOR; 25 cron görevinin hiçbiri 'push:bekleyen:*' önekini boşaltmıyor
     (cron/src/gorevler/broadcast.ts:4 → "pushq ... Faz 3 tüketicisi gönderecek — bu görev DOKUNMAZ").
     ORTAM=canli yapılırsa push'lar KV'ye yazılır, 7 gün TTL ile SESSİZCE ölür:
       telsiz (PTT) sessiz push'u · arkadaşlık isteği · "videon hazır" · haftalık recap · re-arm
     Bu, kullanıcının FARK EDECEĞİ tek sessiz kayıp. Barış'ın kararı olmadan geçilmez.
EOF
  onay "TÜKETİCİ YOK. Yine de ORTAM=canli yapılsın mı? (Barış 'evet' demediyse Ctrl-C)"
fi

onay "4 worker wrangler.toml'da ORTAM='golge' → 'canli' yapılıp yeniden dağıtılacak (api→gps→dispatch→cron).
    Geri dönüş: geri-donus.sh adım 2 (aynı işlem ters yönde, ~2 dk)."
wr_kimlik || { gecit "wrangler kimliği yok (movelog-cf.conf)"; return 1; }
for w in api gps dispatch cron; do
  yap "movelog-$w: ORTAM=canli + wrangler deploy" bash -c "
    set -e
    cd '$CF_DIR/$w'
    # 🔴 YEDEK KORUMASI (2026-08-31 denetimi): eski sürüm yedeği KOŞULSUZ alıyordu.
    #    Bu adım ikinci kez koşarsa (kısmi hata sonrası tekrar) 'canli' hâli yedeğin
    #    ÜSTÜNE yazılırdı → geri-donus.sh g2 yedekten kopyalayınca worker canli KALIRDI.
    #    Yedek artık YALNIZ bir kez ve YALNIZ dosya gerçekten golge iken alınır.
    if [ ! -f wrangler.toml.golge.yedek ]; then
      grep -q '^ORTAM = \"golge\"' wrangler.toml || {
        echo 'DUR: wrangler.toml golge DEGIL ve yedek yok — elle bak'; exit 3; }
      cp wrangler.toml wrangler.toml.golge.yedek
    fi
    sed -i 's/^ORTAM = \"golge\"/ORTAM = \"canli\"/' wrangler.toml
    grep -q '^ORTAM = \"canli\"' wrangler.toml
    npx wrangler deploy >/dev/null
  " || return 1
  [ "$UYGULA" = "1" ] && kayit "UYGULANDI: adim3 movelog-$w ORTAM=canli"
done

echo
echo "  ── SON DOĞRULAMA ──"
cat <<'EOF'
  $ for w in api gps dispatch cron; do curl -s https://movelog-$w.daclen10.workers.dev/health; echo; done
    beklenen: gps/dispatch/cron gövdelerinde "ortam":"canli"
    (movelog-api /health'i grup7 dolduruyor → {"ok":true,"rides":N}; ortam alanı YOKTUR, bu NORMAL)
  $ curl -s https://movelog-cron.daclen10.workers.dev/health | head -c 200
    beklenen: "gorev_sayisi":25 · takvim last_ok değerleri ilerliyor
EOF
if [ "$UYGULA" = "1" ]; then
  sleep 10
  for w in gps dispatch cron; do
    echo -n "  movelog-$w: "; curl -s -m 15 "https://movelog-$w.daclen10.workers.dev/health" | grep -oE '"ortam":"[a-z]+"' || echo "?"
  done
fi
}

# ═════════════════════════════════════════════════════════════════════════════
adim4() {
cat <<'EOF'

═══ ADIM 4 — harita katmanı route'ları ═══════════════════════════════════════
NE DEĞİŞİR: harita.nickdegs.com/<önek>/{matching,styles,geocoding} → harita-katman worker'ı.
  /xyz /mvt /yukseklik /saglik DOKUNULMAZ (Hooder hattında kalır).

🔴 ÖN KOŞUL — MUAFİYET. Bu adım, K0 §0.3+§A3 muafiyeti YAZILI TEYİTLİ ve ÖLÇÜLMÜŞ
   değilse KOŞMAZ. Ölçüt (checklist B3 + R3, ikisi birden):
     (a) önekli /xyz  → 200 + access-control-allow-origin + cross-origin-resource-policy
     (b) 300 karoluk seri → 300/300 = 200; TEK 403/429 = DUR
   (a) sağlanmazsa render videoları BEMBEYAZ çıkar (curl ile görünmez, videoda patlar).
EOF
echo
echo "  ── ÖN DOĞRULAMA (muafiyet) ──"
# shellcheck disable=SC1091
source /opt/matrix/secrets/harita-uc.conf 2>/dev/null || true
[ -n "${HARITA_UC_ONEK:-}" ] || { gecit "HARITA_UC_ONEK yok"; return 1; }
H=$(curl -s -m 20 -o /dev/null -D - "https://harita.nickdegs.com/$HARITA_UC_ONEK/xyz/sat/14/9600/6100.jpg?cb=$$" | tr -d '\r')
kod=$(echo "$H" | grep -oE '^HTTP/[0-9.]+ [0-9]+' | grep -oE '[0-9]+$' | head -1)
acao=$(echo "$H" | grep -ci '^access-control-allow-origin:')
corp=$(echo "$H" | grep -ci '^cross-origin-resource-policy:')
echo "  \$ önekli /xyz → HTTP $kod · ACAO=$acao · CORP=$corp   (beklenen 200/1/1)"
[ "$kod" = "200" ] || { gecit "önekli /xyz $kod"; return 1; }
if [ "$acao" -lt 1 ] || [ "$corp" -lt 1 ]; then
  gecit "R3 EKSİK (ACAO=$acao CORP=$corp) — Hooder önekli /xyz'ye bu iki başlığı EKLEMEDEN geçilmez.
         Kanıt: /opt/matrix/docs/DEVIR-GUNU-CHECKLIST.md EK-2 · istek: docs/HOODER-MUAFIYET-ISTEGI.md"
  return 1
fi
echo "  \$ 300 karoluk seri (bot imzası taklidi) — tek 403/429 = DUR"
if [ "$UYGULA" != "1" ]; then
  echo "  ${M}[KURU]${N} 300 karoluk seri KOŞULMADI (Hooder zone'una boşuna yük bindirmemek için)."
  echo "         gerçek ölçüm: $0 --adim 4 --uygula   ya da   kesim-onkontrol.sh --tam-muafiyet"
  return 0
fi
kotu=0
for i in $(seq 1 300); do
  c=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "https://harita.nickdegs.com/$HARITA_UC_ONEK/xyz/sat/14/$((9600+i))/6160.jpg")
  case "$c" in 403|429) kotu=$((kotu+1)); echo "     istek $i → $c" ;; esac
done
echo "  → 300 istekte 403/429 sayısı: $kotu   (beklenen 0)"
[ "$kotu" = "0" ] || { gecit "muafiyet ÖLÇÜMDE DÜŞTÜ ($kotu blok) — B1'e dön, route ÇEVİRME"; return 1; }
cf_kimlik || { gecit "CF kimliği yok"; return 1; }
r="$(dns_kayit harita-origin.nickdegs.com)"
if [ -z "$r" ]; then
  gecit "harita-origin.nickdegs.com A $SUNUCU_IP (proxy KAPALI) kaydı YOK — statik/geocoding forward'ı
         Worker'ın kendi hostuna düşer ve '500 origin dongusu' verir (checklist D1). Önce kaydı aç."
  return 1
fi
set -- $r; echo "  \$ harita-origin → proxied=$2 içerik=$3   (beklenen False + $SUNUCU_IP)"
[ "$2" = "False" ] || { gecit "harita-origin TURUNCU (proxied=True) — döngü riski"; return 1; }

onay "harita-katman deploy edilip 3 route bağlanacak (matching/styles/geocoding, gizli önek altında).
    dev10 ile hooder-kapi rota tablosu çakışması TEYİT EDİLDİ mi? Geri dönüş: 3 route'u sil (anında)."
yap "harita-katman deploy + route + KV tohumları" bash -c "cd '$CF_DIR/harita-katman' && ./deploy.sh" || return 1
[ "$UYGULA" = "1" ] && kayit "UYGULANDI: adim4 harita-katman deploy + 3 route"

echo
echo "  ── SON DOĞRULAMA ──"
cat <<'EOF'
  $ cd /opt/matrix/cf/harita-katman && python3 test/devir-testi.py --yeni https://harita.nickdegs.com
    geçme ölçütü: T1 ölçek farkı <5/255 · T3 başlıklar · T6'da 404 YOK · T4 code:"Ok" · T11 öneksiz→404
    T1 ≈ 60/255 görürsen: 1024·2^z ölçek hatası → rotalar ~750 m kayar → DERHAL geri-donus.sh
  $ BASE=https://harita.nickdegs.com node test/uyum-test.mjs
    beklenen: "36 geçti, 0 kaldı"
EOF
}

# ═════════════════════════════════════════════════════════════════════════════
adim5() {
cat <<'EOF'

═══ ADIM 5 — SUNUCU SERVİSLERİNİ DURDUR ══════════════════════════════════════
KURAL: yalnız `systemctl stop` / `docker stop`. **disable YOK · rm YOK · docker rm YOK.**
Geri dönüş tek komut olsun diye her şey yerinde bırakılır (unit dosyası, imaj, volume).

SIRA (üretici → tüketici; ters sıra yetim iş bırakır):
  5.1  19 timer  (yeni iş üretimini kes)
  5.2  movelog-cloud.service (dispatcher — eldeki işi bitirsin diye timer'lardan SONRA)
  5.3  docker movelog-api  (route zaten adım 2'de taşındı; artık trafik almıyor)
  5.4  movelog-ptt.service (dosya kuyruğu backend ölünce beslenmez — en son, opsiyonel)

🔴 DURDURULMAYACAKLAR (ölçülmüş gerekçeyle):
  · harita-proxy.service  → harita-katman'ın statik+geocoding forward ORIGIN'İ; ayrıca
                            kisisel-api /harita/ /vektor/ /<önek>/ /api/motor3d hâlâ ona gidiyor.
                            Durdurulursa harita katmanı ve app harita ekranı ölür.
  · movelog-tacclean.timer→ tasks.json: TAŞINMAZ (sunucu disk hijyeni)
  · traccar-gpx.timer     → tasks.json: TAŞINMAZ (Barış'ın kişisel GPX akışı)
  · nginx, docker, traccar → Matrix/Traccar/diğer oturumların ortak altyapısı
EOF
echo
echo "  ── ÖN DOĞRULAMA ──"
kod=$(curl -s -m 15 -o /dev/null -w '%{http_code}' "https://kisisel-api.nickdegs.com/health")
gov=$(curl -s -m 15 "https://kisisel-api.nickdegs.com/health" | head -c 80)
echo "  \$ curl https://kisisel-api.nickdegs.com/health → $kod · $gov"
echo "    (adım 2 yapılmadıysa bu YİNE docker backend'dir; durdurursan API TAMAMEN ÖLÜR)"
cf_kimlik || { gecit "CF kimliği yok — route durumu doğrulanamadan servis durdurulmaz"; return 1; }
rl=$(route_listesi | grep -c '|movelog-api$')
echo "  \$ zone'da movelog-api route sayısı → ${rl:-0}   (beklenen 3)"
[ "${rl:-0}" -ge 1 ] || { gecit "kisisel-api henüz worker'a bağlı değil (adım 2 yapılmamış) — servisleri durdurma"; return 1; }

TIMERLAR=$(systemctl list-units --type=timer --all --no-pager 2>/dev/null \
  | grep -oE '^\s*(activity-detect|movelog-(pending-reconcile|render-bekci|broadcast|genreq|rangereq|grupsurus|rearm|integrity-auto|olay-watch|video-kontrol|gunluk-rapor|hava|ilkvideo-nudge|rozet|kulup-karne|weekly-recap|wrapped|yorum-watch))\.timer' \
  | tr -d ' ' | sort -u)
echo "  ── durdurulacak timer'lar ($(echo "$TIMERLAR" | grep -c .) adet) ──"
echo "$TIMERLAR" | sed 's/^/     /'

onay "Yukarıdaki timer'lar + movelog-cloud + docker movelog-api DURDURULACAK (stop, disable DEĞİL).
    Geri dönüş: geri-donus.sh adım 3 (hepsi start)."
for t in $TIMERLAR; do
  yap "stop $t" systemctl stop "$t" || true
done
[ "$UYGULA" = "1" ] && kayit "UYGULANDI: adim5.1 $(echo "$TIMERLAR" | grep -c .) timer stop"
yap "stop movelog-cloud.service" systemctl stop movelog-cloud.service || true
[ "$UYGULA" = "1" ] && kayit "UYGULANDI: adim5.2 movelog-cloud stop"
yap "docker stop movelog-api" docker stop movelog-api || true
[ "$UYGULA" = "1" ] && kayit "UYGULANDI: adim5.3 docker movelog-api stop"
echo "  ${S}5.4 movelog-ptt.service — OPSİYONEL${N} (backend ölünce zaten boş döner)."
onay "movelog-ptt.service de durdurulsun mu? (istemiyorsan Ctrl-C, kesim tamamdır)"
yap "stop movelog-ptt.service" systemctl stop movelog-ptt.service || true
[ "$UYGULA" = "1" ] && kayit "UYGULANDI: adim5.4 movelog-ptt stop"

echo
echo "  ── SON DOĞRULAMA ──"
cat <<'EOF'
  $ systemctl is-active movelog-cloud movelog-ptt          → inactive · inactive
  $ docker ps --format '{{.Names}}' | grep -c movelog-api  → 0
  $ systemctl is-active harita-proxy                       → active   (DURMAMALI!)
  $ systemctl is-active movelog-tacclean.timer traccar-gpx.timer → active · active (TAŞINMAZ, durmaz)
  $ curl -s https://kisisel-api.nickdegs.com/health        → {"ok":true,"rides":N}  (Worker cevaplıyor)
  $ curl -s -o /dev/null -w '%{http_code}\n' https://kisisel-api.nickdegs.com/harita/sat/14/9600/6100.jpg → 200
EOF
if [ "$UYGULA" = "1" ]; then
  echo -n "  harita-proxy: "; systemctl is-active harita-proxy
  echo -n "  movelog-api docker: "; docker ps --format '{{.Names}}' | grep -c movelog-api
  echo -n "  kisisel-api /health: "; curl -s -m 15 "https://kisisel-api.nickdegs.com/health" | head -c 80; echo
fi
}

# ═════════════════════════════════════════════════════════════════════════════
if [ -n "$TEK_ADIM" ]; then
  case "$TEK_ADIM" in
    1) adim1 ;; 2) adim2 ;; 3) adim3 ;; 4) adim4 ;; 5) adim5 ;;
    *) echo "geçersiz adım: $TEK_ADIM (1-5)"; exit 2 ;;
  esac
else
  adim1 && adim2 && adim3 && adim4 && adim5
fi
rc=$?
echo
if [ "$UYGULA" = "1" ]; then
  echo "${B}kayıt: $KAYIT${N}  ·  geri dönüş: $BURA/geri-donus.sh"
else
  echo "${M}KURU tur bitti — hiçbir şey değişmedi. Uygulamak için: $0 --uygula${N}"
fi
exit $rc
