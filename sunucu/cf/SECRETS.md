# Move Log → Cloudflare — Sır/Yapılandırma Envanteri (Faz 0)

Tarih: 2026-08-30 · Kaynaklar salt-okunur tarandı; **hiçbir değer bu dosyada yok**, yalnız ad+yol+tip.
Worker seti (plan v2, `MOVELOG-CLOUDFLARE-PLAN.md` satır 7/58/98): **movelog-api · movelog-gps ·
movelog-dispatch · movelog-cron** — `movelog-harita` worker'ı **İPTAL** (harita Hooder'ın; salt-okur
tüketiciyiz), o yüzden aşağıda hiçbir sır "harita" worker'ına atanmadı.

Push aracı: `tools/secrets-push.sh` (değer loglamaz; `--dry-run` yalnız adları basar).
Gerçek push **Faz 2'de** (plan satır 100: "sırlar wrangler secret (push Faz 2'de)").

## 1. Sırlar (`wrangler secret put`)

Kaynak kanıtları: `config.env` = `/opt/movelog/backend/config.env` (adlar `grep '^AD='` ile alındı;
tüketim: `main.py` satır 26 `CONF_PATH`, Dockerfile satır 6). Script kanıtları satır numaralarıyla notta.

| wrangler secret ADI | Worker(lar) | Kaynak dosya | Tip | Not |
|---|---|---|---|---|
| JWT_SECRET | api | config.env | string | Oturum JWT imzası (main.py:45) |
| USERS | api | config.env | string | `kullanici:parola,...` listesi (main.py:46) — D1 `users` tablosuna göçünce düşer |
| TRACCAR_USER | api, cron | config.env (aynısı `/etc/nickdegs/traccar.conf` + `/opt/matrix/secrets/traccar.conf`) | string | Paralel dönem Traccar okuma (main.py:49; cron scriptleri `_yerel.traccar_creds()` → /etc/nickdegs/traccar.conf) |
| TRACCAR_PASS | api, cron | config.env | string | Üsttekiyle birlikte |
| TWILIO_SID | api | config.env | string | API Key SID (SK…) — SMS-OTP girişi (main.py:52) |
| TWILIO_TOKEN | api | config.env | string | API Key Secret (main.py:53) |
| TWILIO_VERIFY_SID | api | config.env | string | Verify servisi (main.py:54) |
| TWILIO_ACCOUNT_SID | api | config.env | string | AC… (main.py:55) |
| GIFT_ADMIN_SECRET | api | config.env | string | Hediye/admin ucu |
| REVIEW_PHONE | api | config.env | string | App Store inceleme bypass numarası (main.py:60) — bypass verisi olduğu için sır |
| REVIEW_CODE | api | config.env | string | İnceleme sabit OTP kodu — sır |
| R2_ACCESS_KEY_ID | api, dispatch, cron | config.env (aynısı `/opt/matrix/secrets/movelog-r2.conf`) | string | Presigned URL üretimi main.py:86-112; dispatch atası movelog-cloud.py:146; cron: pending-reconcile/video-kontrol/svcache-rapor. Worker'da R2 **binding** varken yalnız presign için gerekli |
| R2_SECRET_ACCESS_KEY | api, dispatch, cron | config.env | string | Üsttekiyle birlikte |
| RENDER_DONE_SECRET | api, dispatch, cron | config.env (aynısı `/opt/matrix/secrets/movelog-backend.conf`) | string | Motor→`/internal/render-done` doğrulaması; dispatch job'a enjekte eder (movelog-cloud.py:39-40); cron: movelog-pending-reconcile.py |
| LIVEKIT_KEY | api | config.env | string | İnterkom token imzası (main.py LIVEKIT_*) — ✅ yüklendi 2026-08-30 (Görev C) |
| LIVEKIT_SECRET | api | config.env | string | Üsttekiyle birlikte — ✅ yüklendi 2026-08-30 |
| LIVEKIT_URL | api | config.env | string | WSS adresi; gizli değil ama kaynak tekliği için bölüm 2'den buraya taşındı (Görev C) — ✅ yüklendi 2026-08-30 |
| RUNPOD_API_KEY | dispatch, cron | `/opt/matrix/secrets/runpod.conf` | string | RunPod REST (movelog-cloud.py:20-28,91,114; movelog-grupsurus.py da okuyor) |
| APNS_AUTH_KEY | api, cron | `/opt/github-deploy/apple/AuthKey_CAAF5X8DD3.p8` | PEM | APNs ES256 anahtarı (push.py:13). Worker'da WebCrypto ile imza: `api/src/lib/push.ts` — ✅ movelog-api'ye yüklendi 2026-08-30 (push görevi); cron'a ilk deploy'unda secrets-push.sh yükler (worker henüz yok) |
| FCM_SERVICE_ACCOUNT | api, cron | `/opt/github-deploy/google-play-admin.json` | JSON | FCM HTTP v1 servis hesabı (push.py:33) **+ Google Play IAP doğrulama** (main.py:1594-1601,1720 `_GOOGLE_SA`) — api ataması bu yüzden de şart. Kopyası `/opt/movelog/backend/google-play-admin.json` — ✅ movelog-api'ye yüklendi 2026-08-30 (push görevi); cron ilk deploy'da |
| GCP_SERVICE_ACCOUNT | dispatch (OPSİYONEL) | `/opt/matrix/secrets/gcp-movelog.json` | JSON | Pub/Sub/Cloud Run yedek yolu (movelog-cloud.py:31) — Cloud Run yolu MÜHÜRLÜ; fallback porta alınırsa gerekir, alınmazsa PUSH ETME |

**Deploy-zamanı (worker sırrı DEĞİL):** `CLOUDFLARE_API_TOKEN` ←
`/opt/matrix/secrets/movelog-cf.conf` içindeki `MOVELOG_CF_TOKEN` (+ `CLOUDFLARE_ACCOUNT_ID` ←
`MOVELOG_CF_ACCOUNT_ID`). `secrets-push.sh` bunu değeri yazmadan export eder; wrangler oturumu bununla açılır.

Benzersiz worker sırrı: **21** (GCP_SERVICE_ACCOUNT opsiyonel dahil; LIVEKIT_URL dahil) · worker-başına
atama toplamı **32** put (api 19 · dispatch 4+1 ops. · cron 8). ⚠️ Denetim düzeltmesi (2026-08-30): MAPBOX_SECRET_TOKEN sır
listesinden ÇIKARILDI — worker kapsamındaki tüketiciler (movelog-cloud.py:167, activity-detect.py:29)
gerçekte **MAPBOX_PUBLIC_TOKEN** okuyor (bölüm 2'ye taşındı); SECRET_TOKEN'ın tek tüketicisi
harita-proxy.py:49 = İPTAL edilen harita ayağı (bölüm 3).

## 2. Gizli OLMAYAN ayarlar → `wrangler.toml [vars]`

| var ADI | Worker(lar) | Bugünkü kaynak | Değer/Not |
|---|---|---|---|
| AYLIK_BUTCE_ULTRA | api | config.env | Aylık video bütçesi (Ultra) |
| AYLIK_BUTCE_PREMIUM | api | config.env | Aylık video bütçesi (Premium) |
| HARITA_UC_ONEK | api | config.env (ayrıca `/opt/matrix/secrets/harita-uc.conf` — tüketicisi scriptlerde bulunamadı) | Harita ucu yol öneki; K0 sonrası ortak katman değerine döner |
| TRACCAR_URL | api, gps, cron | config.env + `/etc/nickdegs/traccar.conf` | Paralel dönem; Faz 4'te düşer |
| INTEGRITY_ENFORCE | api | config.env | Bayrak (aç/kapa) |
| APPATTEST_ENFORCE | api | config.env | Bayrak |
| APPATTEST_APPID | api | kod sabiti main.py:1786 (`SZF4T3P583.` + bundle) | Varsayılan yeterli |
| IAP_BUNDLE_ID | api | kod sabiti main.py:1470 | `com.nickdegs.kisisel` |
| OWNER_UID | api, cron | kod sabiti main.py:24 | `u69be3f7e960e` (etiketsiz eski veri sahibi) |
| R2_BUCKET | api, dispatch, cron | config.env / r2 conf'lar | `movelog` — asıl erişim R2 **binding** ile |
| R2_ENDPOINT | api, dispatch, cron | config.env | Yalnız presign için; account id içerir (yarı-gizli, yine de var yeterli) |
| RUNPOD_ENDPOINT_ID | dispatch, cron | `/opt/matrix/secrets/runpod.conf` | `q9tw33kjmqx35a` bilinen değer |
| APNS_KEY_ID | api, cron | kod sabiti push.py:12 | `CAAF5X8DD3` — ✅ api+cron wrangler.toml [vars]'a yazıldı 2026-08-30 (push.ts varsayılanı da aynı) |
| APNS_TEAM_ID | api, cron | kod sabiti push.py:12 | `SZF4T3P583` — ✅ [vars] 2026-08-30 |
| APNS_TOPIC | api, cron | kod sabiti push.py:12 | `com.nickdegs.kisisel` — ✅ [vars] 2026-08-30 |
| FCM_PROJECT_ID | api, cron | kod sabiti push.py:34 | `film-ozet` — ✅ [vars] 2026-08-30 |
| TWILIO_SENDER | api | config.env | Alfanümerik gönderici adı — gizli değil |
| ~~LIVEKIT_URL~~ | api | config.env | Bölüm 1'e taşındı (Görev C 2026-08-30): [vars] yerine sır olarak yüklendi — kaynak tekliği (config.env) + secrets-push.sh boru hattı |
| MAPBOX_PUBLIC_TOKEN | dispatch, cron | `/opt/matrix/secrets/mapbox.conf` | pk.* token tasarım gereği public → var yeterli. GERÇEK tüketiciler: movelog-cloud.py:167 (map-match), activity-detect.py:29 (geocoding). Faz H'de ortak katman kararıyla (A4) düşebilir |

`movelog-gps` worker'ının **hiç sırrı yok** (OsmAnd ingest deviceid ile; yalnız D1 binding + TRACCAR_URL
paralel-yansıtma var'ı). `movelog-harita` İPTAL → sıfır atama.

## 3. Kaynağı BULUNAMAYAN / kapsam dışı

| Ad | Durum |
|---|---|
| TWILIO_TEMPLATE_SID | main.py:57'de kullanılıyor ama **config.env'de YOK** — kod boş varsayılanla çalışıyor (main.py:750 `if TWILIO_TEMPLATE_SID`). Push listesine ALINMADI; Barış özel Verify metni isterse değer temin edilmeli |
| MAPBOX_SECRET_TOKEN | `/opt/matrix/secrets/mapbox.conf` içinde VAR ama worker kapsamında tüketicisi YOK — tek tüketici harita-proxy.py:49 (harita ayağı İPTAL, Hooder'ın). Worker'lara atanmadı, push edilmez |
| ADMIN_NUMBERS_FILE | main.py:63 — sır değil, **dosya yolu** (varsayılan `DATA_DIR/admin-numbers.conf`; içeriği admin telefon listesi = veri). Workers'ta D1/KV'ye göçer, secret push'u yok |
| ROUTES_DIR / CONF_PATH / DATA_DIR / OWNER_UID (env) | main.py:22-27 os.environ — dosya-sistemi yolları + sahip uid; Workers'ta yol kavramı yok (OWNER_UID zaten bölüm 2 vars'ta) |
| GOOGLE_MAPS_KEY | Kaynak var (`/opt/matrix/secrets/gmaps.conf`) ama backend/scriptlerde **tüketici bulunamadı** (Street View anahtarı motor/RunPod template env'inde olmalı) — worker'lara atanmadı |
| `/opt/matrix/secrets/livekit.conf` | Tek satır, `AD=DEĞER` formatında DEĞİL; tüketicisi bulunamadı. Backend LIVEKIT_* değerlerini config.env'den alıyor — worker kaynağı config.env |
| movelog-yt-client.json / movelog-yt-token.json | Tüketiciler `/opt/matrix/kisisel-app/yt-auth.py` + `upload-play-videos.py` (Play ASO araçları) — worker kapsamı DIŞI, taşınmaz |
| `/opt/matrix/secrets/tactical_force_aspect.conf` | Sır değil; 1 satırlık ayar bayrağı (movelog-cloud.py:485) — Faz T'de dispatch var'ına döner |
| `/opt/matrix/secrets/r2.conf` | movelog-r2.conf ile aynı bucket (`movelog`); worker kaynağı olarak config.env/movelog-r2.conf esas alındı |

## 4. Push altyapısı notu (2026-08-30 — push görevi)

Kütüphane: `api/src/lib/push.ts` (api + cron ortak; push.py birebir port). Görev metnindeki geçici
adlar bu envanterin KANONİK adlarına eşlendi: **APNS_P8 → APNS_AUTH_KEY** (p8 dosya içeriği),
**FCM_SA → FCM_SERVICE_ACCOUNT** (SA JSON); APNS_KEY_ID/APNS_TEAM_ID (+APNS_TOPIC, FCM_PROJECT_ID)
bölüm 2 [vars]. KV anahtarları: `push:apnsjwt` (ES256 JWT, 20 dk TTL) · `push:fcmtoken` (OAuth
erişim token'ı, expires_in-60 TTL) · `push:kuru:<ts>_<hex>` (KURU MOD kaydı, 7 gün TTL).
KURU MOD: `ORTAM !== 'canli'` iken APNs/FCM'e HTTP çağrısı YAPILMAZ; payload + hedef token
sayıları push:kuru kaydına yazılır. Gerçek gönderim yalnız ORTAM=canli.
Doğrulandı 2026-08-30: kuru KV kaydı gerçek gölge KV'de oluştu (guard: 0 push-HTTP), APNs JWT
ES256 imzası p8 public key'e karşı yerel doğrulandı (+negatif kontrol), FCM OAuth token'ı gerçekten
alındı (scope=firebase.messaging, expires_in 3599) — token isteği push değildir.

## 5. movelog-cron notu (2026-08-30 — cron dolumu)

- **TICK_SECRET** (yeni, yalnız movelog-cron): `/internal/tick` manuel tetik kapısı. Kaynak:
  `/opt/matrix/secrets/movelog-cron.conf` → `MOVELOG_CRON_TICK_SECRET` (chmod 600, bu görevde üretildi).
  secrets-push.sh tablosunda YOK — cron'a özel, elle `wrangler secret put TICK_SECRET` ile yüklendi.
- Cron'un 8 sırlık atama tablosu (bölüm 1) henüz PUSH EDİLMEDİ — tüm görevler sır yokken fail-soft
  ("anahtar yok, atlandı" logu). ORTAM=golge iken RunPod'a hiçbir çağrı yapılmaz (render-bekci kuru mod;
  movelog-dispatch'e 'golge:' önek koruması eklendi — golge işler RunPod'a GİTMEZ, KV `dispatch:golge:*`).
- Aday ek sırlar (Barış kararı bekler): JWT_SECRET (cron video-kontrol teslim testi),
  ASC_KEY_ID/ASC_ISSUER_ID/ASC_APP_ID/ASC_P8 (yorum-watch + review-state).

## movelog-karo (2026-09-15)
| Sır | Worker | Kaynak | Not |
|---|---|---|---|
| HARITA_ONEK | movelog-karo | Mac `~/.nickdegs/anahtarlar/movelog-sunucu/harita-uc.conf` → `HARITA_UC_ONEK` | harita-katman önekli karo yolu; service binding ile kullanılır, istemciye açılmaz. KV `mapconfig.tiles` = `https://karo.nickdegs.com/sat/{z}/{x}/{y}.jpg` |
