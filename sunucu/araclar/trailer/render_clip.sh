#!/bin/bash
# Tek promo klibi yerel 3D render: render_clip.sh <ad> <fps> <saniye> [zoom] [pitch] [kabartma]
# Spec route-video.py'den (SPEC_OUT) alınır -> kare sayısı/fps/noHud/rscale ezilir -> node render3d.js
set -u
W=/tmp/claude-0/-opt-matrix/dd0bbf58-490d-4987-9395-dbfb719e512f/scratchpad/trailer
AD=$1; FPS=$2; SN=$3; ZOOM=${4:-}; PITCH=${5:-}; KAB=${6:-0}; NOOUT=${7:-1}
T=$(python3 -c "import json;p=json.load(open('$W/tracks/${AD}_w.json'))['points'];print(p[0]['t'],p[-1]['t'])"); set -- $T
cd $W/engine
SPEC_OUT=$W/out/${AD}_spec.json ROUTE_OUT=$W/out RENDER3D_DIR=$W/engine/3d RVID_FPS=$FPS GOOGLE_3D_OLU=1 \
  python3 route-video.py 2026-10-05 paid medium 3d 9:16 track=$W/tracks/${AD}_w.json from=$1 to=$2 nohud=1 camdist=orta matched=1 $( [ "$KAB" = 1 ] && echo kabartma=1 ) >$W/out/${AD}_spec.log 2>&1 || { echo "spec HATA"; tail -3 $W/out/${AD}_spec.log; exit 1; }
python3 - <<EOF
import json
s=json.load(open('$W/out/${AD}_spec.json'))
FR=int($FPS*$SN); n=len(s['pts'])
# 🔴 05.10 DERSİ: frameIdx KESİRLİ olmalı (motor fractional index bekler, bkz render3d.js 'FIDX ... FRACTIONAL').
# round() ile tam sayıya yuvarlamak adımları 0/1 yapıyordu -> nokta sıçrıyor, kamera/çizgi titriyor (v1 trailer kusuru).
# Doğrusu: orijinal (hız-tabanlı) frameIdx'i yeni kare sayısına yeniden örnekle.
import numpy as np
orj=s['frameIdx']; s['frameIdx']=[float(x) for x in np.interp(np.linspace(0,len(orj)-1,FR), np.arange(len(orj)), orj)]
s['frames']=FR; s['fps']=$FPS; s['rscale']=1.0; s['noHud']=True
s['outMp4']='$W/out/${AD}.mp4'; s['noOutro']=bool($NOOUT)
z='$ZOOM'; p='$PITCH'
if z: s['zoom']=float(z)
if p: s['pitch']=float(p)
json.dump(s,open('$W/out/${AD}_run.json','w'))
print('spec:', FR, 'kare', s['fps'], 'fps', 'zoom', s['zoom'], 'pitch', s['pitch'], 'kabartma', s['kabartma'], 'satStyle', s['satStyle'])
EOF
cd $W/engine/3d
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome
t0=$(date +%s)
node render3d.js $W/out/${AD}_run.json >$W/out/${AD}.log 2>&1; rc=$?
echo "$AD rc=$rc süre=$(( $(date +%s)-t0 ))s $(ls -la $W/out/${AD}.mp4 2>/dev/null | awk '{print $5" bayt"}')"
