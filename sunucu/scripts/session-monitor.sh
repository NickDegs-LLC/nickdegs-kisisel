#!/bin/bash
# Tüm tmux oturumlarının boşta olup olmadığını kontrol eder
# 0 döndürürse boşta, 1 döndürürse aktif

SESSIONS="matrix media server yedek1 yedek2"
ACTIVE=0

for s in $SESSIONS; do
    # Oturumun son çıktısını al
    output=$(tmux capture-pane -t "$s" -p 2>/dev/null)

    # Aktif işlem belirtileri (sadece gerçek tool çalışması)
    if echo "$output" | grep -qE "Running…|Executing|Building|Downloading|Installing|apt-get|docker pull|npm install|⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏"; then
        echo "AKTIF: $s oturumunda işlem devam ediyor"
        ACTIVE=1
    fi
done

if [[ $ACTIVE -eq 0 ]]; then
    echo "BOŞ: Tüm oturumlar boşta"
    exit 0
else
    exit 1
fi
