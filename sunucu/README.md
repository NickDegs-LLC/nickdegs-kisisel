# sunucu/ — Move Log sunucu tarafı (yedek + sürüm takibi)

Uygulamanın (iOS/Android) çalıştığı **canlı arka uç**. Bu dizin 2026-09-13'te GitHub'a alındı;
o güne dek kod yalnızca üretim sunucusunda (`/opt/matrix/...`) duruyordu, hiçbir yedeği yoktu.

> ⚠️ **Burası dağıtım kaynağı DEĞİL, yedektir.** Canlı dağıtım hâlâ sunucudaki dizinlerden
> yapılıyor. Buradan bir şey geri yüklerken önce sunucudaki hâliyle karşılaştır.

## Ne nerede

| Dizin | Karşılığı (sunucu) | Ne işe yarar |
|---|---|---|
| `cf/` | `/opt/matrix/cf` | **Canlı backend** — Cloudflare Workers: `api` (kisisel-api.nickdegs.com), `gps` (gpsdata…), `dispatch`, `cron`, `harita-katman`. `db/migrations` = D1 şeması, `contracts/` = uç nokta sözleşmeleri, `tools/` = kesim/dağıtım betikleri |
| `render-worker/` | `/opt/matrix/render-worker` | 3B/taktik video render motoru (RunPod imajı, v151) |
| `modal/` | `/opt/matrix/modal` | Modal.com işçisi (RunPod yedeği; bakiye bitince devreye alınacak) |
| `scripts/` | `/opt/matrix/scripts` | harita-proxy, pmtiles okuyucu, sağlık taraması, TTS ısıtma |

## Veri deposu
- **D1:** `movelog-db` — users · rides · videos · positions · gorev_takvimi · bekci_olay …
- **R2:** video/ses nesneleri · **KV:** ayarlar/bekçi durumu · **Queues:** render kuyruğu

## 🔒 Sırlar — burada YOK
Hiçbir token/anahtar/parola bu dizine girmedi. Envanter (yalnız **ad + yol**, değer yok):
`cf/SECRETS.md`. Gerçek değerler sunucuda: `/opt/matrix/secrets/`, `/etc/nickdegs/`,
`/opt/github-deploy/` — ve `source /usr/local/bin/api-env.sh` ile yüklenir.

Yedeğe alınırken şu literaller **maskelendi** (canlı dosyalar değişmedi):
- Matrix bot/bildirim token'ları → `SIR_KALDIRILDI_bkz_secrets_MATRIX_*`
- Traccar parolası → `SIR_KALDIRILDI_bkz_etc_nickdegs_traccar_conf`

Geri yükleme yaparsan bu satırları gerçek değerlerle (tercihen env okuyarak) doldur.

## Dahil edilmeyenler
`node_modules/` · `.wrangler/` · `__pycache__/` · Chrome önbelleği (411 MB) ·
müzik/ses varlıkları (telifli, ~80 MB) · font ve model ağırlıkları (`.ttc`, `.bin`) ·
2 MB üstü ikili dosyalar. Bunlar sunucuda kalır, kod buradadır.
