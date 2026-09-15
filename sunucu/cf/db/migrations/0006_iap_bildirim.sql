-- 0006: App Store Server Notifications V2 + Play RTDN denetim kaydı (2026-09-15).
-- Apple notificationUUID / Pub/Sub messageId ile idempotensi; karar metni kullanıcıya
-- ne yapıldığını (veya neden dokunulmadığını) bırakır. FOREIGN KEY yok (D1 kuralı).
CREATE TABLE IF NOT EXISTS iap_bildirim (
  id         TEXT PRIMARY KEY,           -- Apple notificationUUID | Pub/Sub messageId
  platform   TEXT NOT NULL,              -- 'apple' | 'google'
  tip        TEXT,                       -- notificationType / RTDN türü
  alt_tip    TEXT,                       -- Apple subtype | Google subscriptionId / productType
  ortam      TEXT,                       -- Apple 'Sandbox'|'Production'
  uid        TEXT,                       -- -> users.uid (eşleşmezse NULL)
  pid        TEXT,                       -- ürün kimliği
  karar      TEXT,                       -- 'aktif'|'dusuruldu'|'korundu:<neden>'|'kullanici-yok'|
                                         -- 'yok-sayildi:<neden>'|'hata:<kısa>'
  bitis      INTEGER,                    -- epoch sn (abonelikUygula'ya verilen bitiş)
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS iap_bildirim_uid ON iap_bildirim(uid, created_at);
