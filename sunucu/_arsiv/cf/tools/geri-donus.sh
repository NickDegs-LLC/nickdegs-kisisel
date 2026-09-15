#!/bin/bash
# geri-donus.sh — KESİMDEN TAM DÖNÜŞ, TEK KOMUT, TERS SIRA.
# =============================================================================
# Taban: DEVIR-GUNU-CHECKLIST.md §G + §G2 tablosu (G2.1-G2.6).
# Kural (G2): "Route silmek yalnız worker'ı devreden çıkarır. Muafiyet için yapılan
#             env/URL değişiklikleri yerinde kalır → route geri alındığı halde
#             tüketiciler 404 alır. Geri dönüş sırası TERSTİR."
#
# TERS SIRA (kesim 1→5 ise dönüş 5→1):
#   1  sunucu servislerini BAŞLAT      (kesim 5'in tersi — ÖNCE, yoksa API boşlukta kalır)
#   2  ORTAM canli → golge (4 worker)  (kesim 3'ün tersi — gerçek push/RunPod yazımı DURSUN)
#   3  harita route'ları KALDIR        (kesim 4'ün tersi)
#   4  kisisel-api route + turuncu bulut geri al (kesim 2'nin tersi)
#   5  gpsdata route + turuncu bulut geri al     (kesim 1'in tersi)
#   6  RunPod env'leri eski değere + wmax 0→N flush (G2.2)
#   7  harita-kaynak.json Hooder satırı (G2.6) · yama 05/06 · test-render-yerel.sh (G2.3-G2.5)
#
# 🔴 SIRA GEREKÇESİ: servisler ÖNCE ayağa kalkar. Route'u önce silersen, docker backend
#    henüz ayakta değilken kisisel-api hem worker'sız hem backend'siz kalır (tam kesinti).
#
# Kullanım:
#   ./geri-donus.sh            # KURU: ne yapacağını gösterir, hiçbir şey değiştirmez
#   ./geri-donus.sh --prova    # PROVA: her komutu TAM AÇILMIŞ halde basar + DOĞRULAR
#                              #   (cfapi/rpapi → gerçek curl satırı, sırlar maskeli;
#                              #    systemd birim adı · docker adı · route id · zone id ·
#                              #    bash -c gövdesi `bash -n` ile sözdizimi denetimi)
#   ./geri-donus.sh --uygula   # tam dönüş (adım başı onay SORMAZ — acil durum aracı)
#   ./geri-donus.sh --uygula --onayli   # her adımda ENTER sorar
#   ./geri-donus.sh --adim 3 --uygula   # yalnız o adım
#
# Her adım devir-gunu-kayit.txt'ye yazılır. G2 kuralı: bir adım kesimde UYGULANMADIYSA
# geri de ALINMAZ — script bunu kayıt dosyasından okuyup atlar (--zorla ile ezilir).
# =============================================================================
BURA="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$BURA/kesim-ortak.sh"

UYGULA=0; ONAYLI=0; ZORLA=0; PROVA=0; TEK_ADIM=""
while [ $# -gt 0 ]; do
  case "$1" in
    --uygula) UYGULA=1 ;;
    --onayli) ONAYLI=1 ;;
    --zorla)  ZORLA=1 ;;
    --prova)  PROVA=1 ;;
    --adim)   TEK_ADIM="$2"; shift ;;
    -h|--help) sed -n '2,36p' "$0"; exit 0 ;;
    *) echo "bilinmeyen argüman: $1"; exit 2 ;;
  esac; shift
done
[ "$PROVA" = "1" ] && UYGULA=0
if   [ "$PROVA"  = "1" ]; then MOD="${M}PROVA (komut BASILIR + DOĞRULANIR, hiçbiri çalışmaz)${N}"
elif [ "$UYGULA" = "1" ]; then MOD="${K}${B}UYGULA${N}"
else                           MOD="${M}KURU${N}"; fi
echo "${B}GERİ DÖNÜŞ${N} — mod: $MOD — $(date -Is)"
echo "kayıt dosyası: $KAYIT"

uygulandi_mi() {  # uygulandi_mi <etiket> → kesimde yapıldıysa 0
  [ "$ZORLA" = "1" ] && return 0
  [ -f "$KAYIT" ] || return 1
  grep -q "UYGULANDI: $1" "$KAYIT"
}
yap() {
  local ac="$1"; shift
  if [ "$UYGULA" = "1" ]; then
    echo "  ${B}»${N} $ac"; "$@" || echo "  ${K}HATA${N}: '$ac' (çıkış $?) — devam ediliyor (acil dönüş)"
  else
    echo "  ${M}[KURU]${N} $ac"; echo "         komut: $*"
  fi
}
adim_onay() { [ "$ONAYLI" = "1" ] && onay "$1"; return 0; }

# ═══ PROVA MOTORU ════════════════════════════════════════════════════════════
# Amaç: --uygula'da ÇALIŞACAK komutun TAM açılmış halini basmak ve her birini
# gerçek sisteme karşı doğrulamak. Hiçbir yazma yapılmaz; yalnız okuma.
PROVA_N=0; PROVA_OK=0; PROVA_KOTU=0
p_ok()  { echo "         ${Y}✓${N} $*"; PROVA_OK=$((PROVA_OK+1)); }
p_kir() { echo "         ${K}✗ PROVA HATASI${N}: $*"; PROVA_KOTU=$((PROVA_KOTU+1)); }
p_bil() { echo "         ${M}·${N} $*"; }

# Zone route + DNS tablosunu bir kez çek (prova doğrulaması için, salt-okuma)
PROVA_ROUTES=""; PROVA_ROUTES_CEK=0
prova_routes() {
  [ "$PROVA_ROUTES_CEK" = "1" ] && { echo "$PROVA_ROUTES"; return 0; }
  PROVA_ROUTES_CEK=1
  cf_kimlik && PROVA_ROUTES="$(route_listesi)"
  echo "$PROVA_ROUTES"
}

# cfapi/rpapi'yi gerçek curl satırına açar; Authorization/X-Auth-Key MASKELENİR.
prova_ac() {
  case "$1" in
    cfapi)
      local m="$2" yol="$3" gov="${4:-}"
      printf "curl -s -m 30 -X %s 'https://api.cloudflare.com/client/v4%s' \\\\\n" "$m" "$yol"
      printf "             -H 'X-Auth-Email: %s' -H 'X-Auth-Key: <MASKELİ>'" "${CF_EMAIL:-<YOK>}"
      [ -n "$gov" ] && printf " \\\\\n             -H 'content-type: application/json' --data '%s'" "$gov"
      echo ;;
    rpapi)
      local m="$2" yol="$3" gov="${4:-}"
      printf "curl -s -m 30 -X %s 'https://rest.runpod.io/v1%s' \\\\\n" "$m" "$yol"
      printf "             -H 'authorization: Bearer <MASKELİ>'"
      [ -n "$gov" ] && printf " \\\\\n             -H 'content-type: application/json' --data '%s'" "$gov"
      echo ;;
    bash)
      echo "bash -c <<'GÖVDE'"; printf '%s\n' "$3" | sed 's/^/             /'; echo "             GÖVDE" ;;
    *) echo "$*" ;;
  esac
}

# Komutu gerçek sisteme karşı doğrula (salt-okuma).
prova_dogrula() {
  case "$1" in
    systemctl)
      local eylem="$2" birim="$3"
      if systemctl list-unit-files "$birim" >/dev/null 2>&1; then
        p_ok "systemd birimi VAR: $birim  (durum: $(systemctl is-active "$birim" 2>&1) / $(systemctl is-enabled "$birim" 2>&1))"
      else
        p_kir "systemd birimi YOK: '$birim' — '$eylem' sessizce başarısız olur"
      fi ;;
    docker)
      local eylem="$2" ad="$3"
      if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$ad"; then
        p_ok "docker konteyneri VAR: $ad  (durum: $(docker inspect -f '{{.State.Status}}' "$ad" 2>/dev/null))"
      else
        p_kir "docker konteyneri YOK: '$ad' — 'docker $eylem' hata verir"
      fi ;;
    cfapi)
      local m="$2" yol="$3"
      case "$yol" in
        "/zones/$CF_ZONE_ID/"*) p_ok "zone id doğru (nickdegs.com = $CF_ZONE_ID)" ;;
        /zones/*) p_kir "YABANCI ZONE: $yol  (beklenen $CF_ZONE_ID)" ;;
      esac
      case "$yol" in
        */workers/routes/*)
          local rid="${yol##*/}"
          if prova_routes | grep -q "^$rid|"; then
            p_ok "route id canlı tabloda VAR → $(prova_routes | grep "^$rid|" | cut -d'|' -f2,3)"
          else
            p_kir "route id '$rid' zone tablosunda YOK — DELETE 404 döner"
          fi
          [ "$m" = "DELETE" ] || p_kir "route silme metodu DELETE olmalı, '$m' verilmiş" ;;
        */dns_records/*)
          local did="${yol##*/}"
          if [ ${#did} = 32 ]; then p_ok "DNS kayıt id biçimi geçerli (32 hex): ${did:0:8}…"
          else p_kir "DNS kayıt id biçimi bozuk: '$did'"; fi
          [ "$m" = "PATCH" ] || p_kir "DNS güncelleme metodu PATCH olmalı, '$m' verilmiş" ;;
      esac ;;
    rpapi)
      local m="$2" yol="$3" gov="${4:-}"
      local eid="${yol##*/}"
      if [ "$eid" = "$RP_EP_RENDER" ] || [ "$eid" = "$RP_EP_TAC" ]; then
        p_ok "RunPod endpoint id tanınıyor: $eid"
      else
        p_kir "RunPod endpoint id BEKLENMEYEN: '$eid'"
      fi
      echo "$gov" | grep -q '"workersMax"' && p_ok "gövde workersMax içeriyor: $gov" ;;
    bash)
      local govde="$3"
      if printf '%s' "$govde" | bash -n 2>/dev/null; then p_ok "bash -n: sözdizimi TEMİZ"
      else p_kir "bash -n: SÖZDİZİMİ BOZUK"; printf '%s' "$govde" | bash -n 2>&1 | sed 's/^/           /'; fi
      # cd hedefi + dokunulan dosyalar gerçekten var mı (subshell YOK — sayaç korunur)
      local d f
      while read -r d; do
        [ -z "$d" ] && continue
        [ -d "$d" ] && p_ok "cd hedefi VAR: $d" || p_kir "cd hedefi YOK: $d"
      done <<< "$(printf '%s\n' "$govde" | grep -oE "cd '[^']+'" | sed "s/cd '//;s/'$//")"
      while read -r f; do
        [ -z "$f" ] && continue
        if [ -e "$f" ]; then p_ok "dosya VAR: $f"
        else p_bil "dosya YOK (koşul dalında üretilir/beklenir): $f"; fi
      done <<< "$(printf '%s\n' "$govde" | grep -oE "cd '[^']+'" | sed "s/cd '//;s/'\$//" | head -1 |
                  while read -r bd; do printf '%s\n' "$govde" | grep -oE 'wrangler\.toml[a-z.]*' | sort -u |
                    sed "s|^|$bd/|"; done)" ;;
    *) p_bil "doğrulayıcı yok (komut: $1)" ;;
  esac
}

if [ "$PROVA" = "1" ]; then
  yap() {
    local ac="$1"; shift
    PROVA_N=$((PROVA_N+1))
    printf '  %s[%02d]%s %s\n' "$B" "$PROVA_N" "$N" "$ac"
    echo "       \$ $(prova_ac "$@")"
    prova_dogrula "$@"
  }
fi
# ═════════════════════════════════════════════════════════════════════════════

# ═════════════════════════════════════════════════════════════════════════════
g1() {   # kesim adım 5'in tersi
echo
echo "${B}═══ 1) SUNUCU SERVİSLERİNİ BAŞLAT (kesim adım 5'in tersi) ═══${N}"
echo "  ÖN: docker/systemd birimlerinin hiçbiri SİLİNMEDİ (kesim yalnız stop yaptı) — start yeter."
cat <<'EOF'

  🔴 VERİ AYRIŞMASI UYARISI (2026-08-31 denetiminde eklendi — script bunu ONARAMAZ)
  Kesim ile dönüş ARASINDA geçen sürede yazılan her şey YALNIZ D1'dedir:
    · gpsdata → D1 positions (Traccar'da bu aralık BOŞ kalır)
    · /api/*  → D1 rides/users/clubs/dm/friends (social.json'da bu aralık BOŞ kalır)
  Docker backend başlatıldığı anda kendi (eski) social.json'ından okumaya devam eder →
  o aralıktaki sürüşler/arkadaşlıklar/mesajlar kullanıcıda KAYBOLMUŞ görünür.
  DÖNÜŞ SONRASI ELLE: D1'den aralığı çekip social.json'a birleştir. Aralığı bulmak için:
    grep 'UYGULANDI: adim2' /opt/matrix/docs/devir-gunu-kayit.txt     # kesim anı
    grep 'GERI-ALINDI: kisisel-api'  /opt/matrix/docs/devir-gunu-kayit.txt  # dönüş anı
  Kesim 1 saatten kısa sürdüyse kayıp genelde 0'dır — ama ÖLÇMEDEN "yok" DEME.
EOF
adim_onay "docker movelog-api + movelog-cloud + movelog-ptt + 19 timer BAŞLATILACAK"
yap "docker start movelog-api" docker start movelog-api
yap "start movelog-cloud.service" systemctl start movelog-cloud.service
yap "start movelog-ptt.service" systemctl start movelog-ptt.service
TIMERLAR="activity-detect movelog-pending-reconcile movelog-render-bekci movelog-broadcast \
movelog-genreq movelog-rangereq movelog-grupsurus movelog-rearm movelog-integrity-auto \
movelog-olay-watch movelog-video-kontrol movelog-gunluk-rapor movelog-hava movelog-ilkvideo-nudge \
movelog-rozet movelog-kulup-karne movelog-weekly-recap movelog-wrapped movelog-yorum-watch"
for t in $TIMERLAR; do
  systemctl list-unit-files "$t.timer" >/dev/null 2>&1 && yap "start $t.timer" systemctl start "$t.timer"
done
[ "$UYGULA" = "1" ] && kayit "GERI-ALINDI: sunucu servisleri start (docker+cloud+ptt+timer)"
cat <<'EOF'
  ── DOĞRULAMA ──
  $ docker ps --format '{{.Names}}' | grep -c movelog-api        → 1
  $ curl -s -m 5 http://127.0.0.1:8780/health                    → {"ok":true,...}
  $ systemctl is-active movelog-cloud movelog-ptt                → active · active
  $ systemctl list-timers 'movelog-*' --no-pager | tail -3       → NEXT sütunu dolu
EOF
if [ "$UYGULA" = "1" ]; then sleep 5; echo -n "  backend 8780: "; curl -s -m 8 http://127.0.0.1:8780/health | head -c 60; echo; fi
}

# ═════════════════════════════════════════════════════════════════════════════
g2() {   # kesim adım 3'ün tersi
echo
echo "${B}═══ 2) ORTAM: canli → golge (4 worker) — kesim adım 3'ün tersi ═══${N}"
echo "  NEDEN İKİNCİ: gerçek push/RunPod/bekçi-onarım yazımı ilk fırsatta durmalı;"
echo "  route'lar hâlâ dururken bile canlı worker gerçek APNs atıp RunPod'a para harcayabilir."
if ! uygulandi_mi "adim3"; then
  bil "kesimde adım3 uygulanmamış (kayıtta yok) → ATLANIYOR (--zorla ile ezilir)"; return 0
fi
adim_onay "4 worker ORTAM='canli' → 'golge' yapılıp yeniden dağıtılacak"
wr_kimlik || echo "  ${K}!${N} wrangler kimliği yok — deploy başarısız olacak"
for w in cron dispatch gps api; do    # kesimin tersi: cron ÖNCE sussun
  if [ -f "$CF_DIR/$w/wrangler.toml.golge.yedek" ]; then
    yap "movelog-$w: yedekten wrangler.toml geri + deploy" bash -c "
      set -e; cd '$CF_DIR/$w'
      # 🔴 YEDEK ÖNCE DENETLENİR (2026-08-31 denetimi): eski sürüm önce cp yapıp SONRA
      #    grep'liyordu. Yedek bozuksa (canli) çalışan dosya çoktan ezilmiş oluyordu.
      #    Artık bozuk yedek DOKUNULMADAN sed yoluna düşülür.
      if grep -q '^ORTAM = \"golge\"' wrangler.toml.golge.yedek; then
        cp wrangler.toml.golge.yedek wrangler.toml
      else
        echo '  ! yedek golge DEGIL — yedek yok sayıldı, sed ile golge yapılıyor'
        sed -i 's/^ORTAM = \"canli\"/ORTAM = \"golge\"/' wrangler.toml
      fi
      grep -q '^ORTAM = \"golge\"' wrangler.toml
      npx wrangler deploy >/dev/null"
  else
    yap "movelog-$w: ORTAM=golge (yedek yok, sed) + deploy" bash -c "
      set -e; cd '$CF_DIR/$w'
      sed -i 's/^ORTAM = \"canli\"/ORTAM = \"golge\"/' wrangler.toml
      grep -q '^ORTAM = \"golge\"' wrangler.toml
      npx wrangler deploy >/dev/null"
  fi
done
[ "$UYGULA" = "1" ] && kayit "GERI-ALINDI: 4 worker ORTAM=golge"
cat <<'EOF'
  ── DOĞRULAMA ──
  $ for w in gps dispatch cron; do curl -s https://movelog-$w.daclen10.workers.dev/health; echo; done
    beklenen: hepsinde "ortam":"golge"   (dispatch bundan sonra RunPod'a GERÇEK iş atmaz)
EOF
if [ "$UYGULA" = "1" ]; then sleep 8
  for w in gps dispatch cron; do echo -n "  movelog-$w: "; curl -s -m 15 "https://movelog-$w.daclen10.workers.dev/health" | grep -oE '"ortam":"[a-z]+"' || echo "?"; done
fi
}

# ═════════════════════════════════════════════════════════════════════════════
g3() {   # kesim adım 4'ün tersi — G2.1 (harita)
echo
echo "${B}═══ 3) HARİTA ROUTE'LARINI KALDIR (G2.1) — kesim adım 4'ün tersi ═══${N}"
echo "  Worker SİLİNMEZ. Route gidince istekler zone'un o günkü sahibine (hooder-harita) düşer."
cf_kimlik || { echo "  ${K}✗${N} CF kimliği yok"; return 1; }
LST="$(route_listesi | grep '|harita-katman$' || true)"
if [ -z "$LST" ]; then bil "harita-katman route'u YOK — atlanıyor"; return 0; fi
echo "$LST" | sed 's/^/     /'
adim_onay "yukarıdaki harita-katman route'ları SİLİNECEK"
echo "$LST" | while IFS='|' read -r id pat scr; do
  yap "route sil: $pat" cfapi DELETE "/zones/$CF_ZONE_ID/workers/routes/$id"
done
[ "$UYGULA" = "1" ] && kayit "GERI-ALINDI: harita-katman route'lari silindi (G2.1)"
cat <<'EOF'
  ── DOĞRULAMA ──
  $ cd /opt/matrix/cf/harita-katman && python3 test/devir-testi.py
    beklenen: A1'de saklanan temel çizgiyle AYNI (38 OK · 0 FAIL · 1 beklenen-fark · 5 bilgi)
    origin nginx hattına HİÇ dokunulmadı → dönüş anındadır.
EOF
}

# ═════════════════════════════════════════════════════════════════════════════
g4() {   # kesim adım 2'nin tersi
echo
echo "${B}═══ 4) kisisel-api ROUTE + TURUNCU BULUT GERİ AL — kesim adım 2'nin tersi ═══${N}"
cf_kimlik || { echo "  ${K}✗${N} CF kimliği yok"; return 1; }
LST="$(route_listesi | grep '^.*|kisisel-api.nickdegs.com/.*|movelog-api$' || true)"
if [ -z "$LST" ]; then bil "kisisel-api route'u YOK — atlanıyor"
else
  echo "$LST" | sed 's/^/     /'
  adim_onay "kisisel-api route'ları silinecek + DNS proxied=false (gri bulut) yapılacak"
  echo "$LST" | while IFS='|' read -r id pat scr; do
    yap "route sil: $pat" cfapi DELETE "/zones/$CF_ZONE_ID/workers/routes/$id"
  done
fi
r="$(dns_kayit kisisel-api.nickdegs.com)"; set -- $r
if [ -n "${1:-}" ] && [ "${2:-}" = "True" ]; then
  yap "DNS kisisel-api → proxied=false (kesim öncesi durum)" \
    cfapi PATCH "/zones/$CF_ZONE_ID/dns_records/$1" '{"proxied":false}'
else
  bil "kisisel-api DNS zaten proxied=${2:-?} — dokunulmadı"
fi
[ "$UYGULA" = "1" ] && kayit "GERI-ALINDI: kisisel-api route + gri bulut"
cat <<'EOF'
  ── DOĞRULAMA (DNS yayılması ~1 dk) ──
  $ getent hosts kisisel-api.nickdegs.com        → 169.58.124.139 (CF IP'si DEĞİL)
  $ curl -s https://kisisel-api.nickdegs.com/health
    beklenen: docker backend'in cevabı (adım 1'de başlatıldı). Boş/502 ise backend ayağa kalkmamış.
EOF
if [ "$UYGULA" = "1" ]; then sleep 15; echo -n "  çözümleme: "; getent hosts kisisel-api.nickdegs.com | head -1; fi
}

# ═════════════════════════════════════════════════════════════════════════════
g5() {   # kesim adım 1'in tersi
echo
echo "${B}═══ 5) gpsdata ROUTE + TURUNCU BULUT GERİ AL — kesim adım 1'in tersi ═══${N}"
echo "  Dönüşten sonra konumlar yine Traccar'a (127.0.0.1:5147) düşer; /api/tracker'ın"
echo "  döndürdüğü adres HİÇ değişmediği için istemcide yapılacak bir şey YOK."
cf_kimlik || { echo "  ${K}✗${N} CF kimliği yok"; return 1; }
LST="$(route_listesi | grep '|movelog-gps$' || true)"
if [ -z "$LST" ]; then bil "gpsdata route'u YOK — atlanıyor"
else
  echo "$LST" | sed 's/^/     /'
  adim_onay "gpsdata route'u silinecek + DNS proxied=false yapılacak"
  echo "$LST" | while IFS='|' read -r id pat scr; do
    yap "route sil: $pat" cfapi DELETE "/zones/$CF_ZONE_ID/workers/routes/$id"
  done
fi
r="$(dns_kayit gpsdata.nickdegs.com)"; set -- $r
if [ -n "${1:-}" ] && [ "${2:-}" = "True" ]; then
  yap "DNS gpsdata → proxied=false" cfapi PATCH "/zones/$CF_ZONE_ID/dns_records/$1" '{"proxied":false}'
else
  bil "gpsdata DNS zaten proxied=${2:-?} — dokunulmadı"
fi
[ "$UYGULA" = "1" ] && kayit "GERI-ALINDI: gpsdata route + gri bulut"
cat <<'EOF'
  ── DOĞRULAMA ──
  $ getent hosts gpsdata.nickdegs.com   → 169.58.124.139
  $ curl -s -o /dev/null -w '%{http_code}\n' \
      "https://gpsdata.nickdegs.com/?id=99999999&lat=41&lon=29&timestamp=$(date +%s)"   → 200
  $ ss -tnp | grep -c 5147              → Traccar OsmAnd portu yine dinleniyor
EOF
}

# ═════════════════════════════════════════════════════════════════════════════
g6() {   # G2.2
echo
echo "${B}═══ 6) RunPod env geri + wmax 0→N FLUSH (G2.2) ═══${N}"
cat <<EOF
  ⚠️ Sıcak worker ESKİ env'i taşır. env PATCH'inden sonra workersMax 0'a çekilip
     tekrar N'e alınmazsa (flush) yeni değer bir sonraki işte GÖRÜLMEZ.
  ÖLÇÜM (31.08 — kesim öncesi durum, geri dönüşün HEDEFİ bu):
     movelog-render   $RP_EP_RENDER  wmax=$WMAX_RENDER  template=$RP_TPL_RENDER
        BACKEND_URL = https://kisisel-api.nickdegs.com   ← DEĞİŞMEDİ (hostname sabit) → PATCH GEREKMEZ
     movelog-tactical $RP_EP_TAC  wmax=$WMAX_TAC   template=$RP_TPL_TAC
        HARITA_TABAN/_STATIK/_MATCHING/_GEOCODING = https://harita.nickdegs.com/<mevcut önek>
        ← MLOG_ONEK = mevcut önek olduğu sürece DEĞİŞMEDİ → PATCH GEREKMEZ
EOF
rp_kimlik || { echo "  ${K}✗${N} RUNPOD_API_KEY yok"; return 1; }
DEGISTI=0
uygulandi_mi "runpod-env" && DEGISTI=1
if [ "$DEGISTI" = "0" ]; then
  bil "kayıtta 'UYGULANDI: runpod-env' yok → env DEĞİŞMEMİŞ; PATCH atlanıyor (G2 kuralı)"
else
  echo "  ${S}!${N} kesimde env değiştirilmiş — eski değerler runpod-tactical.conf'tan geri yazılmalı (elle teyit)"
fi
echo "  ── wmax durum ölçümü + gerekiyorsa flush ──"
for ep in "$RP_EP_RENDER:$WMAX_RENDER" "$RP_EP_TAC:$WMAX_TAC"; do
  id="${ep%%:*}"; hedef="${ep##*:}"
  w=$(rpapi GET "/endpoints/$id" | python3 -c "import sys,json;print(json.load(sys.stdin).get('workersMax','?'))" 2>/dev/null)
  echo "     $id: workersMax=$w (hedef $hedef)"
  if [ "$w" != "$hedef" ] || [ "$DEGISTI" = "1" ]; then
    yap "flush $id: wmax→0" rpapi PATCH "/endpoints/$id" '{"workersMax":0}'
    [ "$UYGULA" = "1" ] && sleep 5
    yap "flush $id: wmax→$hedef" rpapi PATCH "/endpoints/$id" "{\"workersMax\":$hedef}"
    [ "$UYGULA" = "1" ] && kayit "GERI-ALINDI: runpod $id wmax flush 0->$hedef"
  else
    bil "$id zaten hedefte, flush gereksiz (sıcak worker eski env taşımıyor)"
  fi
done
cat <<'EOF'
  ── DOĞRULAMA ──
  $ curl -s -H "authorization: Bearer $RUNPOD_API_KEY" https://rest.runpod.io/v1/endpoints/<id> | grep workersMax
    beklenen: render 12 · tactical 3   (0 kalırsa /run 409 verir, videolar SESSİZCE durur)
  $ curl -s -o /dev/null -w '%{http_code}\n' -H "authorization: Bearer $RUNPOD_API_KEY" \
      https://api.runpod.ai/v2/<id>/health   → 200
EOF
}

# ═════════════════════════════════════════════════════════════════════════════
g7() {   # G2.3 - G2.6
echo
echo "${B}═══ 7) MUAFİYET YAMALARI / KAYNAK ZİNCİRİ (G2.3-G2.6) ═══${N}"
echo "  G2 kuralı: bunlar YALNIZ kesimde gerçekten uygulandıysa geri alınır."
echo "  Kayıt dosyasında ne var:"
if [ -f "$KAYIT" ]; then grep "UYGULANDI:" "$KAYIT" | sed 's/^/     /' || echo "     (UYGULANDI satırı yok)"
else echo "     ${S}kayıt dosyası hiç oluşmamış → kesimde hiçbir yama uygulanmamış demektir${N}"; fi

echo
echo "  ${B}G2.6 harita-kaynak.json${N} — Hooder 'xyz' satırı kaldırıldıysa geri ekle"
# kanonik yol harita-proxy.py:54 KAYNAK_CONF'tan gelir (tahmin değil, koddan okunur)
KJ=$(grep -oE '^KAYNAK_CONF *= *"[^"]+"' /opt/matrix/scripts/harita-proxy.py 2>/dev/null | grep -oE '"/[^"]+"' | tr -d '"')
KJ="${KJ:-/opt/matrix/harita-kaynak.json}"
if [ ! -f "$KJ" ]; then bil "$KJ bulunamadı"
elif grep -q "hooder-api/sat" "$KJ"; then
  bil "$KJ içinde hooder-api/sat satırı DURUYOR → geri alınacak bir şey yok"
else
  echo "     ${S}!${N} $KJ içinde hooder-api/sat YOK — kesimde çıkarılmış (B5 tek taraflı çıkış yolu)."
  echo "       geri ekle:  {\"tip\":\"xyz\",\"tur\":\"sat\",\"url\":\"https://realvirtuality.app/hooder-api/sat/{z}/{x}/{y}.jpg\",\"minz\":0,\"maxz\":14}"
  echo "       zincir sırası: esri(0-19) → dizin(0-10) → ${B}xyz hooder(0-14)${N} → eox(0-14)"
  echo "       (dosya kaydedilince harita-proxy mtime ile ANINDA alır — restart YOK)"
fi
echo
echo "  ${B}G2.3 harita-proxy drop-in (yama 06)${N}"
if [ -f /etc/systemd/system/harita-proxy.service.d/muafiyet.conf ]; then
  echo "     ${S}!${N} drop-in VAR → ⚠️ Barış onayıyla kaldır:"
  echo "       rm /etc/systemd/system/harita-proxy.service.d/muafiyet.conf && systemctl daemon-reload && systemctl restart harita-proxy"
  echo "       doğrulama: systemctl show harita-proxy -p Environment"
else bil "drop-in YOK → uygulanmamış, geri alınacak bir şey yok"; fi
echo
echo "  ${B}G2.4 sunucu scriptleri (yama 05 + route-video.py)${N}"
echo "     env kaldırılır; kod varsayılanı zaten 127.0.0.1:8890 → doğrulama: movelog-genreq bir tur temiz koşar"
echo "  ${B}G2.5 scripts/test-render-yerel.sh:37 öneki${N} — satır eski haline döndürülür"
echo
echo "  ${B}Faz-2 kaçakları (kesimde önek eklendiyse geri al)${N}"
grep -n "HARITA_TABAN" /opt/matrix/scripts/test-render-yerel.sh 2>/dev/null | sed 's/^/     /' || true
}

# ═════════════════════════════════════════════════════════════════════════════
if [ -n "$TEK_ADIM" ]; then
  case "$TEK_ADIM" in 1) g1;; 2) g2;; 3) g3;; 4) g4;; 5) g5;; 6) g6;; 7) g7;;
    *) echo "geçersiz adım: $TEK_ADIM (1-7)"; exit 2;; esac
else
  g1; g2; g3; g4; g5; g6; g7
fi

echo
echo "${B}═══ DÖNÜŞ SONRASI TEK BAKIŞTA DOĞRULAMA ═══${N}"
cat <<'EOF'
  $ /opt/matrix/cf/tools/kesim-onkontrol.sh
    beklenen: bölüm 3'te "zone worker route sayısı = 0" + gpsdata/kisisel-api proxied=False
              bölüm 2'de 4 worker ORTAM=golge
  $ curl -s https://kisisel-api.nickdegs.com/health     → docker backend cevabı
  $ curl -s https://gpsdata.nickdegs.com/               → Traccar (worker JSON'u DEĞİL)
  $ cd /opt/matrix/cf/harita-katman && python3 test/devir-testi.py   → A1 temel çizgisi
EOF
if [ "$UYGULA" = "1" ]; then
  kayit "GERI-DONUS TAMAMLANDI"
  echo "${B}kayıt yazıldı: $KAYIT${N}"
elif [ "$PROVA" = "1" ]; then
  echo
  echo "${B}═══ PROVA ÖZETİ ═══${N}"
  echo "  basılan komut : $PROVA_N"
  echo "  doğrulama ✓   : $PROVA_OK"
  echo "  doğrulama ✗   : $PROVA_KOTU"
  echo "  ${S}NOT:${N} route silme komutları boru (pipe) alt-kabuğunda üretildiği için"
  echo "        oradaki ✓/✗ satırları ekranda görünür ama sayaca yansımaz."
  [ "$PROVA_KOTU" = "0" ] && echo "  ${Y}PROVA TEMİZ — hiçbir komut çalıştırılmadı.${N}" \
                          || echo "  ${K}PROVA'DA KIRIK VAR — yukarıdaki ✗ satırlarını düzelt.${N}"
else
  echo "${M}KURU tur — hiçbir şey değişmedi. Uygulamak için: $0 --uygula${N}"
fi
