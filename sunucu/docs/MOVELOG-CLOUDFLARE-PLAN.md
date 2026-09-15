# Move Log → Cloudflare Taşıma Planı — v2 (ORTAK HARİTA mimarisi)

**v2 nedeni (Barış, 2026-08-30):** "Harita ortak olacak — Hooder ve diğer uygulamalar ve sen ortak
kullanacaksınız. **Sadece Hooder yazabilecek.** Değiştirme yok. Sen sadece video üreteceksin.
Uçtan uca planı en baştan kur. Sona yaklaştık diğer tarafta — **haber bekle**, plan kur."

**v1'den farklar:** `movelog-harita` worker'ı **İPTAL** (harita katmanı Hooder'ın malı, biz salt-okur
tüketiciyiz) · Move Log'un rolü netleşti: **video üretimi + onu besleyen asgari servisler** ·
geçişin harita ayağı Hooder tarafından gelecek habere KİLİTLİ.

**Hesap:** Daclen10@gmail.com · zone `nickdegs.com` · Workers Paid VAR · R2 `movelog` zaten burada.
**Faz 0 durumu:** D1 `movelog-db` + KV `movelog-kv` + Queue `movelog-render` AÇIK; token
`/opt/matrix/secrets/movelog-cf.conf`; `/opt/matrix/cf/` iskeleti (npm çakışması çözülecek).

---

## 1. Roller (yeni mimari)

| Katman | Sahibi | Bizim ilişkimiz |
|---|---|---|
| **Harita** (karolar, statik, PMTiles, DEM…) | **Hooder** — tek yazar | SALT-OKUR tüketici; sözleşme: `HARITA-TUKETIM-SOZLESMESI.md` |
| Video üretimi (RunPod + telefon) | Move Log (biz) | Değişmez — motor v140, LocalRouteVideo |
| Move Log API + GPS + dispatch + cron | Move Log (biz) | Cloudflare'e taşınır (bu plan) |
| R2 `movelog` (videolar, track'ler, SV önbelleği) | Move Log (biz) | Kalır |

**Dokunulmazlık:** Hooder'ın hiçbir varlığına (arşiv, worker kodu, servis) dokunulmaz/okunmaz.
Ortak katmanla ilişki YALNIZ yayınlanmış HTTP sözleşmesi üzerinden.

---

## 2. Harita tüketim sözleşmesi (ölçüldü, itiraz turundan geçti)

Tam metin: **`/opt/matrix/docs/HARITA-TUKETIM-SOZLESMESI.md`** — 12 beklenti (B1-B12), 11 açık soru (A1-A11), uyum testleri (T1-T12).
Plan için kritik özet:

- **B4 — ölçek sabiti:** statik `@2x` çıktıda dünya genişliği **512·2^z px**. Değişirse rotalar kayar
  (08-28 "denizde sürüş" vakası, 750 m). Ortak katmandan YAZILI taahhüt istenecek (A10).
- **Matching gerçeği:** proxy `code` alanı döndürmüyor; ana hattaki 4 tüketici `code=="Ok"` şart koştuğu
  için map-matching bugün fiilen yalnız taktik hatta çalışıyor (A5). Geçişte bu ya ortak katmanda düzelir
  ya da matching bize kalır (A4) — **karar Hooder haberine bağlı**.
- **Statik uç:** ortak katman statik+stitch vermezse motor ham XYZ karolardan kendi birleştirir
  (PIL zaten var; `_stitch` mantığı motora taşınır). İki dala da hazırız.
- **Sabit URL tuzağı:** 7 sunucu-scripti `http://127.0.0.1:8890`'ı KODDA sabit tutuyor. İkiye ayrılır:
  · `movelog-cloud.py` + `activity-detect.py` → fetch/mantık kodu, **cron/dispatch worker'a portlanır**
    (harita çağrıları ortak katmanın public URL'ine döner).
  · Taktik dörtlü (`route_gen/intro_gen/outro_gen/render_job`) + `_qa_render` → **PIL/ffmpeg render kodu,
    Worker'da ÇALIŞAMAZ** → yeni **Faz T**: taktik hat RunPod'a taşınır (aşağıda).
- **Motor geçişi "tek env" DEĞİL — İKİ ayrı env:** `route-video.py` → `HARITA_UC` (önekli; matching +
  geocoding + statik) ve `render3d.js` → `HARITA_TABAN` (öneksiz; xyz + mvt + /yukseklik) (+ DEM ayrı).
  A2 kimlik kararı ikisini FARKLI etkiler. Geçiş = RunPod template'inde iki env PATCH (**rebuild şart değil**).
- **Hacim (B12, ölçülü):** 2D/flyover video ~3-6 istek; **3D video ≈ 13.000 karo / ~15.000 istek**
  (+ MVT yüzlerce); taktik video onlarca-yüzlerce istek (9 intro + 13 outro statik + yakın-plan
  karolar + tek başına ~124 matching dilimi). Google 3D hattı (Ultra kısa rota) ortak katmana binmez
  ama Google ölürse aniden biner — B12 tepe notu. A3 rate-limit pazarlığı BU sayılarla yapılır.

---

## 3. Hedef mimari (v2 — 4 worker, harita yok)

```
Telefon ──► movelog-api (Worker, TS/Hono) ──► D1 movelog-db · KV movelog-kv · R2 movelog
   │              │                        ──► Queue movelog-render ──► movelog-dispatch ──► RunPod
   │              └──► APNs / FCM (WebCrypto)
   └──► movelog-gps (Worker, OsmAnd uyumlu) ──► D1 positions
Cron Triggers ──► movelog-cron (görev tablosu; eski 26 timer)
RunPod motoru ──► ORTAK HARİTA (salt-okur; HARITA_UC + HARITA_TABAN) · R2 (video yaz) · movelog-api /internal/render-done
Telefon (LocalRouteVideo/MapKit) ──► movelog-api /api/track (iz) ──► cihazda render
Telefon (WebRouteVideo, /motor3d HTML) ──► ORTAK HARİTA (xyz/mvt/yukseklik DOĞRUDAN; CORS + A2 anonim-karo kararına bağlı)
```

Harita-verisi-olmayan Move Log hesapları yeni evleri:
- rota→piksel projeksiyonu, kamera/zoom, statik birleştirme (gerekirse) → **render motoru içi**
- `/api/track` + `_yol_esle` → **movelog-api** (matching çağrısı ortak katmanın public URL'ine)
- `/motor3d` → Worker'a TAŞINAMAZ (python+node subprocess çalıştırıyor) → **tasarım kararı**:
  spec+HTML üretimi RunPod'a alınır (dispatch üzerinden) veya küçük konteyner; Faz 2'de karara bağlanır
- matching dilimleme/dikiş algoritması → A4 kararına göre motor içi veya movelog-api
- Street View (Google), DEM+glyph kamu uçları → motor içi (ortak katmanla ilgisiz)

---

## 4. D1 şeması, sözleşme, cron tablosu

v1'deki gibi (bkz. bölüm sonundaki Ek): `social.json` 22 anahtar → `users/rides/videos/positions/
messages/friends/clubs/counters` tabloları; `uploaded_tracks` (649 KB) D1'e değil R2'ye.
Bu üçlünün üretimi Faz 0'ın kalan işi — durdurulan analiz workflow'u (`wf_0358ae82-990`) resume edilecek.

---

## 5. Fazlar (v2) ve KAPILAR

### Kapı K0 — "Hooder'dan haber" — **YARI AÇIK (ön-cevap geldi, 2026-08-30)**
Ön-cevap: `HARITA-SOZLESME-HOODER-ON-CEVAP.md` · yanıtımız: `HARITA-SOZLESME-MOVELOG-YANIT.md`
**Şimdiden TAAHHÜT edilenler:** B4 512·2^z (yazılı!) · B2 MVT 204 · B1 tavan-üstü ebeveyn-kırp ·
B10 CORS · **A5 `code:"Ok"`'u katman ekler (bizim 4 tüketiciye dokunulmaz)** · A11 IPS yok ·
B7 matching davranışı. **Ön-görüş:** A3 karo uçlarında 429 planlanmıyor; **A1 `harita.nickdegs.com`
CNAME ile korunacak (tercih)** → bu yol kesinleşirse Move Log tarafında Faz H ≈ SIFIR kod/env değişikliği,
sadece T1-T12 uyum testi kalır. **Final cevap (~1 hafta):** A2 kimlik, A4 matching/geocoding'in evi,
A6/A7/A8/A9/A10. Final gelene dek bugünkü uçlar aynen; hiçbir uç habersiz değişmez (taahhüt).
T12 yük provası yalnız Hooder'ın verdiği pencerede, Barış onayıyla koşulur.
**2. tur (aynı gün):** A1 CNAME iki tarafın ortak tercihi (finalde resmileşir) + statik Cache-Control(30g)
geliyor · A2 önek-URL sürecek, CF Workers'a opsiyonel service-binding önerildi · karşılıklı donma garantisi.
K0 = tek belge: A1-A11 tam cevap + T1-T12 ortak koşu planı + kesişim tarihi (~1 hafta).

### Faz 0 — Hazırlık (kaldığı yerden; K0'dan bağımsız)
- npm ERESOLVE çöz → `api` worker derlensin (5 değil **4 worker**: harita silinir)
- Analiz workflow'u resume: D1 şeması + 110 endpoint sözleşmesi + cron tablosu + sır envanteri
- `db/import_social.py` (idempotent) + yerel D1'de prova; sırlar `wrangler secret` (push Faz 2'de)

### Faz 1 — Veriye dokunmayan parçalar (K0'dan bağımsız başlar)
- `movelog-gps`: OsmAnd ingest → D1 `positions`; Traccar 2 hafta paralel
- `movelog-dispatch`: Queue → RunPod REST + render-done webhook. ⚠️ Gizli harita bağımlılığı:
  movelog-cloud fanout'ta ÖN-EŞLEME (matching, `matched=1`) yapıyor — dispatch worker bunu public
  harita URL'i üzerinden devralır (bugünkü uç çalışır, K0 gerekmez) veya ön-eşleme motora bırakılır (ölçülerek)
- Motor uyum hazırlığı: `HARITA_UC` bugünkü uca bakmaya devam eder (değişiklik YOK — K0 bekleniyor)

### Faz 2 — API portu + gölge mod (v1 ile aynı; 110 uç, 6 grup sırası, JSON diff sıfırlanmadan geçmez)

### Faz 3 — Cron + push (v1 ile aynı; 26 timer → görev tablosu, APNs/FCM WebCrypto)

### Faz T — Taktik hattın RunPod'a taşınması (K0'suz başlar; 1-1,5 gün)
Taktik üretim bugün SUNUCUDA lokal subprocess (`tac_dispatch.py` → render_job; Cloud Run yolu mühürlü)
ve haritaya `127.0.0.1:8890` sabitiyle bağlı. Sunucu kapanırsa taktik ÖLÜR — v1 bunu atlamıştı.
1. Taktik scriptler RunPod imajına eklenir (PIL/ffmpeg zaten imajda); taban URL'ler parametrik yapılır
   (8890 sabitleri kalkar → HARITA_UC/HARITA_TABAN ailesi)
2. `tac_dispatch` mantığı movelog-dispatch/Queue'ya alınır (mühürlü davranış AYNEN korunur —
   [[reference-nv-zoom-butce]] mühürlerine dokunulmaz, sadece çağrı yolu değişir)
3. Kare kare QA ile bir taktik video doğrulanır; landmark fotoğrafı (Commons/Openverse) motor içi kalır

### Faz H — Harita geçişi (K0 SONRASI, ayrı ve küçük)
1. Uyum testleri **T1-T12** ortak katmana karşı koşulur (piksel karşılaştırma, 70/70 rota-karada,
   3 zoom kademesi, MVT 204 kuralı, uçtan uca 3 render, tavan davranışı, kimlik, yük provası).
   ⚠️ T12 yük provası (~2.000 karo/60 sn) Hooder'ın servisine yük demektir — **Barış üzerinden
   zamanlama onayı alınmadan koşulmaz** (A3 pazarlığının parçası).
2. RunPod template: `HARITA_UC` + `HARITA_TABAN` → ortak katman (env PATCH; A4 kararına göre
   matching/statik değişiklikleri varsa imaj vN+1)
2b. Motor DIŞI tüketiciler de geçirilir: movelog-api Worker'ındaki matching/geocoding URL'leri,
   `/motor3d` HTML'inin `HARITA_TABAN`'ı, `/api/mapconfig` yanıtı, cron worker'daki activity-detect geocoding'i
3. Bir test videosu kare kare doğrulanır ([[feedback-video-teker-teker-qa]]); temizse template geçer
4. Eski proxy 2 hafta yedek kalır (motor env'i geri almak = tek PATCH)

### Faz H+ — Statik origin köprüsünün kaldırılması (Faz 4 ÖN KOŞULU)
harita-katman ön-yazımı statik/strm'i origin'e forward eder (T1 riski sıfır ama sunucuya bağlı).
Sunucu kapanmadan ÖNCE: motor-içi stitch (route-video.py'ye _stitch portu, PIL hazır) uygulanıp
statik forward kaldırılır; taktik intro/outro statikleri de Faz T ile RunPod'a taşındığından aynı yolu kullanır.

### Faz 4 — DNS geçişi + sunucu emekliliği (v1 ile aynı: son aktarım, salt-okur, 2 hafta gözlem)
Bitti ölçütü: sunucuda movelog-api + 26 timer + Traccar + **harita-proxy** + **tac_dispatch** kapalıyken
telefon giriş yapar, rota görür, video izler, GPS kaydeder, NORMAL video üretir (ortak haritayla),
**TAKTİK video üretir (RunPod'dan)**, otomatik algılama çalışır, push gelir.

## 6. Süre (v2)
| İş | Süre | Kapı |
|---|---|---|
| Faz 0 kalan | 0,5-1 gün | — |
| Faz 1 | 1 gün | — |
| Faz 2 | 2-3 gün | — |
| Faz 3 | 1 gün | — |
| Faz T (taktik→RunPod) | 1-1,5 gün | — |
| Faz H | 0,5 gün | **K0: Hooder haberi** |
| Faz 4 | 0,5 gün + 2 hafta gözlem | Faz H bitmiş olmalı |
Harita dışı her şey K0 beklenmeden ilerleyebilir; K0 yalnız Faz H'yi kilitler.

## 7. Riskler (v2 farkları)
| Risk | Karşılık |
|---|---|
| Ortak katman ölçeği/formatı farklı çıkar | B4/A10 yazılı taahhüt + T1 piksel testi geçmeden motor geçmez |
| Ortak katman statik/matching vermez | Motor kendi stitch'ini yapar (PIL); matching movelog-api'ye alınır |
| Rate limit / 429 | Motor karo-retry + `exit(7)` davranışı A3'e göre ayarlanır; önbellek R2 SV-cache deseni |
| Hooder tarafı gecikir | Faz 0-3 zaten K0'suz ilerliyor; harita bugünkü uçta kalır, hiçbir şey kırılmaz |
| Ortak katmanda kesinti | Videolar kuyruğa düşer (pending-reconcile bekçisi); telefon LocalRouteVideo yolu ayakta |

---
**Ek — v1'den devralınan ayrıntılar** (D1 şema eşlemesi, endpoint grupları, timer takvimleri,
gölge diff yöntemi, sır envanteri): git geçmişi yerine tek dosyada tutmak için buraya değil,
Faz 0 çıktılarının kendisine bakılır: `cf/db/`, `cf/contracts/`, `cf/cron/`, `cf/SECRETS.md`.
