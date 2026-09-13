#!/usr/bin/env bash
# Move Log CF — sırları wrangler'a yükler. Envanter: /opt/matrix/cf/SECRETS.md
# KURAL: sır DEĞERİ asla ekrana/log'a yazılmaz; bu scripti `bash -x` ile ÇALIŞTIRMA.
# Kullanım:
#   secrets-push.sh --dry-run            # yalnız worker+ad+kaynak basar, hiçbir şey yüklemez
#   secrets-push.sh                      # tümünü yükler (GCP_SERVICE_ACCOUNT hariç — opsiyonel)
#   secrets-push.sh --with-gcp           # opsiyonel GCP Pub/Sub fallback sırrını da yükler
#   secrets-push.sh --only movelog-api   # tek worker
set -euo pipefail
set +x 2>/dev/null || true

DRY=0; WITH_GCP=0; ONLY=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --with-gcp) WITH_GCP=1 ;;
    --only) ONLY="${2:?--only worker adi ister}"; shift ;;
    *) echo "bilinmeyen bayrak: $1" >&2; exit 2 ;;
  esac; shift
done

CF_CONF=/opt/matrix/secrets/movelog-cf.conf
CONFIG_ENV=/opt/movelog/backend/config.env
RUNPOD_CONF=/opt/matrix/secrets/runpod.conf
LIVEKIT_CONF=/opt/matrix/secrets/livekit-cloud.conf   # 02.09: LiveKit Cloud'a taşındı, kaynak ARTIK config.env DEĞİL
# NOT: MAPBOX_SECRET_TOKEN push edilmez (denetim 2026-08-30) — worker tüketicileri
# MAPBOX_PUBLIC_TOKEN kullanıyor (movelog-cloud.py:167, activity-detect.py:29) ve o
# public oldugu icin wrangler.toml [vars]'a gider, sır değil. Bkz SECRETS.md bölüm 2/3.
APNS_P8=/opt/github-deploy/apple/AuthKey_CAAF5X8DD3.p8
FCM_SA=/opt/github-deploy/google-play-admin.json
GCP_SA=/opt/matrix/secrets/gcp-movelog.json

# --- wrangler: önce yereldeki, yoksa global
WRANGLER=/opt/matrix/cf/node_modules/.bin/wrangler
[[ -x "$WRANGLER" ]] || WRANGLER="$(command -v wrangler || true)"
if [[ $DRY -eq 0 && -z "$WRANGLER" ]]; then echo "HATA: wrangler bulunamadi" >&2; exit 1; fi

# --- config.env kapısı (02.09): /opt/movelog SİLİNDİ (Move Log sunucudan kaldırıldı).
# Eskiden dosya yoksa her sır tek tek "ATLA" deyip çıkış 0 veriyordu → "yükledim" sanılırdı.
# Artık yüksek sesle durur. Geri getirmek için:
#   tar -I zstd -xf /opt/matrix/yedek/movelog-sunucu-20260902.tar.zst -C / opt/movelog/backend/config.env
# ⚠️ O dosyadaki LIVEKIT_* değerleri ESKİ self-host'a aittir; LiveKit artık livekit-cloud.conf'tan gelir.
if [[ $DRY -eq 0 && ! -r "$CONFIG_ENV" ]]; then
  echo "HATA: $CONFIG_ENV yok — Move Log 2026-09-02'de sunucudan kaldirildi." >&2
  echo "      Yedekten cikarin (bkz. yukaridaki tar komutu) ya da --dry-run ile calistirin." >&2
  exit 1
fi

# --- conf'tan tek değer (değer stdout'a DÖNER, ekrana basılmaz)
conf_get() { # $1 dosya, $2 anahtar
  awk -F= -v k="$2" '!/^[[:space:]]*#/ && $1==k { sub(/^[^=]*=/,""); print; exit }' "$1"
}

# --- Cloudflare kimliği (değer yazmadan export) — dry-run sır dosyasına HİÇ dokunmaz
if [[ $DRY -eq 0 ]]; then
  if [[ ! -r "$CF_CONF" ]]; then echo "HATA: $CF_CONF okunamiyor" >&2; exit 1; fi
  CLOUDFLARE_API_TOKEN="$(conf_get "$CF_CONF" MOVELOG_CF_TOKEN)"
  CLOUDFLARE_ACCOUNT_ID="$(conf_get "$CF_CONF" MOVELOG_CF_ACCOUNT_ID)"
  if [[ -z "$CLOUDFLARE_API_TOKEN" ]]; then echo "HATA: MOVELOG_CF_TOKEN $CF_CONF icinde bos/yok" >&2; exit 1; fi
  export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
  echo "CLOUDFLARE_API_TOKEN export edildi (kaynak: $CF_CONF, deger gizli)"
fi

FAIL=0; OK=0; SKIP=0

push() { # $1 worker, $2 sirAdi, $3 tip(conf|file), $4 kaynak, $5 confAnahtari(conf ise)
  local worker="$1" name="$2" typ="$3" src="$4" key="${5:-}"
  [[ -n "$ONLY" && "$worker" != "$ONLY" ]] && return 0
  if [[ $DRY -eq 1 ]]; then
    printf '[dry] %-16s %-24s <- %s%s\n' "$worker" "$name" "$src" "${key:+ [$key]}"
    return 0
  fi
  if [[ ! -r "$src" ]]; then
    echo "ATLA: $worker/$name — kaynak okunamiyor: $src"; SKIP=$((SKIP+1)); return 0
  fi
  local val
  if [[ "$typ" == "conf" ]]; then val="$(conf_get "$src" "$key")"; else val="$(cat "$src")"; fi
  if [[ -z "$val" ]]; then
    echo "ATLA: $worker/$name — kaynakta bos ($src${key:+ [$key]})"; SKIP=$((SKIP+1)); return 0
  fi
  # değer yalnız stdin üzerinden wrangler'a gider; komut satırında/log'da görünmez
  if printf '%s' "$val" | "$WRANGLER" secret put "$name" --name "$worker" >/dev/null 2>&1; then
    echo "OK  : $worker/$name"; OK=$((OK+1))
  else
    echo "HATA: $worker/$name yuklenemedi (wrangler cikti bastirildi)"; FAIL=$((FAIL+1))
  fi
  unset val
}

# ============ ATAMA TABLOSU (SECRETS.md bolum 1 ile birebir) ============
# --- movelog-api (19 sir) — LIVEKIT_URL sir olarak eklendi (Gorev C 2026-08-30; gizli degil ama
#     kaynak tek: config.env; [vars]'a deger kopyalamak yerine ayni boru hattindan gider)
for K in JWT_SECRET USERS TRACCAR_USER TRACCAR_PASS TWILIO_SID TWILIO_TOKEN \
         TWILIO_VERIFY_SID TWILIO_ACCOUNT_SID GIFT_ADMIN_SECRET REVIEW_PHONE REVIEW_CODE \
         R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY RENDER_DONE_SECRET; do
  push movelog-api "$K" conf "$CONFIG_ENV" "$K"
done
# LIVEKIT_* (02.09): self-host SİLİNDİ → LiveKit Cloud. config.env'deki ESKİ değerler artık ÖLÜ;
# oradan push etmek telsizi bozar. Tek kaynak: livekit-cloud.conf
for K in LIVEKIT_KEY LIVEKIT_SECRET LIVEKIT_URL; do
  push movelog-api "$K" conf "$LIVEKIT_CONF" "$K"
done
push movelog-api APNS_AUTH_KEY       file "$APNS_P8"
push movelog-api FCM_SERVICE_ACCOUNT file "$FCM_SA"

# --- movelog-gps: sir YOK (OsmAnd ingest deviceid ile; yalniz D1 binding)

# --- movelog-dispatch (4 + opsiyonel GCP) — Mapbox public token [vars]'a gider, burada degil
push movelog-dispatch RUNPOD_API_KEY       conf "$RUNPOD_CONF" RUNPOD_API_KEY
push movelog-dispatch RENDER_DONE_SECRET   conf "$CONFIG_ENV"  RENDER_DONE_SECRET
push movelog-dispatch R2_ACCESS_KEY_ID     conf "$CONFIG_ENV"  R2_ACCESS_KEY_ID
push movelog-dispatch R2_SECRET_ACCESS_KEY conf "$CONFIG_ENV"  R2_SECRET_ACCESS_KEY
if [[ $WITH_GCP -eq 1 ]]; then
  push movelog-dispatch GCP_SERVICE_ACCOUNT file "$GCP_SA"
elif [[ $DRY -eq 1 && ( -z "$ONLY" || "$ONLY" == movelog-dispatch ) ]]; then
  echo "[dry] movelog-dispatch GCP_SERVICE_ACCOUNT <- $GCP_SA (OPSIYONEL, --with-gcp ile)"
fi

# --- movelog-cron (8 sir) — Mapbox public token [vars]'a gider, burada degil
push movelog-cron TRACCAR_USER         conf "$CONFIG_ENV"  TRACCAR_USER
push movelog-cron TRACCAR_PASS         conf "$CONFIG_ENV"  TRACCAR_PASS
push movelog-cron RUNPOD_API_KEY       conf "$RUNPOD_CONF" RUNPOD_API_KEY
push movelog-cron R2_ACCESS_KEY_ID     conf "$CONFIG_ENV"  R2_ACCESS_KEY_ID
push movelog-cron R2_SECRET_ACCESS_KEY conf "$CONFIG_ENV"  R2_SECRET_ACCESS_KEY
push movelog-cron RENDER_DONE_SECRET   conf "$CONFIG_ENV"  RENDER_DONE_SECRET
push movelog-cron APNS_AUTH_KEY        file "$APNS_P8"
push movelog-cron FCM_SERVICE_ACCOUNT  file "$FCM_SA"

if [[ $DRY -eq 1 ]]; then
  echo "--- dry-run bitti (hicbir sey yuklenmedi)"
else
  echo "--- bitti: OK=$OK ATLA=$SKIP HATA=$FAIL"
  [[ $FAIL -eq 0 ]] || exit 1
fi
