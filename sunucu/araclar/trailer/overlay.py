# -*- coding: utf-8 -*-
"""Trailer overlay üreticisi (PIL). 1080x1920 şeffaf PNG'ler.
- pill(text, dosya): liquid-glass kapsül (Temmuz reçetesi, Plex Sans).
- buyuk(satırlar, dosya): hook/vurgu metni, büyük beyaz, yumuşak gölge.
- intro/outro kartları: koyu lacivert gradyan + ikon + metin.
"""
import sys, math
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1080, 1920
FB = '/usr/share/fonts/truetype/ibm-plex/IBMPlexSans-Bold.ttf'
FS = '/usr/share/fonts/truetype/ibm-plex/IBMPlexSans-SemiBold.ttf'
FM = '/usr/share/fonts/truetype/ibm-plex/IBMPlexSans-Medium.ttf'
import os
if not os.path.exists(FB): FB = FS


def _font(p, s):
    return ImageFont.truetype(p, s)


def pill(text, out, size=58, y=None, pad=46):
    f = _font(FS, size)
    tw = f.getlength(text); th = size
    h = int(size * 1.75); w = int(tw + pad * 2)
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    x0 = (W - w) // 2; y0 = (H - h) // 2 if y is None else y
    # gövde: dikey gradyan beyaz alpha 82→20
    body = Image.new('RGBA', (w, h), (0, 0, 0, 0)); bd = ImageDraw.Draw(body)
    for yy in range(h):
        a = int(82 - (82 - 20) * yy / h); bd.line([(0, yy), (w, yy)], fill=(255, 255, 255, a))
    mask = Image.new('L', (w, h), 0); ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=h // 2, fill=255)
    body.putalpha(Image.composite(body.getchannel('A'), Image.new('L', (w, h), 0), mask))
    # arka plan bulanıklığı yok (video üstüne biniyor) → koyu yarı saydam zemin ekle ki okunurluk artsın
    zemin = Image.new('RGBA', (w, h), (0, 0, 0, 0)); ImageDraw.Draw(zemin).rounded_rectangle([0, 0, w - 1, h - 1], radius=h // 2, fill=(10, 14, 30, 95))
    im.alpha_composite(zemin, (x0, y0)); im.alpha_composite(body, (x0, y0))
    # mercek parlaması
    fl = Image.new('RGBA', (w, h), (0, 0, 0, 0)); ImageDraw.Draw(fl).ellipse([w * 0.1, -h * 0.5, w * 0.6, h * 0.45], fill=(255, 255, 255, 60))
    fl = fl.filter(ImageFilter.GaussianBlur(28)); fl.putalpha(Image.composite(fl.getchannel('A'), Image.new('L', (w, h), 0), mask))
    im.alpha_composite(fl, (x0, y0))
    # kenar çizgisi
    d = ImageDraw.Draw(im); d.rounded_rectangle([x0, y0, x0 + w - 1, y0 + h - 1], radius=h // 2, outline=(255, 255, 255, 200), width=2)
    # metin gölgesi + metin
    sh = Image.new('RGBA', (W, H), (0, 0, 0, 0)); ImageDraw.Draw(sh).text((x0 + pad + 2, y0 + (h - th) // 2 - 4), text, font=f, fill=(0, 0, 0, 170))
    im.alpha_composite(sh.filter(ImageFilter.GaussianBlur(4)))
    d.text((x0 + pad, y0 + (h - th) // 2 - 6), text, font=f, fill=(255, 255, 255, 255))
    im.save(out); return out


def buyuk(lines, out, size=104, y=None, align='center', color=(255, 255, 255, 255), sub=None, subsize=46, font=FB):
    f = _font(font, size); fs = _font(FM, subsize)
    lh = int(size * 1.12); total = lh * len(lines) + (subsize + 30 if sub else 0)
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    y0 = (H - total) // 2 if y is None else y
    sh = Image.new('RGBA', (W, H), (0, 0, 0, 0)); sd = ImageDraw.Draw(sh)
    d = ImageDraw.Draw(im)
    for i, ln in enumerate(lines):
        tw = f.getlength(ln); x = (W - tw) // 2 if align == 'center' else 96
        sd.text((x + 3, y0 + i * lh + 6), ln, font=f, fill=(0, 0, 0, 200))
        d.text((x, y0 + i * lh), ln, font=f, fill=color)
    if sub:
        tw = fs.getlength(sub); x = (W - tw) // 2 if align == 'center' else 96
        yy = y0 + lh * len(lines) + 24
        sd.text((x + 2, yy + 4), sub, font=fs, fill=(0, 0, 0, 180)); d.text((x, yy), sub, font=fs, fill=(255, 255, 255, 225))
    out_im = Image.new('RGBA', (W, H), (0, 0, 0, 0)); out_im.alpha_composite(sh.filter(ImageFilter.GaussianBlur(10))); out_im.alpha_composite(im)
    out_im.save(out); return out


def kart(out, icon=None, title='Move Log', sub='', alt='', yildiz=True):
    """Koyu lacivert radyal gradyan + ikon + başlık (intro/outro zemini)."""
    im = Image.new('RGB', (W, H), (6, 10, 28))
    g = Image.new('L', (W, H), 0); gd = ImageDraw.Draw(g)
    for r in range(900, 0, -6):
        a = int(255 * (1 - r / 900) ** 1.6); gd.ellipse([W // 2 - r, H // 2 - r * 1.3, W // 2 + r, H // 2 + r * 1.3], fill=a)
    glow = Image.new('RGB', (W, H), (26, 60, 150)); im = Image.composite(glow, im, g.point(lambda v: int(v * 0.55)))
    if yildiz:
        import random; rnd = random.Random(7); d = ImageDraw.Draw(im)
        for _ in range(260):
            x, y = rnd.randrange(W), rnd.randrange(H); s = rnd.choice([1, 1, 1, 2]); a = rnd.randrange(90, 230)
            d.ellipse([x, y, x + s, y + s], fill=(a, a, min(255, a + 20)))
    im = im.convert('RGBA')
    y = H // 2 - 330
    if icon:
        ic = Image.open(icon).convert('RGBA').resize((300, 300), Image.LANCZOS)
        m = Image.new('L', (300, 300), 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, 299, 299], radius=68, fill=255); ic.putalpha(m)
        sh = Image.new('RGBA', (W, H), (0, 0, 0, 0)); ImageDraw.Draw(sh).rounded_rectangle([W // 2 - 150, y + 24, W // 2 + 150, y + 324], radius=68, fill=(0, 0, 0, 160))
        im.alpha_composite(sh.filter(ImageFilter.GaussianBlur(30))); im.alpha_composite(ic, (W // 2 - 150, y)); y += 300 + 70
    d = ImageDraw.Draw(im)
    f = _font(FB, 112); tw = f.getlength(title); d.text(((W - tw) // 2, y), title, font=f, fill=(255, 255, 255, 255)); y += 150
    if sub:
        f2 = _font(FM, 52); tw = f2.getlength(sub); d.text(((W - tw) // 2, y), sub, font=f2, fill=(200, 212, 240, 255)); y += 100
    if alt:
        f3 = _font(FS, 44); tw = f3.getlength(alt)
        d.rounded_rectangle([(W - tw) // 2 - 44, y + 40, (W + tw) // 2 + 44, y + 40 + 100], radius=50, fill=(255, 255, 255, 235))
        d.text(((W - tw) // 2, y + 64), alt, font=f3, fill=(8, 12, 30, 255))
    im.save(out); return out


if __name__ == '__main__':
    o = sys.argv[1]
    pill('Photorealistic 3D ride video', o + '/p_test.png')
    buyuk(['You rode 240 km.', 'Where’s the proof?'], o + '/b_test.png')
    kart(o + '/k_test.png', icon=o + '/../icon.png', title='Move Log', sub='Your ride, as a movie.', alt='App Store  ·  Google Play')
    print('ok')
