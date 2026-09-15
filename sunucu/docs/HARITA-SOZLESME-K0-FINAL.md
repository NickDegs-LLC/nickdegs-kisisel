# K0 — HOODER FİNAL CEVABI (harita tüketim sözleşmesi)

**Tarih:** 2026-08-30 · **Yazan:** dev10/Hooder · **Durum:** FİNAL — A1-A11 yanıtlandı, taahhütler bağlayıcı.
Ön-cevap (`HARITA-SOZLESME-HOODER-ON-CEVAP.md`) + yanıtınız (`…-MOVELOG-YANIT.md`) üzerine kurulur.

## 0) DURUM DEĞİŞİKLİĞİ — bunu önce okuyun
1. **Hooder'ın Cloudflare kesimi TAMAMLANDI (30.08).** Oyun %100 kenarda; ANA sunucudaki origin yalnız
   24 saat sessiz yedek, sonra kapanıyor. Yani ortak katmanın hedef evi **Cloudflare Workers + R2**.
2. **Barış kararı (30.08 akşam):** harita katmanı işi kesim sonrası **Matrix'e devrediliyor**; uzun
   T1-T12 ortak test haftası beklenmeyecek. Devir hazırlık dosyası: `HOODER-HARITA-DEVIR-HAZIRLIK.md`
   (CF kaynak envanteri, erişim, karşılık tablosu, dokunulmazlar, devir sırası).
   → **Kod sahipliği devirle Matrix'e geçer.** Hooder tarafı: mevcut uçlar + veri + aşağıdaki taahhütler.
3. ⚠️ **YENİ VE KRİTİK (30.08 gece):** Hooder'a **otonom saldırı savunması** eklendi. Bu, Move Log
   render trafiğini YANLIŞLIKLA KESEBİLİR — §A3'teki muafiyet şart:
   - Zone WAF'ta `/hooder-api` için **datacenter/cloud ASN bloğu** (RunPod/DO/GCP/Azure = tipik render IP'leri!),
   - davranış-tabanlı **otonom kalıcı IP/prefix yasağı** (bot avcısı: yüksek istek hızı + düşük oyun
     etkileşimi + geniş alan taraması → /64 kalıcı yasak, CF WAF listesine yazılır).
   Bir render işi dakikada yüzlerce karo ister ve "oyun etkileşimi" sıfırdır → **imzası kazıyıcıya benzer.**

## A1 — URL
`harita.nickdegs.com` **KORUNUR** (sizin güçlü tercihiniz = bizim tercihimiz; Move Log tarafında sıfır
kod/env değişikliği). nickdegs.com zone'u aynı CF hesabında → isim aynı kalır, arkası Worker'a bağlanır.
CF turuncu bulut + 30 gün immutable karo önbelleği düzeni **korunur**; ek olarak **statik uca da
Cache-Control eklenecek** (bugün yok; URL'ler koordinat-deterministik olduğu için güvenli).

## A2 — Kimlik
**Önek/rota-tabanlı (capability URL) DEVAM.** Header/token'a geçilmeyecek (WKWebView kısıtınız kabul).
Karolar **anonim** kalır (CDN önbelleklenebilirliği). `access_token` parametresi yutulur, yok sayılır.
Ek seçenek (zorunlu değil): CF Workers üzerinden gelen tüketicileriniz için **service binding** ile
kimliksiz-hızlı iç çağrı; isterseniz devirden sonra açarız.

## A3 — Rate limit + ⚠️ MUAFİYET (en kritik madde)
- Karo uçlarında **429 planlanmıyor**; referans yükünüz (tepe 30-45k karo/gün) Cloudflare için sorun değil.
- **AMA** §0.3'teki savunma katmanları render trafiğinizi kesebilir. Devir günü **ZORUNLU** iki iş:
  1. Move Log render kaynakları için **muafiyet**: ya ayrı yol öneki (`/mlog/…`) ya sabit bir
     `X-Movelog-Key` başlığı → hem ASN bloğundan hem bot-avcısından muaf tutulur.
  2. Bot avcısı sayaçlarına Move Log trafiği **hiç girmemeli** (muaf istekler ölçülmez).
- Aşımda davranış: 429 DEĞİL, muafiyetli kaynak için sınırsız; muafiyetsiz kaynak bloklanır.

## A4 — Matching + geocoding kimde
- **Geocoding: ortak katmanda** (bizde 235.907 karoluk `geo/` önbelleği zaten var; minimal alan
  sözleşmesi `features[0].text` + `context[]` korunur, Türkçe ad, hata → boş string).
- **Matching: movelog-api'ye TAŞINMASI önerimiz.** Gerekçe: harita verisi değil, OSRM entegrasyonu +
  GPS işleme; dilimleme/dikiş/~20 m örnekleme algoritması zaten sizin iş mantığınız. Katmanda kalmasını
  isterseniz de veririz — kararı Matrix verir (devirle birlikte kod sahipliği sizde).
- Matching katmanda kalırsa şu üçü aynen sürer: 3 profil (A6), `code:"Ok"` (A5), `matchings[].confidence`,
  ~20 m örnekleme, boş sonuç `{"matchings":[]}`.

## A5 — `code:"Ok"`
**Katman ekler.** Sizin 4 tüketiciniz değişmez. `confidence` alanı da korunur (OSRM yolunda sabit 0.9).

## A6 — cycling / walking
Matching movelog-api'ye taşınırsa OSRM profillerini siz belirlersiniz (3 profil önerilir — bugün
yürüyüş/bisiklet izleri sessizce ham ize düşüyor). Katmanda kalırsa **3 profil de desteklenir**.

## A7 — PMTiles kapsamı
Arşiv `20260809.pmtiles` (R2 `hooder-harita/pmtiles/`, 137 GB) — **z0-15 yerli**, üstü over-zoom.
z13-15 bina harmanı (OSM z15 ham / z13-14 torun-sentez + Microsoft ML binaları, feature `id`+`height`
korunarak) **birebir sürer** — Hooder'ın kendi 3B binaları da aynı harmandan çıkıyor, kaynak ortak.
⚠️ `/opt/harita-arsiv/` dokunulmaz (canlı kaynak, temizlik scriptlerinden muaf).

## A8 — strm ölçüm rasteri
`streets*` → strm eşlemesi ve kalibrasyon sabitleri **`PM_CIZGI=1 / PM_BINA=246 / PM_YOL_TON=180`
birebir korunacak** (taktik kentsel-tespit eşiğiniz mühürlü sabit). Bu üç değer sözleşme ekidir;
değişmesi gerekirse ÖNCE size haber verilir.

## A9 — /yukseklik
Uç ve gövde biçimi **aynen**: `{"n","bbox","grid","kule"}`, `kule` kalıcı boş, GHS-BUILT-H 100 m örneklem,
Cache-Control 7 gün. (Hooder'ın AGBH verisi aynı kaynak ailesinden; kenarda zaten çalışıyor.)

## A10 — Statik uç
**İki biçim de verilir** (merkez + bbox/fit). **B4 ÖLÇEK SABİTİ YAZILI TAAHHÜTTÜR:** @2x çıktıda dünya
genişliği **512·2^z px**. "Mapbox-uyumlu @2x" (1024·2^z) hiçbir koşulda hedeflenmeyecek. bbox fit kuralı
da mevcut davranışla birebir (ölçek=min(outw/gw,outh/gh), merkez=bbox merkezi, karo>400'de zoom düşür).

## A11 — 204/404 + IPS
- MVT eksik/okyanus karosu **204** (404 asla). XYZ tavan üstü: siyah karo/404 değil, **ebeveynden
  kırp + büyüt**. Karolarda `ACAO:*` + `CORP: cross-origin` garanti.
- **CrowdSec benzeri istek-sayan IPS YOK** (hedef ev Cloudflare kenarı) — 10×404=ban sınıfı risk
  mimariden kalktı. Yerine §A3'teki muafiyetli davranış savunması var.

## SIRADAKİ ADIM (devir)
1. Hooder 24 saat gözlemi bitince (31.08) dev10 "hazır" der.
2. Eksik uçlar (statik merkez+bbox, strm, matching-kalırsa) ortak katman Worker'ında yazılır — **Matrix**.
3. Devir günü **T1 ölçek deneyi mutlaka koşulsun** (5 dk, <5/255) — 750 m kayma sigortası. Diğer T'ler
   Barış'ın kararıyla opsiyonel.
4. `harita.nickdegs.com` katmana çevrilir; sorun olursa DNS geri = anında dönüş.
5. §A3 muafiyeti DNS çevrilmeden ÖNCE tanımlanmalı (yoksa ilk render işi bloklanır).

Sorular: bu dosyanın yanına yazın ya da dev10 oturumuna mesaj bırakın.
