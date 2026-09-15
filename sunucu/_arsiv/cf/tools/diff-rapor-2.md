# Gölge GET-diff Raporu #2 (Faz 2a)

- Tarih: 2026-08-30 21:02:23 +0200
- Üretim: https://kisisel-api.nickdegs.com
- Gölge: https://movelog-api.daclen10.workers.dev
- Kapsam: method=GET + auth=auth_user → **38 uç** × 3 kullanıcı (apple_golge_diff, u69be3f7e960e, appreview)
- Normalize (değer muaf) alanlar: challenge, created_at, done, done_at, exp, expires, expires_at, expires_in, generated_at, last_seen, last_ts, nonce, now, server_now, server_time, session, to, token, ts, updated_at, uploaded_at, url, video_url
- Float toleransı: 1e-06
- Bilinen-fark kabul listesi (FARKLI sayılmaz, hata sınıfları maskelenmez): `/api/activities` → BEKLENEN BOŞLUK (Faz 3/4: Traccar→D1 akışı); `/api/gps/live` → BEKLENEN BOŞLUK (Faz 3/4: Traccar→D1 akışı)

## Skor

| Verdikt | Uç sayısı |
|---|---|
| EŞİT | 34 |
| FARKLI | 2 |
| BİLİNEN-FARK | 2 |

## Uç tablosu

| Uç | Verdikt | apple_golge_diff | u69be3f7e960e | appreview |
|---|---|---|---|---|
| /api/rides | **FARKLI** | EŞİT (200/200) | FARKLI (200/200) 15 fark (200) | EŞİT (200/200) |
| /api/track | **FARKLI** | EŞİT (200/200) | FARKLI (200/200) 1 fark (200) | EŞİT (200/200) |
| /api/activities | **BİLİNEN-FARK** | EŞİT (200/200) | FARKLI (200/200) 1 fark (200) | FARKLI (200/200) 1 fark (200) |
| /api/gps/live | **BİLİNEN-FARK** | FARKLI (200/200) 1 fark (200) | FARKLI (200/200) 1 fark (200) | FARKLI (200/200) 1 fark (200) |
| /api/attest/challenge | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/badges | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/chat/list | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/chat/poll | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/chat/with/{other} | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/clubs | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/clubs/{cid} | **EŞİT** | EŞİT (404/404) | EŞİT (404/404) | EŞİT (404/404) |
| /api/friends | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/friends/requests | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/groupvideo | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/integrity/nonce | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/intercom/{cid}/token | **EŞİT** | EŞİT (402/402) | EŞİT (404/404) | EŞİT (404/404) |
| /api/leaderboard | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/live/club/{cid} | **EŞİT** | EŞİT (402/402) | EŞİT (404/404) | EŞİT (404/404) |
| /api/live/hr-poll | **EŞİT** | EŞİT (402/402) | EŞİT (403/403) | EŞİT (403/403) |
| /api/live/{username} | **EŞİT** | EŞİT (402/402) | EŞİT (403/403) | EŞİT (403/403) |
| /api/local-renders | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/music | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/music/file | **EŞİT** | EŞİT (404/404) | EŞİT (200/200) | EŞİT (404/404) |
| /api/music/library | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/profile | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/ptt/busy/{username} | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/ptt/{pid} | **EŞİT** | EŞİT (404/404) | EŞİT (200/200) | EŞİT (404/404) |
| /api/rides/{ride_id}/video | **EŞİT** | EŞİT (206/206) | EŞİT (404/404) | EŞİT (206/206) |
| /api/rides/{ride_id}/videourl | **EŞİT** | EŞİT (200/200) | EŞİT (404/404) | EŞİT (200/200) |
| /api/routes/shared | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/safety | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/stats | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/summary/settings | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/tracker | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/users/find | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/voicecall/status | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/voicecall/token | **EŞİT** | EŞİT (403/403) | EŞİT (200/200) | EŞİT (403/403) |
| /api/wrapped | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |

## Fark ayrıntıları

### /api/activities

> Kabul listesi: BEKLENEN BOŞLUK (Faz 3/4: Traccar→D1 akışı) — fark ayrıntısı bilgi amaçlı.

- **u69be3f7e960e** → FARKLI: 1 fark (200)
  - `LISTE-BOY` $.activities üretim=35 gölge=0
- **appreview** → FARKLI: 1 fark (200)
  - `LISTE-BOY` $.activities üretim=1 gölge=0

### /api/gps/live

> Kabul listesi: BEKLENEN BOŞLUK (Faz 3/4: Traccar→D1 akışı) — fark ayrıntısı bilgi amaçlı.

- **apple_golge_diff** → FARKLI: 1 fark (200)
  - `LISTE-BOY` $.positions üretim=0 gölge=1
- **u69be3f7e960e** → FARKLI: 1 fark (200)
  - `LISTE-BOY` $.positions üretim=2 gölge=0
- **appreview** → FARKLI: 1 fark (200)
  - `LISTE-BOY` $.positions üretim=1 gölge=0

### /api/rides

- **u69be3f7e960e** → FARKLI: 15 fark (200)
  - `ALAN-FAZLA(gölge)` $.rides[59].cloud
  - `DEGER` $.rides[59].file üretim="rota_2026-06-27_1782550590_3d_slow_9x16.mp4" gölge="videos/yerel/rota_2026-06-27_1782550590_3d_slow_9x16.mp4"
  - `ALAN-FAZLA(gölge)` $.rides[60].cloud
  - `DEGER` $.rides[60].file üretim="rota_2026-06-27_1782545926_flyover_medium_16x9.mp4" gölge="videos/yerel/rota_2026-06-27_1782545926_flyover_medium_16x9.mp4"
  - `ALAN-FAZLA(gölge)` $.rides[61].cloud
  - `DEGER` $.rides[61].file üretim="rota_2026-06-11_1781166844_flyover_medium_16x9.mp4" gölge="videos/yerel/rota_2026-06-11_1781166844_flyover_medium_16x9.mp4"
  - `ALAN-FAZLA(gölge)` $.rides[62].cloud
  - `DEGER` $.rides[62].file üretim="rota_2026-06-11_1781165738_flyover_medium_16x9.mp4" gölge="videos/yerel/rota_2026-06-11_1781165738_flyover_medium_16x9.mp4"
  - `ALAN-FAZLA(gölge)` $.rides[63].cloud
  - `DEGER` $.rides[63].file üretim="rota_2026-06-07_1780812280_flyover_medium_16x9.mp4" gölge="videos/yerel/rota_2026-06-07_1780812280_flyover_medium_16x9.mp4"
  - `ALAN-FAZLA(gölge)` $.rides[64].cloud
  - `DEGER` $.rides[64].file üretim="rota_2026-06-04_1780567112_3d_medium_16x9.mp4" gölge="videos/yerel/rota_2026-06-04_1780567112_3d_medium_16x9.mp4"
  - `ALAN-FAZLA(gölge)` $.rides[65].cloud
  - `DEGER` $.rides[65].file üretim="rota_2026-06-01_1780303623_flyover_medium_16x9.mp4" gölge="videos/yerel/rota_2026-06-01_1780303623_flyover_medium_16x9.mp4"
  - `DEGER` $.rides[80].date üretim="None" gölge=""

### /api/track

- **u69be3f7e960e** → FARKLI: 1 fark (200)
  - `LISTE-BOY` $.points üretim=387 gölge=0


---

## Rapor #1'e karşı karşılaştırma (2026-08-30, düzeltme turu A+B+C sonrası)

Deploy: version 916d8437 (18:50:39Z — tüm kaynak değişikliklerinden sonra; yeniden deploy gerekmedi, tsc temiz).
Diff'ten hemen önce veri tazeleme koşuldu: `import_social.py --remote` (25/25 tablo OK, rides 282=282) + `--ek dmreads` (10 satır + 18 last_seen).

| Skor | Rapor #1 | Rapor #2 |
|---|---|---|
| EŞİT | 24 | **34** |
| FARKLI | 11 | **2** |
| BİLİNEN-FARK | — | 2 |
| GÖLGE-HATA | 3 | **0** |

### Uç bazında değişim

| Uç | #1 → #2 | Neden düzeldi / kalan neden |
|---|---|---|
| /api/track | GÖLGE-HATA → FARKLI | 500 gitti (Görev A: `hr` kolonu kaldırıldı, şema hizalandı). Kalan: veri göçü boşluğu (aşağıda). |
| /api/voicecall/token | GÖLGE-HATA → EŞİT | Görev C: LIVEKIT_KEY/SECRET/URL sırları yüklendi. |
| /api/intercom/{cid}/token | GÖLGE-HATA → EŞİT | Görev C: aynı sırlar (ortak `livekitJwt`). |
| /api/live/hr-poll | FARKLI → EŞİT | Görev C: rota kayıt sırası üretimle eşlendi (bilinçli ölü-rota paritesi). |
| /api/chat/list | FARKLI → EŞİT | Görev B: `--ek dmreads` tam tazeleme (+ diff öncesi tekrar koşuldu). |
| /api/leaderboard | FARKLI → EŞİT | Görev B: rides snapshot tazeleme (282=282). |
| /api/local-renders | FARKLI → EŞİT | Görev B: yerelq KV göçü (pending=2). |
| /api/music/library | FARKLI → EŞİT | Görev B: usermusic R2 göçü (13 parça). |
| /api/music/file | FARKLI → EŞİT | Görev B: active.m4a R2'de. |
| /api/ptt/{pid} | FARKLI → EŞİT | Görev B: ptt/voicemsg klipleri R2'de. |
| /api/stats | FARKLI → EŞİT | Görev B: rides tazeleme (total 82, moto 61). |
| /api/rides | FARKLI (32 fark) → FARKLI (15 fark) | Eksik 7 ride + video alanları geldi (Görev B). Kalan 15 fark = grup1 KOD ARTIĞI (aşağıda). |
| /api/activities | FARKLI → BİLİNEN-FARK | Görev C kabul listesi: Faz 3/4 Traccar→D1 akışı beklenen boşluk. |
| /api/gps/live | FARKLI → BİLİNEN-FARK | Aynı kabul listesi. (apple_golge_diff'te gölge=1 fazla satır = Görev A'nın knot-test fikstürü, cihaz 24247325.) |

### Kalan farkların sınıflandırması

**1. GERÇEK KOD FARKI — /api/rides (u69be3f7e960e, 15 fark) → sahibi: grup1**
- `/opt/matrix/cf/api/src/routes/grup1.ts:547-548` — videos satırlarında koşulsuz `file: v.r2_key` (tam yol) + `cloud: true`. Üretimde `videos/yerel/%` kayıtları yerel ROUTES_DIR dalından gelir (`/opt/movelog/backend/main.py:276-306`): `file` = ÇIPLAK dosya adı (`rota_…mp4`), `cloud` alanı HİÇ YOK. Fiks (Görev B raporundaki tarif): `r2_key LIKE 'videos/yerel/%'` ise basename dön + `cloud`'u emit etme. → 15 farkın 14'ü (7 yerel ride × 2 alan).
- `/opt/matrix/cf/api/src/routes/grup1.ts:585` — `pyStr(fv.date ?? '')`: NULL date'te `""` üretir; üretim (`main.py:374-375`) `str(fv.get("date",""))` → date anahtarı `null` iken `"None"` STRİNGİ döner ve `fv.get("date") or base... or day` zinciriyle cevaba girer. social.json'da FINAL5 `date: null` (doğrulandı) → üretim `"None"`, gölge `""`. Fiks: `fv.date === null` iken `'None'` emit et (Python str(None) sadakati). → 15 farkın 1'i.

**2. VERİ GÖÇÜ EKSİĞİ (kabul edilen sınıfla aynı kök) — /api/track (u69be3f7e960e: üretim 387 nokta / gölge 0)**
- Kod DEĞİL: uç artık 200 dönüyor, knot→km/h çevirisi test fikstürüyle kanıtlı (Görev A). Uzak D1 `positions` tablosunda tarihsel Traccar noktaları yok — /api/activities ve /api/gps/live ile AYNI "Faz 3/4: Traccar→D1 akışı" boşluğu. Öneri: `BILINEN_FARK`'a `/api/track` da eklenebilir (bu turda liste değiştirilmedi — karar Barış'ın/sonraki turun).

**3. BİLİNEN-FARK (kabul listesi, bilgi amaçlı) — /api/activities, /api/gps/live**
- Faz 3/4 ingest gelince kendiliğinden kapanır. gps/live'daki ters fark (gölge 1 > üretim 0) diff-test fikstürü; Faz 3 öncesi gölge positions tablosu temizlenirse o da gider.
