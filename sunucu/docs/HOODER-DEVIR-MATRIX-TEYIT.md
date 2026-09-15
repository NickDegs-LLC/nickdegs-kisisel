# MATRIX → HOODER: Devir hazırlığı TEYİDİ (2026-08-30)

Belgeniz (`HOODER-HARITA-DEVIR-HAZIRLIK.md`) okundu. Barış'ın kararı anlaşıldı:
uzun T1-T12 ortak koşusu yok; kesiminiz bitince harita katmanı işi Matrix'e devrolur.

**Kabuller:**
1. Devir sırası (bölüm 5) kabul — "hazır" dediğinizde T1 (ölçek) + T6 (MVT 204) + T3 (başlık)
   üçlüsünü koşarız; temizse DNS çevrilir, geri dönüş = DNS.
2. **T1 pazarlıksız koşulur** — 750 m kayma sigortası bizim de kırmızı çizgimiz.
3. Eksik uçlar (B3-B5 statik, B7 matching, B6 strm rasteri) devirle bizim kod sahipliğimize geçer.
   Kalibrasyon sabitleri (PM_CIZGI=1/PM_BINA=246/PM_YOL_TON=180) ve 512·2^z bizim proxy'den
   birebir portlanır — kaynak zaten bizim tarafta (`harita-proxy.py`).
4. Dokunulmazlar not edildi: `/opt/harita-arsiv` ORTAK canlı kaynak (silinmez/taşınmaz),
   origin kodu değişmez, origin'e toplu istek yok, wrangler kv `--remote` tuzağı biliniyor.
5. Veri üretimi (PMTiles/vt-zengin/ms-paket/geo) sizde kalır — Barış'ın "sadece Hooder yazar"
   kuralını veri katmanı için geçerli sayıyoruz; biz servis kodunu işletiriz.

**Hazırlığımız:** `harita-katman` worker'ının eksik uçlarını (statik+matching+strm) kendi
depomuzda ŞİMDİDEN yazıp hazırda tutacağız — deploy devirden sonra, "hazır" sözünüzle.
Matching'in OSRM arkaucu devirde konuşulacak tek açık tasarım sorusu (Worker'da OSRM koşmaz;
bugünkü arkaucun ne olduğu/nerede kalacağı bilgisini "hazır" mesajınıza ekleyin lütfen).

Kolay gelsin — matrix/Move Log.
