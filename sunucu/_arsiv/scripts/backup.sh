#!/bin/bash
# Otomatik yedek sistemi - Local + GDrive

BACKUP_DIR="/opt/matrix/backups"
DATE=$(date '+%Y%m%d_%H%M%S')
BACKUP_FILE="$BACKUP_DIR/backup_$DATE.tar.gz"
LOG="/var/log/backup.log"
NOTIFY="/opt/matrix/scripts/notify.sh"
KEEP_DAYS=7

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG"; }

mkdir -p "$BACKUP_DIR"
log "=== Yedek başladı ==="
$NOTIFY "💾 Günlük yedek başladı..."

# PostgreSQL tam dump
log "PostgreSQL yedekleniyor..."
docker exec matrix-postgres pg_dumpall -U mas > "$BACKUP_DIR/postgres_$DATE.sql" 2>/dev/null && \
    log "OK: PostgreSQL dump alındı" || log "HATA: PostgreSQL dump alınamadı"

# NOT (2026-08-01): Synapse artik SQLite degil PostgreSQL kullaniyor.
# Verisi yukaridaki pg_dumpall ciktisinda ("synapse" DB'si) zaten var.
# Eski /opt/matrix/data/homeserver.db ARTIK CANLI DEGIL — yedeklenmiyor.

# Tüm config + DB'ler tek arşiv
tar -czf "$BACKUP_FILE" \
    /opt/matrix/data/homeserver.yaml \
    /opt/matrix/mas-config.yaml \
    /opt/matrix/docker-compose.yml \
    /opt/matrix/bridges/ \
    /opt/matrix/mjolnir/ \
    /opt/matrix/maubot/ \
    /opt/matrix/scripts/ \
    /opt/mediastack/docker-compose.yml \
    /opt/n8n/workflows/ \
    /opt/podcast/ \
    /etc/nginx/sites-available/ \
    /etc/systemd/system/auto-heal.* \
    /etc/systemd/system/backup.* \
    "$BACKUP_DIR/postgres_$DATE.sql" \
    2>/dev/null

SIZE=$(du -sh "$BACKUP_FILE" 2>/dev/null | cut -f1)
log "Arşiv oluşturuldu: $BACKUP_FILE ($SIZE)"

# Temp dosyaları sil
rm -f "$BACKUP_DIR/postgres_$DATE.sql"

# GDrive'a yükle
log "GDrive'a yükleniyor..."
rclone copy "$BACKUP_FILE" "gdrive:Backups/server/" \
    --transfers 4 \
    >> "$LOG" 2>&1

if [[ $? -eq 0 ]]; then
    log "OK: GDrive yükleme tamamlandı"
    $NOTIFY "✅ Yedek tamamlandı ($SIZE) — GDrive'a yüklendi"
else
    log "HATA: GDrive yüklenemedi (local kopyası var: $BACKUP_FILE)"
    $NOTIFY "⚠️ Yedek local alındı ($SIZE) ama GDrive'a yüklenemedi!"
fi

# Eski local yedekleri temizle (7 günden eskiler)
find "$BACKUP_DIR" -name "backup_*.tar.gz" -mtime +$KEEP_DAYS -delete
log "Eski yedekler temizlendi (>$KEEP_DAYS gün)"
log "=== Yedek tamamlandı ==="
