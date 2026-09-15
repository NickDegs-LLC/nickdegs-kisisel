#!/bin/bash
# matrix-session-snapshot.sh
# Saatlik otomatik durum özeti — yalnızca matrix oturumu.
# Çıktı: /root/.claude/projects/-opt-matrix/memory/matrix_state_snapshot.md
# Diğer oturumlara (server/media/yedek) DOKUNMAZ. API anahtarı hardcode YOK.

set -uo pipefail

MEMORY_DIR="/root/.claude/projects/-opt-matrix/memory"
OUT="$MEMORY_DIR/matrix_state_snapshot.md"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M UTC')
HOSTNAME_STR=$(hostname)

mkdir -p "$MEMORY_DIR"

# ── Yardımcı ───────────────────────────────────────────────────────────
b2h() {
    local b=$1
    if   [ "$b" -ge 1073741824 ]; then printf "%.1fG" "$(echo "$b 1073741824" | awk '{printf "%.1f",$1/$2}')";
    elif [ "$b" -ge 1048576 ];    then printf "%.1fM" "$(echo "$b 1048576"    | awk '{printf "%.1f",$1/$2}')";
    else printf "%dK" "$(( b / 1024 ))"; fi
}
cstat() { local s; s=$(docker inspect --format='{{.State.Status}}' "$1" 2>/dev/null); echo "${s:-yok}"; }
chealth() { docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}' "$1" 2>/dev/null || echo "-"; }
http_check() {
    local code; code=$(curl -sf --max-time 4 -o /dev/null -w "%{http_code}" "$1" 2>/dev/null || echo "000")
    [[ "$code" =~ ^[23] ]] && echo "UP[$code]" || echo "DOWN[$code]"
}

# ── Matrix container'ları (compose'dan dinamik) ────────────────────────
MATRIX_COMPOSE="/opt/matrix/docker-compose.yml"
MATRIX_CONTAINERS=$(grep "container_name:" "$MATRIX_COMPOSE" 2>/dev/null | awk '{print $2}')

# ── Sistem metrikleri ──────────────────────────────────────────────────
UPTIME_STR=$(uptime -p 2>/dev/null || uptime)
LOAD=$(awk '{print $1" "$2" "$3}' /proc/loadavg)
MEM_TOTAL=$(awk '/MemTotal/{print $2*1024}' /proc/meminfo)
MEM_AVAIL=$(awk '/MemAvailable/{print $2*1024}' /proc/meminfo)
MEM_USED=$(( MEM_TOTAL - MEM_AVAIL ))
MEM_PCT=$(( MEM_USED * 100 / MEM_TOTAL ))

# ── Synapse sağlık ─────────────────────────────────────────────────────
SYNAPSE_HEALTH=$(http_check "http://localhost:8008/health")

# ── Matrix container durum tablosu + uyarılar ──────────────────────────
TABLE=""; WARN=""
while IFS= read -r c; do
    [ -z "$c" ] && continue
    st=$(cstat "$c"); he=$(chealth "$c")
    # Hiç oluşturulmamış container'ı (compose'da tanımlı ama yok) atla
    [ "$st" = "yok" ] && continue
    TABLE+=$(printf "  %-22s %-10s %s\n" "$c" "$st" "$he")$'\n'
    # mautrix-telegram bilinçli kapalı (api_id bekleniyor) — uyarı verme
    [ "$st" != "running" ] && [ "$c" != "mautrix-telegram" ] && WARN+="  ⚠ $c çalışmıyor ($st)"$'\n'
    [ "$he" = "unhealthy" ] && WARN+="  ⚠ $c unhealthy"$'\n'
done <<< "$MATRIX_CONTAINERS"

[ -z "$WARN" ] && BANNER="✅ MATRIX SAĞLIKLI" || BANNER="⚠️ DİKKAT GEREKİYOR"

# ── Yaz ────────────────────────────────────────────────────────────────
{
cat << HEADER
---
name: matrix_state_snapshot
description: "Saatlik matrix oturumu durum özeti — son güncelleme ${TIMESTAMP}"
metadata:
  type: project
  auto_generated: true
  session: matrix
---

# Matrix Oturumu — Anlık Durum

**${BANNER}**
**Zaman:** ${TIMESTAMP} | **Host:** ${HOSTNAME_STR}
**Uptime:** ${UPTIME_STR} | **Load:** ${LOAD}
**RAM (host geneli):** $(b2h $MEM_USED) / $(b2h $MEM_TOTAL) (%${MEM_PCT})
**Synapse API (/health):** ${SYNAPSE_HEALTH}
HEADER

if [ -n "$WARN" ]; then echo ""; echo "## Uyarılar"; echo "$WARN"; fi

cat << BODY

---

## Matrix Container Durumu
\`\`\`
$(printf "  %-22s %-10s %s\n" "CONTAINER" "DURUM" "HEALTH")
$(printf "  %-22s %-10s %s\n" "---------" "-----" "------")
${TABLE}\`\`\`

---
*Script: /opt/matrix/scripts/matrix-session-snapshot.sh*
*Timer: matrix-session-snapshot.timer (her saat, flock korumalı)*
BODY
} > "$OUT"
