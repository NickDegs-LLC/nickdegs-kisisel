// movelog-cron — Env tipi. Binding'ler: cron/wrangler.toml; sırlar SECRETS.md tablosuna göre
// OPSİYONEL: hiçbiri yüklenmeden de worker ayakta kalır, ilgili görev "anahtar yok" diye loglar.
export type Env = {
  // push (2026-08-31: KV push:bekleyen tüketicisi cron'a eklendi — lib-push.ts kullanır)
  APNS_AUTH_KEY?: string
  APNS_KEY_ID?: string
  APNS_TEAM_ID?: string
  APNS_TOPIC?: string
  FCM_SERVICE_ACCOUNT?: string
  FCM_PROJECT_ID?: string

  DB: D1Database                 // movelog-db (26 tablo + gorev_takvimi)
  KV: KVNamespace                // push:bekleyen:* · bildirim:bekleyen:* · gorev:log:* · bekci:* ...
  R2: R2Bucket                   // movelog bucket (videos/, genreq/, tracks/ ...)
  RENDER_Q: Queue                // movelog-render kuyruğu (producer) — ORTAM=golge iken ride_id 'golge:' önekli
  // Service binding'ler (kendi-kendini-test duman testi). ⚠️ Worker→Worker HTTP fetch aynı workers.dev
  // bölgesinde YASAK ("error code: 1042" + HTTP 404, 2026-08-31 ölçüldü) — kardeş worker'a yalnız
  // service binding ile gidilir. Binding yoksa ilgili duman ayağı 'atlandı' der, testi düşürmez.
  API?: Fetcher                  // movelog-api
  DISPATCH?: Fetcher             // movelog-dispatch

  // [vars]
  ORTAM: string                  // "golge" | "canli" — golge: push/RunPod/Telegram HİÇBİR gerçek dış yazım yok
  RUNPOD_ENDPOINT_ID?: string    // q9tw33kjmqx35a (render-bekci; golge modda kullanılmaz)
  RUNPOD_ENDPOINT_TAC?: string   // movelog-tactical CPU endpoint'i — BOŞ = henüz kurulmadı (kota 20/20).
                                 // bekçiler: runpod-saglik (wmax/health), imaj-surum-bekcisi, kuyruk-bekcisi
  API_UC?: string                // movelog-api public kökü (video-kontrol teslim testi + duman testi)
  DISPATCH_UC?: string           // movelog-dispatch public kökü (kendi-kendini-test /health ayağı)

  // wrangler secret'ları (hepsi opsiyonel — yoksa görev kendini "atlandı" olarak loglar)
  TICK_SECRET?: string           // /internal/tick manuel tetik kapısı (boşsa uç FAIL-CLOSED)
  RUNPOD_API_KEY?: string        // render-bekci (yalnız ORTAM=canli'da kullanılır)
  JWT_SECRET?: string            // video-kontrol: kullanıcı JWT'siyle teslim ucu testi
  RENDER_DONE_SECRET?: string    // (yedek) iç uçlara HTTP çağrı gerekirse; şu an iç yazımlar doğrudan D1
  ASC_KEY_ID?: string            // App Store Connect (yorum-watch / review-state)
  ASC_ISSUER_ID?: string
  ASC_APP_ID?: string
  ASC_P8?: string                // ES256 özel anahtar (PEM)
  // App Attest receipt / dolandırıcılık metriği (attest-receipt görevi, 17.09).
  // ⚠️ APNs anahtarı BURADA KULLANILAMAZ: DeviceCheck servisi anahtar üretilirken seçilir ve
  // eldeki beş eski anahtarın hepsi Apple'a 401 veriyordu (ölçüldü). 7DYNKZZPCX bunun için üretildi.
  DEVICECHECK_P8?: string        // ES256 özel anahtar (PEM) — DeviceCheck yetkili
  DEVICECHECK_KEY_ID?: string    // 7DYNKZZPCX (boşsa görevdeki varsayılan)
}
