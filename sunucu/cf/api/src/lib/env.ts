// movelog-api — ortak Env tipi (tüm gruplar bunu kullanır)
// Binding'ler: api/wrangler.toml; sırlar: `wrangler secret put` (SECRETS.md).

export type Env = {
  DB: D1Database                 // movelog-db (26 tablo, cf/db/migrations/0001_init.sql)
  KV: KVNamespace                // mapconfig, smsfix:{tel}, integrity_nonce:{uid}, attest_challenge:{uid}, push:bekleyen:*, rl:* ...
  R2: R2Bucket                   // movelog bucket: videos/, tracks/, usermusic/, stockmusic/, ridephotos/, avatars/
                                 // (18.09: ptt/ ve voicemsg/ önekleri artık YAZILMIYOR; eski nesneler
                                 //  R2 lifecycle ile kendiliğinden düşer, hesap silme de temizliyor)
  RENDER_Q: Queue                // movelog-render kuyruğu (producer) — tüketici: movelog-dispatch
  DISPATCH?: Fetcher             // movelog-dispatch service binding (opsiyonel; wrangler.toml'a Faz 3'te eklenir)
  KART?: Fetcher                 // movelog-kart service binding (routes/kart.ts — PNG kartlar; yoksa 503)

  // [vars]
  ORTAM: string                  // "golge" | "canli"
  HARITA: Fetcher            // service binding (origin bypass; bkz wrangler.toml)
  HARITA_UC: string              // harita katmanı public kökü (matching/geocoding): https://harita.nickdegs.com/24579d9db6c7c001
  MAPBOX_TOKEN?: string          // motor3d: matching/geocoding URL'lerindeki access_token (harita-katman YUTAR;
                                 // spec.token alanı da sayfaya SIZMAZ — route-video.py ile biçim eşitliği için)

  // wrangler secret'ları
  JWT_SECRET: string             // HS256 imza anahtarı (main.py JWT_SECRET ile AYNI değer — gölge modda token'lar ortak)
  RENDER_DONE_SECRET?: string    // iç uçlar (register-ride/render-done/render-failed/internal-music); boşsa FAIL-CLOSED (403)
  GIFT_ADMIN_SECRET?: string     // admin uçları (announce/broadcast/costs/gencodes); boşsa FAIL-CLOSED (403)

  // Play RTDN (Pub/Sub OIDC). Boşsa uç varsayılanları kullanır:
  //   aud = https://kisisel-api.nickdegs.com/api/iap/google/bildirim
  //   sa  = movelog-deploy@move-log-500805.iam.gserviceaccount.com
  RTDN_AUD?: string
  RTDN_SA?: string

  // grup dönüş notlarından eklenen opsiyonel sırlar (SECRETS.md kayıtlı; boşsa ilgili uçlar
  // fail-closed / 503 dalına düşer — gruplar kendi denetimlerinde bu davranışı doğruladı)
  USERS?: string                 // "kullanici:parola,..." (main.py:46 APP_USERS — grup3 login)
  TWILIO_SID?: string            // SMS OTP (grup3)
  TWILIO_TOKEN?: string
  TWILIO_VERIFY_SID?: string
  REVIEW_PHONE?: string          // App Store inceleme bypass numarası (main.py:60)
  REVIEW_CODE?: string           // inceleme sabit OTP kodu (main.py:61)
  // 18.09: LIVEKIT_KEY / LIVEKIT_SECRET / LIVEKIT_URL KALDIRILDI — canlı telsiz + interkom çıktı.
  // ⚠️ Cloudflare'deki worker SIRLARI ayrıca silinmeli (`wrangler secret delete`), kod yeter değil.
  TRACCAR_URL?: string           // paralel dönem Traccar okuması (grup1; yoksa 503 "cihaz Traccar'da bulunamadı")
  TRACCAR_USER?: string
  TRACCAR_PASS?: string

  // push altyapısı (lib/push.ts; api + cron ortak) — sırlar SECRETS.md bölüm 1
  APNS_AUTH_KEY?: string         // AuthKey_CAAF5X8DD3.p8 PEM İÇERİĞİ (push.py:13) — yoksa APNs dalı atlanır
  FCM_SERVICE_ACCOUNT?: string   // film-ozet servis hesabı JSON'u (push.py:33) — yoksa FCM dalı atlanır
  // kimlik sabitleri: [vars] (SECRETS.md bölüm 2); boşsa push.ts VARSAYILAN'ları (push.py:12,34) geçerli
  APNS_KEY_ID?: string           // CAAF5X8DD3
  APNS_TEAM_ID?: string          // SZF4T3P583
  APNS_TOPIC?: string            // com.nickdegs.kisisel
  FCM_PROJECT_ID?: string        // film-ozet
}

// Hono generic'i: c.env = Env, c.get('user') = authUser'ın çözdüğü kanonik uid
export type AppEnv = { Bindings: Env; Variables: { user: string } }
