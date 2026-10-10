-- 0013 (2026-10-10) — İLK VİDEO HEDİYE
-- Teşhis (18.09–10.10): 42 yeni üye, 48 "video oluştur" denemesi → 48×402 'video premium özelliği',
-- 0 satın alma denemesi (/api/iap/google hiç çağrılmadı). Ücretsiz kullanıcı KENDİ rotasından tek bir
-- video bile göremiyordu; demo video başkasının rotası. Dönüşüm hunisi burada kopuyordu.
-- Karar (Barış, 10.10 "fixle hepsini"): her üyeye 1 ücretsiz video hakkı. Yeni üyeler kayıt anında
-- video_hak=1 ile doğar (grup3.ts); bu migration MEVCUT ücretsiz üyelere tek seferlik 1 hak verir.
-- İdempotent: hakkı/videosu/bekleyen üretimi olan ya da premium/inceleme hesabı etkilenmez.
-- Hak generate'te düşer (grup1.ts hakOdendi → aylık bütçeden DÜŞMEZ). Maliyet: video başına ~$0,24.
UPDATE users
   SET video_hak = 1, updated_at = CAST(strftime('%s','now') AS INTEGER)
 WHERE COALESCE(premium, 0) = 0
   AND COALESCE(video_hak, 0) = 0
   AND uid NOT IN ('appreview', 'appreview2')
   AND NOT EXISTS (SELECT 1 FROM videos v WHERE v.uid = users.uid)
   AND NOT EXISTS (SELECT 1 FROM pending_videos p WHERE p.uid = users.uid);
