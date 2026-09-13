-- 0004: KENDİ KENDİNİ ONARAN bekçi katmanı (Faz T, 2026-08-31).
-- Her bekçi turu TESPİT → ONAR → DOĞRULA → buraya bir satır yazar. Kuru (ORTAM=golge) turlarda
-- aksiyon 'YAPARDIM: ...' önekiyle, sonuc='kuru' olarak düşer — hiçbir dış yazım yapılmaz.
-- Worker ilk yazımda CREATE TABLE IF NOT EXISTS de çalıştırır (gorevler/bekci-ortak.ts olayYaz());
-- bu dosya şemanın kayıtlı hali. Budama: d1-tutarlilik bekçisi 30 günden eskiyi siler.
CREATE TABLE IF NOT EXISTS bekci_olay (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         INTEGER NOT NULL,          -- olay epoch sn (UTC)
  bekci      TEXT    NOT NULL,          -- 'runpod-saglik' | 'kuyruk-bekcisi' | 'imaj-surum-bekcisi'
                                        -- | 'video-butunluk' | 'd1-tutarlilik' | 'kendi-kendini-test'
                                        -- | 'render-bekci'
  tespit     TEXT    NOT NULL,          -- NE görüldü ('wmax-sifir', 'hayalet-video', 'saglam' ...)
  aksiyon    TEXT    NOT NULL,          -- NE yapıldı / kuru turda 'YAPARDIM: ...'
  sonuc      TEXT    NOT NULL,          -- 'saglam'|'onarildi'|'kuru'|'bildirildi'|'basarisiz'|'atlandi'
  detay_json TEXT                       -- ölçüm/kanıt (ortam, endpoint, rid, sayılar, hata metni)
);
CREATE INDEX IF NOT EXISTS ix_bekci_olay_ts    ON bekci_olay (ts DESC);
CREATE INDEX IF NOT EXISTS ix_bekci_olay_bekci ON bekci_olay (bekci, ts DESC);

-- kendi-kendini-test duman turunun D1 yaz/oku ayağı — uygulama tablolarına DOKUNMAZ (izole).
CREATE TABLE IF NOT EXISTS bekci_duman (
  k  TEXT PRIMARY KEY,
  v  TEXT NOT NULL,
  ts INTEGER NOT NULL
);
