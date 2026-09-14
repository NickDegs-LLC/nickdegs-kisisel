#!/bin/bash
# RunPod → Modal geçişi (ve geri dönüşü). 3B: GECIS-HAZIR.md · taktik: TAKTIK-GECIS.md
#
# TASARIM: motor seçimi KV bayrağında, kodda değil.
#   · dispatch:motor     = ana bayrak (iki hat)
#   · dispatch:motor-tac = isteğe bağlı taktik override (doluysa yalnız taktik onu izler)
#   · geçiş  = kod dağıt (bir kez) + bayrağı 'modal' yap
#   · dönüş  = bayrağı 'runpod' yap (YENİDEN DAĞITIM YOK, saniyeler içinde)
# Bu, "geri alamıyoruz" riskini ortadan kaldırır.
set -euo pipefail

KAYNAK=/opt/matrix/cf/dispatch/src/index.ts
KV_NS=fd5db982178f49c589858c525755fba7
MODAL_DIR=/opt/matrix/modal
RENDER_RUN=https://daclen10--movelog-render-run.modal.run
TAC_RUN=https://daclen10--movelog-tactical-run.modal.run

GERI=0
DURUM=0
YALNIZ=""          # "" | taktik | render
MOTOR_TAC_VER=""   # boş = yazma (tam geçişte kalıntı override'ı temizlemek için modal yazılır)

while [ $# -gt 0 ]; do
  case "$1" in
    --geri) GERI=1 ;;
    --durum) DURUM=1 ;;
    --yalniz-taktik) YALNIZ=taktik ;;
    --yalniz-render) YALNIZ=render ;;
    --motor-tac)
      MOTOR_TAC_VER="${2:-}"
      if [ -z "$MOTOR_TAC_VER" ]; then echo "  ✗ --motor-tac değer ister (modal|runpod)"; exit 1; fi
      shift
      ;;
    --yardim|-h)
      echo "kullanım: $0 [--geri] [--durum] [--yalniz-taktik|--yalniz-render] [--motor-tac modal|runpod]"
      exit 0
      ;;
    *) echo "bilinmeyen bayrak: $1  ($0 --yardim)"; exit 1 ;;
  esac
  shift
done

source /opt/matrix/secrets/movelog-cf.conf
export CLOUDFLARE_API_TOKEN="$MOVELOG_CF_TOKEN" WRANGLER_SEND_METRICS=false
export CLOUDFLARE_ACCOUNT_ID="${MOVELOG_CF_ACCOUNT_ID:-45241304800d3e122aced1f0ae599943}"
CF_EMAIL= CF_TOKEN= CF_GLOBAL_KEY=; export CF_EMAIL CF_TOKEN CF_GLOBAL_KEY

bayrak() {
  local anahtar="$1" deger="$2"
  cd /opt/matrix/cf/dispatch
  npx wrangler kv key put --namespace-id "$KV_NS" --remote "$anahtar" "\"$deger\"" >/dev/null 2>&1
  echo "  bayrak: $anahtar = $deger"
}

kv_get() {
  cd /opt/matrix/cf/dispatch
  npx wrangler kv key get --namespace-id "$KV_NS" --remote "$1" 2>/dev/null || echo '(ayarsız)'
}

modal_bin() {
  if [ -x /opt/modal-isci/venv/bin/modal ]; then
    echo /opt/modal-isci/venv/bin/modal
  else
    echo modal
  fi
}

modal_py() {
  if [ -x /opt/modal-isci/venv/bin/python ]; then
    echo /opt/modal-isci/venv/bin/python
  else
    echo python3
  fi
}

modal_ortam() {
  source /opt/matrix/secrets/modal.conf
  export MODAL_TOKEN_ID MODAL_TOKEN_SECRET
}

sir_var_mi() {
  local ad="$1"
  "$(modal_bin)" secret list 2>/dev/null | grep -q "$ad"
}

if [ "$DURUM" = 1 ]; then
  echo -n "  dispatch:motor     = "; kv_get dispatch:motor
  echo -n "  dispatch:motor-tac = "; kv_get dispatch:motor-tac
  exit 0
fi

if [ "$GERI" = 1 ]; then
  if [ "$YALNIZ" = taktik ]; then
    bayrak dispatch:motor-tac runpod
    echo "✅ Taktik hat RunPod'a döndü (3B bayrağına dokunulmadı)."
  elif [ "$YALNIZ" = render ]; then
    bayrak dispatch:motor runpod
    echo "✅ 3B hat RunPod'a döndü (taktik override'a dokunulmadı)."
  else
    bayrak dispatch:motor runpod
    bayrak dispatch:motor-tac runpod
    echo "✅ İki hat da RunPod'a döndü (yeniden dağıtım gerekmedi)."
  fi
  exit 0
fi

modal_ortam
MBIN="$(modal_bin)"
MPY="$(modal_py)"

# --- sırrı ÖNCEDEN doğrula (sessizce devam etme) ---
if [ "$YALNIZ" != render ]; then
  echo "→ 0/N movelog-tactical Modal sırrı"
  if ! sir_var_mi movelog-tactical; then
    echo "  ✗ Modal sırrı 'movelog-tactical' yok — GEÇİŞ YAPILMADI."
    echo "    Oluştur (değerleri RunPod template egptl6t4pr / secrets'ten al, BURAYA YAZMA):"
    echo "      modal secret create movelog-tactical \\"
    echo "        HARITA_GEOCODING=... HARITA_MATCHING=... \\"
    echo "        HARITA_MVT=... HARITA_UZAK=... \\"
    echo "        MAPBOX_PUBLIC=... TAC_CHUNKS=... TAC_ECHO=... TAC_TIMEOUT=..."
    echo "    HARITA_MVT + HARITA_UZAK ŞART — yoksa streets-v12 bembeyaz döner"
    echo "    ve _road_density her yeri kırsal sayar (31.08-02.09 arası bu hatayla çalışmış)."
    echo "    TAC_BACKEND / RENDER_DONE_SECRET sırrına KONMAZ — sarmalayıcı yer tutucu yazar."
    exit 1
  fi
  echo "   movelog-tactical sırrı var"
fi

adim=1

if [ "$YALNIZ" != taktik ]; then
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

if [ "$YALNIZ" != render ]; then
  echo "→ $adim/N taktik işçisini dağıt"
  adim=$((adim + 1))
  cd "$MODAL_DIR"
  "$MBIN" deploy movelog_tactical.py

  echo "→ $adim/N Modal taktik sağlığı"
  adim=$((adim + 1))
  "$MPY" -c "
import modal, sys
r = modal.Function.from_name('movelog-tactical','saglik').remote()
kotu = [k for k,v in r.items() if isinstance(v,dict) and not v.get('ok')]
print('   sağlık:', 'HEPSİ OK' if not kotu else 'SORUNLU -> ' + ', '.join(kotu))
sys.exit(1 if kotu else 0)
" || { echo "  ✗ Modal taktik sağlıksız — GEÇİŞ YAPILMADI"; exit 1; }
fi

echo "→ $adim/N /run uçları (yanlış sır → 403, eksik gövde → 400)"
adim=$((adim + 1))
source /opt/matrix/secrets/modal-dispatch.conf
export MODAL_DISPATCH_SECRET
"$MPY" -c "
import json, os, sys, urllib.error, urllib.request

sir = os.environ['MODAL_DISPATCH_SECRET']
ucular = []
yalniz = sys.argv[1]
if yalniz != 'taktik':
    ucular.append(('3B', sys.argv[2]))
if yalniz != 'render':
    ucular.append(('taktik', sys.argv[3]))

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
" "$YALNIZ" "$RENDER_RUN" "$TAC_RUN" || { echo "  ✗ /run doğrulaması düştü — GEÇİŞ YAPILMADI"; exit 1; }

echo "→ $adim/N dispatch kaynağı + dağıtım"
adim=$((adim + 1))
if ! grep -q "taktikModalGonder" "$KAYNAK"; then
  echo "  ✗ $KAYNAK içinde taktikModalGonder yok."
  echo "    Bu PR'daki sunucu/cf/dispatch/src/index.ts'i /opt/matrix/cf/dispatch/src/index.ts olarak koy."
  echo "    Eski dispatch-modal.patch taktiği RunPod'a kilitler — UYGULAMA."
  exit 1
fi
echo "   taktik Modal dalı kaynakta var"
cd /opt/matrix/cf/dispatch
source /opt/matrix/secrets/modal-dispatch.conf
echo "$MODAL_DISPATCH_SECRET" | npx wrangler secret put MODAL_SECRET >/dev/null
npx wrangler deploy 2>&1 | tail -3

echo "→ $adim/N bayrak"
if [ "$YALNIZ" = taktik ]; then
  bayrak dispatch:motor-tac modal
elif [ "$YALNIZ" = render ]; then
  bayrak dispatch:motor modal
else
  bayrak dispatch:motor modal
  # kalıntı motor-tac=runpod taktiği ana bayrağa rağmen RunPod'da bırakırdı
  bayrak dispatch:motor-tac modal
fi
if [ -n "$MOTOR_TAC_VER" ]; then
  bayrak dispatch:motor-tac "$MOTOR_TAC_VER"
fi
echo
echo "✅ GEÇİLDİ. Geri dönüş:  bash $0 --geri   (yeniden dağıtım gerekmez)"
echo "   Yalnız taktik:        bash $0 --yalniz-taktik"
echo "   Yalnız 3B:            bash $0 --yalniz-render"
echo "   İlk videoyu izle:     wrangler tail movelog-dispatch"
