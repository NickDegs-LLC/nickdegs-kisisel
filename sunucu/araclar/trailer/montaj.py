# -*- coding: utf-8 -*-
"""Trailer montajı (ffmpeg). Kullanım: montaj.py <dil en|tr> <çıktı.mp4>
Zaman çizelgesi (saniye), 1080x1920 30fps, sessiz AAC:
  HOOK  stelvio 1.5x  0.0-4.2   : h1 (0.3-2.0) → h2 (2.0-4.0)
  ist route        4.2-8.4     : p1 (otomatik)
  amalfi           8.4-12.6    : p2 (sinematik 3B)
  dubai            12.6-16.4   : p3 (şehir)
  norway           16.4-20.2   : p4 (Apple Watch)
  ist globe finali 20.2-25.2   : g (her sürüş / dünyanın her yerinde)
  outro kartı      25.2-28.4
Kesmeler: kısa beyaz flaş (hook sonu) + xfade slide'lar.
"""
import sys, subprocess, json, os
W = '/tmp/claude-0/-opt-matrix/dd0bbf58-490d-4987-9395-dbfb719e512f/scratchpad/trailer'
L = sys.argv[1]; OUT = sys.argv[2]
OV = W + '/ov/'; SRC = W + '/out/'
FPS = 30


def dur(p):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p]).decode().strip())


# ── klip kesimleri: (dosya, baş, süre_kaynak, hız) → çıktı süresi = süre_kaynak/hız
ist_d = dur(SRC + 'ist.mp4')            # 8 sn rota + 6 sn küre
GLOBE_T0 = ist_d - 6.0                  # küre finalinin başladığı an (outroN = 6 sn)
SEG = [
    ('stelvio', 0.9, 6.3, 1.5),         # 4.2 sn — hook (fade-in'in karanlık ilk ~0.8 sn'si atlanır)
    ('ist', 0.9, 4.2, 1.0),             # 4.2
    ('amalfi', 0.9, 4.2, 1.0),          # 4.2
    ('dubai', 0.9, 3.8, 1.0),           # 3.8
    ('norway', 0.9, 3.8, 1.0),          # 3.8
    ('ist', GLOBE_T0 - 0.6, 5.6, 1.12), # 5.0 — rota kadrajı → uzaydan küre
]
XF = 0.3   # xfade süresi
outs = [s[2] / s[3] for s in SEG]
# segment başlangıç zamanları (xfade bindirmeleri düşülerek)
starts = []; t = 0.0
for i, d in enumerate(outs):
    starts.append(t); t += d - (XF if i < len(outs) - 1 else 0)
T_OUTRO = t - XF         # outro xfade'i son klibin SON 0.3 sn'sine biner (offset+duration klibi aşmasın — aşarsa xfade erken keser)
OUTRO_D = 3.4
TOTAL = T_OUTRO + OUTRO_D

inputs = []; fc = []
for i, (ad, ss, sd, hz) in enumerate(SEG):
    inputs += ['-ss', f'{ss:.3f}', '-t', f'{sd:.3f}', '-i', f'{SRC}{ad}.mp4']
    fc.append(f'[{i}:v]setpts=PTS/{hz},fps={FPS},scale=1080:1920,setsar=1,format=yuv420p[v{i}]')
n = len(SEG)
# outro kartı: PNG loop + hafif zoom-in (zoompan on-tabanlı, fps belirtilir — Temmuz dersi)
inputs += ['-loop', '1', '-t', f'{OUTRO_D:.3f}', '-i', f'{OV}{L}_outro.png']
fc.append(f'[{n}:v]fps={FPS},scale=1080:1920,zoompan=z=\'min(1.0+0.04*on/{int(OUTRO_D*FPS)},1.04)\':d=1:x=\'iw/2-(iw/zoom/2)\':y=\'ih/2-(ih/zoom/2)\':s=1080x1920:fps={FPS},setsar=1,format=yuv420p[vo]')
# ── zincir: xfade geçişleri
TRANS = ['wipeleft', 'slideleft', 'fade', 'slideleft', 'fade', 'fade']   # hook→ist beyaz-flaş yerine sert wipe
prev = 'v0'; acc = outs[0]
for i in range(1, n):
    off = acc - XF
    fc.append(f'[{prev}][v{i}]xfade=transition={TRANS[i-1]}:duration={XF}:offset={off:.3f}[x{i}]')
    prev = f'x{i}'; acc = off + outs[i]
fc.append(f'[{prev}][vo]xfade=transition=fade:duration={XF}:offset={T_OUTRO:.3f}[base]')

# ── yazı katmanları: (png, baş, bit, giriş efekti)
def ov(name, a, b, slide=36):
    return (f'{OV}{L}_{name}.png', a, b, slide)

s0 = starts
over = [
    ov('h1', s0[0] + 0.35, s0[0] + 2.05),
    ov('h2', s0[0] + 2.05, s0[0] + 4.0),
    ov('p1', s0[1] + 0.5, s0[1] + outs[1] - 0.2),
    ov('p2', s0[2] + 0.5, s0[2] + outs[2] - 0.2),
    ov('p3', s0[3] + 0.5, s0[3] + outs[3] - 0.2),
    ov('p4', s0[4] + 0.5, s0[4] + outs[4] - 0.2),
    ov('g', s0[5] + 1.6, s0[5] + outs[5] - 0.1),
]
cur = 'base'
for k, (png, a, b, slide) in enumerate(over):
    idx = len(inputs) // 2  # her girdi 2'den fazla token olabilir — aşağıda gerçek indeks hesaplanır
    inputs += ['-loop', '1', '-t', f'{b - a + 0.05:.3f}', '-i', png]
    j = n + 1 + k
    fi, fo = 0.28, 0.25
    fc.append(f'[{j}:v]fps={FPS},format=rgba,fade=t=in:st=0:d={fi}:alpha=1,fade=t=out:st={b - a - fo:.3f}:d={fo}:alpha=1,setpts=PTS+{a:.3f}/TB[o{k}]')
    # yukarı kayarak giriş: y = -slide*(1-ease) ; ease = min(1,(t-a)/0.35)
    y = f"'-{slide}*(1-min(1,(t-{a:.3f})/0.35))'"
    fc.append(f'[{cur}][o{k}]overlay=x=0:y={y}:eof_action=pass:enable=\'between(t,{a:.3f},{b:.3f})\'[c{k}]')
    cur = f'c{k}'
# hafif vinyet + son fade-out
fc.append(f'[{cur}]vignette=angle=PI/9,fade=t=out:st={TOTAL - 0.5:.3f}:d=0.5[vout]')   # PI/5 görüntüyü fazla karartıyordu (dry run ort. parlaklık düştü)

cmd = ['ffmpeg', '-y', '-v', 'error', '-stats'] + inputs + [
    '-f', 'lavfi', '-t', f'{TOTAL:.3f}', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-filter_complex', ';'.join(fc), '-map', '[vout]', '-map', f'{n + 1 + len(over)}:a',
    '-t', f'{TOTAL:.3f}', '-r', str(FPS),
    '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.2', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow',
    '-c:a', 'aac', '-b:a', '96k', '-shortest', '-movflags', '+faststart', OUT]
print('toplam %.1f sn | segment başları: %s | outro %.1f' % (TOTAL, [round(x, 1) for x in starts], T_OUTRO))
open(W + f'/out/montaj_{L}.cmd', 'w').write(' '.join(cmd))
r = subprocess.run(cmd, stderr=subprocess.PIPE, text=True)
print(r.stderr[-600:] if r.returncode else 'OK ' + OUT, '| %.1f MB' % (os.path.getsize(OUT) / 1e6) if os.path.exists(OUT) else '')
sys.exit(r.returncode)
