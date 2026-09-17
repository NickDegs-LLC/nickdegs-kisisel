-- 0007: hesap <-> CIHAZ baglama (2026-09-17, Baris: "herkes tek cihazdan girecek").
-- Kullanici kimligi (uid) ile cihaz kimligi bugune kadar ayrilmamisti; cihaza ait veriler
-- (attest_key, tracker_id, state_json) kullanici satirinda duruyordu ve "hangi cihaz" sorusu
-- ancak user-agent + IP tahminiyle cevaplanabiliyordu (17.09 teshisinde bizzat yasandi).
-- Model: hesap TEK cihaza baglidir. Giris baska cihazdan gelirse tv artirilir (eski oturum
-- dusuru) ve hesap yeni cihaza baglanir = "son giren kazanir".
-- Eski istemciler basligi gondermez -> device_id NULL kalir ve HICBIR SEY degismez.
ALTER TABLE users ADD COLUMN device_id   TEXT;     -- iOS identifierForVendor | Android ANDROID_ID
ALTER TABLE users ADD COLUMN device_seen INTEGER;  -- bu cihazin son goruldugu epoch
CREATE INDEX IF NOT EXISTS idx_users_device ON users(device_id);
