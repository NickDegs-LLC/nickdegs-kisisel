# HARİTA TÜKETİM SÖZLEŞMESİ — Move Log → Ortak Harita Katmanı

**Tarih:** 2026-08-30 · **Hazırlayan:** matrix oturumu (3 ölçüm cephesi birleştirildi + çelişkiler kod/canlı ölçümle çözüldü)
**Amaç:** Barış'ın 2026-08-30 mimari kararı gereği harita ORTAK katman oluyor (yalnız Hooder yazar, herkes salt-okur).
Bu belge Move Log'un o katmandan **tükettiği her şeyin** ölçülmüş envanteri = Hooder tarafına verilecek tüketim sözleşmesinin temeli.
Her iddia dosya:satır veya canlı ölçüm kanıtlı. Hooder'a ait hiçbir dosya okunmadı; `harita-proxy.py` bizim proxy'mizdir.

**İTİRAZ TURU (2026-08-30, bağımsız doğrulama):** belge çürütme denemesinden geçirildi; canlı uç yeniden ölçüldü (statik 100x100@2x→200×200 ✓, XYZ 256px/jpeg/30g+immutable ✓, MVT içerik-tipi ✓, matching driving 200-code'suz / cycling-walking 404 ✓, B4 ölçek deneyi tekrar + yanlış-ölçek kontrolü). Bulunan ve DÜZELTİLEN hatalar: B7'ye taktik matching tüketicileri + `confidence` alanı eklendi; B10'a öneksiz/env'siz `127.0.0.1:8890` yerel tüketici listesi eklendi; B11'deki "statikte 30g başlık" iddiası canlı ölçümle ÇÜRÜTÜLDÜ (statik başlıksız/DYNAMIC); B12 taktik hacmi kodla yeniden sayıldı (intro 9 + outro 13 statik + matching ~124'e kadar); tile-str "2 dosya" → 78; Bölüm 2'ye Google Photorealistic 3D hattı eklendi; geri dönüş planındaki "tüm tüketiciler env'li" iddiası düzeltildi; T1 eşiği ve T3 yöntemi (HEAD→GET) düzeltildi.

**Çözülen rapor çelişkileri (kod kanıtıyla):**
- *Parametresiz `?k` zoom tavanı z18 mi z19 mu?* → **z18.** Kod: `harita-proxy.py:521,525` (`_tavan = 17 if _kt=="premium" else 18`; `_kt=None` da 18'e düşer). Satır 519'daki "parametre yoksa z19" yorumu, satır 522-524'teki 08-11 yük dersi sonrası kod değişince güncellenmemiş — **yorum değil kod geçerli**.
- *Matching profil kısıtı* → proxy regex'i yalnız `driving` (`harita-proxy.py:675`). Canlı ölçüm (2026-08-30): `cycling→404, walking→404, driving→200`.
- *"Android osmdroid buradan çeker" yorumu (harita-proxy.py:513-515)* → GÜNCEL DEĞİL; Android osmdroid doğrudan OSM MAPNIK kullanıyor (`android-native/.../MapChatScreen.kt:82`, cephe-2 ölçümü). Sözleşmede Android tüketici DEĞİL.

---

## 1) MOVE LOG'UN ORTAK HARİTADAN BEKLENTİLERİ

Toplam **12 beklenti maddesi**. "Zorunlu" = eksikse videolar bozulur.

### B1 — XYZ raster karolar (ZORUNLU — 3D motorun zemini)
- **Yol:** `GET /xyz/{sat|str}/{z}/{x}/{y}.jpg?k={premium|ultra}` — `render3d.js:58-59`.
- **Yanıt:** 256×256 `image/jpeg` (q85), `Cache-Control: public, max-age=2592000` (+nginx `immutable`) — `harita-proxy.py:538-543`. Canlı ölçüldü: sat z15 → 200/jpeg/256px.
- **`?k` katman parametresi:** URL'de taşınır (uzak worker'ın tier bilgisi başka yerden gelemez — `render3d.js:49-52`). Zoom tavanı: **premium z17, ultra z18, parametresiz z18** (`harita-proxy.py:521,525`; yukarıdaki çelişki çözümü).
- **Tavan üstü istek:** ASLA 404/siyah karo değil — ebeveyn karodan çeyrek kırp + LANCZOS büyüt (`harita-proxy.py:526-535`; "siyah karo" vakası dersi, satır 527-529). **Sözleşmeye aynen girmeli.**
- **Zoom aralığı pratikte z2…z18:** 3D taban 16.4+CAMZ, uzun-rota kademeleri 10.3/11.2/12.2, dwell +1.4 (`render-worker/scripts/route-video.py:520-534`), dünya finali harita-zoom 1.9 (`render3d.js:677`); MapLibre 256px kaynakta karo z = harita z+1.
- **MapLibre kaynak tanımı:** `tileSize:256, maxzoom:19` (`render3d.js:69-70`) — davranışı proxy tavanı belirler.
- **Hata toleransı:** motor karo hatası sayar, >400 hata → `exit(7)` re-dispatch (`render3d.js:95-99,590-596`). Katman kesintisi = render ölümü.
- Not: `tile-str` önbelleği **78 dosya** (itiraz turu `find` sayımı 30.08; cephe-3'ün "2 dosya"sı hatalıydı — biri bugünden, çoğu 08-10'dan). `tile-sat` 327.488 dosya → oran ~1/4200, sonuç değişmez: `/xyz/str` fiilen az kullanılıyor, gösterim yükü sat+mvt'de. Yine de şehir stili (`satStyle=false` dalı, `render3d.js:73-75`) str'ye bağlı — uç kalmalı.

### B2 — MVT vektör karolar (ZORUNLU — 3B binalar, kabartma=1)
- **Yol:** `GET /mvt/{z}/{x}/{y}.mvt` — `render3d.js:60`; kaynak `minzoom:0, maxzoom:15` (`render3d.js:71`).
- **Tüketilen içerik:** SADECE `buildings` source-layer; öznitelikler `height`, `min_height`, feature `id` (id-hash renk paleti) — `render3d.js:145-162`.
- **z13-15 bina harmanı:** OSM (z15 ham / z13-14 torun-sentez) + Microsoft ML binaları, feature id+height korunarak (`harita-proxy.py:556-567`, `mvt_bina.py:1-16`). Görünüm bu harmanla kalibre — kapsam değişirse şehir videoları görsel değişir.
- **🔴 Eksik karoda 404 DEĞİL 204** (`harita-proxy.py:550-551,577-582`): CrowdSec http-probing tetiklenmesin (bir render binlerce karo çeker; 10×404/10sn = ban = render ölür) + MapLibre 204'ü sorunsuz yutar. **Sözleşmeye aynen yazılmalı.**
- **Content-Type:** `application/vnd.mapbox-vector-tile`, Cache-Control 30g, ACAO:* (`harita-proxy.py:583-587`). Canlı ölçüldü: z14 → 200/6174B.

### B3 — Statik görüntü, MERKEZ biçimi (ZORUNLU — 2D flat/flyover taban)
- **Yol:** `GET /styles/v1/mapbox/{stil}/static/{lon:.6f},{lat:.6f},{z:.3f},{bearing}/{W}x{H}@2x?access_token=…[&attribution=false&logo=false]` — `render-worker/scripts/route-video.py:685-687` (stil `satellite-streets-v12`); eski yerel kopya `scripts/route-video.py:355`; taktik `route_gen.py:171` (`satellite-v9`), `intro_gen.py:22`, `outro_gen.py:32`. **`attribution/logo` parametreleri OPSİYONEL** (intro/outro/activity-detect göndermez — grep) — katman tanımadığı query parametrelerini yutmalı, davranış değiştirmemeli.
- **Yanıt:** `image/jpeg` (q87 — `harita-proxy.py:866-867`), **çıktı DAİMA tam 2W×2H px** (canlı ölçüldü: 100x100@2x → 200×200). Merkez piksel = (lon,lat) Web-Mercator; **kesirli z desteklenir** (telafi `scale=2^(z+1-zi)`, `harita-proxy.py:231-232`).
- **Retry YOK:** tek `urlretrieve` (`route-video.py:687`); hata = render çöker. Uç güvenilir olmalı.

### B4 — 🔴 ÖLÇEK SABİTİ: @2x çıktıda dünya genişliği = **512·2^z px** (EN KRİTİK MADDE)
- Yani `m/px = 156543.03392·cos(lat) / 2^(z+1)`. Rota→piksel projeksiyonu bu sabitle kurulur: `zx=log2(BWp·(1-2·PAD)/(512·dx))` ve `ws=512·2^zoom` (`render-worker/scripts/route-video.py:676-678`).
- **08-28 kayma vakası (kanıt):** eski kod `1024·2^z` varsayıyordu = TAM 2 KAT — rota haritanın üstünde 2 kat büyük çizilip **750 m kayıyordu, sürüş denizde görünüyordu** (`route-video.py:671-675` ölçüm notu; aynı hata taktik motorda daha önce yakalanmıştı — memory: "Karo Ölçeği 2× Hatası").
- **Deneyle doğrulandı (2026-08-30, cephe-1):** z=15 `128x128@2x` statik çıktısı, z16 XYZ karosuyla piksel-piksel karşılaştırıldı → ortalama mutlak fark **0.21/255** = birebir aynı coğrafi pencere. **İtiraz turu tekrarı (30.08, bağımsız kod):** aynı deney z16 Karaköy karosuyla → **1.39/255** (JPEG çift-kodlama gürültüsü; fark ölçüm gününe/karoya göre 0.2-1.4 oynar). **Kontrol deneyi:** aynı karo, yanlış-ölçek hipotezine denk düşen z14 statikle karşılaştırıldı → **64.8/255**. Yani doğru ölçek ≈1/255 bandında, yanlış ölçek ≈65/255 — ayrım nettir, T1 eşiği buna göre <5/255.
- ⚠️ **Bu, gerçek Mapbox'ın @2x davranışından FARKLIDIR** (Mapbox @2x'te 1024·2^z olurdu). Ortak katman "Mapbox-birebir-uyumlu" diye kurulursa TÜM 2D/taktik videolarda rota kayar. **Bu sabit hiçbir koşulda değişemez.**

### B5 — Statik görüntü, BBOX biçimi (ZORUNLU — taktik TEK MOZAİK)
- **Yol:** `GET /styles/v1/mapbox/{stil}/static/[minlon,minlat,maxlon,maxlat]/{W}x{H}@2x` — `route_gen.py:63-65` (1280x1280@2x, `satellite-v9`).
- **Fit kuralı Mapbox ile birebir:** ölçek=min(outw/gw, outh/gh), merkez=bbox merkezi (`harita-proxy.py:274-278`); zoom "1 kaynak px ≥ 1 çıktı px" olana dek artar, karo sayısı >400 ise düşürülür (`:288-294`). route_gen piksel projeksiyonunu bu kurala göre KENDİ kurar (`harita-proxy.py:255-258` uyarısı) — **fit kuralında sapma = taktik videoda rota kayması** (mühürlü taktik hat, memory: TEK KARO + ızgara hizalama).

### B6 — Stil adı → içerik eşlemesi (ZORUNLU — taktik kentsel ölçüm)
- `streets*` stiller → **strm**: soluk PMTiles ÖLÇÜM rasteri; diğer stiller → uydu (`harita-proxy.py:816,844`; ölçüm/gösterim ayrımı `:225-227`).
- Tüketici: `route_gen.py:201` (`streets-v12` 512x512@2x) → `_road_density` kentsel tespit, mühürlü sabit `(d-0.055)/0.033` (`route_gen.py:191-205`). strm görünümü kalibreli: `PM_CIZGI=1, PM_BINA=246, PM_YOL_TON=180` (`pmtiles_okuyucu.py:270-276`). **strm rasterinin renk/kalınlık kalibrasyonu değişirse kentsel tespit eşiği bozulur** — kalibrasyon sabitleri sözleşme eki olmalı.

### B7 — Map Matching / yola oturtma (ZORUNLU + bugün YARALI)
- **Yol:** `GET /matching/v5/mapbox/{profil}/{lon,lat;…}?geometries=geojson&overview=full&tidy=true&radiuses=32;…` (timestamps bilinçli GÖNDERİLMEZ — `render-worker/scripts/route-video.py:309-310`).
- **Tüketiciler + dilimleme:** render-worker 100 nokta/dilim, 99 adım (`route-video.py:304-331`, 3 retry, oturmayan dilim ham köprü); `movelog-cloud.py:182-207` aynı 100'lük sözleşme (bulut hattı ön-eşleme); backend `main.py:_yol_esle` 80/79 (canlı doğrulandı bu ölçümde: `main.py` ~904-942, önek `config.env:29`); eski `scripts/route-video.py:166` tek 100'lük dilim; **🔴 TAKTİK (itiraz turunda bulundu, sözleşmede YOKTU):** `kisisel-app/tactical/render_job.py:264-284` — 90 nokta/dilim + **12 nokta örtüşme**, dilim başına **2 yarıçap denemesi (22 m sıkı → 45 m geniş**, `confidence≥0.35`'te erken kabul), 5500 nokta tavanı → dilim başına 1-2 istek; QA aracı `_qa_render.py:151-163` — 90'lık dilim, radiuses=30. **radiuses serbest parametre olmalı** (tüketiciye göre 22/30/32/45).
- **Profil beklentisi:** tüketiciler `driving|cycling|walking` GÖNDERİYOR (`route-video.py:296-297`; `movelog-cloud.py:180`; `main.py` ort. hız → prof seçimi). **Mevcut proxy yalnız `driving` kabul ediyor** (`harita-proxy.py:675`; canlı: cycling/walking → 404) → yürüyüş/bisiklet izleri bugün SESSİZCE ham ize düşüyor. Sözleşmeye **3 profil de** yazılmalı (veya tüketiciler driving'e sabitlenmeli — karar: açık soru A6).
- **Yanıt biçimi beklentisi:** JSON `{"code":"Ok","matchings":[{"confidence":…,"geometry":{"type":"LineString","coordinates":[[lon,lat],…]}}]}`. Tüketilen alanlar: `code`, `matchings[].geometry.coordinates` **+ `matchings[].confidence` (itiraz turunda bulundu: taktik `render_job.py:279-282` confidence ile en iyi denemeyi seçer ve ≥0.35'te erken kabul eder — confidence kalkarsa/0 dönerse taktik yol-oturtma davranışı bozulur; proxy'nin OSRM yolu sabit 0.9 basıyor, `harita-proxy.py:795`).**
- **🔴 YENİ ÖLÇÜLMÜŞ UYUMSUZLUK (2026-08-30):** dilimleyen 6 tüketiciden 4'ü `d.get("code")=="Ok"` ŞART koşuyor (`render-worker/scripts/route-video.py:317`, `movelog-cloud.py:193`, `scripts/route-video.py:170`, `main.py:936`), ama mevcut proxy'nin Mapbox-kapalı (fiili) yolu **`code` alanı DÖNDÜRMÜYOR** (`harita-proxy.py:795-800`: yalnız `{"matchings":[…]}`). Ölçüm: önbellekteki **157 matching yanıtının 0'ında `code` var** (`/opt/matrix/harita-cache/static/match/`, grep; 30.08 canlı driving isteği de code'suz döndü — tekrar doğrulandı). **İki taktik tüketici (`render_job.py:277`, `_qa_render.py`) code'a bakmadan `matchings` ile çalışıyor** — yani bugün yol-oturtma fiilen YALNIZ taktik hatta çalışıyor, 2D/3D/bulut/backend hatları ham ize düşüyor olabilir. **Geçişte ya ortak katman `"code":"Ok"` ekler (önerilen) ya da code şartlı 4 tüketici düzeltilir** — ikisi birden değil, tek karar (açık soru A5). Uyum testi T4/T5 bunu doğrular.
- **Davranışsal sözleşme:** çıktı ~20 m eşit aralıklı yeniden örneklenmiş SÜREKLİ çizgi (`harita-proxy.py:776-794`) — kamera yumuşatıcısı sabit-pencere (WINs) bu aralığa kalibre; örnekleme kalkarsa "kamera bir anda dönüyor" regresyonu geri gelir (kanıt zinciri `harita-proxy.py:697-719`). Boş sonuç `{"matchings":[]}` biçiminde (404 değil).

### B8 — Reverse Geocoding (gerekli, hata-toleranslı)
- **Yol:** `GET /geocoding/v5/mapbox.places/{lon},{lat}.json?types=poi,neighborhood,locality,place&limit=1&language=tr` — `render-worker/scripts/route-video.py:470-473` (3D dwell adı); `route_gen.py:233` (şehir/mahalle etiketi); `activity-detect.py:30` (**`types=country` özel modu**, `harita-proxy.py:334,347-350`).
- **Yanıt (minimal sözleşme):** tüketilen alanlar SADECE `features[0].text` + `context[].id` (`place*/region*`) + `context[].text` (`harita-proxy.py:309-310`). Türkçe ad beklenir. Canlı ölçüldü (Karaköy → "Kemankeş Karamustafa Paşa"/"Beyoğlu").
- Hata → boş string, video ölmez (`route-video.py:475`). Hacim: 0-5 istek/video (dwell = ~40 m içinde ≥70 sn — `route-video.py:459-467`).

### B9 — /yukseklik (gerekli — 3D kabartma/bina yüksekliği bağlamı)
- **Yol:** `GET /yukseklik?bbox=minlon,minlat,maxlon,maxlat&n=160` — `render3d.js:57` (rota bbox ±0.02°).
- **Yanıt:** `{"n","bbox","grid","kule"}`; grid = GHS-BUILT-H ANBH 100 m örneklem; `kule` KALICI BOŞ (birebir bina yüksekliği MVT `buildings.height`'ta — `harita-proxy.py:590-598,647-651`). Cache-Control 7 gün. Canlı doğrulandı (İstanbul bbox → gerçek grid).
- Hacim: 1 istek/3D video.

### B10 — Kimlik / erişim
- **Motor uçları** (matching, geocoding, static): **gizli yol öneki** `/24579d9db6c7c001/` = capability-URL tarzı paylaşılan sır (kripto kimlik değil) — nginx `cf-harita:27-31`, `cf-kisisel-api:28-34`. Kaynak: `/opt/matrix/secrets/harita-uc.conf` + backend `config.env:29`; ⚠️ render-worker **v140 imajında varsayılan olarak GÖMÜLÜ** (`render-worker/scripts/route-video.py:34`; RunPod template env'inde `HARITA_UC` YOK — cephe-1 GraphQL ölçümü). Önek değişirse **yeni imaj build + template PATCH şart**, env ile ezmek de mümkün (`HARITA_UC`/`HARITA_TABAN`/`DEM_TABAN`).
- **🔴 YEREL TÜKETİCİLER (itiraz turunda bulundu — sözleşmede eksikti):** sunucu-üstü tüketicilerin çoğu katmana alan adından DEĞİL, **sabit `http://127.0.0.1:8890`** üzerinden, **öneksiz ve env'siz** bağlanır: `movelog-cloud.py:187`, `activity-detect.py:30`, taktik `route_gen.py:63,171,201,233`, `intro_gen.py:22`, `outro_gen.py:32`, `render_job.py:273`, `_qa_render.py:155` (grep ile sayıldı, 9 çağrı noktası). Katman bu makineden ayrılırsa bu dosyalarda **kod değişikliği veya yerel bir forwarder ŞART** (env yolu yok). Backend `main.py:932` de alan adını kodda sabit tutar (yalnız önek config'ten).
- **Anonim açık uçlar:** `/xyz/ /mvt/ /yukseklik /saglik` (cf-harita:7-43; gerisi 404). Karolar öneksiz — CDN cache'lenebilirliği için böyle kalmalı.
- **`access_token` parametresi:** tüketiciler eski Mapbox biçimiyle gönderir, katman **yutup yok saymalı** (`route-video.py:27-30`: token "yok" bile olabilir).
- **CORS ZORUNLU:** `Access-Control-Allow-Origin: *` + `Cross-Origin-Resource-Policy: cross-origin` — yoksa WKWebView/WebGL (telefon 3B motoru + headless chromium) karo çekemez, **video bembeyaz çıkar**; curl ile fark edilmez (`cf-harita:11-13` /xyz, `:20-21` /mvt CORP — MVT'nin ACAO'sunu proxy verir `harita-proxy.py:579,585`; `cf-kisisel-api:8-11,33`). Karolar için zorunlu; statik/matching/geocoding'i yalnız sunucu-yanı istemciler (python/PIL) çektiği için orada CORS aranmaz (bugün de yok — canlı ölçüm).
- **JWT/premium kapısı** yalnız `/motor3d`'de — o harita verisi değil (Bölüm 2'ye taşınıyor).

### B11 — Önbelleklenebilirlik
- **Beklenen başlıklar:** karolar `Cache-Control: public, max-age=2592000` (+`immutable`) — /xyz nginx'ten (`cf-harita:10-13`), /mvt nginx+proxy'den (`cf-harita:19-21`, `harita-proxy.py:586`); `/yukseklik` 7g (`harita-proxy.py:612,661`). **⚠️ DÜZELTME (canlı GET, 2026-08-30): STATİK yanıtta Cache-Control/ACAO YOK** — proxy `_send` başlık eklemez (`harita-proxy.py:389-394`), CF'te `cf-cache-status: DYNAMIC` → **her statik istek origin'e iner**. Bu bugünkü fiili durum; ortak katman statiğe 30g başlık EKLERSE sorun değil (statik URL'ler koordinat-deterministik), ama "statikte de 30g var" varsayımıyla kapasite planlanMAmalı. Karolar **immutable varsayılır** — motor aynı karoyu asla yeniden doğrulamaz; CF turuncu bulut 30g cache ile tekrar eden karo origin'e HİÇ gelmez (MISS→HIT kanıtı `render3d.js:44-45`).
- **Move Log'un origin yükünü taşınabilir kılan şey bu**: paralel segment worker'ları aynı karoları ayrı ayrı ister (`render3d.js:516-520,652`), mükerrerleri CDN keser.
- İç önbellek (5.3 GB, LRU, `/opt/matrix/harita-cache`) katmanla birlikte Hooder'a geçer — Move Log'un beklediği yalnız BAŞLIKLAR.

### B12 — Hacim (ölçülmüş) + sağlık
- **Video başına:** 3D render ≈ **13.000 benzersiz karo / ~15.000 karo isteği** (`harita-proxy.py:107-109` V125 vakası; `:522-523` "~13.000 ölçüldü") + MVT (şehir rotasında yüzlerce; harman deposu toplam 1.026 dosya) + 1 `/yukseklik` + 0-5 geocoding + ⌈(N−1)/99⌉ matching (bulut hattında video başına 1 ön-eşleme). 2D video: **1 statik** + matching. **Taktik video (itiraz turunda kodla yeniden sayıldı — eski "birkaç statik" EKSİKTİ):** 1 bbox mozaik (1280x1280@2x) + intro **9 statik** (3 şehir z9 + 3 şehir z13 + kendi nokta z15/z16/z17 — `intro_gen.py:28-31`) + outro **13 statik** (z17→z5 kademeleri — `outro_gen.py:34-35` `ZLVL=range(17,4,-1)`) + route_gen yakın-plan 1280x1280@2x karoları (rota uzunluğuna göre onlarca, 12-worker paralel — `route_gen.py:173-186 _dtiles_par`) + 512'lik ölçüm rasterleri + geocoding + **matching ⌈N/90⌉ dilim × 1-2 yarıçap denemesi** (5500 nokta tavanında en çok ~62 dilim ≈ 124 istek — `render_job.py:261-282`). Yani taktik video statik uca **onlarca-yüz istek** bindirir ve statik bugün CDN-cache'siz (B11) → hepsi origin'e iner.
- **Günlük gerçek yük (origin'e ulaşan; cephe-3 + itiraz turu 30.08 tekrar sayımı):** son 24 saat 3.741 yeni önbellek dosyası (cephe-3: 3.422), son 7 gün 63.096 (cephe-3: 59.063 — aynı gün daha erken; önbellek yazımı = başarılı dış istek); nginx dün 6.354 `/xyz` / bugün 3.280 `/xyz` + 3 `/mvt` (CF miss'leri; cephe-3'ün 6.364/3.275'iyle uyumlu — doğrulandı). **Tepe:** eşzamanlı 2-3 render günü ≈ 30-45k karo isteği; CDN+iç önbellek sonrası origin'e inen bunun küçük kesri. **Tepe notu:** Ultra kısa-rota 3D'ler normalde Google 3D hattında (Bölüm 2) — Google hattı ölürse (`GOOGLE_3D_OLU=1` vakası, `route-video.py:586,616-620`) bu videolar da ANİDEN ortak katmana biner; kapasite bu düşüş senaryosuna göre düşünülmeli.
- **Dış kaynak freni (bilgi):** Esri'ye jeton kovası 20 istek/sn + 60 patlama (`harita-proxy.py:112-115`); Nominatim 1.1 sn global (`:328-332`); OSRM dilim arası 0.12 sn. Hooder eşdeğer frenleri kendi belirler (açık soru A3).
- **/saglik:** `{"ok","kaynak","katman"}` (`harita-proxy.py:503-509`) — izleme scriptleri kullanıyor; eşdeğer bir sağlık ucu istenir.

---

## 2) MOVE LOG TARAFINDA KALANLAR (harita verisi OLMAYAN hesaplar)

| Kalan iş | Gerekçe (neden harita katmanı değil) | Yeni evi | Kanıt |
|---|---|---|---|
| Rota→piksel projeksiyonu (`w_xy`, `ws=512·2^z`, PAD, zoom seçimi `zx/zy`, CAMZ kademeleri) | Videoya özgü kadraj matematiği; katman yalnız görüntü verir | **Render motoru içi** (route-video.py / route_gen.py) | `render-worker/scripts/route-video.py:660-681`, `route_gen.py` |
| Kamera koreografisi, dwell tespiti (40 m/70 sn), zoom kademeleri, karo hata sayacı/exit(7) | Tamamen render davranışı | **Render motoru içi** | `route-video.py:459-467,520-534`, `render3d.js:95-99,590-596` |
| Kentsel yoğunluk ölçümü `_road_density` (mühürlü `(d-0.055)/0.033`) | Ölçüm ALGORİTMASI bizde; yalnız strm rasterini tüketir (B6) | **Taktik motor içi** — ama strm kalibrasyon sabitleri sözleşme eki | `route_gen.py:191-205` |
| **Matching dilimleme/dikiş/~20 m örnekleme algoritması** | Harita verisi değil, GPS işleme; bugün proxy İÇİNDE duruyor (OSRM'e karşı, `harita-proxy.py:723-794`) | **Karara bağlı (açık soru A4):** matching'i ortak katman verirse algoritma Hooder'a geçer; vermezse **movelog-api'ye** taşınır (proxy'den sökülür) | `harita-proxy.py:675-806` |
| `/motor3d` (telefon yedek üretim yolu: JWT + premium kapısı + spec üretimi) | Harita verisi değil; proxy'de durması "tamamen tarihsel/pratik" (cephe-3) | **movelog-api / backend** (`kisisel-api` nginx zaten oraya yönlendiriyor) | `harita-proxy.py:396-500`, `cf-kisisel-api:38-45`, `WebRouteVideo.swift:115` |
| Backend `/api/track` + `_yol_esle` (25 m seyreltme, hız→profil, 80'lik dilim) | GPS izi Move Log verisi; matching'in yalnız TÜKETİCİSİ | **movelog-api** (zaten orada) | `main.py:859,904-942` |
| Street View pano hattı | Tamamen Google API + R2 önbelleği; harita ucunu hiç kullanmıyor (grep: 0) | **Render motoru içi** | `render-worker/scripts/streetview.py:47,133-147` |
| DEM arazi (AWS terrarium) + glyph (openmaptiles) | Harita katmanımızdan değil, kamu uçları | **Render motoru içi** (env ile ezilebilir) | `render3d.js:62,67` |
| **Google Photorealistic 3D Tiles hattı (itiraz turunda eklendi — sözleşmede hiç yoktu)** | Ultra kısa-rota 3D videoların ANA zemini Google/Cesium; harita katmanını HİÇ kullanmaz (kendi GKEY'i, `route-video.py:35-40`); ama ölürse MapLibre+ortak katmana düşer → B12 tepe notu | **Render motoru içi** (`render-google3d.js`) | `route-video.py:188,543,605-620`, `rp_handler.py:145-157` |
| Taktik landmark fotoğrafı (Commons/Openverse) | Dekoratif dış içerik, harita verisi değil; hata yutulur | **Taktik motor içi** | `render_job.py:118-167` |
| Bulut/işleme zinciri: fanout `matched=1`, RunPod dispatch, R2 | Video orkestrasyon | **movelog-cloud / rp_handler** | `movelog-cloud.py`, `rp_handler.py:67` |
| activity-detect ülke tespiti | Reklam analitiği; geocoding'in tüketicisi | **Move Log scripti kalır**, B8'i tüketir | `activity-detect.py:30` |
| iOS canlı harita + cihaz-yerel video zemin görüntüsü | Apple MapKit/MKMapSnapshotter — harita katmanını KULLANMIYOR (tüm Sources grep: 0) | değişiklik yok | `MapTab.swift:2`, `LocalRouteVideo.swift:104-130`, `Store.swift:598-599` (yalnız `/api/track` dolaylı) |
| `/api/mapconfig` + `map-config.json` | Uç var ama tüketen istemci 0 satır ("app 1.59+" notu, bağlanmamış) | **movelog-api'de bekler**; ortak katman URL'i belli olunca güncellenecek "gelecek tüketici" | `main.py:1878`, `/opt/movelog/data/map-config.json` |

**Katmanla birlikte Hooder'a GEÇENLER** (Move Log'da kalmaz): kaynak zinciri (Esri/EOX/sat_cache), Esri boş-karo md5 tespiti, üst-zoom yedeği, jeton kovası, LRU disk önbelleği, PMTiles okuyucu + MVT bina harmanı, GHS GeoTIFF'leri, Nominatim/OSRM entegrasyonları (A4-A5 kararına bağlı), `harita-kaynak.json` canlı config düzeni.

---

## 3) AÇIK SORULAR — Hooder tarafı haber verince netleşecek

- **A1 — Ortak katmanın URL'i:** `harita.nickdegs.com` kalıyor mu, yeni domain mi? CF turuncu bulut + 30g immutable cache düzeni (B11) yeni yerde korunacak mı? (v140 imajında taban URL gömülü — değişim = env PATCH veya v141 build, B10.)
- **A2 — Kimlik şeması:** gizli önek (capability URL) devam mı, token/başlık mı? Karolar anonim kalmalı mı (CDN cache'i için evet deriz)? `?k=premium|ultra` katman adları ve zoom tavanı politikası (17/18) kimin kararı olacak? Yerel `.aktif-katman` dosyası düzeninin (yalnız yerel taktik render, `tac_dispatch.py` yazar) ortak katmanda karşılığı ne?
- **A3 — Rate limit:** Hooder bize uç başına ne sınır verecek? Referans yükümüz B12'de (tepe ~30-45k karo/gün, origin'e inen ~3-6k/gün). Aşımda davranış ne olacak (429 mu, kuyruk mu)? — 429, karo hata sayacını (>400→exit 7) tetikler, bilinmeli.
- **A4 — Matching + geocoding ortak katmanda mı?** Bunlar harita "verisi" değil dış servis entegrasyonu (OSRM + Nominatim). Katman veriyorsa: 3 profil (B7) + `code:"Ok"` + ~20 m örnekleme + `{"matchings":[]}` boş-biçimi + geocoding minimal alanları sözleşmeye girer. Vermiyorsa: mevcut algoritmalar proxy'den **movelog-api'ye** taşınır ve bu uçlar sözleşmeden düşer.
- **A5 — `code:"Ok"` uyumsuzluğu kim düzeltir:** ortak katman mı ekler (önerilen; tek satır), yoksa code şartlı 4 tüketici mi güncellenir? (B7'deki ölçülmüş bulgu — bugün 157/157 önbellek yanıtı code'suz; taktik 2 tüketici code'suz zaten çalışıyor.)
- **A6 — cycling/walking:** katman 3 profili gerçekten destekleyecek mi (OSRM profilleri), yoksa Move Log tüketicileri driving'e mi sabitlenecek? (Bugün yürüyüş/bisiklet videoları yola oturmuyor — sessiz düşüş.)
- **A7 — PMTiles kapsamı:** vektör arşiv z kaç'a kadar yerli? (Bizim mevcut okuyucu z0-15 yerli + üstü over-zoom, `pmtiles_okuyucu.py`; memory'deki "arşiv z10'da bitiyor" notu raster arşiv planına ait görünüyor — Hooder alanı okunamadığı için doğrulanamadı.) z13-15 bina harmanı (OSM+Microsoft, feature id+height) ortak katmanda birebir sürecek mi? — `render3d.js` fill-extrusion buna kalibre.
- **A8 — strm ölçüm rasteri:** `streets*`→strm eşlemesi ve kalibrasyonu (PM_CIZGI=1/PM_BINA=246/PM_YOL_TON=180) Hooder üretiminde birebir korunacak mı? Korunmazsa taktik kentsel-tespit eşiği (`route_gen` mühürlü sabiti) yeniden kalibre edilmek zorunda.
- **A9 — /yukseklik:** GHS GeoTIFF'leri katmana geçince uç ve `{"grid","kule":boş}` biçimi aynen kalacak mı?
- **A10 — Statik uç:** iki biçim de (merkez + bbox/fit) verilecek mi? Bilhassa **512·2^z sabiti (B4) yazılı taahhüt** olarak isteniyor — "Mapbox-uyumlu @2x" (1024·2^z) diye kurulursa tüm 2D/taktik videolar kayar.
- **A11 — 204/404 politikası:** MVT'de 204 (B2) ve XYZ tavan-üstü ebeveyn-kırpma (B1) korunacak mı; katman önünde CrowdSec benzeri bir IPS olacak mı (RunPod IP'leri whitelist/CF-üzerinden erişim — `route-video.py:31-33` dersi)?

---

## 4) UYUM TESTİ — geçiş günü çalıştırılacak somut liste

Sıra önemli; T1-T3 geçmeden render testine girilmez.

1. **T1 Ölçek deneyi (B4):** z=15 `128x128@2x` statik (merkez = z16 karonun coğrafi merkezi) ↔ z16 XYZ karo piksel karşılaştırması; ortalama mutlak fark **< 5/255** (referans ölçümler: 0.21/255 ve 1.39/255 — JPEG çift-kodlamayla oynar; yanlış-ölçek kontrol deneyi **64.8/255** verdi, ayrım net). 1024·2^z sapması burada anında yakalanır.
2. **T2 Eski/yeni statik piksel diff:** aynı koordinatta (İstanbul + kırsal 1 nokta) eski uç ve yeni uç statik görüntüsü, **üç zoom kademesinde** (z11 / z15 / z17), merkez + bbox biçimlerinin ikisinde; diff eşiği: kaynak görüntü farkı dışında geometrik kayma 0 px.
3. **T3 Başlık kontrolü:** ⚠️ **HEAD kullanma** — mevcut proxy HEAD'e 501 döner (canlı ölçüldü 30.08), `curl -s -o /dev/null -D -` (GET) ile bak. /xyz → `Access-Control-Allow-Origin: *`, `Cross-Origin-Resource-Policy`, `Cache-Control: public, max-age=2592000` (+immutable); /mvt → aynı CC + ACAO + doğru Content-Type; ikinci istekte CF `HIT`. **Statik için başlık BEKLEME** (bugün yok — B11); ortak katman eklerse bonus. (CORS eksiği curl'de video bozmadan görünmez — bu yüzden T7 de şart.)
4. **T4 Matching biçimi:** driving isteği → 200 + `code:"Ok"` (A5 kararına göre) + dolu `matchings[0].geometry.coordinates` + **dolu `matchings[0].confidence`** (taktik erken-kabul eşiği 0.35 buna bakar — B7); radiuses 22/30/32/45 hepsi kabul; cycling/walking → A6 kararına uygun davranış; oturmayan iz → `{"matchings":[]}` (404 değil); aynı istek ikinci kez → önbellekten aynı yanıt.
5. **T5 Örnekleme yumuşaklığı:** bilinen 200 noktalı test izi → çıktı noktaları arası mesafe histogramı ~20 m'de yoğunlaşmalı; >60° kırılma sayısı referans değerin (ham 45) altında — "kamera bir anda dönüyor" regresyon bekçisi.
6. **T6 MVT:** okyanus karosu → **204** (404 DEĞİL); İstanbul z14/z15 → 200 + `application/vnd.mapbox-vector-tile` + `buildings` katmanında `height/min_height/id`; z13 sentez karosu boş değil.
7. **T7 Uçtan uca 3 render:** (a) 1 gerçek 3D render (şehir rotası, kabartma=1) — beyaz/siyah kare yok, binalar yükseliyor, karo hata sayacı exit(7) tetiklenmiyor; (b) 1 flat/flyover 2D — **70/70 rota-karada testi**: bilinen kıyı rotasında çizginin tamamı karada (08-28 "sürüş denizde" regresyonu); (c) 1 taktik video — TEK MOZAİK bbox fit'inde rota-yol hizası (ızgara kayması yok).
8. **T8 XYZ tavan davranışı:** `?k=premium` ile z18 istek → 200 + ebeveynden kırpılmış görüntü (siyah karo YOK); `?k=ultra` z18 → gerçek karo; z2 (dünya finali) → 200.
9. **T9 /yukseklik:** İstanbul bbox `n=160` → dolu `grid`, `kule` boş; render3d YUK_URL biçimiyle.
10. **T10 Geocoding:** Karaköy → `features[0].text` Türkçe POI/mahalle + `context` place; `types=country` → ülke (activity-detect modu).
11. **T11 Kimlik:** doğru önek/kimlikle motor uçları 200; öneksiz `/matching…` → 404; anonim `/xyz` → 200.
12. **T12 Yük/limit:** 60 sn'de ~2.000 karo çekimi (tek render simülasyonu, `render3d` deseninde) → 429/ban YOK, süre regresyonu < %20; ardından `/saglik` (veya eşdeğeri) OK.

**Geri dönüş planı (itiraz turunda DÜZELTİLDİ):** env ile ezilebilenler yalnız RunPod hattı — `route-video.py:34` (`HARITA_UC`), `render3d.js:48` (`HARITA_TABAN`), `render3d.js:62` (`DEM_TABAN`); v140 gömülü varsayılanlar için template env PATCH yeter. **Ama sunucu-üstü 7 dosya (movelog-cloud, activity-detect, taktik 5'lisi — B10 yerel tüketiciler listesi) taban URL'i `127.0.0.1:8890` olarak KODDA sabit tutar, env yolu YOKTUR** → oralarda geri dönüş = kod değişikliği geri alma ya da 8890'ı dinleyen yerel forwarder. Backend `main.py:932` domain'i de kodda sabit. "Dakikalar süren dönüş" yalnız RunPod hattı için doğrudur.
