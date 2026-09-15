#!/bin/bash
# YEREL TEST RENDER (Barış 2026-08-11: "buluttan test edersek para biter")
# RunPod'a gitmeden, SIFIR maliyetle kısa doğrulama klibi üretir.
# ÖLÇÜM: 45 kare · 480x854 · 15fps = 402 sn (~7 dk), 3 MB. Sunucuda GPU yok (SwiftShader),
# bu yüzden kare başına ~9 sn; nice 15 ile arka planda, Hooder'ı yormaz.
#
# KULLANIM: test-render-yerel.sh [iz.json] [kare] [ultra|premium]
#   iz.json  = {"track":[{lon,lat,t,spd},...]} veya düz nokta listesi
#   kare     = varsayılan 45 (~7 dk). 90 kare ~14 dk. 200+ kare için RunPod'u tercih et.
#
# NE ZAMAN YETERLİ: bina/renk/yükseklik/karo/atıf/kamera akışı — yani görsel her şey.
# NE ZAMAN YETMEZ: ses, tam süre pacing, intro/outro kartları, segment birleştirme.
set -uo pipefail
IZ="${1:-/opt/matrix/routes/test-iz.json}"
KARE="${2:-45}"
KATMAN="${3:-ultra}"
OUT=/opt/matrix/routes/test-yerel
mkdir -p $OUT
[ -r "$IZ" ] || { echo "iz dosyası yok: $IZ"; exit 1; }
CFG=$(mktemp --suffix=.json)
python3 - "$IZ" "$KARE" "$KATMAN" "$OUT" "$CFG" <<'PY'
import json,sys
iz,kare,katman,out,cfgp=sys.argv[1:6]
d=json.load(open(iz)); tr=d.get("track") if isinstance(d,dict) else d
pts=[{"lon":p["lon"],"lat":p["lat"],"t":p.get("t",0),"spd":p.get("spd",30),"cum":i*0.01}
     for i,p in enumerate(tr)]
json.dump({"W":480,"H":854,"fps":15,"frames":int(kare),"pitch":60,"zoom":15.6,
  "outMp4":f"{out}/klip.mp4","ffmpeg":"/usr/bin/ffmpeg","satStyle":True,
  "ultra":(katman=="ultra"),"rscale":1,
  "title":{"date":"TEST","totkm":"0.0"},"lineColor":"#00e5ff","dotColor":"#ff3b30",
  "pts":pts}, open(cfgp,"w"))
print(f"  {kare} kare · {katman} · {len(pts)} nokta")
PY
T0=$(date +%s)
cd /opt/matrix/render-worker/3d
PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome \
HARITA_TABAN=https://harita.nickdegs.com \
  nice -n 15 node render3d.js "$CFG" 2>&1 | tail -2
rm -f "$CFG"
echo "  SÜRE: $(( $(date +%s)-T0 )) sn · ÇIKTI: $OUT/klip.mp4 ($(du -h $OUT/klip.mp4 2>/dev/null | cut -f1))"
