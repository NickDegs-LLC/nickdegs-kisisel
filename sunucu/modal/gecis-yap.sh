#!/bin/bash
# RunPod → Modal geçişi (ve geri dönüşü). Ayrıntı: /opt/matrix/modal/GECIS-HAZIR.md
#
# TASARIM: motor seçimi KV bayrağında (`dispatch:motor`), kodda değil.
#   · geçiş  = kod dağıt (bir kez) + bayrağı 'modal' yap
#   · dönüş  = bayrağı 'runpod' yap (YENİDEN DAĞITIM YOK, saniyeler içinde)
# Bu, "geri alamıyoruz" riskini ortadan kaldırır.
set -euo pipefail

YAMA=/opt/matrix/modal/dispatch-modal.patch
KAYNAK=/opt/matrix/cf/dispatch/src/index.ts
KV_NS=fd5db982178f49c589858c525755fba7

source /opt/matrix/secrets/movelog-cf.conf
export CLOUDFLARE_API_TOKEN="$MOVELOG_CF_TOKEN" WRANGLER_SEND_METRICS=false
export CLOUDFLARE_ACCOUNT_ID="${MOVELOG_CF_ACCOUNT_ID:-45241304800d3e122aced1f0ae599943}"
CF_EMAIL= CF_TOKEN= CF_GLOBAL_KEY=; export CF_EMAIL CF_TOKEN CF_GLOBAL_KEY

bayrak() {
  cd /opt/matrix/cf/dispatch
  npx wrangler kv key put --namespace-id "$KV_NS" --remote "dispatch:motor" "\"$1\"" >/dev/null 2>&1
  echo "  bayrak: dispatch:motor = $1"
}

if [ "${1:-}" = "--geri" ]; then
  bayrak runpod
  echo "✅ RunPod'a dönüldü (yeniden dağıtım gerekmedi)."
  exit 0
fi

if [ "${1:-}" = "--durum" ]; then
  cd /opt/matrix/cf/dispatch
  echo -n "  şu anki motor: "
  npx wrangler kv key get --namespace-id "$KV_NS" --remote "dispatch:motor" 2>/dev/null || echo '(ayarsız = runpod)'
  exit 0
fi

echo "→ 1/4 Modal sağlığı (geçmeden ÖNCE, kör geçiş yok)"
cd /opt/matrix/modal
source /opt/matrix/secrets/modal.conf; export MODAL_TOKEN_ID MODAL_TOKEN_SECRET
/opt/modal-isci/venv/bin/python -c "
import json, modal, sys
r = modal.Function.from_name('movelog-render','saglik').remote()
kotu = [k for k,v in r.items() if isinstance(v,dict) and not v.get('ok')]
print('   sağlık:', 'HEPSİ OK' if not kotu else 'SORUNLU -> ' + ', '.join(kotu))
sys.exit(1 if kotu else 0)
" || { echo "  ✗ Modal sağlıksız — GEÇİŞ YAPILMADI"; exit 1; }

echo "→ 2/4 geri çağrı yolu"
/opt/modal-isci/venv/bin/python -c "
import modal, sys
r = modal.Function.from_name('movelog-render','geri_cagri_sina').remote()
print('   geri çağrı:', r)
sys.exit(0 if r.get('ok') else 1)
" || { echo "  ✗ geri çağrı düşüyor — GEÇİŞ YAPILMADI (video kullanıcıya ulaşmazdı)"; exit 1; }

echo "→ 3/4 dispatch yaması + dağıtım"
if grep -q "modalGonder" "$KAYNAK"; then
  echo "   yama zaten uygulanmış"
else
  # /opt/matrix git deposu DEĞİL → doğrudan patch. Kaynak bu arada değiştiyse
  # yama GÜRÜLTÜYLE düşer (sessizce bayat kod dağıtmaktansa iyidir).
  cp "$KAYNAK" "$KAYNAK.oncesi-modal"
  patch -p1 -d /opt/matrix < "$YAMA" || {
    echo "  ✗ yama uymadı — dispatch/src/index.ts değişmiş. Elle bak, körlemesine dağıtma."; exit 1; }
  echo "   yama uygulandı (yedek: $KAYNAK.oncesi-modal)"
fi
cd /opt/matrix/cf/dispatch
source /opt/matrix/secrets/modal-dispatch.conf
echo "$MODAL_DISPATCH_SECRET" | npx wrangler secret put MODAL_SECRET >/dev/null
npx wrangler deploy 2>&1 | tail -3

echo "→ 4/4 bayrak"
bayrak modal
echo
echo "✅ GEÇİLDİ. Geri dönüş:  bash $0 --geri   (yeniden dağıtım gerekmez)"
echo "   İlk videoyu izle:  wrangler tail movelog-dispatch"
