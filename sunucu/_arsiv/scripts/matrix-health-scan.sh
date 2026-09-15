#!/bin/bash
# matrix-health-scan.sh — Saatlik son-kullanıcı arayüz + performans + hata taraması.
# SADECE matrix oturumunun alanı (kendi container'ları + matrix subdomainleri).
# Bulunan sorunları DOĞRUDAN düzeltir (container restart), kalıcı/kritik durumu
# veya yapılan düzeltmeyi Telegram matrix topiğine bildirir. Sorun yoksa SESSİZ.
# Kurulum: matrix oturumu, 2026-06-14. systemd: matrix-health-scan.timer (1h).
set -u
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

LOG=/var/log/matrix-health-scan.log
STAMP=$(date '+%Y-%m-%d %H:%M:%S')
PROBLEMS=()   # kalıcı/raporlanacak sorunlar
FIXES=()      # yapılan otomatik düzeltmeler

log(){ echo "[$STAMP] $*" >> "$LOG"; }

# --- 1) Container sağlığı (matrix + extra-apps compose) — exited/unhealthy → restart ---
check_compose(){
  local dir="$1" label="$2"
  [ -f "$dir/docker-compose.yml" ] || return 0
  # her servis: isim ve durum
  while IFS=$'\t' read -r name state; do
    [ -z "$name" ] && continue
    case "$state" in
      *running*healthy*|*running*|"Up"*healthy*|"Up"*)
        # unhealthy kontrolü ayrı (Up ama unhealthy olabilir)
        if echo "$state" | grep -qi "unhealthy"; then
          log "UNHEALTHY: $name ($state) — restart deneniyor"
          if (cd "$dir" && docker compose restart "$name" >/dev/null 2>&1); then
            FIXES+=("🔄 $name unhealthy idi, restart edildi ($label)")
          else
            PROBLEMS+=("❌ $name unhealthy, restart BAŞARISIZ ($label)")
          fi
        fi
        ;;
      *exited*|*Exited*|*dead*|*restarting*|*Restarting*|*created*)
        log "DOWN: $name ($state) — başlatılıyor"
        if (cd "$dir" && docker compose up -d "$name" >/dev/null 2>&1); then
          FIXES+=("▶️ $name kapalıydı ($state), başlatıldı ($label)")
        else
          PROBLEMS+=("❌ $name kapalı, başlatma BAŞARISIZ ($label)")
        fi
        ;;
    esac
  done < <(cd "$dir" && docker compose ps -a --format '{{.Name}}\t{{.Status}}' 2>/dev/null)
}
check_compose /opt/matrix "matrix"
check_compose /opt/apps/extra "extra-apps"

# --- 2) HTTP erişilebilirlik (matrix subdomainleri) — 5xx / bağlantı hatası = sorun ---
# 2xx/3xx/401/403 = nginx+upstream ayakta (kabul). 5xx/000(timeout/conn) = sorun.
# NOT: her app KENDİ çalışan hostname'inde (bazıları .duckdns.org, bazıları .com).
# Doğrulanmış liste (2026-06-14). Yeni app eklenince buraya gerçek URL'iyle ekle.
# ⚠️ 2026-08-05: 12 ek uygulama (Memos/Vikunja/FreshRSS/Trilium/Joplin/Planka/Firefly/
# Ghostfolio/Syncthing/Changedetection/Dawarich/Panel) Barış'ın talebiyle KALDIRILDI
# ("kullanmıyorum"). Bu yüzden izleme listesinden de çıkarıldılar -> boşuna 502 alarmı gitmesin.
# Geri kurulurlarsa URL'leriyle buraya tekrar eklenmeli.
# ⚠️ 2026-09-02: Traccar (gps/gpsdata) SİLİNDİ — GPS artık CF Worker'da (gpsdata.nickdegs.com),
# Move Log sunucudan tamamen kaldırıldı (yedek: /opt/matrix/yedek/movelog-sunucu-20260902.tar.zst).
# kisisel-api.nickdegs.com artık Cloudflare Worker (sunucu vhost'u yok); /health CF'den 200 döner.
ENDPOINTS=(
  "https://nickdegs.duckdns.org|Element/Matrix"
  "https://app.nickdegs.com|Kisisel App (PWA)"
  "https://kisisel-api.nickdegs.com/health|Kisisel App API"
)
# GÜNCEL iPhone Safari User-Agent — cihaz/mobil uyumluluk kontrolü için.
# 2026-06: en yeni seri iPhone 17 / 17 Pro / Pro Max, iOS 26. iPhone 18 (iOS 27) sonbaharda gelecek.
# iPhone 18 / iOS 27 çıkınca bu satırı güncelle (OS sürümü + Version/ numarası).
MOBILE_UA="Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1"

# Geçici yük/yavaşlık yanlış alarm vermesin: timeout/5xx olursa 8sn bekle, 2 kez daha dene.
# Gerçek arıza tüm denemelerde düşer; ağır background job sırasındaki anlık yavaşlık elenir.
# 2. arg verilirse o User-Agent ile (güncel iPhone) ister.
probe(){ curl -s -o /dev/null -w '%{http_code}' --max-time 20 -L ${2:+-A "$2"} "$1" 2>/dev/null; }
for e in "${ENDPOINTS[@]}"; do
  url="${e%%|*}"; name="${e##*|}"
  code=$(probe "$url")
  if [ "$code" = "000" ] || [ "${code:0:1}" = "5" ]; then
    for try in 1 2; do
      sleep 8
      code=$(probe "$url")
      { [ "$code" != "000" ] && [ "${code:0:1}" != "5" ]; } && break
    done
  fi
  if [ "$code" = "000" ]; then
    log "ENDPOINT FAIL: $name $url → bağlantı yok/timeout (3 deneme)"
    PROBLEMS+=("🔌 $name erişilemiyor ($url) — timeout/bağlantı yok (3 deneme)")
  elif [ "${code:0:1}" = "5" ]; then
    log "ENDPOINT 5xx: $name $url → $code (3 deneme)"
    PROBLEMS+=("🟥 $name HTTP $code ($url) — upstream hatası (3 deneme)")
  else
    log "OK: $name $url → $code"
    # CİHAZ KONTROLÜ: masaüstü çalışıyorsa güncel iPhone UA ile de dene.
    # Sadece mobilde bozuluyorsa (5xx/timeout) raporla — masaüstü zaten OK.
    mcode=$(probe "$url" "$MOBILE_UA")
    if [ "$mcode" = "000" ] || [ "${mcode:0:1}" = "5" ]; then
      sleep 8; mcode=$(probe "$url" "$MOBILE_UA")
    fi
    if [ "$mcode" = "000" ] || [ "${mcode:0:1}" = "5" ]; then
      log "MOBILE FAIL: $name $url → iPhone UA $mcode (masaüstü OK)"
      PROBLEMS+=("📱 $name güncel iPhone'da açılmıyor ($url) — mobil $mcode, masaüstü OK")
    else
      log "MOBILE OK: $name → iPhone UA $mcode"
    fi
  fi
done

# --- 3) TLS sertifika son kullanım (matrix ana sertifika) — <10 gün = uyarı ---
for host in nickdegs.duckdns.org nickdegs.com; do
  exp=$(echo | timeout 15 openssl s_client -servername "$host" -connect "$host":443 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  if [ -n "$exp" ]; then
    exp_ts=$(date -d "$exp" +%s 2>/dev/null)
    now_ts=$(date +%s)
    days=$(( (exp_ts - now_ts) / 86400 ))
    log "TLS $host: $days gün kaldı"
    [ "$days" -lt 10 ] && PROBLEMS+=("🔐 TLS sertifikası $host $days gün içinde doluyor")
  fi
done

# --- 4) Disk & bellek eşikleri ---
DISK_ROOT=$(df / | awk 'NR==2{gsub("%","",$5); print $5}')
[ "${DISK_ROOT:-0}" -ge 90 ] && PROBLEMS+=("💾 Kök disk %$DISK_ROOT dolu")
if mountpoint -q /mnt/HC_Volume_105825100 2>/dev/null || df /var/lib/docker >/dev/null 2>&1; then
  DISK_VOL=$(df /var/lib/docker | awk 'NR==2{gsub("%","",$5); print $5}')
  [ "${DISK_VOL:-0}" -ge 90 ] && PROBLEMS+=("💾 Docker/volume diski %$DISK_VOL dolu")
fi
MEM_AVAIL=$(free | awk '/Mem:/{printf "%d", $7/$2*100}')
[ "${MEM_AVAIL:-100}" -lt 8 ] && PROBLEMS+=("🧠 Boş bellek %$MEM_AVAIL (düşük)")

# --- 5) Container log hata taraması (son 1 saat, matrix container'ları) ---
for c in synapse mas matrix-postgres element coturn; do
  docker inspect "$c" >/dev/null 2>&1 || continue
  errs=$(docker logs --since 1h "$c" 2>&1 | grep -icE "error|fatal|panic|traceback|exception" 2>/dev/null)
  log "LOG $c: $errs hata satırı (1h)"
  # Yüksek hata yoğunluğu (>50/saat) = dikkat
  [ "${errs:-0}" -gt 50 ] && PROBLEMS+=("📛 $c logunda son 1 saatte $errs hata satırı")
done

# --- Raporlama: sadece düzeltme yapıldıysa veya kalıcı sorun varsa Telegram'a ---
TG_SCRIPT=/opt/claude-bridge/reply.sh
if [ ${#FIXES[@]} -gt 0 ] || [ ${#PROBLEMS[@]} -gt 0 ]; then
  MSG="🩺 Sağlık taraması ($(date '+%H:%M'))"
  [ ${#FIXES[@]} -gt 0 ]    && MSG+=$'\n\n✅ Düzeltildi:'    && for f in "${FIXES[@]}";    do MSG+=$'\n• '"$f"; done
  [ ${#PROBLEMS[@]} -gt 0 ] && MSG+=$'\n\n⚠️ Dikkat:'        && for p in "${PROBLEMS[@]}"; do MSG+=$'\n• '"$p"; done
  log "RAPOR gönderiliyor: ${#FIXES[@]} düzeltme, ${#PROBLEMS[@]} sorun"
  [ -x "$TG_SCRIPT" ] && "$TG_SCRIPT" "health-$(date +%s)" matrix "$MSG" >/dev/null 2>&1
else
  log "Temiz: sorun yok, sessiz kalındı"
fi
exit 0
