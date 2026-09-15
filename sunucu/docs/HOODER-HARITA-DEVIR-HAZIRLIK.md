# HOODER → MATRIX: HARİTA KATMANI DEVİR HAZIRLIĞI

**Tarih:** 2026-08-30 · **Yazan:** dev10/Hooder · **Durum:** HAZIRLIK (devir, Hooder'ın Cloudflare
geçişi tamamlanınca Barış'ın sözüyle yürürlüğe girer)
**Barış kararı (30.08):** Uzun T1-T12 ortak test süreci BEKLENMEYECEK — geçişten sonra harita
katmanı işi doğrudan Matrix'e devredilir (Barış yarın müsait değil). Kritik tekil kontroller
(bilhassa T1 ölçek deneyi) yine de koşulmalı — 5 dakikalık iş, 750 m kayma sigortası.

## 1) Cloudflare kaynakları (erişim: `source /usr/local/bin/api-env.sh` → CF_GLOBAL_KEY/CF_EMAIL — tüm oturumlarda aynı)
- Hesap: 45241304800d3e122aced1f0ae599943 (daclen10) · Workers Paid AKTİF
- **Workers:** hooder-kapi (gateway/rota tablosu) · hooder-harita (vt karolar + statik aile + sat) ·
  hooder-cekirdek (okuma uçları) · hooder-para · hooder-guvenlik (bildirim/push RPC) ·
  hooder-cron (18 motor: sağlık/yedek/ekonomi) · hooder-indir (MS bina paketleri, Queue)
- **R2 `hooder-harita`:** `pmtiles/20260809.pmtiles` (vektör kaynak) · `vt-zengin/` (üretilmiş MVT) ·
  `ms-paket/` (Microsoft bina paketleri + _kapsam.json) · `statik/` (yasal/PWA/piyon3d/sprite) ·
  `geo/` (235k geocoding önbelleği) · `stil/` · `yedek/`. Ayrıca `hooder-sat` (uydu XYZ), `hooder-yedek` (DB yedekleri).
- **KV** hooder-ayar: 75b9e274f076450da3eb86f6882b8fc3 · **D1** hooder-ana: d6552d4d-71ff-40e1-9071-c1d263012512
- **Kaynak kod:** /root/dev10/outputs/hooder-cf/ (worker/=harita, kapi/, cekirdek/, guvenlik/, cron/, para/, db/, kesim/)
- Kesim runbook + engel kayıtları: kesim/kesim.sh · kesim/ENGELLER.md (A1-A97) · kesim/SOZLESME.md

## 2) Move Log beklentilerinin bugünkü karşılıkları
| Beklenti | Cloudflare'de var mı | Not |
|---|---|---|
| B2 MVT bina (OSM+MS harman, z13-15) | ✅ hooder-harita `/vt` | aynı kök harman; 204 politikası eklenecek (bugün Hooder hattında farklı) |
| B1 XYZ uydu | ✅ kısmen (`/sat` + hooder-sat R2) | `?k` tavan/ebeveyn-kırpma portlanacak |
| B9 /yukseklik | ✅ veri (AGBH) kenarda | uç biçimi `{grid,kule:boş}` portlanacak |
| B8 geocoding | ✅ geo/ önbelleği | Nominatim canlı çağrı politikası A4 kararına bağlı |
| B3-B5 statik (merkez+bbox) | ❌ YAZILACAK | ⚠️ B4: dünya genişliği **512·2^z** — 1024 ASLA (750 m kayma vakası) |
| B7 matching (OSRM) | ❌ YAZILACAK | `code:"Ok"` katman ekler + `confidence` korunur + ~20 m örnekleme |
| B6 strm ölçüm rasteri | ❌ YAZILACAK | kalibrasyon sabitleri (PM_CIZGI=1/PM_BINA=246/PM_YOL_TON=180) birebir |

## 3) Değişmez taahhütler (HARITA-SOZLESME-HOODER-ON-CEVAP.md — Move Log kabul etti)
512·2^z · MVT eksik karoya 204 · tavan üstü ebeveyn-kırpma · karolarda ACAO:*+CORP ·
code:"Ok"u katman ekler · IPS yok · ~20 m örnekleme + `{"matchings":[]}` boş biçimi.
A1 CNAME (harita.nickdegs.com) iki tarafın da tercihi; A2 kimlik önek/rota-tabanlı kalır.

## 4) Dokunulmazlar + tuzaklar
- `/opt/harita-arsiv/` (137 GB pmtiles) = canlı kaynak, ORTAK, silinmez/taşınmaz (disk raporlarında şişkinlik sanılmasın).
- Origin kodu (/opt/payment/hooder_service.py, harita_vektor.py) değiştirilmez.
- Origin'e düşebilecek TOPLU istek yasak (29.08 gece kazası) — kesim sonrası origin kapalı, konu kalkar.
- Wrangler 4 kv komutları varsayılan YEREL — `--remote` şart.
- Mevcut Matrix proxy'si (harita-proxy.py) devir tamamlanana dek AYNEN çalışır; Move Log uçları habersiz değişmez.

## 5) Devir anında yapılacaklar (sıra)
1. dev10 kesimi bitirir (origin kapalı, oyun %100 kenarda) — Matrix'e "hazır" der.
2. Statik+matching+strm uçları hooder-harita worker'ına (ya da ayrı `harita-katman` worker'ına) yazılır —
   kod sahipliği devirle Matrix'e geçer; dev10 Hooder-özel worker'ların sahibi kalır.
3. T1 ölçek deneyi + T6 MVT-204 + T3 başlık kontrolü (15 dk) → harita.nickdegs.com DNS'i katmana çevrilir.
4. Move Log tüketicileri hiç değişmeden yeni katmanda çalışır; sorun olursa DNS geri = anında dönüş.

İletişim: dev10 oturumu ulaşılabilir; sorular bu dosyanın yanına ya da oturumlar arası mesajla.
