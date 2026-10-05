# Trailer üretim hattı (05.10.2026) — yerel 3D render, GPU/Modal masrafı YOK

Sosyal medya trailer'ı (9:16, 1080×1920) gerçek render motoruyla (`render-worker/3d/render3d.js`)
sunucuda SwiftShader üzerinden çizilir. Kare başına ~3 sn (3 paralel işte ~6-8 sn); 8 sn'lik klip ≈ 30 dk.

Akış: `rota.py` (OSRM demo → 25 m iz) → `kirp.py` (km penceresi) → `render_clip.sh` (route-video.py SPEC_OUT ile
spec → noHud/noOutro/kare sayısı ezilir → node render3d.js) → `overlay.py` (Plex Sans kapsül/kart PNG) → `montaj.py` (ffmpeg xfade).
`surucu.py` 3 paralel kuyruk. Motor yaması `render3d_noOutro.patch` (küre finalini kapatan `IN.noOutro`).
Ortam: `PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome`, 3d/ dizininde `PUPPETEER_SKIP_DOWNLOAD=1 npm install`.

🔴 v1 KUSURU (Barış: "çizgiler titriyor, nokta sıçrıyor"): `render_clip.sh` frameIdx'i `round()` ile TAM SAYIYA
yuvarlıyordu; motor KESİRLİ (hız-tabanlı) indeks bekler. Adımlar 0/1 → nokta donup sıçrar, kamera aynı indeksi
kullandığı için çizgi titrer. Fiks scriptte (np.interp ile orijinal frameIdx yeniden örneklenir) — klipler bu fiksle
HENÜZ YENİDEN RENDER EDİLMEDİ. Ayrıca ürün 60 fps üretir, v1 30 fps'ti; 60'a çıkınca süre 2×.
Varlıklar: sunucu `/opt/matrix/promo-videos/trailer-2026-10-05/` + R2 `movelog/promo/trailer-2026-10-05/`.
