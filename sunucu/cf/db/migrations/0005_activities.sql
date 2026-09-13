-- 0005: GÜNLÜK ÖZET tablosu (2026-09-04).
-- NEDEN: `GET /api/activities` (api/src/routes/grup7.ts:478) bu tablodan okuyor ama tablo HİÇ
-- YARATILMAMIŞTI → sorgu "no such table: activities" ile patlıyor, uçtaki `catch` bunu YUTUP
-- boş liste dönüyordu. Sonuç: uygulamadaki "Günlük özet" ekranı BOMBOŞ (Barış şikayeti 04.09).
-- Özetler bu arada üretiliyordu ama yalnız KV'ye (`sent:ozet:<gun>_<uid>`, 3 gün TTL) yazılıyordu
-- — yani ekranın okuduğu yere hiç ulaşmıyordu (cron/src/gorevler/activity-detect.ts:412).
-- Bu göç tabloyu açar; activity-detect artık HEM KV'ye (durum bayrağı) HEM buraya yazar.
--
-- `day` iki biçimde olabilir (grup7.ts:490 parseRangeName ile ayrıştırılır):
--   'YYYY-MM-DD'                      → günlük kart
--   'YYYY-MM-DD_YYYY-MM-DD' benzeri   → aralık kartı (POST /api/summary/range)
-- uid NOT NULL: 08-13 gizlilik fiksi — sahipsiz özet kimseye görünmemeli.
CREATE TABLE IF NOT EXISTS activities (
  id         TEXT PRIMARY KEY,            -- '<uid>_<day>' (deterministik; upsert anahtarı)
  uid        TEXT NOT NULL,               -- -> users.uid
  day        TEXT NOT NULL,               -- 'YYYY-MM-DD' veya aralık adı
  summary    TEXT NOT NULL,               -- özet metni (çok satırlı, emoji'li)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (uid, day)
);

-- Okuma deseni: WHERE uid = ? ORDER BY created_at DESC (grup7.ts:479)
CREATE INDEX IF NOT EXISTS idx_activities_uid_created ON activities (uid, created_at DESC);
