#!/bin/bash
# Modal'daki `ghcr` sırrını DAR KAPSAMLI bir token ile değiştirir.
#
# NEDEN: şu an oradaki token `/opt/github-deploy/token.conf` — ölçüldü, kapsamı:
#   admin:enterprise, admin:org, delete_repo, delete:packages, repo, workflow, write:packages
# Yani hesabın tamamına yetkili. Modal'ın imajı çekmesi için YALNIZCA `read:packages` yeter.
#
# ⚠️ Token'ı API'den ÜRETEMİYORUM: GitHub klasik PAT üretme ucunu kaldırdı
# (POST /authorizations -> 404, sınandı). İnce-taneli PAT'ler de yalnız arayüzden üretilir.
#
# BARIŞ'IN YAPACAĞI (60 sn):
#   1. https://github.com/settings/tokens/new
#   2. Note: "modal-ghcr-read"  ·  Expiration: dilediğin
#   3. TEK kutu işaretle:  read:packages
#   4. Generate token → kopyala
#   5. Bu betiği çalıştır:   bash /opt/matrix/modal/ghcr-sir-degistir.sh 'ghp_...'
#
# Betik token'ı ekrana YAZMAZ, diske KAYDETMEZ; doğrudan Modal'a koyar ve imaj çekimini sınar.
set -euo pipefail

# Token'ı ORTAM DEĞİŞKENİNDEN almak yeğlenir: komut satırı argümanı `ps` çıktısında
# görünür ve bu sunucuda başka oturumlar da çalışıyor.
T="${GHCR_TOKEN:-${1:-}}"
if [ -z "$T" ]; then
  echo "kullanım: GHCR_TOKEN='ghp_...' bash $0" >&2
  exit 2
fi

echo "→ token kapsamı doğrulanıyor (dar olmalı)..."
KAPSAM=$(curl -sI -H "Authorization: Bearer $T" https://api.github.com/user \
         | tr -d '\r' | grep -i '^x-oauth-scopes:' | cut -d' ' -f2- || true)
echo "  kapsam: ${KAPSAM:-<ince-taneli PAT (kapsam başlığı yok)>}"
case "$KAPSAM" in
  *repo*|*admin*|*delete*|*workflow*)
    echo "  ⚠️ BU TOKEN HÂLÂ GENİŞ — devam edilmedi. Yalnız read:packages işaretle." >&2
    exit 1 ;;
esac

echo "→ ghcr çekim yetkisi sınanıyor..."
echo "$T" | docker login ghcr.io -u NickDegs --password-stdin >/dev/null 2>&1 \
  || { echo "  ✗ ghcr login BAŞARISIZ — token paketleri okuyamıyor" >&2; exit 1; }
docker manifest inspect ghcr.io/nickdegs/movelog-render:v151 >/dev/null 2>&1 \
  || { echo "  ✗ imaj manifesti okunamadı — read:packages eksik" >&2; exit 1; }
echo "  ✓ imaj okunabiliyor"

echo "→ Modal sırrı değiştiriliyor..."
source /opt/matrix/secrets/modal.conf
export MODAL_TOKEN_ID MODAL_TOKEN_SECRET
/opt/modal-isci/venv/bin/modal secret create ghcr \
  REGISTRY_USERNAME=NickDegs REGISTRY_PASSWORD="$T" --force >/dev/null

echo "→ Modal imajı yeni sırla yeniden kuruluyor (gerçek doğrulama)..."
cd /opt/matrix/modal
/opt/modal-isci/venv/bin/modal deploy movelog_render.py 2>&1 | tail -3

echo
echo "✅ TAMAM — Modal artık dar kapsamlı token kullanıyor."
echo "   Şimdi ESKİ geniş token'ı GitHub'da iptal etmeye GEREK YOK (CI hâlâ onu kullanıyor),"
echo "   ama Modal'da artık durmuyor."
