#!/usr/bin/env python3
# Move Log FREE katman filigranı — uygulama ikonundan üretilir.
# ⚠️ 2026-08-05: /opt/matrix/assets kurtarmada gelmedi, logo.png kayboldu -> sıfırdan üretildi.
# Barış'ın isteği: "uygulamanın ikonu, hafif arka planlı; videoyu ÇOK HAFİF bozsun ki Premium'a teşvik etsin".
# Tasarım kararları:
#   - iOS squircle köşe (r=%22.37) -> mağazadaki ikonla aynı silüet, kullanıcı tanır
#   - %80 opaklık -> altındaki uydu görüntüsü hafifçe görünür (bozar ama örtmez)
#   - koyu yumuşak gölge + ince beyaz kontur -> hem parlak (kar/deniz) hem koyu (orman/gece) zeminde okunur
#   - altında "MOVE LOG" kelime markası -> köşede sadece şekil değil, İSİM kalsın
# Çıktı 512px; route-video.py `thumbnail((180,180))` ile küçültür (1080p'de ~%9 genişlik).
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SRC   = "/opt/matrix/kisisel-app/app/ios-native/Resources/Assets.xcassets/AppIcon.appiconset/icon_1024.png"
OUT   = "/opt/matrix/assets/logo.png"
FONT  = "/opt/matrix/kisisel-app/tactical/fonts/Saira-SemiBold.ttf"

ICON     = 512      # rozet kenarı
PAD      = 26       # gölgeye yer
ICON_A   = 0.80     # rozet opaklığı (1.0 = tam örter; 0.80 "çok hafif")
TXT_A    = 0.95
# ⚠️ Kelime markası rozetin ALTINA değil İÇİNE konur: route-video `thumbnail((180,180))` ile
# EN UZUN kenarı 180'e indiriyor -> alta yazı bandı eklenirse rozet küçülür VE yazı ~20px'e
# düşüp okunmaz olur (2026-08-05'te iki uydu karesinde ölçüldü). İçeride rozetle aynı ölçekte kalır.
STRIP    = 0.26     # rozetin alt %26'sı = isim şeridi

def squircle_mask(size, r_ratio=0.2237, ss=4):
    """iOS köşe yuvarlaklığı. Süper-örnekleme ile pürüzsüz kenar."""
    m = Image.new("L", (size * ss, size * ss), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size * ss - 1, size * ss - 1],
                                        radius=int(size * ss * r_ratio), fill=255)
    return m.resize((size, size), Image.LANCZOS)

def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    icon = Image.open(SRC).convert("RGBA").resize((ICON, ICON), Image.LANCZOS)

    mask = squircle_mask(ICON)
    badge = Image.new("RGBA", (ICON, ICON), (0, 0, 0, 0))
    badge.paste(icon, (0, 0), mask)

    # isim şeridi: alta doğru koyulaşan perde (ikon sanatı üstünde yazı okunsun)
    sh_h = int(ICON * STRIP)
    scrim = Image.new("RGBA", (ICON, sh_h), (0, 0, 0, 0))
    sp = scrim.load()
    for y in range(sh_h):
        al = int(215 * (y / max(1, sh_h - 1)) ** 0.65)
        for x in range(ICON):
            sp[x, y] = (6, 12, 30, al)
    badge.alpha_composite(scrim, (0, ICON - sh_h))

    # kelime markası — rozetin İÇİNDE, rozetle aynı ölçekte küçülür
    try:
        f = ImageFont.truetype(FONT, 66)
    except Exception:
        f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 62)
    d = ImageDraw.Draw(badge)
    txt, ls = "MOVE LOG", 6
    wsum = sum(d.textlength(c, font=f) + ls for c in txt) - ls
    x = (ICON - wsum) / 2
    ty = ICON - sh_h + (sh_h - 66) / 2 - 4
    for c in txt:
        d.text((x, ty), c, font=f, fill=(255, 255, 255, int(255 * TXT_A)),
               stroke_width=3, stroke_fill=(0, 0, 0, 170))
        x += d.textlength(c, font=f) + ls

    # ince beyaz kontur: koyu zeminde rozetin kenarı kaybolmasın
    ring = Image.new("RGBA", (ICON, ICON), (0, 0, 0, 0))
    ImageDraw.Draw(ring).rounded_rectangle([1, 1, ICON - 2, ICON - 2],
                                           radius=int(ICON * 0.2237), outline=(255, 255, 255, 90), width=3)
    badge.alpha_composite(ring)

    # squircle dışına taşan perde/yazı pikselleri kırpılsın
    badge.putalpha(Image.composite(badge.getchannel("A"), Image.new("L", (ICON, ICON), 0), mask))

    # rozet opaklığı
    a = badge.getchannel("A").point(lambda v: int(v * ICON_A))
    badge.putalpha(a)

    W = H = ICON + PAD * 2
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))

    # yumuşak gölge (parlak uydu zemininde okunsun)
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([PAD, PAD + 6, PAD + ICON, PAD + ICON + 6],
                                         radius=int(ICON * 0.2237), fill=(0, 0, 0, 130))
    out.alpha_composite(sh.filter(ImageFilter.GaussianBlur(14)))
    out.alpha_composite(badge, (PAD, PAD))

    out.save(OUT)
    print(f"yazıldı: {OUT}  {out.size}  ({os.path.getsize(OUT)} bayt)")

if __name__ == "__main__":
    main()
