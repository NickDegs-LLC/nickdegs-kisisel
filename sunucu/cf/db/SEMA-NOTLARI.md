# D1 Şema Notları — social.json → movelog-db eşlemesi

Faz 0 çıktısı. Kaynaklar: `/opt/movelog/data/social.json` (2026-08-30, 754 KB, 22 üst anahtar —
her biri örnek kayıtlarıyla ölçüldü) + `/opt/movelog/backend/main.py` (4111 satır — her anahtarın
okuma/yazma yerleri satır numarasıyla). Şema: `cf/db/migrations/0001_init.sql`
(gerçek `sqlite3`'e karşı doğrulandı, 26 tablo; 3 itiraz raporlu düzeltme turu 2026-08-30 —
tv/sokak_hak kolonları, summary default'u, NOCASE handle indeksi, dm user_b indeksi + self-DM,
bool CHECK'leri, iap sku varyantı, state_json json_set kuralı, 0002 nötrleme bu turda girdi).

Genel kurallar: her tabloda `created_at/updated_at` (epoch INTEGER) · TEXT PK'ler ·
JSON yalnız bütün-okunan şekilsiz veri · **FOREIGN KEY yok** (D1'de zayıf; bütünlük Worker'da,
SQL'deki `-> users.uid` yorumları mantıksal FK).

---

## Tablo tablo gerekçeler

### users ⇐ `profiles` (47 kayıt) + `seen` (17 kayıt)
- **Kaynak ölçümü:** profiles alan frekansları çıkarıldı (40 farklı alan; en sıkları:
  welcomed 36, lang 32, trackerId 23, last_beacon 22, apns 21, phone 18).
- **Okur/yazar:** main.py'de en sık kullanılan anahtar (60 get + 31 setdefault).
  Kimlik/alias main.py:193; profil listesi 456; /api/me bayrakları 1406; profil güncelleme 1853;
  hesap silme 2750-2775; video renkleri 2340-2345; hoş geldin push'u 2006.
- **Neden bu şekil:** filtrelenen/tek tek güncellenen alanlar kolon (phone→SMS girişi,
  handle→arama, tracker_id→GPS eşleme, premium/ultra/admin→yetki kapıları,
  summary_enabled/hour→cron taraması, free_tactical_used→bedava-taktik kapısı main.py:2523,
  `tv`→her istekte JWT karşılaştırması, `sokak_hak`/`video_hak`→IAP sayaçları).
  Bütün-okunanlar 4 JSON kolonda: `avatar_json`, `badges_json`, `prefs_json`
  (summary_vid_*, video_line/dot, safety_*, group_video, hr_share, _not),
  `state_json` (trackdbg, last_beacon, ptt_busy, vc_invite, vc_go, hr_want_until, hr_woke,
  hr_live — canlı/geçici durum, hiçbiri hiçbir sorguda filtre değil; ölçüm: hepsi tek profil
  objesi içinde atomik okunup yazılıyor). `hr_live` = {hr, ts} anlık nabız peek raporu, 12 sn
  TTL (yazım main.py:3338, okuma 3132-3135 ve 3320-3324) — import/Worker whitelist'i bu alanı
  da içermeli, ilk sürümde listeden eksikti (düzeltme turu 2026-08-30).
- **`tv` (token version — düzeltme turu eklemesi):** JWT İPTAL mekanizması. `_token_versions()`
  tüm profillerden `p.get("tv",0)` okur (main.py:130-141), `make_jwt` payload'a gömer (147-148),
  `verify_jwt` HER kimlikli istekte karşılaştırır (163), `/api/auth/signout-all` bump'lar
  (1861-1866). Bugünkü veride 0 profilde var (kimse signout-all yapmamış) ama kaybolursa:
  bump yapmışların token'ları toptan reddedilir + iptal edilmiş eski token'lar geri geçerli
  olur (güvenlik açığı). Kolon: `tv INTEGER NOT NULL DEFAULT 0`; import `?? 0`.
- **`sokak_hak` (düzeltme turu eklemesi):** PARAYLA satın alınan tek-kullanımlık Street View
  hakkı — video_hak'ın kardeşi, ilk şemada unutulmuştu. /api/me döner (main.py:1403), IAP
  doğrulaması artırır (1563-1570), üretim düşürür (2315-2316). Bugünkü veride 0 profilde var
  ama satış 2026-08-28'den beri açık; kolon olmazsa satın alınan hak kaybolur (para kaybı).
- **`summary_enabled/summary_hour` DEFAULT'ları (düzeltme turu):** kodun varsayılanı
  AÇIK/21'dir (main.py:2796-2797 `get("summary_enabled", True)` / `get("summary_hour", 21)`;
  activity-detect.py:146 aynı). Ölçüm: 47 profilden yalnız 2'sinde alan var (ikisi de true).
  İlk şemadaki `DEFAULT 0` import sonrası 45 kullanıcının özetini sessizce KAPATIRDI.
  Karar: iki kolon da DEFAULT'suz (NULL = kullanıcı seçmedi); cron/Worker sorgusu
  `WHERE COALESCE(summary_enabled,1)=1`, saat `COALESCE(summary_hour,21)`.
  Import kuralı: alan yoksa NULL yaz, 0 YAZMA.
- **Bool→INTEGER cast (düzeltme turu):** kaynakta premium/ultra/admin/summary_enabled
  (ve rides.uploaded, videos.group) JSON **bool** (ölçüm: 6/6/2/2/10 kayıt); kod
  free_tactical_used'ı da bool yazar (main.py:2526). SQLite INTEGER affinity `'true'`
  literalini sayıya çevirmez → `WHERE premium=1` sessizce boş dönerdi. Şemaya
  `CHECK (x IN (0,1))` savunması kondu (NULL'u geçirir, 'true' TEXT'ini import hatası yapar);
  import kuralı: bool → `int(v)` AÇIK cast.
- **`state_json` eşzamanlılık kuralı (düzeltme turu):** alanlara FARKLI aktörler yazıyor:
  ptt_busy'yi KARŞI TARAF hedefin profiline yazar (main.py:3588), vc_invite karşı taraf (3508),
  hr_want_until izleyen (3312); last_beacon (3291) ve trackdbg (2041, ~143 istek/gün) sahibi.
  Bugün tek Python süreci + dosya kilidi serialize ediyor; Worker'da "SELECT → JS'te değiştir →
  UPDATE" deseni kayıp-güncelleme üretir. **Sözleşme:** state_json alan güncellemesi TEK deyim —
  `json_set(COALESCE(state_json,'{}'), '$.alan', json(?))` / silme `json_remove` — blob'u okuyup
  geri yazmak YASAK. (Şema değişikliği gerekmez; gölge-diff bozulmaz.)
- **`idx_users_handle` NOCASE (düzeltme turu):** handle aramaları hep case-insensitive —
  tam eşleşme `lower()` ile (main.py:2942), kullanıcı araması prefix `startswith` (3907-3909).
  BINARY indeks varsayılan (case-insensitive) `LIKE ?||'%'`e de `lower(handle)=?`e de hizmet
  edemez → indeks `handle COLLATE NOCASE` yapıldı; Worker sorguları `= ? COLLATE NOCASE` /
  `LIKE ?||'%'`. İsim substring kolu (3909) indekslenemez — 47 satır, tarama kabul.
- **`seen` ayrı tablo DEĞİL:** uid→epoch tekil değeri (main.py:4037 `_touch`, 4041 `_online`,
  eşik 70 sn) → `users.last_seen_at` kolonu. Ayrı tablo iki tablo dokunuşu demekti.

### push_tokens ⇐ `profiles[].apns[]` + `profiles[].fcm[]`
- **Ölçüm:** apns bir LİSTE (kişi başı ≤5, main.py:2001-2003); token kaydında diğer TÜM
  kullanıcılardan aynı token sökülüyor (çapraz-bildirim gizlilik kuralı, main.py:1989-1998).
- **Neden bu şekil:** `token TEXT PRIMARY KEY` global teklik kuralını şemanın kendisine
  gömer; "başka hesaptan sök" = tek `DELETE/UPDATE`. push.py:28 `profile_tokens()` yerine
  `SELECT token FROM push_tokens WHERE uid=?`.

### friends ⇐ `friends` (uid → [uid...])
- **Okur/yazar:** liste main.py:2924; arkadaşlık kabulünde iki yön AYRI yazılıyor
  (main.py:3924 ve 3998); ~10 endpoint "hedef arkadaşım mı" kontrolü yapıyor
  (3035, 3056, 3147, 3306, 3438, 3504, 3557, 3628); hesap silmede ters temizlik 2753-2757.
- **Neden bu şekil:** yönlü (uid, friend_uid) satırlar — kod zaten iki yönü ayrı tutuyor,
  aynen taşımak gölge-diff'i kolaylaştırır. `idx_friends_reverse` ters temizlik için.

### friend_requests ⇐ `freqs` (hedef → {isteyen: ts})
- **Ölçüm:** bugün 2 kayıt, ikisi boş dict (istekler kabul edilmiş).
- **Okur/yazar:** istek gönder 3946; karşılıklı istek = oto-kabul 3941; gelen/giden liste
  3957-3958 ve 3901-3902; kabul 3967-3975; hesap silme 2766-2770.
- **Neden bu şekil:** (target, requester) PK; "benim gönderdiklerim" sorgusu bugün tüm
  freqs'i tarıyor (3901) → `idx_freq_requester` bunu indeksli hale getirir.

### invites ⇐ `invites` (token → {by, ts})
- **Okur/yazar:** üretim 4009, kabul 4018, hesap silmede by=user temizliği 2763-2765.
- 7 kayıt, alanlar sadece by+ts (ölçüldü) → üç kolonluk tablo.

### dm_messages ⇐ `dm` ("a|b" → mesaj listesi), dm_reads ⇐ `read`
- **Ölçüm:** 112 mesaj; alanlar id/frm/text/ts/type (112) + media (71); tipler: text 41,
  voice 71 (media = `p<ts><hex>` PTT klip kimliği; klip dosyası R2'ye gider).
- **Okur/yazar:** `_pair()` sıralı çift anahtarı 4032; sohbet listesi + unread sayımı
  4047-4056; sohbet açma + okundu işareti 4068-4072; gönderme 4074+; hesap silmede
  "user'ı içeren tüm çiftler" 2759-2760.
- **Neden bu şekil:** çift anahtarı `user_a/user_b` (alfabetik, `user_a <= user_b`) kolonlarına
  açıldı — `LIKE '%uid%'` yerine `WHERE user_a=? OR user_b=?`; unread sayımı
  `idx_dm_pair(user_a,user_b,ts)` ile indeksli. `read` uid→{peer:ts} haritası
  birebir `dm_reads(uid, peer_uid, read_at)`.
- **SELF-DM (düzeltme turu):** `_pair()` = `"|".join(sorted([a,b]))` a==b'ye izin verir
  (main.py:4031-4032) ve canlı veride VAR: `'baris|baris'` (1 text mesaj, id=ea1321f0aab9 —
  ölçüm 2026-08-30). Sıralama varsayımı `user_a <= user_b`'dir, ASLA katı `<` değil; şemaya
  `CHECK (user_a <= user_b)` kondu. Import testine self-pair vakası eklenmeli; "karşı taraf"
  türetimi a==b halini ele almalı.
- **`idx_dm_pair_b` (düzeltme turu):** "kullanıcının TÜM sohbetleri" deseni (chat_list
  main.py:4049-4051 çiftin İKİ yanına bakar; hesap silme 2759-2760) SQL'de
  `WHERE user_a=? OR user_b=?` — idx_dm_pair yalnız user_a kolunu karşılar, user_b kolu
  full SCAN olurdu (EXPLAIN ile ölçüldü). `idx_dm_pair_b(user_b, user_a, ts)` eklendi →
  MULTI-INDEX OR, iki SEARCH.

### rides ⇐ `detected_rides` (281 kayıt)
- **Ölçüm:** alan frekansları date/ts/to/type/user 281, km/lat/lon 265, uploaded 10.
- **Okur/yazar:** ingest `register_ride` main.py:1058-1069 (activity-detect her aktiviteyi
  yazar; upsert — prev değerleri korunuyor); listede videosuz rota kaynağı 263;
  km toplamları 3192, 3213, 3714 (streak), 3740 (liderlik); GPX/TCX yükleme 2452.
- **Neden bu şekil:** çekirdek tablo. `to` → `to_ts` (SQL okunabilirliği). Tüm toplamlar
  user+ts filtreli → `idx_rides_user_ts`. Boş `user` = Barış kuralı (main.py:255-258)
  import sırasında BARIS_UID'e sabitlenmez, Worker'da aynı fallback korunur (gölge-diff birebir).

### rides.track_key + R2 ⇐ `uploaded_tracks` (649 KB — 22 anahtarın en büyüğü)
- **Ölçüm:** 2 kayıt: 1504 ve 5000 noktalı diziler; nokta = {t, lat, lon, spd, alt, hr}.
- **Okur/yazar:** yazım 2451 (`str(frm)` anahtarıyla); okuma 863, 2543, 2654
  (generate akışı `uploaded_tracks[str(int(frm))]`).
- **Karar (direktif):** D1'e GİRMEZ → R2 `tracks/{ts}.json`. Anahtar deterministik
  (ts = rotanın frm'i) olduğundan generate akışı doğrudan R2 GET yapabilir;
  `rides.track_key` kaydı ayrıca bağ kurar (uploaded=1 satırlarında dolu).

### ride_type_overrides ⇐ `ride_types` (17 kayıt, rid → "moto")
- **Okur/yazar:** yazım 2237 (kullanıcı elle düzeltir, sahiplik kontrolü 2235);
  okuma 260 (list_rides tüm koleksiyonların üstüne override uygular).
- **Neden rides kolonu değil (gerekçe düzeltme turunda ölçümle düzeltildi):** override rid'i
  HİÇBİR koleksiyonda olmayabilir (silinmiş rota). Ölçüm 2026-08-30: 17 kaydın 7'si
  detected_rides'ta, 0'ı cloud_videos'ta, 10'u tamamen sarkık (ör. `2026-06-11_1781166844`,
  `2026-04-15_1776270521_1783197073`). Eski "videosu-olan-ama-rides'ta-olmayan" gerekçesi
  veriyle uyuşmuyordu. Bağımsız rid→tip sözlüğü tek kayıpsız temsil.

### deleted_rides ⇐ `deleted_rides` (18 elemanlı liste)
- **Okur/yazar:** gizleme filtresi 261; kullanıcı silmesi 851; grup-sonrası solo gizleme
  1138-1147; yeniden üretimde listeden ÇIKARMA 1157-1159 ve 1236.
- **Neden bu şekil:** global set (listede kullanıcı alanı yok — ölçüldü; "looptest" gibi
  elle girilmişler bile var) → tek kolonlu PK tablosu. Üyelik testi = PK lookup.

### videos ⇐ `cloud_videos`
- **Ölçüm:** alanlar key/user/date/ts/to/type/mode/speed/aspect/size/done/km (5 kayıtta 12/12);
  grup videosunda ek `group:true` + `users:[...]` ve `_w2` kopya rid'leri (main.py:1125-1138).
- **Okur/yazar:** render-done yazar 1116-1148 (+gpucost 1151, pending/failed temizliği 1155-1159);
  liste 262/324; paylaşım kaynağı 3050.
- **Neden bu şekil:** `key` → `r2_key`; grup üye listesi `users_json` (bütün okunur, yalnız
  push/etiket için); grup-solo örtüşme taraması (1139-1147) user+ts aralık sorgusu →
  `idx_videos_user_ts`.

### pending_videos ⇐ `pending_videos`, failed_videos ⇐ `failed_videos`
- **Okur/yazar:** pending yazımı 2611 ve 2713 (generate/regenerate, "Hazırlanıyor" kilidi),
  temizliği 1155 (done) ve 1254 (failed); failed yazımı 1256 (`render-failed` endpoint'i 1243),
  liste 362-379, yeniden denemede pop 2614/2716.
- **Ölçüm:** failed'ın 5 alanı (ts/to/date/type/mode) eski kayıtlarda null olabiliyor
  (ilk 2 örnek kayıtta null gözlendi) → kolonlar nullable.

### clubs + club_members ⇐ `clubs` (4 kayıt)
- **Ölçüm:** {name, owner, members[], code, created}.
- **Okur/yazar:** kurma 3798-3805 (üyelik sayısı limiti 3798); katılma (kod) 3766+;
  detay 3809; üyelik kontrolleri 3061, 3618, 3833; son üye çıkınca silme 3860.
- **Neden bu şekil:** `members[]` listesi `club_members` satırlarına açıldı — "hangi
  kulüplerdeyim" (3798, 3786) `idx_club_members_uid` ile; katılım kodu UNIQUE indeks.

### shared_routes + shared_route_targets ⇐ `shared_routes` (runtime anahtarı — bugünkü
dosyada yok, main.py `setdefault` ile yaratıyor)
- **Okur/yazar:** oluşturma 3069-3073 ({from, ride_id, to[], ts, km, date, rideref{ts,to_t}});
  gelen kutusu 3091-3097; meydan-okuma eşleştiricisi 1079-1091 (`ridden{uid:ts}` yazar).
- **Neden bu şekil:** `to[]` hedef listesi + `ridden{}` haritası aynı kullanıcı uzayı →
  tek çocuk tablo `shared_route_targets(sid, uid, ridden_at NULL)`. Gelen kutusu
  `idx_srt_uid`; eşleştiricinin "bana gönderilmiş ve sürülmemiş" filtresi
  `WHERE uid=? AND ridden_at IS NULL`.

### ptt_acl ⇐ `ptt_acl` (21 kayıt)
- **Ölçüm:** İKİ şekil: `{"users":[a,b]}` (21/21 mevcut kayıt) ve `{"club": cid}`
  (kodda: main.py:3411).
- **Okur/yazar:** DM klibi ACL yazımı 3471; kulüp klibi 3411; dinleme yetkisi kontrolü
  3614-3618 (klip servis edilirken).
- **Neden bu şekil:** `club_cid` kolonu + `users_json` — users listesi ≤2 eleman, hep bütün
  okunur, filtrelenmez → JSON gerekçeli. Klip dosyaları (`/opt/movelog/data/ptt/`) R2'ye.

### gift_codes ⇐ `giftcodes` (şu an boş)
- **Okur/yazar:** admin üretimi 1959-1970 ({used_by:null, created}); kullanım 1456-1467
  (used_by/used_at yazılır + premium verilir; aynı kullanıcı tekrar = idempotent).

### iap_transactions ⇐ `iap_used` (1 kayıt: {user, pid, ts})
- **Okur/yazar:** Apple StoreKit2 doğrulama 1542; token-tek-hesap kontrolü 1632;
  Google doğrulama 1675; boost idempotency 1582-1584.
- **Neden bu şekil:** PK = transactionId/orderId/purchaseToken → replay/çift-sayım koruması şemada.
- **`sku` varyantı (düzeltme turu):** `{user, pid, ts}` ölçümü tek Apple kaydına dayanıyordu.
  Kodda İKİ alan varyantı var: Apple + Google-sub `pid` yazar (main.py:1566, 1637 —
  Google-sub'ta pid='google-sub', tid=purchaseToken), Google boost consumable ise **`sku`**
  yazar (main.py:1679, tid=orderId). Import kuralı: `pid = kayıt.pid ?? kayıt.sku`
  (birebir ad portu sku kayıtlarını NOT NULL'a düşürürdü); Worker Google-boost'ta pid
  kolonuna sku değerini yazar.

### render_counts ⇐ `render_counts`
- **Ölçüm:** anahtar biçimleri: `2026-08-28:1`, `3d_2026-08-28:1`, `ay_2026-08:0.033` (REAL!).
  Kod ayrıca `boost_{gün}` (1587-1590), `auto_{gün}`, `sv_{gün}` üretir (2293-2299).
- **Okur/yazar:** `_bump_daily_cap` 2275-2299 (gün temizliği + ay bütçesi kuralı:
  `ay_` öneklileri gün temizliğinde SİLME); boost çarpanı 1587.
- **Neden bu şekil:** anahtarlar heterojen ve dinamik → (uid, counter_key, value REAL)
  üçlüsü; gün/ay temizliği Worker'da aynı kuralla sürer. Tipli kolonlara açmak
  (day/kind ayrıştırma) gölge-diff'te fazladan dönüşüm demekti — Faz 2'de gerekirse.

### gpu_costs ⇐ `gpucost` (uid → {ay: {secs, videos, g3d_secs}})
- **Okur/yazar:** render-done telemetri 1151-1154; admin maliyet raporu 1938-1955.
- İç yapı sabit üç sayaç (ölçüldü) → tipli kolonlar, PK (uid, month).
- **Sahipsiz uid (düzeltme turu):** `u2f2e847e0430` gpucost'ta + 2 detected_rides kaydında var
  ama profiles'ta YOK (silinmiş hesap kalıntısı — ölçüm 2026-08-30). FK olmadığı için sorun
  değil; import users'ta varlık şartı aramamalı, Worker join'leri LEFT JOIN varsaymalı.

### free_tactical_devices ⇐ `free_tactical_devices` (runtime listesi)
- **Okur/yazar:** cihaz kontrolü 1406 ve 2524; kullanınca ekleme 2527. Attest key = PK.

### feedbacks ⇐ `feedbacks` (runtime listesi; main.py:1443 append)
- Kayıt: {user, name, handle, lang, text, ts}; id yoktu → Worker `fb_<ts>_<hex>` üretir
  (TEXT PK kuralı).

### config ⇐ `announcement` + `free_tactical_enabled`
- **Okur/yazar:** duyuru okuma 1888 (`/api/announcement`); kill-switch 1406 (`/api/me`).
- **Karar:** KV değil D1 — social.json'un tamamı tek depoda kalınca Faz 2 gölge-diff'i
  ve `import_social.py` tek kaynaktan çalışır; okuma sıklığı app-açılışı seviyesinde,
  D1 için sorun değil. (Kararsızlık notu aşağıda.)

### positions — Traccar'ın halefi (movelog-gps worker'ı yazar)
- **Backend'in Traccar'dan FİİLEN okudukları (ölçüm):** `latitude/longitude`
  (890, 1307, 3227, 3245), `speed` knot — HER tüketici ×1.852 ile km/h'a çeviriyor
  (891, 1308, 3229, 3236), `altitude` (893, 3263), `course` (3254), `accuracy` (3263),
  `fixTime`/`deviceTime` → epoch (892, 3158, 3235), `attributes.heartRate` (894),
  `attributes.hr` (3206 — watch OsmAnd `&hr=`), `attributes.batteryLevel` (3247),
  `attributes.charge` (3254). Scriptler: activity-detect.py:150-159 (t/lat/lon/ele/dop/hr),
  movelog-cloud.py:64-70.
- **Kararlar (REVİZE 2026-08-30 — şema hizalama, diff #1):** KANONİK = uzak D1'deki
  FİİLİ tablo (movelog-gps worker'ının yazdığı):
  `device, ts, lat, lon, spd, alt, acc, brg, batt, charge, created_at` + indeks
  `idx_positions_dev_ts(device, ts)`, PK YOK.
  · `spd` KNOT saklanır — okuyan her tüketici main.py'deki gibi ×1.852 ile km/h'a çevirir
    (main.py:891,1308,3229; Worker'da /api/track ve /api/gps/live aynı çarpanı uygular).
  · **`hr` KOLONU YOK:** telefon GPS ingest'e nabız GÖNDERMİYOR — eski not (heartRate/hr'ın
    tek kolona inmesi) YANLIŞTI. Nabız `/api/live/hr-report` yolundan gelir ve
    `users.state_json.hr_live` = {hr, ts} olarak saklanır (main.py:3320 ailesi);
    /api/track detay yanıtındaki `hr` alanı bu dünyada hep null (üretimde de telefon
    kaynaklı fix'lerde attributes.heartRate yoktu).
  · `course` yerine `brg` (OsmAnd `bearing`), `charging` yerine `charge`, `updated_at` yok.
  · `device` = users.tracker_id (OsmAnd `id=` parametresi).
- **0002_positions.sql:** yorum-tombstone kalır; eski 0002'nin "çelişen" sanılan speki
  (spd=knot, brg/charge, hr yok, PK yok) aslında SAHADAKİ GERÇEKti — 0001'in positions
  bloğu 2026-08-30'da bu speke hizalandı (yukarıdaki revize kararlar).

## KV'ye giden yardımcı JSON'lar
`0001_init.sql` sonundaki `-- KV anahtarları` bloğunda: `mapconfig` (main.py:1877),
`smsfix:{telefon}` (720-730), `freepush:{uid}` (activity-detect.py:53),
`nudge:ilkvideo:{uid}` (movelog-ilkvideo-nudge.py:18), `bekci:render`
(movelog-render-bekci.py:34), `bekci:video-kontrol` (movelog-video-kontrol.py:27).

## Sayım kontrolü: 22 anahtarın tamamı
| social.json anahtarı | Nereye |
|---|---|
| profiles | users (+push_tokens) |
| friends | friends |
| invites | invites |
| seen | users.last_seen_at |
| dm | dm_messages |
| read | dm_reads |
| ride_types | ride_type_overrides |
| giftcodes | gift_codes |
| announcement | config('announcement') |
| deleted_rides | deleted_rides |
| cloud_videos | videos |
| detected_rides | rides |
| pending_videos | pending_videos |
| uploaded_tracks | **R2** tracks/{ts}.json + rides.track_key |
| failed_videos | failed_videos |
| clubs | clubs + club_members |
| gpucost | gpu_costs |
| freqs | friend_requests |
| ptt_acl | ptt_acl |
| render_counts | render_counts |
| iap_used | iap_transactions |
| free_tactical_enabled | config('free_tactical_enabled') |
| *(runtime)* shared_routes | shared_routes + shared_route_targets |
| *(runtime)* feedbacks | feedbacks |
| *(runtime)* free_tactical_devices | free_tactical_devices |

## Kararsız kalınan noktalar (Faz 2 öncesi karar ister)
1. **announcement/free_tactical_enabled: D1 `config` vs KV** — D1 seçildi (gölge-diff/import
   tek depo). Kill-switch'e her `/api/me`'de bakılıyor; trafik büyürse KV'ye (veya Worker
   içi 60 sn cache'e) alınabilir.
2. **`seen` yazma sıklığı** — bugün her chat isteği social.json'a yazıyor; D1'de her istek
   bir UPDATE olur. Presence eşiği 70 sn → Worker'da "son yazımdan >30 sn geçtiyse yaz"
   sönümlemesi öneriliyor (davranış değişmez, yazma sayısı düşer). Karar Faz 2'de.
3. **`state_json` genişliği** — trackdbg/last_beacon/ptt_busy tek JSON kolonunda; beacon
   yazımı sık (app açılışı). Sorun olursa `beacon_*` tipli kolonlara ayrılır; şimdilik
   atomik profil-objesi davranışına sadık kalındı.
4. **positions PK'de aynı-saniye çakışması — ÇÖZÜLDÜ (2026-08-30):** PK kaldırıldı,
   kanonik şemada yok (uzak tabloda da yoktu); aynı saniyedeki ikinci fix ek satır olur,
   (device,ts) erişimini idx_positions_dev_ts karşılar.
5. **`deleted_rides` global (kullanıcısız)** — bugünkü davranış aynen taşındı; rid çakışması
   teorik olarak başka kullanıcının kaydını gizleyebilir (bugün de öyle). Faz 2'de uid
   kolonu eklemek davranış değişikliği olur — Barış'a sorulacak.
6. **`ride_types`'ın rides'a gömülmesi — İPTAL (düzeltme turu):** kolona indirgeme
   YAPILMAYACAK — ölçüm 2026-08-30: 17 override'ın 10'u hiçbir koleksiyonda yok (silinmiş
   rotalar); indirgeme bu 10 kaydı düşürür. Ancak "sarkık kayıtlar zaten işlevsiz, bilinçli
   temizlik" kararı Barış'tan çıkarsa yeniden değerlendirilir.
