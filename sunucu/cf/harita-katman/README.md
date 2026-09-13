# cf-harita-katman — Harita Katmanı Worker'ı

**Durum (2026-08-31):** CANLI. `harita.nickdegs.com/{ONEK}/{matching,styles,geocoding}/*`
route'ları bağlı + `https://harita-katman.daclen10.workers.dev` açık.
Karar ve gerekçeler: `KARAR.md`. Sözleşme: `/opt/matrix/docs/HARITA-TUKETIM-SOZLESMESI.md`.

## 31.08 — SUNUCUSUZLAŞTIRMA

Barış: *"haritayı da hallet, sunucu kapansa bile çalışıp kendini onaracak şekilde."*
Devirden çıkan hâlde statik + geocoding origin'e forward ediliyordu; harita-proxy 30 sn
durdurulduğunda **statik 502 · geocoding 502 · /harita/ 502 · /xyz 502** ölçüldü.
Bugün kaynak zincirleri public'e alındı ve origin **opsiyonel yedeğe** düşürüldü.

| Uç | Kaynak | Sunucu gerekir mi? | Sunucu kapanınca |
|---|---|---|---|
| `/{ONEK}/matching/v5/mapbox/*` | OSRM (public) + Cache API → R2 | **HAYIR** (zaten yoktu) | değişmez |
| `/{ONEK}/xyz/{sat\|str}/{z}/{x}/{y}.jpg` | Esri → Hooder `/sat` (z≤14) → EOX (z≤14) | **HAYIR** | **değişmez** |
| `/{ONEK}/mvt/{z}/{x}/{y}.mvt` | z0-12 Hooder `/vt`; z13-15 origin harmanı, yoksa Hooder | **HAYIR** | bina seyrekleşir (5.353→586/z14), boşalmaz |
| `/{ONEK}/yukseklik?bbox=` | Cache API → **R2 (kalıcı)** → origin → sıfır-grid | **HAYIR** | önbellekteki bbox aynen; yenisi sıfır-grid (fail-soft) |
| `/{ONEK}/geocoding/v5/mapbox.places/*` | Nominatim → Esri reverse (yedek) | **HAYIR** | değişmez |
| `/{ONEK}/styles/v1/*` (statik) | RASTER dikiş → **motor içi yan-servis** | 501 + açıklama | 501 + açıklama |
| `/saglik` · `/saglik?tam=1` | Worker | HAYIR | teşhis verir |

**Kendini onarma mekanizmaları**
1. **Kaynak zinciri** — bir kaynak ölünce sıradaki devralır (Esri→Hooder→EOX).
2. **Esri gri "veri yok" karosu tespiti** — 2521 B + md5 `f27d9de7f80c`; o kaynak atlanır.
   (`crypto.subtle.digest("MD5")` Workers'da DESTEKLENİYOR — ölçüldü, Python birebir taşındı.)
3. **Üst-zoom yedeği** — istenen zoom'da görüntü yoksa en fazla 4 kademe yukarı çıkıp
   ebeveynin çeyreği kırpılır (CF Image Resizing). Bulanık ama gerçek görüntü.
4. **⚡ Devre kesici** (`src/origin.js`) — origin arızasında 60 sn susturulur. Bir 3B render
   ~13.000 karo çeker; her karoda TCP zaman aşımı beklemek render'ı öldürür (V125-ULTRA dersi:
   619 adet nginx 499 → beyaz video). **ÖLÇÜLDÜ:** origin erişilemezken `/mvt` 1. istek 1,63 sn,
   2.-6. istekler **0,08-0,10 sn**. Sunucu dönünce 60 sn sonra kendiliğinden yeniden denenir.

   ⚠️ **"YAVAŞ" ≠ "ÖLÜ"** — ilk yazımda her zaman aşımı kesiciyi açıyordu; 10 taze z14 karosu
   ölçüldüğünde origin'in `mvt_bina.harman` **soğuk sentezi 1,5-5,8 sn** sürdüğü, 5 sn'lik
   zaman aşımının karoların **%20'sinde** kesiciyi açtığı ve SAĞLIKLI sunucuya rağmen 60 sn
   boyunca Hooder'ın seyrek binalarının (586 vs 5.353) servis edildiği görüldü — sessiz kalite
   kaybı. Düzeltme: `/mvt` origin zaman aşımı 20 sn + kesici yalnız **hızlı** hatada
   (DNS/connect/5xx = gerçekten ölü) ANINDA açılır, zaman aşımında **üst üste 3** kez ister.
   Düzeltme sonrası 12/12 karo origin'den geldi.
5. **Katmanlı önbellek** — Cache API (kenar) + R2 (kalıcı, tüm kenarlar). Geocode ve yükseklik
   R2'de kalıcı: bir kez hesaplanan sonuç sunucu sonsuza dek kapansa bile yaşar.
6. **Fail-soft** — `/yukseklik` sıfır grid ile 200 döner; `render3d.js:100-135` zaten
   `v > 0.5` değilse `null` dönüp karo `height`'ına / id-hash yedeğine düşüyor → video ölmez.

### KV ile deploy'suz kumanda (`HARITA_AYAR`)

| Anahtar | Varsayılan | Ne yapar |
|---|---|---|
| `statik_mod` | `origin` | `501` yazılınca statik uç origin'e hiç dokunmaz, doğrudan 501 döner. **Motor yan-servisi canlıya çıkınca bunu yaz.** |
| `mvt_kaynak` | `origin-once` | `yalniz-hooder` = tam sunucusuz mod (z13-15 de Hooder'dan, z16 → 204). |
| `geo_kaynak` | `nominatim` | `esri` = Nominatim'i tamamen atla (kalıcı 429 durumunda). |
| `origin_yedek` | `1` | **ANA ŞALTER.** `0` → hiçbir uç origin'e dokunmaz. Sunucu kalıcı kapanınca tek yazım. |
| `osrm_urls` | `["https://router.project-osrm.org"]` | CF çıkış IP'leri OSRM'de kısıtlanırsa buradan değişir. |
| `profiller` | `["driving"]` | A6: cycling/walking → 404 (bugünkü davranış). |
| `match_ttl_gun` | `30` | Match önbellek TTL'i. |

```bash
KV=7e558455c099483abb87a2afbffca190
wrangler kv key put --remote --namespace-id $KV statik_mod '501'     # --remote ŞART (wrangler 4 varsayılanı YEREL)
```

### ⚠️ statik neden bugün hâlâ 501 DEĞİL

Statik = N×M karonun birleştirilip kırpılması (RASTER). Worker'da PIL yok, WASM 128 MB
sınırında elendi, CF Image Resizing tek görüntüyü dönüştürür — mozaikleyemez. Karar
(TASARIM §2a): dikiş çekirdeği **motor imajına yan-servis** olarak konur, konteyner içinde
`127.0.0.1:8890` dinler. `route_gen.py:13` varsayılanı **zaten** `http://127.0.0.1:8890` →
RunPod `movelog-tactical` template'inden `HARITA_TABAN/HARITA_STATIK` env'lerini **kaldırmak
yeter**; mühürlü dosyanın kod yolu tek karakter değişmez (512·2^z, bbox fit, LANCZOS,
JPEG q87/q92 aynı kod; imajda Pillow 12.3.0 pinli → çıktı birebir).

**Ama bugün koşulsuz 501 basmak CANLI RENDER'I ÖLDÜRÜR:** ölçüldü 31.08, template
(`egptl6t4pr`) hâlâ `HARITA_STATIK=https://harita.nickdegs.com/{ONEK}` diyor ve bu uca bugün
**1.104 istek** geldi (`Python-urllib` = taktik motor, gerçek üretim trafiği). Bu yüzden
davranış KV ile seçiliyor. Sıra: **① yan-servis imaja girer ② template env'leri silinir
③ `statik_mod=501`.** Geri alma da aynı yerden, saniyeler içinde.

### 🔴 /xyz /mvt /yukseklik ROUTE'U BİLEREK EKLENMEDİ

**Ölçüm 31.08:** `harita.nickdegs.com/xyz/`'e gelen 4.510 isteğin ~4.400'ü **Hooder'ın oyun
istemcileri** (`Hooder/2.4 MapLibre… iOS`, `app.realvirtuality.landlord… Android`). Çıplak
`/xyz/` route'unu claim etmek Hooder'ın oyun haritasını öldürür → **oturum sınırları gereği
YASAK.**

**Önekli** yol (`/{ONEK}/xyz/*`) Hooder'ı etkilemez — ama route eklemek TEK BAŞINA yetmez:
`render3d.js:57-60` bugün **çıplak** yolu kullanıyor (`HARITA_TABAN=https://harita.nickdegs.com`).
İkisi birlikte yapılır ve **Barış onayı ister**:
1. `movelog-render` RunPod template'inde `HARITA_TABAN` → `https://harita.nickdegs.com/{ONEK}`
   (ya da `https://harita-katman.daclen10.workers.dev/{ONEK}`)
2. Zone'a 3 route: `/{ONEK}/xyz/*`, `/{ONEK}/mvt/*`, `/{ONEK}/yukseklik*`
   (hazır satırlar `wrangler.toml.example` içinde yorumlu duruyor)

O ana kadar bu üç uç **yalnız workers.dev'den** servis edilir; `harita.nickdegs.com/{ONEK}/xyz`
hâlâ origin'e (nginx→harita-proxy) gider.

### Ölçülen origin kusurları (worker'ın kapattığı)

| Kusur | Origin | Worker |
|---|---|---|
| `OPTIONS /{ONEK}/xyz/...` | **501** → MapLibre ön-uçuşu düşer, beyaz kare | **204** + ACAO |
| `/{ONEK}/mvt/...` ACAO | **ÇİFT** `Access-Control-Allow-Origin` (nginx + proxy) → tarayıcı çoklu değeri geçersiz sayar | tek başlık |
| statik `Cache-Control` | yok | 30 g immutable (B11 bonus) |

## Kaynak dosyaları

| Dosya | Rol |
|---|---|
| `src/index.js` | yönlendirici + önek denetimi (T11) + CORS ön-uçuş + `/saglik?tam=1` teşhisi |
| `src/kaynak.js` | public karo kaynakları, Esri boş-karo tespiti, CF Image Resizing kırpma, ortak başlık/önbellek |
| `src/karo.js` | `/xyz` — `harita-proxy.py:511-544` + `_tile` portu |
| `src/mvt.js` | `/mvt` — 204 kuralı + Hooder/origin kaynak seçimi |
| `src/yukseklik.js` | `/yukseklik` — Cache API → R2 → origin → sıfır-grid |
| `src/geokod.js` | B8 geocoding — `_geocode` portu, Nominatim + Esri yedeği |
| `src/statik.js` | `/styles` — KV'li origin/501 |
| `src/origin.js` | **opsiyonel yedek** origin erişimi + devre kesici |
| `src/matching.js` | B7 map matching (değişmedi; yalnız CORP başlığı eklendi) |
| `src/cache.js` | KV ayarları + katmanlı match önbelleği |

## Testler

```bash
node test/uyum-test.mjs --birim                                    # saf birim (ağ yok)
ONEK=… BASE=https://harita-katman.daclen10.workers.dev node test/uyum-test.mjs   # TAM takım
ONEK=… BASE=https://harita.nickdegs.com          node test/uyum-test.mjs   # route'lu 3 uç
```

**Ölçüm 31.08 (deploy sonrası):**
- workers.dev → **60 geçti / 0 kaldı** (11 birim + T4/T5/T11 + statik forward + 24 yeni uç testi)
- harita.nickdegs.com → 53 geçti / 7 kaldı — **yedisi de "route yok" göstergesi**, kusur değil:
  `/saglik`, `/xyz` X-Kaynak, `/mvt` ACAO (çift), 3× öneksiz-404, `OPTIONS` 501. Route eklenince
  hepsi yeşile döner.
- `test/devir-testi.py` (Python+PIL) — eski↔yeni uç piksel karşılaştırması, değişmedi.

## Kalan iş (bu worker'ın dışında)

1. **Motor yan-servisi** (GÖREV B) → sonra `statik_mod=501`.
2. **`mvt_bina.py` JS portu + Microsoft binaları R2'ye** — z13-15'i de sunucusuzlaştırır.
   Boyut ölçüldü: 720.605 satır ama yalnız **5.945 farklı z15 karosu** (147 MB SQLite) →
   `ms/{x15}_{y15}.json` olarak 5.945 R2 nesnesi. Bitene kadar origin "opsiyonel üstünlük".
3. **GHS-BUILT-H'ın R2'ye ön-pişirilmesi** — `/yukseklik` grid'ini sıfır kayıpla sunucusuzlaştırır
   (41 MB GeoTIFF; kenarda GeoTIFF çözücü olmadığı için ham uint8 ızgara olarak yazılmalı).
4. **Route + `HARITA_TABAN`** kararı (yukarıdaki kırmızı blok) — Barış onayı.

## Bilinçli farklar (bugünkü proxy'ye göre)

- `code:"Ok"` dolu matching yanıtlarına EKLENİR (A5); boş biçim code'suz kalır (bayt-birebir).
- Boş match sonucu **önbelleğe yazılmaz** (Python 30 gün boş sonucu diske yazıyordu).
- Statik/karo yanıtlarına `Cache-Control` 30 g + ACAO + CORP eklenir.
- Tavan üstü karo kırpması PIL LANCZOS değil **CF Image Resizing** → z18/z19'da piksel-birebir
  değil (sözleşme T1 z15↔z16 ölçeğine dokunmaz; kırpma geometrisi ölçüldü: merkez piksel
  ham z18 `(60,76,63)` ↔ premium kırpma `(59,75,65)`).
- Kırpma yapılamazsa (Image Resizing arızası) katman tavanı yerine **gerçek zoom karosu**
  verilir: doğru görüntü > ürün ayrımı. `X-Kaynak: …+tavansiz` ile görünür.
- Geocoding artık worker içinde (Nominatim) — origin'e gitmez. `geocoding_forward` KV anahtarı
  okunmuyor (deploy.sh siliyor).

## Risk defteri

| Risk | Sigorta |
|---|---|
| CF çıkış IP'leri public OSRM/Nominatim'de engellenir | KV `osrm_urls`/`geo_kaynak` deploy'suz değişir + önbellek trafiği düşürür |
| Esri CF kenarından rate-limit yer | Cache API 30 g + R2; zincir Hooder/EOX'a düşer. ⚠️ Python'daki jeton kovası (20/sn) worker'da YOK — isolate başına global sayaç imkânsız (DO gerekir). Bugün ölçülen hacimde sorun değil, izlenmeli. |
| Hooder `/sat` `/vt` uçları kapanır/değişir | Bizim koda değil yalnız yayınlanmış HTTP uçlarına bağlıyız; kapanırsa `/xyz` Esri/EOX'la sürer, `/mvt` z0-12 origin'e döner |
| Nominatim 1 istek/sn politikası | Bugünkü hacim 65 istek/gün (ölçüldü) + Cache API 7 g + R2 kalıcı + 39 sıcak kayıt R2'ye kopyalandı |
| `statik_mod=501` erken yazılır | Canlı taktik render statik alamaz → KV'yi `origin`'e geri yaz (saniyeler) |
| Route eklenmeden HARITA_TABAN önekli adrese alınır | 404 → beyaz harita. İkisi AYNI ANDA yapılmalı |
