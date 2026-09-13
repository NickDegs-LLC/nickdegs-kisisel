#!/bin/sh
# TAKTİK KONTEYNER GİRİŞİ (2026-08-31) — harita yan-servisi + RunPod handler
#
# NEDEN BU DOSYA: statik mozaik artık MOTORDA üretiliyor (harita_yan.py, PIL). Yan-servis
# 127.0.0.1:8890'de dinler; mühürlü route_gen/intro_gen/outro_gen'in ZATEN okuduğu
# `HARITA_STATIK` env'i oraya bakar -> motor kodunda TEK SATIR değişiklik YOK.
#
# Handler `exec` ile çalışır: PID 1 kalır, RunPod'un sinyal/timeout yönetimi bozulmaz.
set -e

: "${HARITA_YAN_PORT:=8890}"
: "${HARITA_YAN_CACHE:=/tmp/harita-yan}"
# Uzak uç (karo/MVT yedeği): açıkça verilmediyse HARITA_TABAN'dan türet.
if [ -z "$HARITA_UZAK" ] && [ -n "$HARITA_TABAN" ]; then
  case "$HARITA_TABAN" in
    http://127.0.0.1*|http://localhost*) : ;;   # kendimizi kaynak gösterme (döngü olur)
    *) HARITA_UZAK="$HARITA_TABAN" ;;
  esac
fi
if [ -z "$HARITA_MVT" ] && [ -n "$HARITA_UZAK" ]; then HARITA_MVT="$HARITA_UZAK"; fi
export HARITA_YAN_PORT HARITA_YAN_CACHE HARITA_UZAK HARITA_MVT

mkdir -p "$HARITA_YAN_CACHE"
python3 -u /app/tactical/harita_yan.py &
YAN_PID=$!

# HAZIR OLMA BEKLEMESİ: yan-servis ayağa kalkmadan render başlarsa ilk statik istekleri
# bağlantı reddi alır. 10 sn tavan.
# ⚠️ KİMLİK DENETİMİ ŞART (test sırasında yakalandı): port dolu olabilir ve /saglik'e BAŞKA
# bir servis cevap verebilir. O zaman "hazır" sanıp yanlış servise render yaptırırdık.
# Bu yüzden cevabın içinde `"katman": "harita-yan"` ARANIR; ayrıca süreç canlı mı bakılır.
i=0
while [ $i -lt 50 ]; do
  if ! kill -0 "$YAN_PID" 2>/dev/null; then
    echo "HATA: harita-yan süreci öldü (pid ${YAN_PID}) — statik üretilemez" >&2
    break
  fi
  if python3 - "$HARITA_YAN_PORT" <<'PY' 2>/dev/null
import sys, urllib.request
g = urllib.request.urlopen(f"http://127.0.0.1:{sys.argv[1]}/saglik", timeout=1).read().decode()
sys.exit(0 if '"katman": "harita-yan"' in g else 1)
PY
  then
    echo "harita-yan HAZIR (port ${HARITA_YAN_PORT}, pid ${YAN_PID})"
    break
  fi
  i=$((i+1)); sleep 0.2
done
[ $i -ge 50 ] && echo "UYARI: harita-yan 10 sn'de hazır olmadı (pid ${YAN_PID}) — render statikte hata alabilir" >&2

exec python3 -u /app/tactical/rp_handler_tac.py
