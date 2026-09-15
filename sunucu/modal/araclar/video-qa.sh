#!/bin/bash
# Gerekir: ffmpeg/ffprobe + rclone (sunucuda var; Mac'te brew install ffmpeg).
# Sır dizini: Mac'te ~/.nickdegs/anahtarlar/movelog-sunucu
SIR_DIZIN="${SIR_DIZIN:-$HOME/.nickdegs/anahtarlar/movelog-sunucu}"
# kullanım: video-qa.sh <r2_key>  — R2'den indir, ölç, sil (salt-okuma)
set -a; . $SIR_DIZIN/movelog-r2.conf; set +a
export RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
       RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" RCLONE_CONFIG_R2_ENDPOINT="$R2_ENDPOINT"
D=$(mktemp -d); F=$D/v.mp4; trap 'rm -rf "$D"' EXIT
rclone copyto "r2:$R2_BUCKET/$1" "$F" --s3-no-check-bucket 2>&1 | tail -2
[ -s "$F" ] || { echo "İNDİRİLEMEDİ: $1"; exit 1; }
echo "dosya: $1 · $(du -h "$F" | cut -f1)"
ffprobe -v error -show_entries format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels -of json "$F" | python3 -c "
import sys,json; j=json.load(sys.stdin)
print('süre: %.1f sn' % float(j['format']['duration']))
for s in j['streams']:
    if s['codec_type']=='video': print('video: %s %sx%s @ %s' % (s['codec_name'], s['width'], s['height'], s['r_frame_rate']))
    elif s['codec_type']=='audio': print('ses: %s %s Hz %s kanal' % (s['codec_name'], s.get('sample_rate'), s.get('channels')))"
python3 - "$F" <<'PY'
import sys
b = open(sys.argv[1], 'rb').read(8_000_000)
m, d = b.find(b'moov'), b.find(b'mdat')
print('faststart:', 'EVET (moov önce)' if m != -1 and (d == -1 or m < d) else 'HAYIR (moov sonda)')
PY
echo "ses yüksekliği: $(ffmpeg -hide_banner -nostats -i "$F" -af ebur128=framelog=quiet -f null - 2>&1 | grep -E '^\s+I:' | tail -1 | tr -s ' ')"
ffmpeg -hide_banner -nostats -i "$F" -vf "fps=1,signalstats,metadata=print:key=lavfi.signalstats.YAVG" -an -f null - 2>&1 | grep -oE 'YAVG=[0-9.]+' | cut -d= -f2 | python3 -c "
import sys; v=[float(x) for x in sys.stdin if x.strip()]
if not v: print('parlaklık: ölçülemedi'); sys.exit()
print('parlaklık (1 kare/sn, %d kare): min %.0f · ort %.0f · maks %.0f · beyaz(>235) %d · siyah(<16) %d' % (len(v), min(v), sum(v)/len(v), max(v), sum(x>235 for x in v), sum(x<16 for x in v)))"
