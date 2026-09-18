#!/bin/bash
# RunPod → Modal geçişi (ve geri dönüşü). 3B: GECIS-HAZIR.md
# 18.09: TAKTİK HAT KALDIRILDI — betik yalnız 3B (movelog-render) hattını yönetir.
#
# TASARIM: motor seçimi KV bayrağında, kodda değil.
#   · dispatch:motor     = ana bayrak (iki hat)
#   · geçiş  = kod dağıt (bir kez) + bayrağı 'modal' yap
#   · dönüş  = bayrağı 'runpod' yap (YENİDEN DAĞITIM YOK, saniyeler içinde)
# Bu, "geri alamıyoruz" riskini ortadan kaldırır.
#
# NEDEN (Mac): sunucu köprü; betik kendi konumundan repo yollarını türetir,
# sırlar ~/.nickdegs/anahtarlar/movelog-sunucu, wrangler npx --yes wrangler@4.
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
MODAL_DIR="$SCRIPT_DIR"
DISPATCH_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/../cf/dispatch" && pwd)"
KAYNAK="$DISPATCH_DIR/src/index.ts"
SIR_DIR="${HOME}/.nickdegs/anahtarlar/movelog-sunucu"
KV_NS=fd5db982178f49c589858c525755fba7
RENDER_RUN=https://daclen10--movelog-render-run.modal.run

GERI=0
DURUM=0
DEPLOY_ATLA=0

wra() {
  npx --yes wrangler@4 "$@"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --geri) GERI=1 ;;
    --durum) DURUM=1 ;;
    --deploy-atla) DEPLOY_ATLA=1 ;;
    --yardim|-h)
      echo "kullanım: $0 [--geri] [--durum] [--deploy-atla]"
      exit 0
      ;;
    *) echo "bilinmeyen bayrak: $1  ($0 --yardim)"; exit 1 ;;
  esac
  shift
done

source "$SIR_DIR/movelog-cf.conf"
export CLOUDFLARE_API_TOKEN="$MOVELOG_CF_TOKEN" WRANGLER_SEND_METRICS=false
export CLOUDFLARE_ACCOUNT_ID="${MOVELOG_CF_ACCOUNT_ID:-45241304800d3e122aced1f0ae599943}"
CF_EMAIL= CF_TOKEN= CF_GLOBAL_KEY=; export CF_EMAIL CF_TOKEN CF_GLOBAL_KEY

bayrak() {
  local anahtar="$1" deger="$2"
  cd "$DISPATCH_DIR"
  wra kv key put --namespace-id "$KV_NS" --remote "$anahtar" "\"$deger\"" >/dev/null 2>&1
  echo "  bayrak: $anahtar = $deger"
}

kv_get() {
  cd "$DISPATCH_DIR"
  wra kv key get --namespace-id "$KV_NS" --remote "$1" 2>/dev/null || echo '(ayarsız)'
}

modal_bin() {
  if [ -x "${HOME}/.venvs/modal/bin/modal" ]; then
    echo "${HOME}/.venvs/modal/bin/modal"
  else
    echo modal
  fi
}

modal_py() {
  if [ -x "${HOME}/.venvs/modal/bin/python" ]; then
    echo "${HOME}/.venvs/modal/bin/python"
  else
    echo python3
  fi
}

modal_ortam() {
  source "$SIR_DIR/modal.conf"
  export MODAL_TOKEN_ID MODAL_TOKEN_SECRET
}

sir_var_mi() {
  local ad="$1"
  "$(modal_bin)" secret list 2>/dev/null | grep -q "$ad"
}

if [ "$DURUM" = 1 ]; then
  echo -n "  dispatch:motor     = "; kv_get dispatch:motor
  exit 0
fi

if [ "$GERI" = 1 ]; then
  bayrak dispatch:motor runpod
  echo "✅ 3B hat RunPod'a döndü (yeniden dağıtım gerekmedi)."
  exit 0
fi

modal_ortam
MBIN="$(modal_bin)"
MPY="$(modal_py)"

adim=1

if true; then
  echo "→ $adim/N Modal 3B sağlığı (geçmeden ÖNCE, kör geçiş yok)"
  adim=$((adim + 1))
  cd "$MODAL_DIR"
  "$MPY" -c "
import json, modal, sys
r = modal.Function.from_name('movelog-render','saglik').remote()
kotu = [k for k,v in r.items() if isinstance(v,dict) and not v.get('ok')]
print('   sağlık:', 'HEPSİ OK' if not kotu else 'SORUNLU -> ' + ', '.join(kotu))
sys.exit(1 if kotu else 0)
" || { echo "  ✗ Modal 3B sağlıksız — GEÇİŞ YAPILMADI"; exit 1; }

  echo "→ $adim/N 3B geri çağrı yolu"
  adim=$((adim + 1))
  "$MPY" -c "
import modal, sys
r = modal.Function.from_name('movelog-render','geri_cagri_sina').remote()
print('   geri çağrı:', r)
sys.exit(0 if r.get('ok') else 1)
" || { echo "  ✗ geri çağrı düşüyor — GEÇİŞ YAPILMADI (video kullanıcıya ulaşmazdı)"; exit 1; }
fi

echo "→ $adim/N /run uçları (yanlış sır → 403, eksik gövde → 400)"
adim=$((adim + 1))
source "$SIR_DIR/modal-dispatch.conf"
export MODAL_DISPATCH_SECRET
"$MPY" -c "
import json, os, sys, urllib.error, urllib.request

sir = os.environ['MODAL_DISPATCH_SECRET']
ucular = []
ucular.append(('3B', sys.argv[1]))

def post(url, govde):
    req = urllib.request.Request(url, data=json.dumps(govde).encode(),
                                 headers={'content-type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read()[:200]
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:200]

for ad, url in ucular:
    kod, _ = post(url, {'secret': 'yanlis', 'input': {'track': [1, 2, 3]}})
    if kod != 403:
        print(f'   ✗ {ad} yanlış sır {kod} (403 beklenirdi)')
        sys.exit(1)
    print(f'   {ad} yanlış sır → 403')
    kod, _ = post(url, {'secret': sir, 'input': {}})
    if kod != 400:
        print(f'   ✗ {ad} eksik gövde {kod} (400 beklenirdi)')
        sys.exit(1)
    print(f'   {ad} eksik gövde → 400')
" "$RENDER_RUN" || { echo "  ✗ /run doğrulaması düştü — GEÇİŞ YAPILMADI"; exit 1; }

echo "→ $adim/N dispatch kaynağı + dağıtım"
adim=$((adim + 1))
if ! grep -q "modalGonder" "$KAYNAK"; then
  echo "  ✗ $KAYNAK içinde modalGonder yok."
  echo "    dispatch kaynağı repo sunucu/cf/dispatch/src/index.ts olmalı (Modal dalı)."
  exit 1
fi
echo "   Modal dalı kaynakta var"
cd "$DISPATCH_DIR"
if [ "$DEPLOY_ATLA" = 1 ]; then
  # NEDEN: kaynakta Modal dalı var + MODAL_SECRET canlıysa yeniden dağıtım gereksiz.
  if wra secret list 2>/dev/null | grep -q 'MODAL_SECRET'; then
    echo "   --deploy-atla: MODAL_SECRET canlı, dağıtım atlandı"
  else
    echo "  ✗ --deploy-atla istendi ama MODAL_SECRET canlıda yok — dağıtım şart"
    exit 1
  fi
else
  source "$SIR_DIR/modal-dispatch.conf"
  echo "$MODAL_DISPATCH_SECRET" | wra secret put MODAL_SECRET >/dev/null
  wra deploy 2>&1 | tail -3
fi

echo "→ $adim/N bayrak"
bayrak dispatch:motor modal
echo
echo "✅ GEÇİLDİ. Geri dönüş:  bash $0 --geri   (yeniden dağıtım gerekmez)"
echo "   Dağıtımı atla:        bash $0 --deploy-atla"
echo "   İlk videoyu izle:     npx --yes wrangler@4 tail movelog-dispatch"
