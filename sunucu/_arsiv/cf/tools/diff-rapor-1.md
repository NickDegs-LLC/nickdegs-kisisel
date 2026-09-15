# Gölge GET-diff Raporu #1 (Faz 2a)

- Tarih: 2026-08-30 20:36:04 +0200
- Üretim: https://kisisel-api.nickdegs.com
- Gölge: https://movelog-api.daclen10.workers.dev
- Kapsam: method=GET + auth=auth_user → **38 uç** × 3 kullanıcı (apple_golge_diff, u69be3f7e960e, appreview)
- Normalize (değer muaf) alanlar: challenge, created_at, done, done_at, exp, expires, expires_at, expires_in, generated_at, last_seen, last_ts, nonce, now, server_now, server_time, session, to, token, ts, updated_at, uploaded_at, url, video_url
- Float toleransı: 1e-06

## Skor

| Verdikt | Uç sayısı |
|---|---|
| EŞİT | 24 |
| FARKLI | 11 |
| GÖLGE-HATA | 3 |

## Uç tablosu

| Uç | Verdikt | apple_golge_diff | u69be3f7e960e | appreview |
|---|---|---|---|---|
| /api/activities | **FARKLI** | EŞİT (200/200) | FARKLI (200/200) 1 fark (200) | FARKLI (200/200) 1 fark (200) |
| /api/chat/list | **FARKLI** | EŞİT (200/200) | FARKLI (200/200) 1 fark (200) | EŞİT (200/200) |
| /api/gps/live | **FARKLI** | EŞİT (200/200) | FARKLI (200/200) 1 fark (200) | FARKLI (200/200) 1 fark (200) |
| /api/intercom/{cid}/token | **GÖLGE-HATA** | GÖLGE-HATA (402/503) gölge 503 (üretim 402) gövde={"detail": "interkom kapalı"} | GÖLGE-HATA (404/503) gölge 503 (üretim 404) gövde={"detail": "interkom kapalı"} | GÖLGE-HATA (404/503) gölge 503 (üretim 404) gövde={"detail": "interkom kapalı"} |
| /api/leaderboard | **FARKLI** | EŞİT (200/200) | FARKLI (200/200) 3 fark (200) | EŞİT (200/200) |
| /api/live/hr-poll | **FARKLI** | FARKLI (402/200) durum: üretim 402 ≠ gölge 200 | FARKLI (403/200) durum: üretim 403 ≠ gölge 200 | FARKLI (403/200) durum: üretim 403 ≠ gölge 200 |
| /api/local-renders | **FARKLI** | EŞİT (200/200) | FARKLI (200/200) 1 fark (200) | EŞİT (200/200) |
| /api/music/file | **FARKLI** | EŞİT (404/404) | FARKLI (200/404) durum: üretim 200 ≠ gölge 404 | EŞİT (404/404) |
| /api/music/library | **FARKLI** | EŞİT (200/200) | FARKLI (200/200) 1 fark (200) | EŞİT (200/200) |
| /api/ptt/{pid} | **FARKLI** | EŞİT (404/404) | FARKLI (200/404) durum: üretim 200 ≠ gölge 404 | EŞİT (404/404) |
| /api/rides | **FARKLI** | EŞİT (200/200) | FARKLI (200/200) 32 fark (200) | EŞİT (200/200) |
| /api/stats | **FARKLI** | EŞİT (200/200) | FARKLI (200/200) 2 fark (200) | EŞİT (200/200) |
| /api/track | **GÖLGE-HATA** | GÖLGE-HATA (200/503) gölge 503 (üretim 200) gövde={"detail": "cihaz Traccar'da yok"} | GÖLGE-HATA (200/500) gölge 500 (üretim 200) gövde=e41656eb2ba6c629 | GÖLGE-HATA (200/500) gölge 500 (üretim 200) gövde=e41656eb2ba6c629 |
| /api/voicecall/token | **GÖLGE-HATA** | GÖLGE-HATA (403/503) gölge 503 (üretim 403) gövde={"detail": "canlı telsiz kapalı"} | GÖLGE-HATA (200/503) gölge 503 (üretim 200) gövde={"detail": "canlı telsiz kapalı"} | GÖLGE-HATA (403/503) gölge 503 (üretim 403) gövde={"detail": "canlı telsiz kapalı"} |
| /api/attest/challenge | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/badges | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/chat/poll | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/chat/with/{other} | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/clubs | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/clubs/{cid} | **EŞİT** | EŞİT (404/404) | EŞİT (404/404) | EŞİT (404/404) |
| /api/friends | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/friends/requests | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/groupvideo | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/integrity/nonce | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/live/club/{cid} | **EŞİT** | EŞİT (402/402) | EŞİT (404/404) | EŞİT (404/404) |
| /api/live/{username} | **EŞİT** | EŞİT (402/402) | EŞİT (403/403) | EŞİT (403/403) |
| /api/music | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/profile | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/ptt/busy/{username} | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/rides/{ride_id}/video | **EŞİT** | EŞİT (206/206) | EŞİT (404/404) | EŞİT (206/206) |
| /api/rides/{ride_id}/videourl | **EŞİT** | EŞİT (200/200) | EŞİT (404/404) | EŞİT (200/200) |
| /api/routes/shared | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/safety | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/summary/settings | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/tracker | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/users/find | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/voicecall/status | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |
| /api/wrapped | **EŞİT** | EŞİT (200/200) | EŞİT (200/200) | EŞİT (200/200) |

## Fark ayrıntıları

### /api/activities

- **u69be3f7e960e** → FARKLI: 1 fark (200)
  - `LISTE-BOY` $.activities üretim=35 gölge=0
- **appreview** → FARKLI: 1 fark (200)
  - `LISTE-BOY` $.activities üretim=1 gölge=0

### /api/chat/list

- **u69be3f7e960e** → FARKLI: 1 fark (200)
  - `DEGER` $.conversations[0].unread üretim=0 gölge=2

### /api/gps/live

- **u69be3f7e960e** → FARKLI: 1 fark (200)
  - `LISTE-BOY` $.positions üretim=2 gölge=0
- **appreview** → FARKLI: 1 fark (200)
  - `LISTE-BOY` $.positions üretim=1 gölge=0

### /api/intercom/{cid}/token

- **apple_golge_diff** → GÖLGE-HATA: gölge 503 (üretim 402) gövde={"detail": "interkom kapalı"}
- **u69be3f7e960e** → GÖLGE-HATA: gölge 503 (üretim 404) gövde={"detail": "interkom kapalı"}
- **appreview** → GÖLGE-HATA: gölge 503 (üretim 404) gövde={"detail": "interkom kapalı"}

### /api/leaderboard

- **u69be3f7e960e** → FARKLI: 3 fark (200)
  - `DEGER` $.week[0].km üretim=42.7 gölge=20.7
  - `DEGER` $.week[0].rides üretim=3 gölge=2
  - `DEGER` $.week[0].secs üretim=6271 gölge=2561

### /api/live/hr-poll

- **apple_golge_diff** → FARKLI: durum: üretim 402 ≠ gölge 200
  - `PROD-GOVDE` {"detail": "Ultra gerekli"}
  - `GOLGE-GOVDE` {"want": false, "share": true}
- **u69be3f7e960e** → FARKLI: durum: üretim 403 ≠ gölge 200
  - `PROD-GOVDE` {"detail": "sadece arkadaşını izleyebilirsin"}
  - `GOLGE-GOVDE` {"want": false, "share": true}
- **appreview** → FARKLI: durum: üretim 403 ≠ gölge 200
  - `PROD-GOVDE` {"detail": "sadece arkadaşını izleyebilirsin"}
  - `GOLGE-GOVDE` {"want": false, "share": true}

### /api/local-renders

- **u69be3f7e960e** → FARKLI: 1 fark (200)
  - `LISTE-BOY` $.pending üretim=2 gölge=0

### /api/music/file

- **u69be3f7e960e** → FARKLI: durum: üretim 200 ≠ gölge 404
  - `GOLGE-GOVDE` {"detail": "müzik yok"}

### /api/music/library

- **u69be3f7e960e** → FARKLI: 1 fark (200)
  - `LISTE-BOY` $.tracks üretim=13 gölge=0

### /api/ptt/{pid}

- **u69be3f7e960e** → FARKLI: durum: üretim 200 ≠ gölge 404
  - `GOLGE-GOVDE` {"detail": "klip yok"}

### /api/rides

- **u69be3f7e960e** → FARKLI: 32 fark (200)
  - `LISTE-BOY` $.rides üretim=82 gölge=75
  - `ALAN-EKSIK(gölge)` $.rides[59].file
  - `ALAN-EKSIK(gölge)` $.rides[59].video_url
  - `ALAN-FAZLA(gölge)` $.rides[59].error
  - `ALAN-FAZLA(gölge)` $.rides[59].failed
  - `DEGER` $.rides[59].added üretim=1782589209 gölge=1787768792
  - `DEGER` $.rides[59].aspect üretim="9x16" gölge="16:9"
  - `DEGER` $.rides[59].date üretim="2026-06-27" gölge="2026-04-27"
  - `DEGER` $.rides[59].id üretim="2026-06-27_1782550590" gölge="2026-04-27_1777281859_1787763344"
  - `DEGER` $.rides[59].size üretim=13599835 gölge=0
  - `DEGER` $.rides[59].speed üretim="slow" gölge="medium"
  - `ALAN-EKSIK(gölge)` $.rides[60].file
  - `ALAN-EKSIK(gölge)` $.rides[60].video_url
  - `ALAN-FAZLA(gölge)` $.rides[60].novideo
  - `DEGER` $.rides[60].added üretim=1782589644 gölge=1777281859
  - `DEGER` $.rides[60].aspect üretim="16x9" gölge="16:9"
  - `DEGER` $.rides[60].date üretim="2026-06-27" gölge="2026-04-27"
  - `DEGER` $.rides[60].id üretim="2026-06-27_1782545926" gölge="up_1783174323_1777281859"
  - `DEGER` $.rides[60].size üretim=3428460 gölge=0
  - `ALAN-EKSIK(gölge)` $.rides[61].file
  - `ALAN-EKSIK(gölge)` $.rides[61].video_url
  - `ALAN-FAZLA(gölge)` $.rides[61].novideo
  - `DEGER` $.rides[61].added üretim=1781181264 gölge=1777281859
  - `DEGER` $.rides[61].aspect üretim="16x9" gölge="16:9"
  - `DEGER` $.rides[61].date üretim="2026-06-11" gölge="2026-04-27"
  - `DEGER` $.rides[61].emoji üretim="🏍️" gölge="🚲"
  - `DEGER` $.rides[61].id üretim="2026-06-11_1781166844" gölge="up_1783174380_1777281859"
  - `DEGER` $.rides[61].size üretim=1877579 gölge=0
  - `DEGER` $.rides[61].type üretim="moto" gölge="bike"
  - `ALAN-EKSIK(gölge)` $.rides[62].file
  - … (+2 fark daha)

### /api/stats

- **u69be3f7e960e** → FARKLI: 2 fark (200)
  - `DEGER` $.by_type.moto üretim=61 gölge=54
  - `DEGER` $.total_rides üretim=82 gölge=75

### /api/track

- **apple_golge_diff** → GÖLGE-HATA: gölge 503 (üretim 200) gövde={"detail": "cihaz Traccar'da yok"}
- **u69be3f7e960e** → GÖLGE-HATA: gölge 500 (üretim 200) gövde=e41656eb2ba6c629
- **appreview** → GÖLGE-HATA: gölge 500 (üretim 200) gövde=e41656eb2ba6c629

### /api/voicecall/token

- **apple_golge_diff** → GÖLGE-HATA: gölge 503 (üretim 403) gövde={"detail": "canlı telsiz kapalı"}
- **u69be3f7e960e** → GÖLGE-HATA: gölge 503 (üretim 200) gövde={"detail": "canlı telsiz kapalı"}
- **appreview** → GÖLGE-HATA: gölge 503 (üretim 403) gövde={"detail": "canlı telsiz kapalı"}

## Kritik farklar — kök neden analizi (elle doğrulandı)

1. **/api/track → GÖLGE-HATA 500 (grup7) — EN KRİTİK, KANITLI.**
   `wrangler tail` kanıtı: `D1_ERROR: no such column: hr`. Canlı uzak D1'deki `positions`
   tablosu migration 0001 ile UYUMSUZ: gerçek kolonlar `device, ts, lat, lon, spd, alt, acc,
   brg, batt, charge, created_at` — migration'daki `hr`, `course`, `charging`, `updated_at`
   YOK (`brg`≠course, `charge`≠charging adları da farklı). GPS ingest hattı tabloyu kendi
   şemasıyla oluşturmuş görünüyor. `SELECT ... hr FROM positions` → 500.
   → Aksiyon: gps grubu + migration sahibi şemayı hizalamalı (ALTER TABLE positions ADD hr
   veya sorguların gerçek şemaya çekilmesi); grup7 dosyasına DOKUNMADIM (kural 5).

2. **/api/live/hr-poll → FARKLI (grup2) — üretimde ÖLÜ ROTA.**
   main.py'de `/api/live/{username}` (satır 3168) `/api/live/hr-poll`'dan (3354) ÖNCE tanımlı
   → FastAPI istekleri `username="hr-poll"` olarak eşler: üretim 402 "Ultra gerekli" /
   403 "sadece arkadaşını izleyebilirsin" döner. Gölge, fonksiyonun YAZILDIĞI davranışı
   (200 `{"want":false,"share":true}`) veriyor. BİREBİR kuralı gereği gölge üretimin route-
   gölgeleme davranışını taklit etmeli — YA DA bu Barış'a üretim bug'ı olarak sorulmalı
   (Nabız Peek özelliği üretimde bu uçtan hiç çalışamıyor demektir).

3. **/api/voicecall/token + /api/intercom/{cid}/token → GÖLGE-HATA 503 (grup5/grup8) — SIR EKSİK (beklenen).**
   LIVEKIT_KEY yüklenmemiş → bilinçli fail-closed ("canlı telsiz kapalı"/"interkom kapalı").
   Kontrol sırası main.py ile birebir (secret kontrolü en önce). Sırlar yüklenince yeniden diff.

4. **/api/rides (Barış) → FARKLI (grup1 + import aracı).**
   Üretim 82 / gölge 75 kayıt; ilk 59 kayıt BİREBİR, sonra kayma. Gölgede `up_*` ve
   `*_<kopya-ts>` biçimli id'ler üretimdeki `YYYY-MM-DD_ts` id'lerden farklı; 7 kayıt eksik.
   appreview ve apple_golge_diff (örnek içerik yolu) EŞİT → uç kodu değil, import'un
   uploaded/grup-kopyası id eşlemesi + eksik kayıt sorunu. Ayrıca Barış ride'larının video
   alanları (file/video_url) gölgede yok → `videos` tablosunda yalnız appreview satırları var
   (import videoları eksik almış).

5. **/api/stats + /api/leaderboard → FARKLI (grup7/grup8) — #4'ün türevi.**
   total_rides 82→75, by_type.moto 61→54, hafta km 42.7→20.7: hepsi eksik ride'ların
   toplamlara yansıması. Ayrı kod hatası kanıtı yok.

6. **/api/music/library + /api/music/file → FARKLI (grup4) — varlık import'u eksik.**
   Üretim 13 parça / ref=active 200; gölge 0 parça / 404 "müzik yok". Müzik dosyaları
   R2'ye taşınmamış.

7. **/api/ptt/{pid} → FARKLI (grup4) — varlık import'u eksik.**
   `ptt_acl` satırı D1'de var (yetki kontrolü çalışıyor) ama klip sesi R2'de yok →
   üretim 200 / gölge 404 "klip yok".

8. **/api/activities + /api/gps/live → FARKLI (grup7) — Traccar→D1 boru hattı henüz canlı değil.**
   Üretim 35 aktivite / 2 canlı konum; gölge 0/0 (D1 positions'ta 1 satır). Faz 3 ingest
   gelene kadar beklenen veri boşluğu; uç davranışı (200 + boş liste) tutarlı.

9. **/api/local-renders → FARKLI (grup6) — kuyruk durumu taşınmadı.**
   Üretim pending=2 (yerelq dosya kuyruğu), gölge 0. Veri boşluğu, kod farkı değil.

10. **/api/chat/list → FARKLI (grup5) — salt veri drifti.**
    unread üretim 0 / gölge 2: D1 kopyası alındıktan sonra üretimde mesajlar okundu
    (dm_reads drifti). Kod farkı yok.

**Not (test-durumu yan etkisi):** /api/track'te apple_golge_diff üretimde 200 `{"points":[]}`
döndü çünkü önceki diff turunda GET /api/tracker (main.py:2730-2733) profile trackerId'yi
OTO-YAZDI (GET'in yan etkisi). Gölge de /api/tracker'da users.tracker_id oluşturmuyorsa bu
fark kalıcıdır — grup7 kontrol etmeli.

**Genel değerlendirme:** 24/38 uç üç kullanıcıda da durum+alan kümesi+değer bazında BİREBİR.
14 farklının dağılımı: 1 gerçek kod hatası (şema uyumsuzluğu → 500), 1 route-sırası sadakat
sorusu (hr-poll), 2 eksik sır (beklenen fail-closed), 10 veri/import boşluğu-drifti.
