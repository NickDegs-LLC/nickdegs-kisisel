# DEVİR GÜNÜ CHECKLIST — harita katmanı (Hooder → Matrix)

**Tarih:** 2026-08-30 · **Güncelleme:** 2026-08-31 (kaçak tüketici avı → B5, B6, F4, F5, G2, EK, EK-2)
**Yazan:** matrix oturumu · **Durum:** UYGULAMAYA HAZIR (henüz koşulmadı)
**Girdi:** `HARITA-SOZLESME-K0-FINAL.md` (A1-A11 + §0.3 bot savunması) ·
`HARITA-TUKETIM-SOZLESMESI.md` (B1-B12, T1-T12) · `HOODER-HARITA-DEVIR-HAZIRLIK.md` ·
`/opt/matrix/cf/harita-katman/KARAR.md` (tasarım + **§A4 kararı**)

## Nasıl okunur
- **⚠️ ONAY** = Barış'ın açık onayı olmadan YAPILMAZ (DNS/route/canlı yönlendirme sınıfı).
- **🅷 HOODER** = dev10'un işi; biz yalnız İSTER ve DOĞRULARIZ (onların kodu/zone'u bizim alanımız değil).
- Her adımda: **komut → beklenen çıktı → başarısızsa**.
- Sıra bağlayıcıdır. Özellikle: **muafiyet (B) → deploy (D) → route çevirme (E)**.
  Muafiyet olmadan route çevrilirse **ilk render işi bloklanır** (K0 §0.3 + §A3, son cümle).

## Roller ve dosyalar
| Ne | Nerede |
|---|---|
| Worker kodu (bizim) | `/opt/matrix/cf/harita-katman/` (`src/`, `deploy.sh`, `wrangler.toml.example`) |
| Devir testi aracı | `/opt/matrix/cf/harita-katman/test/devir-testi.py` (T1/T3/T6/T4/T11/B8 + ESKİ↔YENİ) |
| Uyum testi (Worker'a özel) | `/opt/matrix/cf/harita-katman/test/uyum-test.mjs` (T4/T5/T11 + forward) |
| Muafiyet yamaları (tüketici tarafı) | `/opt/matrix/cf/harita-katman/muafiyet/yamalar/` (01-06) |
| Gizli önek | `/opt/matrix/secrets/harita-uc.conf` → `HARITA_UC_ONEK` (**loga/ekrana yazılmaz**) |
| Muafiyet başlığı (varsa) | `/opt/matrix/secrets/movelog-harita-key.conf` → `MOVELOG_KEY`, `MLOG_ONEK` |
| Bu sunucu (origin) | `169.58.124.139` — statik + geocoding forward'ın hedefi |

---

# A) HAZIRLIK — devirden ÖNCE (onay gerekmez: okuma/ölçme/test sınıfı)

### A1. Temel çizgiyi ölç ve SAKLA
```bash
cd /opt/matrix/cf/harita-katman
python3 test/devir-testi.py --json > /opt/matrix/docs/devir-temel-cizgi-$(date +%F).json
python3 test/devir-testi.py
```
**Beklenen (30.08 ölçümü):** `38 OK · 0 FAIL · 1 beklenen-fark · 5 bilgi`
- T1 ölçek: `fark=1.51/255` (eşik <5) · kontrol (yanlış ölçek) `60.31/255` → **ayrım net**
- T6: eksik karo (z16) → **204** · İstanbul z14/z15 → 200 + `application/vnd.mapbox-vector-tile`
- T4: `code=None` = **beklenen fark** (bugünkü kusur, A5 — katman düzeltecek), `confidence=0.9`
- T3: statik `Cache-Control` **YOK** (B11 fiili durum) · `HEAD statik → 501` (bu yüzden GET)

**Başarısızsa:** devir gününe girmeden önce ESKİ uçta bir arıza var demektir — önce onu çöz;
temel çizgi bozuksa YENİ uç "aynı mı" sorusu cevaplanamaz.

### A2. Kod hazır mı
```bash
cd /opt/matrix/cf/harita-katman
npm run typecheck
node test/uyum-test.mjs --birim
PORT=8837 test/dev-baslat.sh &            # yerel wrangler dev (gerçek önekle, loga yazmadan)
BASE=http://127.0.0.1:8837 node test/uyum-test.mjs
pkill -f "wrangler dev --port 8837"
```
**Beklenen:** typecheck sessiz (exit 0) · birim `11 geçti` · tam takım **`36 geçti, 0 kaldı`**
**Başarısızsa:** deploy etme. FAIL satırı hangi T'ye aitse `KARAR.md`deki ilgili maddeye dön.

### A3. Sırlar yerinde mi (değerleri EKRANA BASMA)
```bash
grep -q HARITA_UC_ONEK /opt/matrix/secrets/harita-uc.conf && echo "onek VAR"
[ -f /opt/matrix/secrets/movelog-harita-key.conf ] && echo "muafiyet dosyasi VAR" || echo "muafiyet dosyasi YOK (MLOG_ONEK=ONEK olacak)"
source /usr/local/bin/api-env.sh >/dev/null && [ -n "$CF_GLOBAL_KEY" ] && echo "CF anahtari VAR"
```
**Başarısızsa:** eksik olanı tamamlamadan `deploy.sh` çalışmaz (kendisi de reddeder).

### A4. dev10'un "hazır" sözünü bekle
Hooder 24 saatlik gözlemi bitirip (31.08) "hazır" demeden **B adımına geçilmez**.

---

# B) 🅷 HOODER MUAFİYETİ — 🔴 EN KRİTİK, HER ŞEYDEN ÖNCE

> K0 §0.3 + §A3: zone'da **datacenter/cloud ASN bloğu** (RunPod/DO/GCP/Azure) + davranış-tabanlı
> **kalıcı /64 yasağı** var. Bir render dakikada yüzlerce karo çeker, "oyun etkileşimi" sıfırdır
> → imzası kazıyıcıya benzer. **Muafiyet DNS/route çevrilmeden ÖNCE tanımlanmalı.**

### B1. İsteği gönder (bizim işimiz: İSTEMEK)
İstenen üç madde (K0 §A3'ün kendi diliyle):
1. **Muafiyet işareti = YOL ÖNEKİ** (`/{MLOG_ONEK}/…`) — başlık değil.
   Gerekçe: karoyu tarayıcı da çekiyor (WKWebView/headless chromium); sabit başlık **CORS ön-uçuş**
   doğurur ve ölçümde `OPTIONS` → **501** (bkz. `muafiyet/yamalar/01`). Önek her iki tüketici
   sınıfında da bedava çalışır.
2. **Muaf istekler bot-avcısı sayaçlarına HİÇ girmesin** (yalnız bloklanmasın değil — SAYILMASIN).
3. **`X-Movelog-Key` başlığı ikincil işaret olarak kabul edilsin** (sunucu-yanı bacaklarda taşınır).
+ 🔴 **R3:** önekli `/xyz` yolunda **ACAO + CORP başlıkları** da verilsin — bugünkü nginx bunları
yalnız öneksiz `location /xyz/` altında ekliyor (30.08 ölçüldü); eksikse **video BEMBEYAZ çıkar**.

**Not:** `src/index.js:11` `muafiyet/ONERI-HOODER.md` dosyasına atıf yapıyor; dosya henüz yok —
istek gönderilmeden önce yazılmalı (yamalar 01-06 içeriği hazır).

### B2. 🅷 Hooder teyidi (yazılı)
Beklenen cevap: "`/{MLOG_ONEK}/*` ASN bloğundan ve bot avcısından muaf; muaf istekler sayaçlara
girmiyor; önekli `/xyz` ACAO+CORP veriyor."
**Başarısızsa:** **DUR.** E adımına (route çevirme) geçme. Muafiyetsiz devir = ilk render ölür.

### B3. Muafiyeti ÖLÇ (teyide güvenme, ölç)
```bash
source /opt/matrix/secrets/harita-uc.conf
curl -s -o /dev/null -D - "https://harita.nickdegs.com/$HARITA_UC_ONEK/xyz/sat/14/9600/6100.jpg" \
  | grep -iE "^HTTP|access-control-allow-origin|cross-origin-resource-policy|cache-control|cf-cache-status"
```
**Beklenen:** `200` + `access-control-allow-origin: *` + `cross-origin-resource-policy: cross-origin`
+ `cache-control: public, max-age=2592000, immutable`; ikinci istekte `cf-cache-status: HIT`.
**Başarısızsa (ACAO/CORP yok):** R3 karşılanmamıştır → B1'e dön. Bu eksik curl ile görünür ama
videoda **beyaz kare** olarak patlar; T7 sınıfı gerçek render duman testi olmadan geçme.

### B4. Veri-merkezi tarafından ölç (ASN bloğu gerçekten muaf mı)
Muafiyetin asıl sınavı bizim sunucumuz değil **RunPod/Cloud Run** çıkışıdır (ASN bloğu orayı hedefler).
Küçük bir iş tetiklenip motorun karo çekimi loglarından 200 alındığı doğrulanır.
**Başarısızsa:** 403/429/blok görülüyorsa muafiyet kuralı yanlış kapsamda tanımlanmıştır → B1.

### B5. 🔴 `/hooder-api/sat` KAÇAĞI — muafiyet isteğine EKLENECEK (31.08 kaçak avında bulundu)
> Bu, muafiyet planında (yamalar 01-06) **hiç yoktu.** Yamaların hepsi `harita.nickdegs.com` /
> `127.0.0.1:8890` tüketicilerini kapsıyor; bu çağrı **doğrudan Hooder zone'una** gidiyor.

**Kanıt (31.08, ölçüldü):**
- `scripts/harita-proxy.py:36` → `HOODER_URL = https://realvirtuality.app/hooder-api/sat/{z}/{x}/{y}.jpg`
- `harita-kaynak.json` 3. kaynak: `{"tip":"xyz","tur":"sat","url":".../hooder-api/sat/…","minz":0,"maxz":14}` — **AKTİF**
- Canlı ölçüm: `curl .../hooder-api/sat/10/600/380.jpg` → **200** (bu sunucudan, şu an çalışıyor)
- Zincir sırası: `esri`(0-19) → `dizin /opt/payment/sat_cache`(0-**10**) → **`xyz hooder`(0-14)** → `eox`(0-14).
  Yani **z11-14'te Esri boş karo döndüğü anda** (`_bos_karo_mu` → `data=None` → zincir devam) sıradaki
  kaynak doğrudan Hooder'ın `/hooder-api`'sidir — `dizin` orada devrede değil (maxz=10).
- Çağıran IP = **bu sunucu (169.58.124.139) = datacenter ASN** → K0 §0.3'ün ASN bloğunun tam hedefi.

**Ek risk:** `/opt/payment/sat_cache` (9,3 GB, z0-10) Hooder'ın alanında. Hooder ANA sunucu origin'i
24 saat sonra kapanınca bu dizin de giderse, z0-10 uydu isteği de `xyz` satırına düşer → hacim artar.

**İstek (B1'e 4. madde olarak eklenir):**
> 4. `realvirtuality.app/hooder-api/sat/*` için **169.58.124.139 muafiyeti** (ya da bu çağrının da
>    muafiyet öneğine taşınması). Not: mevcut sunucu-yanı bot avcısı (`/opt/hooder/bot-avcisi.py:63`)
>    `BEYAZ` listesinde 169.58.124.139 ve 169.58.151.59'u zaten taşıyor ve yalnız `/hooder-api/geo/`
>    saydırıyor — **CF kenarındaki YENİ savunmanın aynı beyaz listeyi/kapsamı taşıyıp taşımadığı
>    yazılı teyit edilmeli.** ASN bloğu IP tabanlıdır; eski beyaz liste onu otomatik kapsamaz.

**Muafiyet gelmezse tek taraflı çıkış yolu (bizim alanımız, ⚠️ Barış onayı):** `harita-kaynak.json`
içindeki `tip:"xyz"` Hooder satırını kaldır → zincir `esri → dizin → eox` olur, Hooder zone'una
sıfır istek. (Dosya kaydedilince proxy anında algılar, restart yok — `_kaynaklar()` mtime izliyor.)
**Ölçüm ölçütü:** kaldırmadan önce/sonra `journalctl -u harita-proxy` karo hata sayısı aynı kalmalı.

### B6. Öneksiz/kapsam dışı kalan tüketiciler (aynı istekle kapatılır)
| Kaçak | Nerede | Bugün riskli mi | Muafiyet yolu |
|---|---|---|---|
| `HARITA_TABAN=https://harita.nickdegs.com` (**öneksiz**) | `scripts/test-render-yerel.sh:37` | Elle koşulunca: yüzlerce öneksiz `/xyz`+`/mvt`, datacenter IP'den → bot imzası | satıra `/<MLOG_ONEK>` eklenecek (yama yok — EKLE) |
| `scripts/route-video.py:166,287,355` (`127.0.0.1:8890` sabit) | **CANLI** — `movelog-genreq.timer` (2 dk) → `movelog-genreq.py:25`; ayrıca `render-pool.py:39` | Bugün yerel → risksiz. Katman sunucudan ayrılınca **env yolu YOK** | yama 05'e 3. dosya olarak eklenecek (bugün yalnız `movelog-cloud.py` + `activity-detect.py` var) |
| `kisisel-app/tactical/*` ↔ `cf/tactical-runpod/*` **env adı çakışması** | yama 03 `TAC_HARITA` · Faz T kopyası `HARITA_TABAN/_STATIK/_MATCHING/_GEOCODING` (`TASIMA.md:37-40`) | Muafiyet env'i tek ada set edilirse **diğer kopya öneksiz kalır** | tek aile seçilecek (Faz T'nin 4'lü ailesi önerilir); ⚠️ `cf/tactical-runpod/` başka bir workflow'un elinde — **DOKUNMA**, yalnız adı hizala |
| `kisisel-api.nickdegs.com/harita/` → `8890/xyz/` · `/vektor/` → `8890/mvt/` | `/etc/nginx/sites-available/cf-kisisel-api:4,16`; app her açılışta `/api/mapconfig` → `map-config.json` `tiles` | Bugün yerel → risksiz. **Faz-2'de app'in TÜM harita ekranı buradan geçiyor** | hiçbir yamada YOK — Faz-2 (H) listesine girmeli |
| Backend `main.py:932` (`harita.nickdegs.com/{onek}/matching`) | `/opt/movelog/backend` (bizim alanımız değil, ama önek `config.env:29`) | Önek = muafiyet öneği ise **kendiliğinden muaf** | önek AYNI kalırsa iş yok; değişirse `config.env` güncellenir |
| `cf/api` Worker → `HARITA_UC` matching | `cf/api/wrangler.toml:13`, `grup7.ts:379` | İstek **Cloudflare ağından** çıkar — ASN bloğu CF'in kendi ASN'ini kapsıyor mu? | B2'de açıkça sorulacak (K0 §A2'deki *service binding* seçeneği bunu kökten çözer) |

**Not (hijyen):** `cf/api/wrangler.toml:13` gizli öneği **düz metin** taşıyor; `harita-katman`
tarafında aynı önek bilinçli olarak repoya yazılmıyor (`wrangler.toml.example` `{ONEK}` placeholder).
Devirden sonra tek yönteme indirilmeli (⚠️ ayrı karar, devir gününe eklenmez).

---

# C) ⚠️ ONAY NOKTASI — Barış'a sunulacak paket

Aşağıdakiler **canlı yönlendirmeyi değiştirir**, hepsi tek onayda sunulur:
1. **DNS:** `harita-origin.nickdegs.com` **A → 169.58.124.139**, **proxy KAPALI (gri bulut)**
   (Worker'ın origin'e döngüsüz ulaşması için; `cf.resolveOverride`).
2. **Route:** `harita.nickdegs.com/{ONEK}/matching/*`, `/{ONEK}/styles/*`, `/{ONEK}/geocoding/*`
   → `harita-katman` worker'ı (varsa `{MLOG_ONEK}` ikizleri).
3. Geri dönüş: **route silmek yeter** (worker silmeye gerek yok) → istekler eski sahibine düşer.

**Onay yoksa:** D ve sonrası YAPILMAZ. A ve B adımları onaysız da tamamlanabilir (ölçüm/istek sınıfı).

---

# D) BİZİM DEPLOY

### D1. Gri-bulut DNS kaydı (⚠️ onay sonrası)
`harita-origin.nickdegs.com` A `169.58.124.139`, **proxy KAPALI** (CF panel ya da `cf-subdomain-ekle.sh`).
```bash
getent hosts harita-origin.nickdegs.com     # 169.58.124.139 dönmeli (CF IP'si DEĞİL)
```
**Beklenen:** doğrudan sunucu IP'si.
**Başarısızsa (turuncu bulut kalmış):** Worker kendi hostuna istek atar → `500 origin dongusu`
(sessiz döngü YOK, kod bunu yakalar). Kaydı gri yap, tekrar dene.

### D2. 🅷 Route koordinasyonu (ortak kaynak kuralı: birbirini bekle)
dev10 ile `hooder-kapi` rota tablosunda çakışma olmadığını teyit et. Bizim üç route'umuz **dar**;
`/xyz` `/mvt` `/yukseklik` `/saglik` onların hattında kalır.
**Başarısızsa:** aynı desen iki worker'a bağlanamaz — çakışan deseni onlar bırakana kadar bekle.

### D3. Duman testi için geçici workers.dev (opsiyonel ama önerilir)
`wrangler.toml.example`'da `workers_dev = false`. Route çevirmeden önce worker'ı görmek için
deploy'u bir kez `workers_dev = true` ile yapıp `https://harita-katman.<subdomain>.workers.dev/saglik`
kontrol et, sonra `false`'a döndürüp yeniden deploy et.
**Beklenen:** `{"ok":true,"katman":"cf-harita-katman"}`

### D4. Deploy
```bash
cd /opt/matrix/cf/harita-katman && ./deploy.sh
```
Yaptıkları: R2 bucket (`harita-match-cache`) · KV namespace (`HARITA_AYAR`) · `wrangler deploy`
(route'lar dahil) · `MOVELOG_KEY` secret · KV tohumları
`osrm_urls` / `profiller=["driving"]` / `match_ttl_gun=30` / `geocoding_forward=1`.
**Beklenen son satır:** `deploy tamam (kv=<id>). Simdi README 'Devir gunu' testlerini kos.`
**Başarısızsa:**
- `KV namespace olusturulamadi` → `source /usr/local/bin/api-env.sh` yapılmamış/CF anahtarı yok.
- route çakışması hatası → D2'ye dön (dev10).
- deploy yarıda kaldıysa: route'lar yazılmamışsa canlı **hiç etkilenmez** (eski hat sürer).

---

# E) ⚠️ ROUTE/DNS ÇEVİRME (canlıya geçiş anı)

D4 route'ları yazdığı anda `/{ONEK}/matching|styles|geocoding` **bizim worker'a düşer**;
`/xyz` `/mvt` `/yukseklik` Hooder'ın hattına geçtiğinde devir tamamlanır (🅷).
**Ölçüt: bu adım B (muafiyet) teyit edilmeden YAPILMAZ.**

Geçiş anını sabitle:
```bash
date -Is >> /opt/matrix/docs/devir-gunu-kayit.txt
```

---

# F) DOĞRULAMA (geçişten hemen sonra — 15 dk)

### F1. Tek komut: ESKİ↔YENİ
```bash
cd /opt/matrix/cf/harita-katman
python3 test/devir-testi.py --yeni https://harita.nickdegs.com
```
> ESKİ hattı artık erişilemiyorsa: `--sadece-yeni --yeni https://harita.nickdegs.com`
> (karşılaştırma yerine A1'de saklanan JSON temel çizgisiyle elle kıyasla).

**Geçme ölçütü — hepsi OK olmalı:**
| Test | Eşik / beklenen |
|---|---|
| **T1 ölçek** | z15 statik ↔ z16 karo **< 5/255** (temel çizgi 1.51) + kontrol (z14) **> 20/255** (60.31) → **750 m kayma sigortası** |
| **T3 başlık** | `/xyz` ACAO:* + CORP + CC 30 g · `/mvt` ACAO + CC + doğru CT · **statikte artık CC 30 g VAR** (katman ekler) + 2. istekte `X-Onbellek: cache-api` |
| **T6 MVT** | eksik karo **204**, hiçbir yerde **404 YOK**; İstanbul z14/z15 200 + dolu |
| **T4 matching** | **`code:"Ok"` ZORUNLU** (ESKİ'de yoktu — YENİ'de FAIL ise 4 tüketici ham ize düşer) · `confidence` sayı · max adım < 45 m · boş sonuç bayt-birebir `{"matchings":[]}` |
| **T11** | öneksiz matching/styles/geocoding → 404 |
| **B8** | geocoding 200 + `features[0].text` dolu |
| **K1** | ESKİ↔YENİ statik piksel farkı **< 5/255** |
| **K2** | matching nokta sayısı aynı + max sapma **< 1.0 m** (hedef 0.000) |

**Başarısızsa — hangi FAIL, ne yapılır:**
| FAIL | Anlamı | Aksiyon |
|---|---|---|
| T1 fark ≈ 60/255 | **1024·2^z ölçek hatası** — rotalar ~750 m kayar | **DERHAL G'ye (geri dönüş)**. Tartışma yok. |
| T1 kontrol < 20 | test ayırt edici değil | T1 sonucuna güvenme; karo/koordinat sabitlerini gözden geçir |
| T3 statik CC yok | forward Cache-Control eklemiyor | origin'e her istek iner (yavaş ama çalışır) → not al, G şart değil |
| T3 `/xyz` ACAO/CORP yok | **video bembeyaz** | 🅷 B1-R3'e dön; render tetiklenmeden düzelt |
| T6 herhangi bir 404 | 204 kuralı bozulmuş | 🅷 dev10'a bildir; render riski (eski IPS sınıfı ban) |
| T4 `code` yok | 4 tüketici ham ize düşer | worker eski sürüm mü? `wrangler deploy` tekrar; düzelmezse G |
| T4 boş biçim farklı | tüketici parse'ı kırılır | G |
| K2 sapma > 1 m | matching portu sapmış | G, sonra `src/matching.js` ↔ `harita-proxy.py:723-798` karşılaştır |

### F2. Worker'a özel uyum takımı
```bash
BASE=https://harita.nickdegs.com node test/uyum-test.mjs
```
**Beklenen:** `36 geçti, 0 kaldı` (T4/T5/T11 + geocoding + forward duman).

### F3. Gerçek tüketici duman testi (curl'ün göremediği kısım)
Küçük bir video işi tetiklenir (2D + taktik birer tane yeter):
- karo çekimi **200** (motor logu), `exit(7)` karo-hata sayacı tetiklenmiyor
- çıktı videosu **bembeyaz DEĞİL** (CORS kanıtı — T7'nin yerini tutan tek gerçek kontrol)
- yol-oturtma çalıştı mı: `code:"Ok"` sonrası ham-ize-düşme olmamalı

**Başarısızsa:** beyaz kare → CORS (B1-R3) · karo 403 → muafiyet (B) · rota kayması → T1 (G'ye).

### F4. 🔴 İLK RENDER'IN CANLI İZLENMESİ (eksikti — 31.08 eklendi)
> Muafiyetin gerçek sınavı curl değil, **dakikada yüzlerce karo çeken ilk gerçek iş**tir. F3 işi
> "bitti mi" diye sormaz — **koşarken** izlenir; blok, bitmiş videoda değil, akan logda görünür.
> ⚠️ İzleme bash'inde `render_job.py` STRING'İ ARAMA (bilinen footgun: `tac_dispatch` OOM sayacını
> bozup render'ı asıyor) — **log dosyasının BİT-kontrolünü** kullan.

F3 işi tetiklendiği anda, ayrı bir kabukta 3 pencere birden açık kalır:
```bash
# 1) motor logu — karo HTTP kodları (403/429 = muafiyet çöktü)
journalctl -u harita-proxy -f
# 2) taktik/2D iş logu — dosya boyutu ilerliyor mu (grep YOK, byte kontrolü)
watch -n5 'ls -l /opt/matrix/routes/*.log 2>/dev/null | tail -3'
# 3) Hooder zone'una giden kaçak var mı (B5 kaçağı gerçekten sustu mu)
ss -tnp 2>/dev/null | grep -c ESTAB
```
**Geçme ölçütü (üçü birden):**
- karo çekiminde **hiç 403/429 yok** (tek bir tane bile = muafiyet kapsam dışı → B1)
- ilk 60 sn içinde kare üretimi **ilerliyor** (log dosyası büyüyor) — donma = sessizce yutulan istek
- iş bitince çıktı **bembeyaz değil** ve `exit(7)` karo-hata sayacı tetiklenmemiş

**Neden ayrı adım:** ASN bloğu ve /64 yasağı **anlık değil, eşik dolunca** devreye girer. Tek karoluk
curl (B3) geçer ama 300 karoluk gerçek iş bloklanabilir. Bu farkı yalnız canlı izleme yakalar.

### F5. Kaçak sızıntı denetimi (geçişten 1 saat sonra, 2 dk)
Muafiyet önekli olduğu için **öneksiz kalan bir tüketici sessizce çalışmaya devam eder** — ta ki
bot avcısı onu yakalayana kadar. Geçişten sonra öneksiz istek kalmadığı doğrulanır:
```bash
grep -c "/xyz/" /var/log/nginx/access.log                 # öneksiz /xyz sayısı
grep -c "hooder-api/sat" /var/log/nginx/access.log        # B5 kaçağı (0 olmalı ya da muaf)
```
**Beklenen:** öneksiz `/xyz` yalnız app karo ucundan (`kisisel-api /harita/`, Faz-2'ye kadar normal);
`hooder-api/sat` **0** ya da B5 muafiyeti yazılı teyitli.
**Başarısızsa:** hangi tüketici olduğunu bul (B6 tablosu), **route'u geri almadan** önce onu önekle —
kaçak tek başına devri geri aldırmaz ama 24 saat içinde kalıcı /64 yasağı doğurur.

---

# G) GERİ DÖNÜŞ PLANI (her an, tek adım)

```bash
# 1) BİZİM tarafı geri al: route'ları kaldır (worker'ı SİLMEYE gerek yok)
#    CF panel → Workers → harita-katman → Triggers → Routes → üç route'u sil
#    (ya da wrangler.toml'dan routes bloğunu boşaltıp yeniden deploy)
```
- İstekler **eski sahibine** düşer; origin nginx hattına **hiç dokunulmadı** → anında dönüş.
- `harita-proxy.py` ve 8890'daki 8 yerel çağrı noktası devir boyunca **çalışır durumda kaldı**.
- 🅷 Hooder tarafı (tile route'ları) için geri dönüş dev10'da; DNS geri alma da onların hattı.
- Geri dönüşten sonra doğrulama: `python3 test/devir-testi.py` → A1'deki temel çizgiyle aynı olmalı.

**Geri dönüş kararı için eşik (tartışmasız):** T1 ölçek FAIL · T6'da 404 · T4 boş biçim bozulması ·
K2 > 1 m. Bunların herhangi biri → önce geri dön, sonra teşhis et.

### G2. 🔴 Geri dönüş route ile BİTMEZ — muafiyet/env de geri alınır (eksikti, 31.08)
Route silmek yalnız **worker'ı** devreden çıkarır. Muafiyet için yapılan **env/URL değişiklikleri
yerinde kalır** ve öneki artık kimsenin tanımadığı bir yola işaret ediyor olabilir → route geri
alındığı halde tüketiciler 404 alır. Geri dönüş sırası **ters**tir:

| # | Ne geri alınır | Nasıl | Kanıt |
|---|---|---|---|
| G2.1 | Route'lar | CF panel → Workers → `harita-katman` → Triggers → Routes (3 kayıt sil) | `curl` öneksiz uç eski yanıtı verir |
| G2.2 | RunPod template env | `HARITA_TABAN`/`HARITA_UC` eski değere PATCH + **wmax 0→3 flush** (sıcak worker eski env'i taşır) | küçük iş → karo 200 |
| G2.3 | harita-proxy drop-in (yama 06) | `rm /etc/systemd/system/harita-proxy.service.d/muafiyet.conf` + `daemon-reload` + restart ⚠️ Barış onayı | `systemctl show harita-proxy -p Environment` |
| G2.4 | Sunucu scriptleri (yama 05 + `route-video.py`) | env kaldır (kod varsayılanı zaten `127.0.0.1:8890`) | `movelog-genreq` bir tur temiz koşar |
| G2.5 | `test-render-yerel.sh` öneki | satırı eski hale getir | — |
| G2.6 | `harita-kaynak.json` (B5 uygulandıysa) | Hooder `xyz` satırını geri ekle | proxy mtime ile anında alır, restart yok |

**Kural:** G2.2-G2.6 **yalnız o adım gerçekten uygulandıysa** geri alınır. Devir gününde neyin
uygulandığı `devir-gunu-kayit.txt`'ye satır satır yazılır — yoksa geri dönüşte ne yapıldığı bilinmez.

```bash
# her uygulanan muafiyet adımı için TEK satır (önek/anahtar YAZILMAZ, yalnız adım adı)
echo "$(date -Is) UYGULANDI: yama06-drop-in" >> /opt/matrix/docs/devir-gunu-kayit.txt
```

---

# H) DEVİR SONRASI (ayrı adımlar, ayrı onay)

| # | İş | Neden hemen değil |
|---|---|---|
| H1 | **A6: 3 profil aç** — `wrangler kv key put --remote --namespace-id <id> profiller '["driving","cycling","walking"]'` | Davranış değişikliği: bugün yürüyüş/bisiklet izleri sessizce ham ize düşüyor, açılınca yola oturur. Tek değişiklik / ölç / göster. ⚠️ Barış onayı. Geri alma: `'["driving"]'` |
| H2 | Faz-2 (a): RunPod motoru tek statiğini ham karodan kendi birleştirsin → forward köprüsündeki uzak trafik sıfırlanır | v141 imaj hattı (build → ghcr → template PATCH → wmax flush) — devir günü riskine eklenmez |
| H3 | Faz-2 (b): geocoding zincirinin önüne Hooder'ın `geo/` R2 önbelleği | Hooder bucket'ına binding = sahiplik sınırında bağımlılık → ayrı karar |
| H4 | Devir kaydını `/opt/oturum-devir/MATRIX-DEVIR.md`ye ölçümlerle yaz | İş biter bitmez (sormadan güncellenir) |

---

## TEK BAKIŞTA SIRA
```
A1 ölç → A2 test → A3 sırlar → A4 "hazır"
   ↓
B1 muafiyet iste → B2 🅷 teyit → B3 ölç → B4 veri-merkezinden ölç
B5 /hooder-api kaçağı → B6 öneksiz tüketiciler                        ← BURASI GEÇİLMEDEN İLERLEME
   ↓
C ⚠️ Barış onayı (DNS + route + geri dönüş planı tek pakette)
   ↓
D1 gri-bulut DNS → D2 🅷 route koordinasyonu → D3 workers.dev duman → D4 deploy
   ↓
E ⚠️ route çevrildi (an kaydedilir)
   ↓
F1 devir-testi --yeni → F2 uyum-test → F3 gerçek video duman testi
F4 ilk render CANLI izlenir → F5 (+1 saat) kaçak sızıntı denetimi
   ↓
FAIL mi? → G route sil + G2 muafiyet/env geri al   |   Temiz mi? → H1-H4
```

---

## EK — TÜKETİCİ ENVANTERİ (31.08 kaçak avı, tam liste)

Harita ucuna giden **her** çağrı. "Muafiyet" sütunu = devir gününde hangi yama/adım kapsıyor.

| # | Tüketici | Uç | Bağlanma biçimi | Bağlam | Muafiyet |
|---|---|---|---|---|---|
| 1 | `render-worker/3d/render3d.js:48,57-60` | `/yukseklik` `/xyz/sat` `/xyz/str` `/mvt` | `HARITA_TABAN` env | headless Chromium (puppeteer) | yama 01 (env) |
| 2 | `render-worker/scripts/route-video.py:311,472,685` | matching · geocoding · styles | `HARITA_UC` env (önekli) | Python urllib | yama 01 + 02 (başlık) |
| 3 | **telefon `/motor3d`** → `telefon-html.js` → `render3d.js` sayfası | `/xyz` `/mvt` `/yukseklik` | `HARITA_TABAN` (harita-proxy env'inden miras) | **WKWebView** | yama 06 (drop-in) |
| 4 | `kisisel-app/tactical/` 5 dosya, 9 çağrı | styles · matching · geocoding | `127.0.0.1:8890` **sabit** | Python+PIL | yama 03 (`TAC_HARITA`) |
| 5 | `cf/tactical-runpod/` (Faz T kopyası) | aynı 9 çağrı | `HARITA_TABAN/_STATIK/_MATCHING/_GEOCODING` | Python+PIL | **env adı çakışması** → B6 · ⚠️ başka workflow'un dosyası, DOKUNMA |
| 6 | `scripts/movelog-cloud.py:187` | matching (ön-eşleme) | `8890` sabit | Python | yama 05 |
| 7 | `scripts/activity-detect.py:30` | geocoding (ters-geokod, ülke) | `8890` sabit | Python | yama 05 |
| 8 | **`scripts/route-video.py:166,287,355`** | matching · geocoding · styles | `8890` sabit | **CANLI** (`movelog-genreq.timer` 2 dk) | 🔴 **YAMA YOK** → B6 |
| 9 | **`scripts/test-render-yerel.sh:37`** | `/xyz` `/mvt` `/yukseklik` | `harita.nickdegs.com` **ÖNEKSİZ** | elle koşulan test, datacenter IP | 🔴 **YAMA YOK** → B6 |
| 10 | `cf/api/src/routes/grup7.ts:379` | matching | `HARITA_UC` (wrangler var) | CF Worker subrequest | yama 04 (başlık) + B6 (CF ASN sorusu) |
| 11 | Backend `main.py:932` | matching | domain kodda sabit, önek `config.env:29` | Python httpx | önek aynıysa kendiliğinden |
| 12 | **`scripts/harita-proxy.py:36` + `harita-kaynak.json`** | **`realvirtuality.app/hooder-api/sat`** | sabit URL, aktif zincir kaynağı | **doğrudan Hooder zone'u**, datacenter IP | 🔴 **YAMA YOK** → B5 |
| 13 | **App harita ekranı** — `/api/mapconfig` → `map-config.json` → `kisisel-api.../harita/` → `8890/xyz` | `/xyz` | nginx `cf-kisisel-api:4` | telefon (her kullanıcı) | bugün yerel; **Faz-2 (H)** |
| 14 | RunPod 3B MVT — nginx `/vektor/` → `8890/mvt` | `/mvt` | nginx `cf-kisisel-api:16` | headless Chromium | bugün yerel; **Faz-2 (H)** |

**Kapsam dışı (harita katmanı DEĞİL, bilerek listede):** Esri `arcgisonline`, EOX `tiles.maps.eox.at`,
terrarium DEM `s3.amazonaws.com/elevation-tiles-prod` (`render3d.js:62`), OSRM/Nominatim public,
Google Photorealistic 3D (`render-google3d.js`). Bunlar Hooder zone'una girmez, muafiyet gerekmez.

---

## EK-2 — MUAFİYET YÖNTEMİ SINAMASI: neden BAŞLIK DEĞİL, YOL ÖNEĞİ (31.08 ölçümü)

K0 §A3 iki seçenek veriyor: ayrı yol öneki `/mlog/…` **veya** sabit `X-Movelog-Key` başlığı.
**Ölçüm, başlığın tüketicilerin yarısında teknik olarak İMKANSIZ olduğunu gösteriyor.**

### Ölçülen gerçek — ön-uçuş (31.08, canlı)
```
OPTIONS https://harita.nickdegs.com/xyz/sat/14/9600/6100.jpg               → 501
OPTIONS https://harita.nickdegs.com/<ONEK>/xyz/sat/14/9600/6100.jpg        → 501
OPTIONS https://kisisel-api.nickdegs.com/harita/sat/14/9600/6100.jpg       → 501
GET     (aynı üç URL)                                                      → 200
```
`X-Movelog-Key` **CORS-safelisted değildir** → tarayıcı bağlamında her karo isteği önce `OPTIONS`
ön-uçuşu yapar → **501** → karo hiç yüklenmez. Yani başlık, tarayıcı tüketicilerinde yalnız
"işe yaramaz" değil, **mevcut çalışan hattı da kırar**. (501'in sebebi: `harita-proxy.py`
`BaseHTTPRequestHandler` yalnız `do_GET`/`do_POST` tanımlıyor; `do_OPTIONS` yok.)

### WKWebView kanıtı (envanter #3 — telefon 3B motoru)
1. **Sayfa bir URL'den yüklenmiyor.** `harita-proxy.py:485-487` yanıtı `{"html": …}` JSON'u olarak
   döndürüyor; app bunu **string olarak** WKWebView'a veriyor. `WKWebView.load(URLRequest)`
   başlıkları **yalnız ana-çerçeve gezinme isteğine** uygulanır — burada öyle bir istek **YOK**.
   Karoların hepsi sayfa-içi **alt-kaynak** isteğidir.
2. **Alt-kaynağa başlık ekleyen public API yok.** WKWebView'da sayfa-içi `fetch`/`XHR`/`<img>`
   isteklerine native tarafta başlık iliştirmenin desteklenen bir yolu yoktur.
3. **`WKURLSchemeHandler` çare değil:** `http`/`https` şemalarına kaydedilemez (WKWebView bunları
   native işler, kayıt istisna fırlatır). Karoları yakalamak için URL'leri özel bir şemaya
   (`mlog://…`) yeniden yazmak gerekir — bu **zaten bir URL yeniden yazımı**, yani öneğin
   dezavantajlı bir biçimi; üstüne CORS/önbellek/Range davranışını da elle taşımak gerekir.
4. **`WKContentRuleList` çare değil:** engelle/gizle/https'e-çevir aksiyonlarını destekler,
   **başlık ekleme aksiyonu yoktur** (o Safari uzantısı API'sidir).
5. **Geriye tek yol kalıyor:** MapLibre `transformRequest` ile JS'ten başlık eklemek — bu da
   yukarıdaki **501 ön-uçuşuna** çarpar. Yani telefon için başlık **hiçbir yoldan uygulanabilir değil.**

**Aynı kısıt render motorunda da var:** `render3d.js:6,499` puppeteer/headless Chromium; karolar yine
tarayıcı bağlamında çekiliyor → ön-uçuş aynı şekilde vurur.

### Sonuç (B1'in gerekçesi, ölçümle sabit)
| Tüketici sınıfı | Yol öneki | `X-Movelog-Key` başlığı |
|---|---|---|
| Python/urllib/httpx (#2,6,7,8,11) | ✅ | ✅ |
| CF Worker fetch (#10) | ✅ | ✅ |
| **WKWebView (#3)** | ✅ | ❌ **imkansız** (1-5 maddeleri) |
| **headless Chromium (#1,14)** | ✅ | ❌ ön-uçuş 501 |
| nginx forward (#13) | ✅ | ✅ (proxy_set_header) |

→ **Birincil işaret YOL ÖNEĞİ olmak ZORUNDA.** Başlık yalnız sunucu-yanı bacaklarda **ikincil/yedek**
işaret olarak istenir (yamalar 02/04 tam olarak bunu yapıyor). B1'in 1. maddesi doğrudur; bu ek
onun **ölçülmüş kanıtıdır**.

### ⚠️ Öneğin bugünkü kusuru (B3 bunu ölçecek — 31.08'de ölçüldü, HENÜZ YOK)
```
GET /xyz/sat/…          → ACAO: *  · CORP: cross-origin · CC: …immutable
GET /<ONEK>/xyz/sat/…   → ACAO YOK · CORP YOK           · CC: …(immutable YOK)
GET /<ONEK>/mvt/…       → ACAO: *  · CORP YOK
```
Yani **muafiyet öneğine taşınan her tarayıcı tüketicisi (yama 01 ve 06) bugün beyaz kare üretir.**
R3 (önekli `/xyz` + `/mvt` için ACAO + CORP) karşılanmadan yama 01 ve 06 **uygulanmamalıdır** —
aksi halde muafiyet, koruduğu şeyi bozar. B3'ün geçme ölçütü bu tablodur.
