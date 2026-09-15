#!/bin/bash
# Sunucu bildirim sistemi - Matrix'e mesaj gönderir

MATRIX_URL="http://localhost:8008"
MATRIX_TOKEN="SIR_KALDIRILDI_bkz_secrets_MATRIX_TOKEN"
ALERT_ROOM="!tEMLCGLeSPbEjygOrG:nickdegs.duckdns.org"

notify() {
    local msg="$1"
    local txn_id=$(date +%s%N)
    curl -s -X PUT \
        "${MATRIX_URL}/_matrix/client/v3/rooms/${ALERT_ROOM}/send/m.room.message/${txn_id}" \
        -H "Authorization: Bearer ${MATRIX_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{\"msgtype\":\"m.text\",\"body\":\"${msg}\"}" > /dev/null 2>&1
}

notify "$1"
