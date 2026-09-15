# Modal geçişi doğrulama araçları (salt-okuma)

- `modal-dogrula.sh` — KV bayrakları (`dispatch:motor`, `dispatch:motor-tac`, `bulut-kapali`), `dispatch:son`, son bekleyen/video/başarısız
  işler ve park kayıtları (D1 + KV REST). İlk gerçek Modal işini doğrulamak için.
- `video-qa.sh <r2_key>` — videoyu R2'den indirir, ölçer, siler: süre, çözünürlük/fps/kodek, faststart, ses (LUFS), 1 kare/sn parlaklık
  (beyaz >235 / siyah <16 kare). ffmpeg + rclone gerekir.
- Sırlar: `~/.nickdegs/anahtarlar/movelog-sunucu` (Mac) (`SIR_DIZIN` ile ezilebilir).

14.09'da bilinen sağlam flyover videosunda: 37,2 sn · 1080×1920@60 · faststart EVET · −70 LUFS (müziksiz = beklenen) · beyaz/siyah kare 0.
