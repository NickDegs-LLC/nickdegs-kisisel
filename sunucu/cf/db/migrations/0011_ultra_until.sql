-- 0011: Ultra katmaninin KENDI bitis tarihi (2026-09-17 gece, uctan uca tarama bulgusu).
--
-- NEDEN: Premium (grup 22168391) ve Ultra (grup 22202706) App Store'da AYRI abonelik gruplari ->
-- bir kullanici ikisini AYNI ANDA aktif tutabilir (or. yillik Premium + aylik Ultra). Sunucu tek bir
-- `premium_until` tutuyor ve `ultra` kararini ondan turetiyordu:
--   - Premium'un yenilemesi/restore'u gelince CASE "bu abonelik ultra degil, daha uzun baska hak yok"
--     deyip ultra=0 yaziyordu -> Ultra'si hala gecerliyken taktik ozellikler 402 (para odenmis, hak yok).
--   - Ultra doldugunda Premium daha uzunsa 'korundu:baska-hak' -> Ultra HIC dusmuyordu.
-- COZUM: ultra_until. Ultra olmayan olay ultra'ya DOKUNMAZ; Ultra olaylari ultra_until'i MAX'lar;
-- cron/bildirim Ultra'yi ultra_until'e gore dusurur. NULL = suresiz (promo/redeem/inceleme), premium_until ile ayni anlam.
ALTER TABLE users ADD COLUMN ultra_until INTEGER;   -- epoch saniye; NULL = suresiz Ultra

-- Backfill: tarihli Ultra kullanicilarinda (bugun 0 kisi) Ultra olayi premium_until'i de MAX'ladigi icin
-- premium_until en iyi tahmindir. Suresiz (NULL) olanlara dokunulmaz.
UPDATE users SET ultra_until = premium_until
 WHERE ultra = 1 AND premium_until IS NOT NULL AND ultra_until IS NULL;
