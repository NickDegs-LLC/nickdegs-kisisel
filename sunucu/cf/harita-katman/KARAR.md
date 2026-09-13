# KARAR — Harita Katmanı Tasarımı (yargıç turu)

**Tarih:** 2026-08-30 · **Yazan:** matrix oturumu (yargıç)
**Girdi:** 3 tasarım önerisi + keşif ölçümleri + HOODER-HARITA-DEVIR-HAZIRLIK.md + HARITA-TUKETIM-SOZLESMESI.md + harita-proxy.py (canlı kod doğrulaması yapıldı: matching algoritması :723-798, dilim=10/bindirme=2/radiuses=25 sabit/0.12 sn bekleme/~20 m örnekleme/confidence 0.9 — birebir teyit).

## SEÇİM: Tasarım 1 (basitlik-önce) TABAN + Tasarım 2'den iki alıntı

**Ana karar: "Worker = JSON, PIL = raster" ayrımı.**
- **B7 matching** → CF Worker'a GERÇEK PORT (tek yeni kod; sıfır raster, kanıtlı ≤13 alt-istek/çağrı).
- **B3-B5 statik + B6 strm** → Worker'dan origin'e (bu sunucudaki `harita-proxy.py`) **forward** + Cache API 30 g. Aynı PIL kodu üretmeye devam eder → 512·2^z sabiti, bbox fit kuralı ve strm kalibrasyonu (PM_CIZGI=1/PM_BINA=246/PM_YOL_TON=180) **yeniden yazılmaz**, T1/T2 riski yapısal sıfır.
- **Sunucuda değişen: HİÇBİR ŞEY.** 8890'daki 8 yerel çağrı noktası + mühürlü taktik dosyalar + RunPod v140 imajı dokunulmaz.

**Tasarım 2'den alınanlar:**
1. **KV `HARITA_AYAR`** — `osrm_urls` çalışırken değiştirilebilir (en büyük risk = CF çıkış IP'lerinin public OSRM'de kısıtlanması; anahtar-teslim geçiş KV'den, deploy'suz).
2. **Match önbelleği** — anahtar = SHA-256(profil + seyreltilmiş koordinatlar), Cache API → R2 → OSRM, TTL 30 g (rotalar deterministik; tekrar eden rota bedavaya iner, OSRM trafiği azalır = risk-1'in ikinci sigortası).

## ÖLÇÜT KARŞILAŞTIRMASI

| Ölçüt | T1 (basitlik) | T2 (performans) | T3 (devir-uyumu) |
|---|---|---|---|
| **Devir günü riski** | ✅ EN DÜŞÜK — raster aynı PIL kodundan; tek yeni parça matching (saf JSON) | ⚠️ orta — RunPod v141 imaj + template PATCH + wmax flush (bilinen tuzaklar) + stitcher kopyası sapma riski | 🔴 EN YÜKSEK — WASM 83-105 MB tepe / 128 MB sınır (400-karo tavanında AŞIYOR, ölçüldü); strm JS rasterizer'ın PIL'le piksel-paritesi KANITSIZ; Barış tam T1-T12 beklenmeyecek dedi → kanıtsız parite devire giremez |
| **Kod sahipliği (veri Hooder'ın, servis bizim)** | ✅ net — bağımsız Worker, Hooder kaynağına binding YOK; karolar public /xyz'den tüketilir | ✅ net ama servis 3 yere yayılır (Worker+stitcher+motor) | ⚠️ bulanık — hooder-harita worker'ına service binding + Hooder R2 bucket'ına binding = bizim servis Hooder'ın deploy artefaktlarına bağımlı |
| **Bakım yükü** | ✅ ~600 satır, tek teknoloji (Worker JS) | ⚠️ 3 kod tabanı (~1100 satır) + v141 hattı | 🔴 ~1400 satır + WASM vendor + elle rasterizer + golden korpus + Container yedek planı |
| **Sözleşme sadakati (512·2^z, kalibrasyon)** | ✅ yapısal — aynı kod üretiyor, sapma imkansız | ⚠️ statik motor-portu B4/B5 fit kuralını yeniden kurar (golden testle yönetilebilir ama sapma MÜMKÜN) | 🔴 strm kalibrasyonu `(d-0.055)/0.033` mühürlü eşiğe karşı elle rasterizer = en yüksek sadakat riski |

**Belirleyici ölçüm gerçekleri:** (1) B3-B6'nın 9 tüketicisinin 8'i bu sunucuda `127.0.0.1:8890` sabit, hepsi Python+PIL; (2) tek uzak raster tüketicisi RunPod'un video başına 1 statiği (7 günde 28 dosya); (3) B6 strm'in uzak tüketicisi SIFIR ve photon'da polygon çizimi YOK. Haftada 28 istek için WASM+bellek+kalibrasyon riski alınmaz.

## REDDEDİLENLER

- **T3 (tek worker, tam WASM):** Bellek sınırı ölçümle aşılıyor (400-karo vakası); strm paritesi kanıtlanamadı ("parite sağlanamazsa Container" = devir gününe açık uçlu plan); Hooder worker/bucket binding'i sahiplik sınırını bulanıklaştırır ve dev10 ile deploy-koordinasyon yükü getirir. Devir dokümanının ayrı-worker seçeneğine uyum T1'de de var (aynı hesap, kendi worker'ımız, binding'siz).
- **T2 (stitcher kopyası + v141 motor portu):** Ölçülen trafik (28 statik/hafta uzak) 3 kod tabanını gerekçelendirmez; v141 = imaj build + ghcr push + template PATCH + wmax flush zinciri (memory'de kayıtlı tuzaklar). Cache/KV fikirleri ALINDI, gerisi Faz-2 opsiyonu.
- **T1'in içinden reddedilen:** Worker+photon statik "faz 2" olarak bile önerilmez (bellek); deneme dosyaları scratchpad'de kanıt olarak durur.

## UYGULAMA LİSTESİ (dosya dosya — /opt/matrix/cf/harita-katman/)

| # | Dosya | İçerik | ~Satır |
|---|---|---|---|
| 1 | `KARAR.md` | bu belge | — |
| 2 | `wrangler.toml.example` | name=harita-katman, hesap 45241304800d3e122aced1f0ae599943, route'lar `harita.nickdegs.com/{ONEK}/matching/*`, `/{ONEK}/styles/*` (+bayraklı `/{ONEK}/geocoding/*`), KV binding `HARITA_AYAR`, R2 binding `harita-match-cache`, vars: `ORIGIN_TABAN`, `OSRM_BEKLEME_MS=120`. **{ONEK} placeholder** — gizli önek repoya yazılmaz | 35 |
| 3 | `deploy.sh` | öneki `/opt/matrix/secrets/harita-uc.conf`'tan okur → wrangler.toml'u scratch'te üretir → `wrangler deploy` + KV seed (`osrm_urls`, `profiller`, `match_ttl_gun`). **ELLE, DEVİRDEN SONRA çalıştırılır** | 30 |
| 4 | `src/index.js` | router + önek denetimi (öneksiz → 404, B10/T11) + `/saglik` → `{"ok":true,"katman":"cf-harita-katman"}` | 80 |
| 5 | `src/matching.js` | `harita-proxy.py:723-798` birebir portu: 60 m seyreltme (0.00054°) → 10'luk dilim + 2 bindirme → OSRM `match/v1` (radiuses=25 sabit, tidy=true, gaps=ignore, timeout 45 sn, dilim arası 0.12 sn) → en-yakın-nokta dikişi → oturmayan dilim ham köprü → ~20 m yeniden örnekleme (0.00018°, segment başına ≤400) → `confidence: 0.9`. Sözleşme farkları: **`code:"Ok"` EKLENİR** (A5 önerilen), boş → `{"matchings":[]}`, `radiuses/tidy/access_token` yutulur. **Profil politikası (A6, devir-günü-sıfır-değişim):** KV `profiller` varsayılan `"driving"` = bugünkü davranış birebir (cycling/walking → 404); A6 kararı gelince KV'den 3 profile açılır, deploy'suz. + osrm_urls KV'den + 3 retry/backoff | 230 |
| 6 | `src/cache.js` | match önbelleği: SHA-256(profil+seyreltilmiş koordinatlar) → Cache API → R2 → OSRM; TTL KV `match_ttl_gun` (varsayılan 30) | 80 |
| 7 | `src/statik-forward.js` | `/styles/v1/*` (→ strm dahil; stil eşlemesi origin'de) + KV bayraklı `/geocoding/v5/*` → `ORIGIN_TABAN`'a önek dahil aynen ilet; yanıta `Cache-Control: public, max-age=2592000` + Cache API (statik URL koordinat-deterministik, B11 izinli). ⚠️ `ORIGIN_TABAN` = sunucu IP/gri-bulut adı — Worker'ın kendi hostu OLMAZ (loop) | 50 |
| 8 | `test/uyum-test.mjs` | `wrangler dev`'e karşı: **T4** (code:"Ok" + confidence 0.9 + radiuses 22/30/32/45 kabul + boş biçim + cycling/walking→404 varsayılan + ikinci istek önbellekten aynı), **T5** (200 noktalı test izi → ~20 m histogram + >60° kırılma < 45), **T11** (öneksiz→404), forward duman testi (statik → 200/jpeg/2W×2H) | 140 |
| 9 | `README.md` | mimari, KV anahtarları, deploy sırası, bize düşen testler (T4/T5/T11 + T1-T2 5 dk teyit), geri dönüş: route kaldır = anında dönüş (origin nginx hattı dokunulmamış), risk defteri (CF çıkış IP × OSRM → KV `osrm_urls` değiştir) | 80 |

**Toplam yeni kod ≈ 600-650 satır. Sunucu tarafında değişiklik YOK** (devir sonrası tek olası ayar: `harita-kaynak.json` karo kaynağı → CF `/xyz` — canlı config, kod değil; `/opt/harita-arsiv` yerinde durdukça o da şart değil).

## DEVİR GÜNÜ SIRASI (bize düşen)

1. **Devirden ÖNCE (serbest, okuma/test sınıfı):** kod yazılır, `wrangler dev`'e karşı uyum-test yeşile çekilir (OSRM canlı — dış istek zaten bugünkü proxy'nin yaptığı iş).
2. Hooder "hazır" deyince: `deploy.sh` (wrangler deploy + KV seed) — **Barış onayı + dev10 ile route koordinasyonu** (hooder-kapi rota tablosuyla çakışma olmasın; ortak kaynak kuralı: birbirini bekle).
3. Canlıya karşı T4/T5/T11 + T1 ölçek deneyi (forward mimarisinde statik aynı origin'den geldiği için T1/T2 yapısal birebir — yine de 5 dk koşulur, 750 m sigortası).
4. RunPod + backend tüketicileri DNS üzerinden hiçbir kod değişikliği olmadan çalışır (aynı yol + önek).
5. Sorun → route kaldır/DNS geri = anında dönüş.

---

# A4 KARARI — matching (ve geocoding) NEREDE kalıyor

**Tarih:** 2026-08-30 (K0 final cevabından sonra) · **Karar mercii:** Matrix (K0 §A4: "kararı Matrix
verir; devirle birlikte kod sahipliği sizde") · **Durum:** KARARLAŞTI, kod uygulandı.

## KARAR
1. **Matching HARİTA KATMANINDA KALIR** — bugünkü `src/matching.js` (birebir port, parite kanıtlı).
   K0'ın "movelog-api'ye taşınsın" önerisi **reddedildi**.
2. **Geocoding de katmanda kalır** (K0 A4 ile aynı yön) — **bizim** worker'ımızdan origin'e forward:
   route AÇIK + KV `geocoding_forward` varsayılan AÇIK.
3. **A6 profil politikası devir günü DEĞİŞMEZ:** KV `profiller = ["driving"]` (cycling/walking → 404
   = bugünkü davranış birebir). K0'ın "katmanda kalırsa 3 profil desteklenir" taahhüdü **koddadır**,
   açılışı devir doğrulandıktan SONRA ayrı adım + Barış onayı (aşağıda).

## GEREKÇE — 1) sıçrama sayısı (belirleyici ölçüt)

| Tüketici | Nerede koşuyor | **(a) katmanda** | (b) movelog-api'de |
|---|---|---|---|
| RunPod 3B motoru `route-video.py:304-331` | RunPod serverless GPU (veri merkezi) | RunPod → **CF kenarı** → OSRM · origin YOK | RunPod → **Contabo** → OSRM · ortada TEK sunucumuz |
| Taktik motor `render_job.py:264-284` 🔒MÜHÜRLÜ | Cloud Run europe-west3 | Cloud Run → CF kenarı (aynı bölge) → OSRM | Cloud Run → Contabo → OSRM |
| Bulut ön-eşleme `movelog-cloud.py:182-207` | Contabo | Contabo → CF → OSRM | süreç-içi |
| Backend `main.py:_yol_esle` (904-942) | Contabo | Contabo → CF → OSRM | süreç-içi ← **(b)'nin TEK kazancı** |
| QA `_qa_render.py:151-163` · eski `scripts/route-video.py:166` | yerel | değişmez | URL değişir |

**Sonuç:** (b) yalnız 1 tüketicide (backend, en düşük hacimli) sıçrama kazandırır; 2 en ağır
tüketiciyi (RunPod + taktik) **tek sunucumuza geri bağlar**. (a) uzak tüketicilerde origin'i
zincirden tamamen çıkarır — matching artık origin'e HİÇ dokunmaz (yalnız statik forward dokunur).

## GEREKÇE — 2) taşımanın gerçek maliyeti (devir günü riski)

| | (a) katmanda | (b) movelog-api'ye taşı |
|---|---|---|
| Devir günü değişen tüketici dosyası | **0** | **5** (+ RunPod imaj/template PATCH + Cloud Run yeniden dağıtım) |
| MÜHÜRLÜ dosyaya dokunma | yok | **`render_job.py` (c35be584)** + `route_gen.py` hattı |
| Yeni yazılacak kod | yok (hazır, 35/35 test) | algoritmanın yeni evi + yeni uç kimliği + yeni önbellek |
| Parite kanıtı | **VAR** — 117/117 nokta, max sapma **0.000 m**, confidence 0.9 | sıfırdan kurulur |
| Önbellek | Cache API + R2, **tüm tüketiciler ortak**, kenar-yerel, TTL 30 g | sunucu diski, paylaşılmaz, yeniden yazılır |
| OSRM adres riski | KV `osrm_urls` **deploy'suz** değişir (hazır sigorta) | yeni bir ayar yolu gerekir |

## GEREKÇE — 3) K0'ın kendi gerekçesi düşüyor
K0 taşımayı **sahiplik** gerekçesiyle önerdi ("harita verisi değil, sizin iş mantığınız").
Devirle **kod sahipliği zaten Matrix'e geçti**: `harita-katman` BİZİM worker'ımız, bizim repomuzda
(`/opt/matrix/cf/harita-katman`), biz deploy ediyoruz, Hooder kaynağına **binding yok**. Yani
"algoritma bizim olsun" ile "algoritma bizim Worker'ımızda koşsun" aynı anda sağlanıyor —
kodu taşımaya gerek kalmadan. Taşıma yalnız hostname'i değiştirirdi, sahipliği değil.

## GEREKÇE — 4) hedefle uyum
Memory/hedef: *"Move Log backend sunucudan TAMAMEN bağımsız, Cloudflare'de"*. (b) video üretiminin
yol-oturtma adımını Contabo'ya geri bağlar → hedefe **aykırı**. (a) uyumlu.

## §A3 (bot savunması) açısından nötr
Muafiyet **her iki durumda da zorunlu** — `/xyz` + `/mvt` + statik trafiği (video başına ~13.000
karo) zaten Hooder zone'undan geçiyor ve datacenter ASN'lerinden geliyor. Matching'i taşımak
muafiyet ihtiyacını kaldırmaz, yalnız muaf edilecek yol sayısını 1 azaltırdı. Karar bu ölçütten
etkilenmedi.

## KABUL EDİLEN RİSKLER (ölçülü)
- **Worker duvar saati:** tüketiciler izi zaten 80-100 noktalık dilimlerle gönderiyor
  (`route-video.py` 100 · `main.py` 80 · `render_job.py` 90); 60 m seyreltme sonrası istek başına
  3-5 OSRM alt-isteği kalıyor. Ölçüm (30.08 canlı): 5 noktalı iz **227-651 ms**. 5500 noktalık
  taktik iz TEK istekte gelmiyor (⌈N/90⌉ dilim) → Worker limiti gündeme gelmiyor.
- **Public OSRM bağımlılığı:** bugünkü proxy'yle aynı. Çökerse `{"matchings":[]}` → tüketiciler ham
  ize düşer, video ölmez. İkinci sigorta: match önbelleği + KV `osrm_urls`.

## GEOCODING — neden katmanda ve neden AÇIK
K0 A4 geocoding'i ortak katmana koydu (Hooder'da 235.907'lik `geo/` önbelleği var). Ama uç yolu
**önekli** (`/{ONEK}/geocoding/v5/…`) ve minimal alan sözleşmesi (`features[0].text` + `context[]`)
bizim sözleşmemiz. Devir günü Hooder'a yeni bir yanıt-biçimleme kodu yazdırmak gereksiz risk;
bizim forward'ımız **zaten yazılı ve canlı ölçüldü** (30.08: `Cankurtaran Mahallesi` / `Istanbul`).
🔴 **Route claim edilmezse** devir sonrası bu yol zone'un o günkü sahibine düşer → 404 → videolarda
şehir/mahalle adı **sessizce** kaybolur (hata yutuluyor, video ölmüyor → fark edilmez).
Bu yüzden kod varsayılanı da AÇIK (KV okunamasa bile ölmesin); kapatmak için KV'ye `0`.

## KARARIN GEREKTİRDİĞİ KOD DEĞİŞİKLİĞİ (uygulandı, `tsc` temiz)
| Dosya | Değişiklik |
|---|---|
| `wrangler.toml.example` | `/{ONEK}/geocoding/*` route'u **yorumdan çıkarıldı** (+MLOG_ONEK ikizi deploy.sh'ta) |
| `deploy.sh` | KV tohumu `geocoding_forward=1`; muafiyet-öneki ikiz route listesine geocoding eklendi |
| `src/cache.js` | `geocodingForward` varsayılanı **AÇIK** (yalnız `"0"/"false"` kapatır) — fail-safe yön |
| `src/statik-forward.js` | forward seçenek nesnesine geçti: `tip` (geocoding'de `application/json`) + **`bosCache:false`** → `features:[]` (Nominatim arızası) 7 gün önbelleğe YAZILMAZ; matching'in boş-sonuç kuralıyla aynı gerekçe |
| `test/uyum-test.mjs` | "geocoding kapalı → 404" testi **A4 forward testiyle** değiştirildi (200 + `features[0].text` + CC 7 g) |
| `README.md` | B8 satırı + KV tablosu güncellendi |

**Doğrulama (30.08):** `npm run typecheck` temiz · `node test/uyum-test.mjs` (wrangler dev + canlı
OSRM + canlı origin) **36/36 yeşil** (eski 35 + 2 geocoding − 1 kaldırılan).

## SONRAKİ ADIM — A6 3 profil (devir günü DEĞİL)
Devir doğrulandıktan sonra, **ayrı adım + Barış onayı** (davranış değişikliği: bugün yürüyüş/bisiklet
izleri sessizce ham ize düşüyor, açılınca yola oturmaya başlar → "tek değişiklik / ölç / göster"):
```
wrangler kv key put --remote --namespace-id <id> profiller '["driving","cycling","walking"]'
```
Deploy YOK. Geri alma: aynı komut `'["driving"]'` ile.

## FAZ-2 OPSİYONLARI (ayrı onay ister, şimdi YAPILMAZ)

- **(a)** Tasarım 2'nin `engine/stitch_port.py` fikri: bir v141 zaten build edilecekse RunPod motoru tek statiğini ham karodan kendi birleştirir → forward köprüsündeki uzak trafik sıfırlanır.
- **(b)** ~~Geocoding forward bayrağının açılması~~ → **A4 kararıyla YAPILDI** (yukarı bkz).
  Yerine geçen Faz-2 fikri: geocoding zincirinin önüne Hooder'ın `geo/` R2 önbelleği (235.907 kayıt)
  konsun → origin'e inen geocoding trafiği ~sıfırlanır. Hooder'ın bucket'ına okuma erişimi ister
  (sahiplik sınırı: binding = bağımlılık) → ayrı karar.
