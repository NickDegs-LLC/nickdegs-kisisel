# sunucu/_arsiv — sunucu dönemi araçları (salt kayıt)

2026-09-15'te Move Log tamamen sunucusuz yapıldı (Cloudflare Workers + D1/KV/R2, render Modal,
dağıtım GitHub Actions). Bu klasördeki dosyalar sunucuyu (`/opt/matrix`, `api-env.sh`, sunucu IP'leri)
varsayar ve **artık çalıştırılmaz**; yalnız geçmiş kaydı ve olası geri dönüş bilgisi için tutulur.

- `cf/tools/` — Cloudflare'e kesim (kesim*.sh), geri dönüş, gölge diff, sır yükleme betikleri (Eylül başı geçişi).
- `cf/harita-katman/deploy-golge.sh` — harita katmanı gölge (route'suz) dağıtımı; devir tamamlandı.
- `cf/db/` — sunucudaki social.json / Traccar'dan D1'e tek seferlik aktarım betikleri.
- `modal/ghcr-sir-degistir.sh` — Modal ghcr sırrını sunucudan değiştiren tek seferlik betik.
- `scripts/` — sunucudaki `/opt/matrix/scripts` kopyası (harita-proxy, sağlık taraması vb.; bir kısmı
  sunucuda Hooder/Matrix için hâlâ çalışır — kaynağı SUNUCUDADIR, bu kopya yedektir).
- `*.bak*` — düzenleme öncesi yedek dosyalar.

Güncel yollar: dağıtım `.github/workflows/cf-deploy.yml` · render imajı `render-imaj.yml` · Modal `modal-deploy.yml`.
