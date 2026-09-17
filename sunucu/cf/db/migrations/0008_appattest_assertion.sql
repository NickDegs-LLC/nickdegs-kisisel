-- 0008: App Attest ASSERTION destegi (2026-09-17, Baris: "hepsini yap").
--
-- SORUN: bugune kadar yalnizca ATTESTATION yapiliyordu ve sonucundan sadece keyId saklaniyordu.
-- Apple'in modelinde attestation OMUR BOYU BIR KEREDIR; sonraki her istek, attestation'da elde
-- edilen ACIK ANAHTAR ile imzalanan bir ASSERTION ile dogrulanir. Acik anahtari saklamadigimiz
-- icin assertion teknik olarak IMKANSIZDI -> attestation tek seferlik bir torene donusmustu.
-- Ayrica istemci her acilista generateKey() cagirip YENI donanim anahtari uretiyordu; bu yuzden
-- attest_key surekli degisiyor ve ona dayanan bedava-aksiyon cihaz-dedup'u anlamsizlasiyordu
-- (olcum 17.09: attested=20 ama attest_key=11, free_tactical_devices=0).
--
-- MODEL: keyId istemcide Keychain'de KALICI. Sunucu attestation'da acik anahtari + counter'i yazar;
-- her assertion'da imzayi bu anahtarla dogrular ve counter'in KESIN ARTTIGINI kontrol eder
-- (tekrar saldirisi korumasi). counter artmazsa assertion reddedilir.
--
-- GERIYE DONUK: kolonlar NULL baslar. Eski istemciler assertion gondermez, attest_pubkey NULL
-- kalir ve HICBIR SEY degismez -- akis fail-open oldugu gibi korunur.
ALTER TABLE users ADD COLUMN attest_pubkey  TEXT;     -- credCert SPKI (base64) -- assertion imzasi bununla dogrulanir
ALTER TABLE users ADD COLUMN attest_counter INTEGER;  -- son gecerli assertion counter'i (kesin artmali)
ALTER TABLE users ADD COLUMN attest_receipt TEXT;     -- attestation receipt (base64) -- Apple dolandiricilik metrigi icin ileride
