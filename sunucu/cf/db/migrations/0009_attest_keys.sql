-- 0009: App Attest — Apple'in SAKLAMA sartlari (2026-09-17, Baris: "Apple ne diyorsa yap hepsini").
--
-- Apple "Validating apps that connect to your server" saklama adiminda dort sey soyluyor:
--   1) "Store the verified public key from credCert on your server and associate it with the user
--       for the specific device."
--   2) "As an added protection against replay attacks, make sure that the public key doesn't
--       already have an association with another user."
--   3) "Be prepared to store multiple (key, receipt) pairs for each user. Store one pair for each
--       device the user uses to access your services."
--   4) "keep development pairs separate from production pairs because you can't use one set in
--       the other's environment."
--
-- 0008'de anahtar users satirinda TEK kolon olarak tutuluyordu:
--   (2) hic kontrol edilmiyordu -> ayni anahtar iki hesaba baglanabilirdi (replay korumasi yok),
--   (3) yapisal olarak imkansizdi (tek kolon = tek cihaz),
--   (4) ortam (development/production) hic kaydedilmiyordu.
--
-- key_id PRIMARY KEY: ayni App Attest anahtari IKI satirda olamaz, dolayisiyla iki uid'e de
-- baglanamaz -> (2) veritabani seviyesinde garanti. Kodda ayrica acik kontrol var ki hata
-- mesaji anlasilir olsun (sessiz constraint patlamasi yerine).
--
-- ⚠️ users.attest_key BILEREK KALIYOR: bedava-aksiyon cihaz-dedup'u onu BES yerde okuyor
-- (grup1:948, grup2:212, grup3:254, grup4:176 ve free_tactical_devices tablosu). O kolon
-- "bu hesabin EN SON anahtari" olarak surdurulur; kaynak dogruluk artik bu tablodadir.
CREATE TABLE IF NOT EXISTS attest_keys (
  key_id     TEXT PRIMARY KEY,           -- credentialId (base64) = Apple keyId
  uid        TEXT NOT NULL,              -- -> users.uid
  pubkey     TEXT NOT NULL,              -- credCert SPKI (base64) — assertion imzasi bununla dogrulanir
  receipt    TEXT,                       -- attestation receipt (base64) — "store the receipt immediately"
  counter    INTEGER NOT NULL DEFAULT 0, -- son gecerli assertion counter'i (KESIN artmali)
  env        TEXT NOT NULL,              -- 'production' | 'development' (aaguid'den turetilir)
  val_kat    INTEGER,                    -- apple_validation_category_01 (iOS 27+; yoksa NULL)
  bundle_ver TEXT,                       -- apple_bundle_version_01 (iOS 27+; yoksa NULL)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attest_keys_uid ON attest_keys(uid);
CREATE INDEX IF NOT EXISTS idx_attest_keys_env ON attest_keys(uid, env);
