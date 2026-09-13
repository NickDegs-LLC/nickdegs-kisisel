-- ============================================================================
-- Move Log — D1 (SQLite) şeması · 0001_init
-- Kaynak: /opt/movelog/data/social.json (22 üst anahtar, 2026-08-30 ölçümü)
--         + main.py'de runtime'da doğan 3 anahtar (shared_routes, feedbacks,
--           free_tactical_devices) + Traccar positions (backend'in okuduğu alanlar).
-- Kararların gerekçeleri: /opt/matrix/cf/db/SEMA-NOTLARI.md
--
-- KURALLAR (Faz 0 direktifi):
--  · Her tabloda created_at / updated_at (INTEGER, epoch saniye).
--  · TEXT PK'ler (uid, rid, vid, code...) — mevcut kimlikler aynen korunur.
--  · JSON kolonlar YALNIZ gerçekten şekilsiz/bütün-okunan veri için
--    (avatar, badges, prefs, trackdbg...) — filtrelenen hiçbir alan JSON'da değil.
--  · FOREIGN KEY YOK: D1'de FK desteği zayıf/kapalı; bütünlük Worker kodunda
--    (Hono katmanı) korunur. Aşağıda "-> users.uid" yorumları mantıksal FK'dir.
--  · uploaded_tracks (649 KB, satır başına 1.5k-5k GPS noktası) D1'e GİRMEZ:
--    R2 'tracks/{ts}.json' olarak taşınır; rides.track_key ile bağlanır.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- users  ⇐ social.profiles (47 kayıt) + social.seen (17 kayıt → last_seen_at)
-- Sık filtrelenen/tek tek güncellenen alanlar kolon; bütün-okunan gruplar JSON.
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE users (
  uid                 TEXT PRIMARY KEY,          -- 'baris', 'u69be3f7e960e', 'apple_...', 'google_...'
  name                TEXT,
  handle              TEXT,                      -- @kullanıcıadı (arama/etiket)
  alias               TEXT,                      -- eski kimlik eşlemesi (main.py:193)
  phone               TEXT,                      -- SMS girişi anahtarı (+90...)
  lang                TEXT DEFAULT 'en',         -- push/UI dili (12 dil)
  premium             INTEGER DEFAULT 0 CHECK (premium IN (0,1)),
  ultra               INTEGER DEFAULT 0 CHECK (ultra IN (0,1)),
  admin               INTEGER DEFAULT 0 CHECK (admin IN (0,1)),  -- limitsiz; main.py:2278
  -- ⚠️ Kaynakta bu bayraklar JSON bool (ölçüm: premium/ultra 6, admin 2 kayıtta bool).
  --   Import kuralı: bool → 1/0 AÇIK cast (int(v)); JSON değeri olduğu gibi basılırsa
  --   INTEGER affinity 'true' literalini çevirmez, WHERE premium=1 sessizce boş döner.
  --   CHECK'ler bu hatayı sessiz veri bozulması yerine import hatasına çevirir.
  premium_until       INTEGER,                   -- epoch; abonelik bitişi
  tv                  INTEGER NOT NULL DEFAULT 0,-- token version — JWT İPTAL mekanizması (main.py:130-166
                                                 -- her istekte karşılaştırılır; signout-all bump'lar 1861-1866)
                                                 -- import: profiles[uid].tv ?? 0 (bugünkü veride 0 profilde var
                                                 -- ama kod yolu canlı — kaybolursa iptal edilen token'lar geri gelir)
  video_hak           INTEGER DEFAULT 0,         -- satın alınan bulut-video hakkı (VIDEO_IDS)
  sokak_hak           INTEGER DEFAULT 0,         -- satın alınan Sokak/Street View hakkı (SOKAK_IDS; PARA):
                                                 -- /api/me 1403, IAP +adet 1563-1570, üretimde -1 2315-2316
                                                 -- import: profiles[uid].sokak_hak ?? 0 (satış 2026-08-28'den beri açık)
  tracker_id          TEXT,                      -- Traccar uniqueId (positions.device ile eşleşir)
  apple_sub           TEXT,                      -- Apple orijinal abonelik kimliği (string)
  google_sub          TEXT,                      -- Google obfuscatedAccountId (string)
  attest_key          TEXT,                      -- App Attest anahtarı (free_tactical cihaz-dedup)
  attested            INTEGER,                   -- son başarılı attest epoch
  welcomed            INTEGER,                   -- hoş geldin push'u atıldı mı (epoch; main.py:2006)
  free_tactical_used  INTEGER DEFAULT 0 CHECK (free_tactical_used IN (0,1)),
                                                 -- hesap başına 1 bedava taktik (main.py:2523; kod bool yazar 2526)
  summary_enabled     INTEGER CHECK (summary_enabled IN (0,1)),
                                                 -- günlük özet. NULL = kullanıcı SEÇMEDİ; kodun varsayılanı AÇIK
                                                 -- (main.py:2796 get(...,True); activity-detect.py:146 aynı).
                                                 -- Ölçüm: 47 profilden 2'sinde var (ikisi de true) — DEFAULT 0
                                                 -- konsaydı 45 kullanıcının özeti kapanırdı. Cron/Worker kuralı:
                                                 -- WHERE COALESCE(summary_enabled,1)=1. Import: alan yoksa NULL, 0 YAZMA.
  summary_hour        INTEGER,                   -- günlük özet saati. NULL = seçilmedi; kod varsayılanı 21
                                                 -- (main.py:2797) → COALESCE(summary_hour,21)
  last_seen_at        INTEGER,                   -- ⇐ social.seen[uid]; presence <70sn (main.py:4037,4041)
  yerel_son           INTEGER,                   -- son yerel-render epoch
  avatar_json         TEXT,                      -- {"type":"emoji"|"photo","value":...} — şekilsiz, bütün okunur
  badges_json         TEXT,                      -- ["first","km1000",...] — sırasız rozet listesi
  prefs_json          TEXT,                      -- bütün-okunan tercih paketi: summary_vid_* , video_line,
                                                 -- video_dot, group_video, safety_buddy/arrive/stop,
                                                 -- hr_share, _not vb. (asla filtrelenmez)
  state_json          TEXT,                      -- geçici canlı durum: trackdbg, last_beacon, ptt_busy,
                                                 -- vc_invite, vc_go, hr_want_until, hr_woke, hr_live
                                                 -- (hr_live = {hr,ts} anlık nabız raporu, 12sn TTL — main.py:3338/3132/3320)
                                                 -- ⚠️ EŞZAMANLILIK: ptt_busy/vc_invite/hr_want_until'i KARŞI TARAF,
                                                 -- last_beacon/trackdbg/hr_live'ı SAHİBİ yazar. Worker kuralı:
                                                 -- alan güncellemesi TEK deyim — json_set/json_remove ile;
                                                 -- blob'u SELECT edip JS'te değiştirip geri UPDATE etmek YASAK
                                                 -- (kayıp-güncelleme üretir). Örn:
                                                 -- UPDATE users SET state_json=json_set(COALESCE(state_json,'{}'),
                                                 --   '$.ptt_busy',json(?1)), updated_at=?2 WHERE uid=?3;
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
CREATE INDEX idx_users_phone   ON users(phone);
-- handle aramaları HEP case-insensitive: tam eşleşme lower() ile (main.py:2942),
-- kullanıcı araması prefix startswith (main.py:3907-3909). BINARY indeks ne
-- `handle LIKE ?||'%'` (varsayılan LIKE case-insensitive) ne `lower(handle)=?` sorgusuna
-- hizmet eder → NOCASE indeks. Worker sorguları: handle = ? COLLATE NOCASE / LIKE ?||'%'.
-- (İsim substring araması main.py:3909 indekslenemez — 47 satır, tarama kabul.)
CREATE INDEX idx_users_handle  ON users(handle COLLATE NOCASE);
CREATE INDEX idx_users_tracker ON users(tracker_id);

-- push token'ları ⇐ profiles.apns[] + profiles.fcm[] (liste, kişi başı ≤5)
-- Token GLOBALDE tek hesaba aittir (çapraz-bildirim gizlilik kuralı, main.py:1989-2003):
-- token PK olunca "başka hesaptan sök" işi tek UPDATE/DELETE'e iner.
CREATE TABLE push_tokens (
  token      TEXT PRIMARY KEY,
  uid        TEXT NOT NULL,                      -- -> users.uid
  platform   TEXT NOT NULL,                      -- 'apns' | 'fcm'
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_push_tokens_uid ON push_tokens(uid);


-- ────────────────────────────────────────────────────────────────────────────
-- Sosyal graf
-- ────────────────────────────────────────────────────────────────────────────

-- friends ⇐ social.friends (uid -> [uid...]); kod İKİ yönü de ayrı yazar
-- (main.py:3924,3998) — burada da yönlü satırlar tutulur.
CREATE TABLE friends (
  uid        TEXT NOT NULL,                      -- -> users.uid
  friend_uid TEXT NOT NULL,                      -- -> users.uid
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (uid, friend_uid)
);
CREATE INDEX idx_friends_reverse ON friends(friend_uid);  -- hesap silmede ters temizlik (main.py:2754)

-- friend_requests ⇐ social.freqs (hedef -> {isteyen: ts}); karşılıklı istek = oto-kabul (main.py:3941)
CREATE TABLE friend_requests (
  target_uid    TEXT NOT NULL,                   -- isteğin GİTTİĞİ kişi
  requester_uid TEXT NOT NULL,                   -- isteği GÖNDEREN
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (target_uid, requester_uid)
);
CREATE INDEX idx_freq_requester ON friend_requests(requester_uid);  -- "gönderdiklerim" (main.py:3901,3958)

-- invites ⇐ social.invites (token -> {by, ts}); davet linki kabulü (main.py:4009,4018)
CREATE TABLE invites (
  code       TEXT PRIMARY KEY,                   -- URL-safe token
  by_uid     TEXT NOT NULL,                      -- -> users.uid
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_invites_by ON invites(by_uid);  -- hesap silmede temizlik (main.py:2764)


-- ────────────────────────────────────────────────────────────────────────────
-- Sohbet (DM)
-- ────────────────────────────────────────────────────────────────────────────

-- dm_messages ⇐ social.dm ("a|b" sıralı-çift anahtarı -> mesaj listesi)
-- "a|b" çifti user_a/user_b (alfabetik: user_a <= user_b) olarak açıldı;
-- eski _pair() anahtarı gerekirse user_a||'|'||user_b ile üretilir.
-- ⚠️ SELF-DM mümkün: _pair() sorted([a,b]) a==b'ye izin verir (main.py:4031-4032) ve
--   canlı veride VAR ('baris|baris', 1 mesaj — ölçüm 2026-08-30). Katı `<` doğrulaması
--   veya CHECK(user_a<user_b) bu kaydı düşürürdü; 'karşı taraf' türetimi a==b'yi ele almalı.
CREATE TABLE dm_messages (
  id         TEXT PRIMARY KEY,                   -- 12 hex (mevcut kimlikler korunur)
  user_a     TEXT NOT NULL,                      -- çiftin küçüğü  -> users.uid
  user_b     TEXT NOT NULL,                      -- çiftin büyüğü (a==b olabilir) -> users.uid
  frm        TEXT NOT NULL,                      -- göndereni (user_a ya da user_b)
  msg_type   TEXT NOT NULL DEFAULT 'text',       -- 'text' | 'voice' (ölçüm: 41 text, 71 voice)
  text       TEXT DEFAULT '',
  media      TEXT,                               -- voice: ptt klip kimliği 'p<ts><hex>' (dosya R2'ye taşınır)
  ts         INTEGER NOT NULL,                   -- gönderim epoch'u
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (user_a <= user_b)                       -- kanonik çift sırası (<=, ASLA katı < — self-DM var)
);
CREATE INDEX idx_dm_pair ON dm_messages(user_a, user_b, ts);  -- sohbet + unread sayımı (main.py:4047-4056)
-- "kullanıcının TÜM sohbetleri" deseni (chat_list main.py:4049-4051, hesap silme 2759-2760)
-- SQL'de WHERE user_a=? OR user_b=? olur; idx_dm_pair yalnız user_a kolunu karşılar →
-- user_b kolu için ikinci indeks (EXPLAIN: MULTI-INDEX OR, iki SEARCH; yoksa full SCAN):
CREATE INDEX idx_dm_pair_b ON dm_messages(user_b, user_a, ts);

-- dm_reads ⇐ social.read (uid -> {karşı_taraf: ts})
CREATE TABLE dm_reads (
  uid        TEXT NOT NULL,                      -- okuyan
  peer_uid   TEXT NOT NULL,                      -- kimin sohbeti
  read_at    INTEGER NOT NULL,                   -- son okuma epoch'u (main.py:4072)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (uid, peer_uid)
);


-- ────────────────────────────────────────────────────────────────────────────
-- Rotalar ve videolar
-- ────────────────────────────────────────────────────────────────────────────

-- rides ⇐ social.detected_rides (281 kayıt; activity-detect ledger'ı)
-- rid biçimleri: '{YYYY-MM-DD}_{ts}' (algılanan) | 'up_{now}_{frm}' (GPX/TCX yüklenen)
CREATE TABLE rides (
  rid        TEXT PRIMARY KEY,
  uid        TEXT,                               -- -> users.uid (eski kayıtlarda boş → BARIS_UID sayılır, main.py:255)
  date       TEXT,                               -- 'YYYY-MM-DD' (TR günü)
  ts         INTEGER NOT NULL,                   -- başlangıç epoch
  to_ts      INTEGER NOT NULL,                   -- bitiş epoch  (JSON'daki 'to'; SQL'de rezervimsi → to_ts)
  ride_type  TEXT,                               -- moto|car|bike|run|walk
  km         REAL,                               -- 265/281 kayıtta var; yoksa 0 sayılır (main.py:3729)
  lat        REAL,                               -- başlangıç koordinatı (rota-eşleştirici, main.py:1087-1090)
  lon        REAL,
  uploaded   INTEGER DEFAULT 0 CHECK (uploaded IN (0,1)),
                                                 -- 1 = GPX/TCX ile yüklendi (main.py:2452)
                                                 -- kaynakta bool (10 kayıt, ölçüldü) → import int cast
  track_key  TEXT,                               -- R2 anahtarı 'tracks/{ts}.json' — uploaded_tracks D1'e GİRMEZ:
                                                 -- 649 KB ham GPS izi (t/lat/lon/spd/alt/hr noktaları) R2'de durur;
                                                 -- generate akışı str(frm) ile arıyordu (main.py:863,2543,2654),
                                                 -- yeni dünyada anahtar deterministik: tracks/{ts}.json
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_rides_user_ts ON rides(uid, ts);  -- liste + günlük/haftalık km toplamları (main.py:3192,3213,3714,3740)

-- ride_type_overrides ⇐ social.ride_types (rid -> tip); kullanıcı elle düzeltmesi (main.py:2237)
-- rides'a kolon olarak GÖMÜLMEDİ: override rid'i HİÇBİR koleksiyonda olmayabilir (silinmiş rota).
-- Ölçüm 2026-08-30: 17 kayıttan 7'si rides'ta, 0'ı cloud_videos'ta, 10'u tamamen sarkık →
-- bağımsız rid→tip sözlüğü tek kayıpsız temsil; Faz 2'de rides kolonuna İNDİRGEME YAPMA (10/17 düşer).
CREATE TABLE ride_type_overrides (
  rid        TEXT PRIMARY KEY,
  ride_type  TEXT NOT NULL,                      -- moto|car|bike|run|walk
  uid        TEXT,                               -- kim değiştirdi (sahiplik zaten endpoint'te doğrulanır)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- deleted_rides ⇐ social.deleted_rides (rid listesi) — "geçmişten gizle" seti.
-- Bugün global bir set (kullanıcı alanı yok, main.py:261); yeniden üretimde kayıt SİLİNİR (main.py:1157-1159).
CREATE TABLE deleted_rides (
  rid        TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- videos ⇐ social.cloud_videos — bulutta üretilip R2'ye yazılan videolar (render-done, main.py:1116-1148)
-- rid biçimleri: '{date}_{ts}' | '{date}_{ts}_{üretim_ts}' | grup kopyası '{rid}_w2', '{rid}_w3'...
CREATE TABLE videos (
  rid          TEXT PRIMARY KEY,
  uid          TEXT,                             -- -> users.uid (sahip; grup kopyasında o kopyanın sahibi)
  r2_key       TEXT NOT NULL,                    -- 'videos/....mp4' (JSON'daki 'key')
  date         TEXT,
  ts           INTEGER NOT NULL,                 -- rota başlangıcı
  to_ts        INTEGER NOT NULL,                 -- rota bitişi
  ride_type    TEXT,                             -- moto|car|bike|run|walk
  mode         TEXT,                             -- flat|flyover|3d|tactical...
  speed        TEXT,                             -- fast|medium|slow|auto
  aspect       TEXT,                             -- '16:9' | '9:16'
  size         INTEGER DEFAULT 0,                -- bayt
  km           REAL,
  done_at      INTEGER,                          -- render bitiş epoch'u (JSON'daki 'done')
  is_group     INTEGER DEFAULT 0 CHECK (is_group IN (0,1)),
                                                 -- grup sürüş videosu (main.py:1125-1131; kaynakta 'group':true bool)
  users_json   TEXT,                             -- grup üyeleri ["u..","u.."] — yalnız is_group=1'de, bütün okunur
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX idx_videos_user_ts ON videos(uid, ts);  -- rota listesi + grup-solo örtüşme taraması (main.py:1139-1147)

-- pending_videos ⇐ social.pending_videos — "Hazırlanıyor" kilidi (main.py:2611,2713 yazar;
-- render-done/failed kaldırır: main.py:1155,1254; 6 saatte bitmeyeni bekçi failed'a çevirir)
CREATE TABLE pending_videos (
  vid        TEXT PRIMARY KEY,                   -- '{gün}_{from}_{üretim_ts}'
  uid        TEXT NOT NULL,                      -- -> users.uid
  date       TEXT,
  ts         INTEGER NOT NULL,
  to_ts      INTEGER NOT NULL,
  ride_type  TEXT,
  mode       TEXT,
  queued_at  INTEGER NOT NULL,                   -- JSON'daki 'queued'
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_pending_user ON pending_videos(uid);

-- failed_videos ⇐ social.failed_videos — HATA kartları (main.py:1256 yazar; liste main.py:362-379)
CREATE TABLE failed_videos (
  vid        TEXT PRIMARY KEY,                   -- '{date}_{ts}_{deneme_ts}'
  uid        TEXT,                               -- -> users.uid
  reason     TEXT,
  failed_at  INTEGER NOT NULL,                   -- JSON'daki 'at'
  date       TEXT,                               -- ↓ bu 5 alan eski kayıtlarda null olabiliyor (ölçüldü)
  ts         INTEGER,
  to_ts      INTEGER,
  ride_type  TEXT,
  mode       TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_failed_user ON failed_videos(uid);


-- ────────────────────────────────────────────────────────────────────────────
-- Kulüpler, paylaşılan rotalar, PTT
-- ────────────────────────────────────────────────────────────────────────────

-- clubs ⇐ social.clubs (cid -> {name, owner, members[], code, created})
CREATE TABLE clubs (
  cid        TEXT PRIMARY KEY,                   -- 'c<ts><hex>'
  name       TEXT NOT NULL,
  owner_uid  TEXT NOT NULL,                      -- -> users.uid
  join_code  TEXT NOT NULL,                      -- 6 harf katılım kodu (benzersizliği kod üretimi kontrol eder, main.py:3766)
  created_at INTEGER NOT NULL,                   -- JSON'daki 'created'
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_clubs_code ON clubs(join_code);

-- club_members ⇐ clubs[].members listesi (üyelik sorguları: main.py:3618,3798,3833)
CREATE TABLE club_members (
  cid        TEXT NOT NULL,                      -- -> clubs.cid
  uid        TEXT NOT NULL,                      -- -> users.uid
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (cid, uid)
);
CREATE INDEX idx_club_members_uid ON club_members(uid);

-- shared_routes ⇐ social.shared_routes (runtime'da doğan anahtar; main.py:3069 yazar)
-- "Sana gelen rotalar" + rota meydan okuması eşleştiricisi (main.py:1079-1091, 3091-3097)
CREATE TABLE shared_routes (
  sid        TEXT PRIMARY KEY,                   -- 'sr<ts><hex>'
  from_uid   TEXT NOT NULL,                      -- gönderen -> users.uid
  ride_id    TEXT,                               -- kaynak rota -> rides.rid / videos.rid
  km         REAL DEFAULT 0,
  date       TEXT,
  ts         INTEGER NOT NULL,
  rideref_ts INTEGER,                            -- kaynak rotanın ts/to penceresi (rideref)
  rideref_to INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- shared_route_targets ⇐ shared_routes[].to listesi + ridden{uid:ts} haritası (iki yapı tek tabloda)
CREATE TABLE shared_route_targets (
  sid        TEXT NOT NULL,                      -- -> shared_routes.sid
  uid        TEXT NOT NULL,                      -- hedef kullanıcı -> users.uid
  ridden_at  INTEGER,                            -- NULL = henüz sürmedi; epoch = sürdü (main.py:1091)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (sid, uid)
);
CREATE INDEX idx_srt_uid ON shared_route_targets(uid);  -- gelen kutusu (main.py:3091)

-- ptt_acl ⇐ social.ptt_acl (klip kimliği -> dinleme yetkisi). İKİ şekil var (ölçüldü):
-- {"users":[a,b]} (DM klibi, main.py:3471) VEYA {"club": cid} (kulüp klibi, main.py:3411).
-- users_json JSON kaldı: ≤2 eleman, hep bütün okunur, asla filtrelenmez (main.py:3614-3618).
CREATE TABLE ptt_acl (
  pid        TEXT PRIMARY KEY,                   -- 'p<ts><hex>' (dm_messages.media ile aynı uzay; klip R2'ye)
  club_cid   TEXT,                               -- kulüp klibi ise -> clubs.cid, değilse NULL
  users_json TEXT,                               -- DM klibi ise '["uidA","uidB"]', değilse NULL
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);


-- ────────────────────────────────────────────────────────────────────────────
-- Para, sayaçlar, telemetri
-- ────────────────────────────────────────────────────────────────────────────

-- gift_codes ⇐ social.giftcodes (şu an boş; üretim main.py:1960, kullanım main.py:1456-1467)
CREATE TABLE gift_codes (
  code       TEXT PRIMARY KEY,                   -- 10 harf (ambiguous karakterler hariç)
  used_by    TEXT,                               -- NULL = kullanılmadı; -> users.uid
  used_at    INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- iap_transactions ⇐ social.iap_used (transactionId/orderId/purchaseToken -> kayıt; replay/çift-sayım
-- koruması, main.py:1542,1632,1675). PK'nin kendisi idempotency anahtarı.
-- ⚠️ Kaynak kayıtların İKİ alan varyantı var: Apple/iOS ve Google-sub 'pid' yazar
-- (main.py:1566,1637), Google boost consumable ise 'sku' yazar (main.py:1679).
-- Import kuralı: pid = kayıt.pid ?? kayıt.sku (ikisi de ürün kimliği; birebir ad portu 'sku'
-- kayıtlarını NOT NULL'a düşürürdü). Worker da Google boost'ta pid kolonuna sku değerini yazar.
CREATE TABLE iap_transactions (
  tid        TEXT PRIMARY KEY,                   -- Apple transactionId | Google orderId | Google-sub purchaseToken
  uid        TEXT NOT NULL,                      -- -> users.uid
  pid        TEXT NOT NULL,                      -- ürün kimliği (com.nickdegs.kisisel.* | 'google-sub' | boost sku)
  ts         INTEGER NOT NULL,                   -- doğrulama epoch'u
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_iap_uid ON iap_transactions(uid);

-- render_counts ⇐ social.render_counts (uid -> {sayaç_anahtarı: değer})
-- Anahtar biçimleri ölçüldü: '{YYYY-MM-DD}' (flat/flyover), '3d_{gün}', 'auto_{gün}', 'sv_{gün}',
-- 'boost_{gün}' (main.py:1587), 'ay_{YYYY-MM}' (REAL, aylık $ bütçe — main.py:2282-2291).
-- Değer REAL: gün sayaçları tamsayı, ay bütçesi kesirli (0.033 gözlendi).
CREATE TABLE render_counts (
  uid         TEXT NOT NULL,                     -- -> users.uid
  counter_key TEXT NOT NULL,
  value       REAL NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (uid, counter_key)
);

-- gpu_costs ⇐ social.gpucost (uid -> {ay: {secs, videos, g3d_secs}}) — maliyet telemetrisi
-- (yazan: render-done main.py:1151-1154; okuyan: admin raporu main.py:1938)
-- Not: sahipsiz uid var (ölçüm: 'u2f2e847e0430' gpucost'ta + 2 rides'ta ama profiles'ta yok —
-- silinmiş hesap kalıntısı). FK yok → import users'ta varlık ŞARTI aramamalı; Worker join'leri
-- LEFT JOIN varsaymalı.
CREATE TABLE gpu_costs (
  uid        TEXT NOT NULL,                      -- -> users.uid
  month      TEXT NOT NULL,                      -- 'YYYY-MM' (UTC)
  secs       INTEGER NOT NULL DEFAULT 0,
  videos     INTEGER NOT NULL DEFAULT 0,
  g3d_secs   INTEGER NOT NULL DEFAULT 0,         -- Ultra 3D (Google 3D) saniyeleri
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (uid, month)
);

-- free_tactical_devices ⇐ social.free_tactical_devices (runtime listesi; App Attest cihaz-dedup,
-- main.py:2524-2527: cihaz başına 1 bedava taktik video)
CREATE TABLE free_tactical_devices (
  attest_key TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- feedbacks ⇐ social.feedbacks (runtime listesi; main.py:1443 append) — uygulama içi fikir kutusu
CREATE TABLE feedbacks (
  id         TEXT PRIMARY KEY,                   -- worker üretir: 'fb_<ts>_<hex>' (eskisinde id yoktu)
  uid        TEXT NOT NULL,                      -- -> users.uid
  name       TEXT,
  handle     TEXT,
  lang       TEXT,
  text       TEXT NOT NULL,
  ts         INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- config ⇐ social.json'daki TEKİL anahtarlar: 'announcement' (main.py:1888) ve
-- 'free_tactical_enabled' (kill-switch, main.py:1406). KV yerine D1: gölge-mod diff'i ve
-- import tek depodan yürür; okuma sıklığı düşük (app açılışı) → D1 yeterli.
CREATE TABLE config (
  key        TEXT PRIMARY KEY,                   -- 'announcement' | 'free_tactical_enabled'
  value_json TEXT NOT NULL,                      -- announcement: {title,body,url,active,ts}; kill-switch: true/false
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);


-- ────────────────────────────────────────────────────────────────────────────
-- positions — Traccar'ın yerini alan GPS ingest tablosu (movelog-gps worker'ı yazar)
-- Backend'in Traccar /api/positions yanıtından FİİLEN okuduğu alanlar (ölçüm):
--   latitude, longitude (main.py:890,1307,3227,3245), speed (knot; her yerde ×1.852 → km/h,
--   main.py:891,1308,3229), altitude (main.py:893,3263), course (main.py:3254),
--   accuracy (main.py:3263 'acc'), fixTime/deviceTime → epoch (main.py:892,3158,3235),
--   attributes.heartRate (main.py:894) ve attributes.hr (main.py:3206; watch OsmAnd &hr=),
--   attributes.batteryLevel (main.py:3247), attributes.charge (main.py:3254).
-- Script tüketicileri aynı aileden okur: activity-detect.py:150-159, movelog-cloud.py:64-70.
-- KARAR (revize 2026-08-30, şema hizalama): KANONİK şema = uzak D1'deki FİİLİ tablo
-- (movelog-gps worker'ı bunu yazıyor; gps/src/index.ts INSERT'i birebir bu kolonlar).
--   · spd KNOT saklanır (telefon Tracker.swift speed'i knot yollar, gps worker çevirmeden
--     yazar) — okuyan HER tüketici main.py'deki gibi ×1.852 ile km/h'a çevirir.
--   · hr KOLONU YOK: telefon GPS ingest'e nabız GÖNDERMİYOR; nabız /api/live/hr-report
--     yolundan gelir (users.state_json.hr_live — main.py:3320 ailesi).
--   · course→brg (OsmAnd 'bearing' parametresi), charge (0/1), updated_at yok.
--   · PK YOK — uzak tabloda da yok; (device,ts) erişimi idx_positions_dev_ts karşılar
--     (aynı saniyede ikinci fix ek satır olur, Traccar'da da pratikte tekti).
CREATE TABLE positions (
  device     TEXT    NOT NULL,          -- trackerId (8 haneli) = users.tracker_id (OsmAnd id=)
  ts         INTEGER NOT NULL,          -- fix epoch saniye (telefonun timestamp'i)
  lat        REAL    NOT NULL,
  lon        REAL    NOT NULL,
  spd        REAL,                      -- knot (okurken ×1.852 → km/h)
  alt        REAL,                      -- metre
  acc        REAL,                      -- konum doğruluğu (metre)
  brg        REAL,                      -- yön/derece (OsmAnd bearing; Traccar 'course' eşleniği)
  batt       INTEGER,                   -- 0-100
  charge     INTEGER DEFAULT 0,         -- 0/1 (OsmAnd charge=true)
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_positions_dev_ts ON positions(device, ts);


-- ============================================================================
-- KV anahtarları (movelog-kv) — şemaya GİRMEYEN yardımcı JSON'lar
-- (hepsi küçük, şekilsiz, tek-okuyuculu durum dosyaları; D1 tablosu hak etmiyor)
--
--  · mapconfig                     ⇐ /opt/movelog/data/map-config.json
--       /api/mapconfig yanıtının kendisi (main.py:1877-1881); app her açılışta okur.
--       Faz H'de değeri ortak harita URL'ine döner (tek KV yazımı = anında geçiş).
--  · smsfix:{telefon}              ⇐ smsfix.json (main.py:720-730)
--       yanlış ülke kodu düzeltme önbelleği {fixed, ts}; TTL uygun (30 gün).
--  · freepush:{uid}                ⇐ free-push-sayac.json (activity-detect.py:53)
--       ücretsiz kullanıcı push sayacı {n, son} — cron worker'a taşınır.
--  · nudge:ilkvideo:{uid}          ⇐ ilkvideo-nudge.json (movelog-ilkvideo-nudge.py:18)
--       ömür boyu 1 "ilk videonu üret" bildirimi; değer = gönderim epoch'u.
--  · bekci:render                  ⇐ render-bekci.json (movelog-render-bekci.py:34)
--       render bekçisi durumu {retry:{}, sonbildirim:{...}}.
--  · bekci:video-kontrol           ⇐ video-kontrol.json (movelog-video-kontrol.py:27)
--       video QA bekçisi durumu {sonbildirim:{...}, temiz_tur}.
--
-- NOT: social.json'un 22 anahtarından İKİSİ (announcement, free_tactical_enabled) KV'ye değil
-- yukarıdaki `config` tablosuna kondu (gerekçe tablo yorumunda). uploaded_tracks R2'ye
-- (rides.track_key), kalan 19 anahtar + 3 runtime anahtarı yukarıdaki tablolara eşlendi.
-- ============================================================================
