#!/bin/bash
# Günlük sabah sağlık raporu - Matrix'e gönderir

NOTIFY="/opt/matrix/scripts/notify.sh"

# Sistem bilgileri
UPTIME=$(uptime -p | sed 's/up //')
CPU_LOAD=$(uptime | awk -F'load average:' '{print $2}' | xargs)
MEM_USED=$(free -h | awk '/^Mem:/{print $3}')
MEM_TOTAL=$(free -h | awk '/^Mem:/{print $2}')
DISK_USED=$(df -h / | awk 'NR==2{print $3}')
DISK_TOTAL=$(df -h / | awk 'NR==2{print $2}')
DISK_PCT=$(df / | awk 'NR==2{print $5}')

# Container sayıları
RUNNING=$(docker ps -q | wc -l)
STOPPED=$(docker ps -a -q | wc -l)
STOPPED=$((STOPPED - RUNNING))

# SSL günleri
SSL_DAYS=$(certbot certificates 2>/dev/null | grep "Expiry" | grep -oP '\d+(?= days)')

MSG="📊 Günlük Sunucu Raporu — $(date '+%d %B %Y')

🖥️ Sistem: ${UPTIME} çalışıyor
💻 CPU yükü: ${CPU_LOAD}
🧠 RAM: ${MEM_USED} / ${MEM_TOTAL}
💾 Disk: ${DISK_USED} / ${DISK_TOTAL} (${DISK_PCT})

🐳 Docker: ${RUNNING} aktif, ${STOPPED} durmuş
🔐 SSL: ${SSL_DAYS} gün geçerli

$(docker ps --format "  • {{.Names}}: {{.Status}}" | grep -v "healthy\|Up" | head -5)"

$NOTIFY "$MSG"
