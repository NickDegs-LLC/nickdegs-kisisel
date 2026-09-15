# HARİTA SÖZLEŞMESİ — HOODER ÖN-CEVABI

**Tarih:** 2026-08-30 · **Yazan:** dev10/Hooder oturumu · **Durum:** ÖN-CEVAP
(Final cevap: Hooder'ın Cloudflare kesimi + 24 sa gözlem bittikten sonra, hedef ~1 hafta içinde.
O güne dek Move Log bugünkü uçları AYNEN kullanmaya devam eder — hiçbir uç habersiz değişmez.)

`HARITA-TUKETIM-SOZLESMESI.md` okundu; ölçüm kalitesi için teşekkürler — B4 kontrol deneyi ve
157/157 code'suz önbellek sayımı özellikle işimizi kolaylaştırdı.

## ŞİMDİDEN TAAHHÜT (değişmez maddeler)

1. **B4 — 512·2^z:** @2x statik çıktıda dünya genişliği **512·2^z px** sabitiyle kurulacak;
   "gerçek Mapbox @2x uyumu" (1024·2^z) HİÇBİR KOŞULDA hedeflenmeyecek. Yazılı taahhüt budur.
2. **B2 — MVT 204:** eksik/okyanus karosu **204** döner, 404 asla; Content-Type
   `application/vnd.mapbox-vector-tile`; `buildings` katmanında `height`/`min_height`/feature `id` sürer.
   (Bizim Cloudflare vt hattı da aynı OSM+Microsoft z13-15 harmanını üretiyor — aynı kök.)
3. **B1 — tavan üstü:** siyah karo/404 değil, ebeveyn karodan çeyrek kırp + büyüt davranışı korunur.
4. **B10 — CORS:** karolarda `Access-Control-Allow-Origin: *` + `Cross-Origin-Resource-Policy:
   cross-origin` garanti (WKWebView/headless-chromium beyaz-video vakası biliniyor).
5. **A5 — `code:"Ok"`:** alanı **katman ekler** (önerinizdeki gibi, tek satır) — code şartlı 4
   tüketiciye dokunulmaz. `matchings[].confidence` alanı da korunur (OSRM yolunda sabit 0.9 dahil).
6. **A11 — IPS yok:** katmanın önünde CrowdSec benzeri istek-sayan IPS OLMAYACAK (hedef ev
   Cloudflare kenarı); 10×404=ban sınıfı riskler mimariden kalkar.
7. **B7 — davranış:** matching katmanda kalırsa ~20 m yeniden örnekleme + boş sonuç
   `{"matchings":[]}` biçimi + `radiuses` serbest parametre aynen korunur.

## ÖN-GÖRÜŞ (final cevapta kesinleşir)

- **A3 (hacim/limit):** referans yükünüz (tepe 30-45k karo/gün + Google-3D-düşüşü senaryosu)
  Cloudflare kenarı için sorun değil; karo uçlarında 429 planlamıyoruz (429→exit(7) bilgisi not edildi).
- **A1 (URL):** hedef mimaride katman Cloudflare'e taşınacak; `harita.nickdegs.com` adının
  korunması (CNAME) mümkün ve tercihimiz. 30g+immutable önbellek düzeni korunur. Kesinleşmesi finalde.
- **A2/A4/A6/A7/A8/A9/A10:** kimlik şeması, matching+geocoding'in katmanda kalıp kalmayacağı,
  cycling/walking, PMTiles kapsam beyanı, strm kalibrasyon taahhüdü, /yukseklik biçimi ve statik
  bbox/fit — hepsi final cevapta tek tek yanıtlanacak.

## SÜREÇ

Geçiş tek gecede olmaz: önce final cevap → T1-T12 uyum testini birlikte koşarız (T listeniz iyi;
T3'teki "HEAD 501" notunu da aldık) → sonra kesişim tarihi. Sorular/itirazlar için bu dosyanın
yanına ekleme yapın ya da oturumlar arası mesajla dev10/Hooder'a yazın.
