-- 0014 (2026-10-18) — İLK VİDEO HEDİYESİ GERİ ALINDI
-- Barış: "Hediye niye verdin, ben öyle bir şey demedim." 0013'ün verdiği ve yeni üyelerin kayıtta aldığı
-- 1 video hakkı sıfırlanır. Ölçüm 18.10: video_hak>0 olan 104 kişinin HEPSİ video_hak=1, premium=0 ve
-- hiçbirinin satın alma kaydı yok (iap_transactions'ta video paketi hiç satılmadı) → hepsi hediye.
-- İdempotent; satın alma kaydı olan kullanıcıya dokunmaz.
UPDATE users
   SET video_hak = 0, updated_at = CAST(strftime('%s','now') AS INTEGER)
 WHERE COALESCE(video_hak, 0) = 1
   AND COALESCE(premium, 0) = 0
   AND uid NOT IN (SELECT uid FROM iap_transactions WHERE uid IS NOT NULL);
