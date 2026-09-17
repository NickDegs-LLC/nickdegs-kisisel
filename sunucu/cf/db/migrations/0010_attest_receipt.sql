-- 0010: App Attest receipt yasam dongusu (2026-09-17, Baris: "device check seyi dolandiricilik
-- onlemek icin al bunu" + DeviceCheck yetkili anahtar 7DYNKZZPCX saglandi).
--
-- Apple "Assessing fraud risk": attestation'daki receipt sunucudan Apple'a POST edilir
--   uretim     https://data.appattest.apple.com/v1/attestationData
--   gelistirme https://data-development.appattest.apple.com/v1/attestationData
-- Donen govde YENI bir receipt'tir ve ESKISININ YERINE saklanmalidir. Receipt icindeki alanlar:
--   6  = tip ('ATTEST' ilk receipt | 'RECEIPT' yenilenmis; risk metrigi YALNIZ 'RECEIPT'te)
--   17 = risk metrigi (bu CIHAZIN son 30 gunde urettigi attest anahtari sayisi)
--   19 = not-before (bu tarihten ONCE cagirirsan Apple 304 doner)
--   21 = expiry     (bu tarihten SONRA Apple istegi onurlandirmayabilir)
--
-- Bu yuzden receipt'i "bir kere dogrula" degil, ZAMANLANMIS olarak tazelemek gerekir; kolonlar
-- o zamanlamayi tasiyor. Cagri istek yolunda OLAMAZ (erken cagri 304 yer) -> cron gorevi.
--
-- 0009'da attest_keys.receipt vardi ama omru tasiyan hicbir alan yoktu: ne zaman cagirilacagi,
-- ne zaman olecegi, en son ne dondugu bilinmiyordu.
ALTER TABLE attest_keys ADD COLUMN receipt_tip       TEXT;     -- alan 6:  'ATTEST' | 'RECEIPT'
ALTER TABLE attest_keys ADD COLUMN risk_metrik       INTEGER;  -- alan 17: 30 gunluk anahtar sayisi (NULL = henuz bilinmiyor)
ALTER TABLE attest_keys ADD COLUMN receipt_not_before INTEGER; -- alan 19: epoch; bundan ONCE cagirma (304)
ALTER TABLE attest_keys ADD COLUMN receipt_expiry    INTEGER;  -- alan 21: epoch; bundan sonra cagri bosa
ALTER TABLE attest_keys ADD COLUMN receipt_checked   INTEGER;  -- son basarili tazeleme epoch'u
ALTER TABLE attest_keys ADD COLUMN receipt_hata      TEXT;     -- son hata (304/400/401/429 vb.) - teshis icin

-- Gorev "sirasi gelmis" anahtarlari bununla secer: not_before gecmis ve expiry gelmemis olanlar.
CREATE INDEX IF NOT EXISTS idx_attest_keys_receipt ON attest_keys(receipt_not_before, receipt_expiry);
