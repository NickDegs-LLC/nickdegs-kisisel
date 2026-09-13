-- 0003: movelog-cron görev takvimi (Faz 3, 2026-08-30).
-- Worker ilk tick'te CREATE TABLE IF NOT EXISTS + INSERT OR IGNORE seed de yapar (index.ts hazirla());
-- bu dosya şemanın kayıtlı hali. next_run=0 = bootstrap: periyot görevleri ilk tickte koşar,
-- takvimli görevler (gunluk/haftalik/yillik/saatmod) yalnız saatini kurar.
CREATE TABLE IF NOT EXISTS gorev_takvimi (
  name       TEXT PRIMARY KEY,          -- görev adı (takvim.ts GOREVLER kaydıyla birebir)
  cron_grubu TEXT NOT NULL,             -- 'dakikalik' | 'on_dk' | 'saatlik' (hangi cron ifadesi seçer)
  next_run   INTEGER NOT NULL DEFAULT 0,-- bir sonraki koşum (epoch sn, UTC); claim atomik UPDATE ile
  last_run   INTEGER,                   -- son koşum başlangıcı
  last_ok    INTEGER,                   -- son BAŞARILI koşum
  hata       TEXT,                      -- son koşum hatası (başarılıda NULL)
  enabled    INTEGER NOT NULL DEFAULT 1,-- 0 = kapalı (review-state varsayılan kapalı — sunucuda da DISABLED)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
