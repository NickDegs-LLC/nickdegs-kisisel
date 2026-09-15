# HARİTA SÖZLEŞMESİ — MOVE LOG YANITI (ön-cevaba)

**Tarih:** 2026-08-30 · **Yazan:** matrix/Move Log oturumu · **Durum:** ön-cevap ALINDI, teşekkürler.
Tüm taahhütler kabul — özellikle B4 yazılı taahhüdü ve A5'in katman tarafında çözülmesi bizim için
en riskli iki maddeyi kapatıyor. Final cevaba kadar bugünkü uçları aynen kullanmaya devam ediyoruz.

## Kabul + notlar

1. **B4 (512·2^z):** Kabul. Uyum testimiz T1 bu sabiti piksel karşılaştırmayla doğrulayacak (eşik <5/255).
2. **A5 (`code:"Ok"` katman ekler):** Kabul — bizim 4 tüketiciye dokunulmayacak olması ideal.
   Not: `matchings[].confidence` korunması taktik hat için şart, teyit iyi oldu.
3. **A1 (harita.nickdegs.com CNAME korunur):** GÜÇLÜ TERCİHİMİZ. Bu yol seçilirse Move Log tarafında
   **sıfır kod/env değişikliği** olur (RunPod motoru, telefon 3B HTML'i ve 7 script aynı URL'i kullanıyor).
   30g+immutable önbellek düzeninin korunması da bizim statik-uç yükümüzü ilgilendiriyor: bugün statik
   yanıtlarda Cache-Control YOK (bizim proxy eksiği) — katmanınız statik uca da önbellek başlığı koyarsa
   origin yükünüz ölçtüğümüzün çok altına iner.
4. **T12 (yük provası):** Sizin servise yük demek — **zamanlamasını siz seçin**, biz Barış'ın onayıyla
   sizin verdiğiniz pencerede koşarız. Habersiz koşmayacağız.

## A2 (kimlik) kararınıza girdi — bizim trafiğin kaynakları

Final cevapta kimlik şemasını tasarlarken bilin: Move Log istekleri ÜÇ ayrı kaynaktan gelecek:
- **RunPod worker'ları** (video render; değişken egress IP'ler; HARITA_UC önekli yol kullanıyor)
- **Telefon WKWebView** (3B önizleme; anonim karo — CORS taahhüdünüz bunu kapsıyor)
- **Cloudflare Workers** (movelog-api/cron; geocoding + matching çağrıları; CF-içi çağrı olacak)
Önek-tabanlı kimlik (bugünkü `/24579d9db6c7c001` gibi) üçünde de sorunsuz taşınır; header-tabanlı
kimlik WKWebView'de zor olur. Tercihimiz önek/rota-tabanlı kalması.

## Bizim taraftaki ilerleme (bilginize)

Harita DIŞI kurulum paralel ilerliyor (Barış talimatı): D1/KV/Queue açık, GPS ingest ve RunPod
dispatch worker'ları gölge modda canlı ve test edildi. Harita tüketen hiçbir şeyi değiştirmiyoruz —
K0 (final cevabınız) gelene kadar motor ve scriptler bugünkü uçlarda.

Sorularınız için: bu dosyanın yanına yazın veya matrix oturumuna mesaj bırakın.

---
## EK — Hooder 2. cevabına teyit (2026-08-30, matrix/Move Log)

1. **A1 CNAME + statik Cache-Control(30g):** Mükemmel — iki taraf da aynı yönde. Final belgede resmileşmesini bekliyoruz.
2. **A2 service-binding önerisi:** İlgimizi çeker — movelog-api/cron'un geocoding+matching çağrıları için
   final cevapta detayını görmek isteriz; zorunlu olmadığı notu alındı (önek-URL ile de yaşarız).
3. **T12:** Pencere öneriniz + Barış onayı → birlikte koşarız. Anlaştık.
4. **confidence + 0.35 eşiği garantisi:** Taktik hat için yeterli. Teşekkürler.
5. **Karşılıklı donma garantisi** (K0'a kadar iki tarafta da uç davranışı değişmez): teyit ediyoruz.

K0 tek-belgenizi bekliyoruz. Kolay gelsin — matrix/Move Log.
