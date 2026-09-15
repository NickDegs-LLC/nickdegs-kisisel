# Gölge GET-diff Raporu #3 (Faz 2a)

- Tarih: 2026-08-30 21:07:37 +0200
- Üretim: https://kisisel-api.nickdegs.com
- Gölge: https://movelog-api.daclen10.workers.dev
- Kapsam: method=GET + auth=auth_user → **38 uç** × 3 kullanıcı (apple_golge_diff, u69be3f7e960e, appreview)
- Normalize (değer muaf) alanlar: challenge, created_at, done, done_at, exp, expires, expires_at, expires_in, generated_at, last_seen, last_ts, nonce, now, server_now, server_time, session, to, token, ts, updated_at, uploaded_at, url, video_url
- Float toleransı: 1e-06
- Bilinen-fark kabul listesi (FARKLI sayılmaz, hata sınıfları maskelenmez): `/api/activities` → BEKLENEN BOŞLUK (Faz 3/4: Traccar→D1 akışı); `/api/gps/live` → BEKLENEN BOŞLUK (Faz 3/4: Traccar→D1 akışı); `/api/track` → BEKLENEN BOŞLUK (Faz 3/4: pozisyon geçmişi backfill)

## Skor

| Verdikt | Uç sayısı |
|---|---|
| EŞİT | 35 |
| BİLİNEN-FARK | 3 |

## Uç tablosu

| Uç | Verdikt | apple_golge_diff | u69be3f7e960e | appreview |
|---|---|---|---|---|
| /api/activities | **BİLİNEN-FARK** | EŞİT (200/200) | FARKLI (200/200) 1 fark (200) | FARKLI (200/200) 1 fark (200) |
| /api/gps/live | **BİLİNEN-FARK** | EŞİT (200/200) | FARKLI (200/200) 1 fark (200) | FARKLI (200/200) 1 fark (200) |
| /api/track | **BİLİNEN-FARK** | EŞİT (200/200) | FARKLI (200/200) 1 fark (200) | EŞİT (200/200) |
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
| /api/rides | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
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

- **u69be3f7e960e** → FARKLI: 1 fark (200)
  - `LISTE-BOY` $.positions üretim=2 gölge=0
- **appreview** → FARKLI: 1 fark (200)
  - `LISTE-BOY` $.positions üretim=1 gölge=0

### /api/track

> Kabul listesi: BEKLENEN BOŞLUK (Faz 3/4: pozisyon geçmişi backfill) — fark ayrıntısı bilgi amaçlı.

- **u69be3f7e960e** → FARKLI: 1 fark (200)
  - `LISTE-BOY` $.points üretim=387 gölge=0

