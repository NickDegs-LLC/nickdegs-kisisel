# Taktik hat → RunPod taşıması

**Tarih:** 2026-08-30 · **Kaynak:** `/opt/matrix/kisisel-app/tactical/` (CANLI — bu taşımada
**hiç değiştirilmedi**, MD5'leri taşıma öncesi/sonrası aynı) · **Hedef:** bu dizin.

Bugünkü hat (movelog-cloud.py:493 → `tac_dispatch.py` → LOKAL render) **kesim gününe kadar aynen
çalışmaya devam eder**. Bu dizin onun RunPod'a taşınmış kopyasıdır.

---

## 1) Mühür — ne değişti (route_gen.py / render_job.py)

Kural: bu iki dosyada **yalnız taban-URL'in env'den okunması** değişebilir. Uygulanan diff bunun
dışına çıkmadı — `diff -u` ile satır satır sayıldı:

| Dosya | Toplam değişen satır | Dağılım |
|---|---|---|
| `route_gen.py` | 68 | 4 URL sil + 4 URL ekle + 5 env/yorum ekle **+ 55 KARO FİKSİ (2026-08-31, saf ekleme)** |
| `render_job.py` | 7  | 1 URL sil + 1 URL ekle + 5 env/yorum ekle |
| `intro_gen.py` | 5  | 1 + 1 + 3 |
| `outro_gen.py` | 5  | 1 + 1 + 3 |

**KARO FİKSİ (2026-08-31, Barış onaylı — mühre yapılan tek istisna).** `route_gen.py`'ye **55 satır
EKLENDİ, 0 satır silindi, 0 satır değiştirildi**. `# >>>KARO-FIKSI … # <<<KARO-FIKSI` bloğu (178-230)
mühürlü `_dtile`'ı `_dtile_ham` diye saklar, sarmalayıcıyı aynı ada bağlar → **mevcut hiçbir satıra
dokunmadan** her iki çağrı yolu (`_dtiles_par._one` ve HBIG) korunur; +2 satır `_karo_denetle()`
çağrısı (242 ve 981). Yeniden deneme 0.3/0.8/2.0 sn (kalıcı 4xx retry edilmez), eşik
`TAC_TILE_FAIL_ORAN=0.02` / `TAC_TILE_FAIL_MUTLAK=8` aşılırsa `RuntimeError` → iş BAŞARISIZ → kuyruk
bekçisi yeniden kuyruğa alır. Davranış sabitleri (aşağıdaki liste) **elle sürülmedi**.
Geri-çevirme kanıtı: fiks + env + URL satırları çıkarılınca md5 `63963465e8206ef763ce31324ddc22d0`
= CANLI `/opt/matrix/kisisel-app/tactical/route_gen.py` ile **birebir aynı**.
Fiksli dosya md5 `b4a623c8616919acd660cd2a62e08943` (1869 satır) — imaj **v2** bunu taşır.

Silinen satırların **hepsi** `http://127.0.0.1:8890/...` içeren URL satırıdır; eklenen URL-dışı
satırların hepsi `HARITA_*` env okuması + yorumdur. Davranış sabitlerinin hiçbirine dokunulmadı
(confidence 0.35, `_BUD=178.0/59.6`, `_OUTRO_BUD=13.2`, 5500 nokta, `CH=90/OVL=12`, radius (22,45),
`PAD=0.22`, `_ATILES=_mppz(z)/2.0`, `(_edge-0.185)/0.095`, `(d-0.055)/0.033`, `(d-0.058)/0.045`,
`_DIN,_DH,_DOUT=1.4,1.2,1.4`, `_NVMIN_F=FPS*9.0`, `_WINMIN`, `_z16bud=460`, `_b17=620`,
`(11,9000.0,60)/(12,3500.0,110)/(13,2000.0,130)` — hepsi yerinde, sayımla doğrulandı).

Taban kopya (diff referansı):
`/tmp/claude-0/-opt-matrix/d2098d40-e95c-419d-b46a-33df2c86a27a/scratchpad/muhur-taban/`

### 1b) MÜHÜR KAYDI — dört dosyanın md5'i (v5 / v141 kurulumunda doğrulandı, 2026-08-31)

| Dosya | md5 (İMAJDA) | Taşıma öncesi CANLI (`/opt/matrix/kisisel-app/tactical/`) |
|---|---|---|
| `route_gen.py` | `b4a623c8616919acd660cd2a62e08943` | `63963465e8206ef763ce31324ddc22d0` (+KARO FİKSİ) |
| `render_job.py` | `753e62f59fbf77f07289a665ec7704eb` | `13362345e5e513fbcc4eb0bc7fd588b1` (+env/URL) |
| `intro_gen.py` | `11d72b0c98d2df53f068a1e4f8d447be` | `c509808771ddec1e9742e9b61c2076a7` (+env/URL) |
| `outro_gen.py` | `98c9437025c7fd846abe3c8d0c15cbbe` | `7714ddc3693cb6ef8370fa182ec8f613` (+env/URL) |
| `scripts/route-video.py` (v141) | `04c66b111916aaaf3e096ae9b47347df` | v140 imajıyla **AYNI** (v141 dosyaya dokunmaz) |

**v4 → v5 ve v140 → v141 geçişinde bu beş md5'in HİÇBİRİ değişmedi** (imaj içinden okundu).

## 1c) STATİK SIDECAR (v5 / v141, 2026-08-31 — GÖREV B)

`harita_yan.py` + `mvt_raster.py` imajın İÇİNE kondu; `basla.sh` CMD olarak yan-servisi
127.0.0.1:8890'de arka planda başlatır, hazır olmasını `"katman": "harita-yan"` kimlik denetimiyle
bekler, sonra handler'ı **`exec`** ile PID 1 yapar (RunPod sinyal/timeout yönetimi bozulmaz).
Handler'ın yan-servisi başlatması GEREKMEZ — bunu CMD yapar.

- Mühür denetimleri: `harita_yan.py --muhur harita-proxy.py` → 4/4 BİREBİR ·
  `mvt_raster.py --muhur pmtiles_okuyucu.py` → 6/6 + kalibrasyon BİREBİR.
- Piksel kanıtı: canlı statik önbellekteki **376 gerçek üretim çıktısı** (302 sat nokta ·
  71 strm nokta · 3 sat bbox) — hepsi **maks fark 0/255**. Konteynerden üretilen 4 görüntü
  proxy tabanıyla **md5 birebir**; boş önbellek + doğrudan Esri ile de aynı md5.
- ⚠️ **Yan-servis YALNIZ `/styles/...` + `/saglik` sunar.** `/matching`, `/geocoding`, `/xyz`,
  `/mvt`, `/yukseklik` → **404 "yol taninmadi"** (ölçüldü).

## 2) HARITA_* env ailesi

| Değişken | Varsayılan | Kullanan |
|---|---|---|
| `HARITA_TABAN` | `http://127.0.0.1:8890` | diğer üçünün varsayılanı |
| `HARITA_STATIK` | `=HARITA_TABAN` | `route_gen` bbox/`_dtile`/`_road_density`, `intro_gen.sat`, `outro_gen.sat` |
| `HARITA_MATCHING` | `=HARITA_TABAN` | `render_job._snap_to_roads`, `_qa_render` |
| `HARITA_GEOCODING` | `=HARITA_TABAN` | `route_gen._rgeo2` |

**Env yokken davranış bugünküyle birebir** (varsayılan = yerel proxy). RunPod'da template env'i
dördünü de `https://harita.nickdegs.com/<gizli önek>` yapar.

> **GÜNCEL (2026-09-02):** statik artık imaj-içi yan-servisten (`basla.sh` → `harita_yan.py`,
> 127.0.0.1:8890) geliyor; template `egptl6t4pr` env'inde **HARITA_TABAN/HARITA_STATIK YOK** (varsayılan
> yan-servise düşer). Yan-servisin sokak (`strm`) zinciri için **`HARITA_MVT` + `HARITA_UZAK`** =
> `https://harita.nickdegs.com/<gizli önek>` template'te ŞART — yoksa `streets-v12` bembeyaz döner ve
> `_road_density` her yeri kırsal sayar (NV/şehir zoom açılmaz; 31.08-02.09 arası böyleydi, 02.09 eklendi).
> Template env: `HARITA_GEOCODING`, `HARITA_MATCHING`, `HARITA_MVT`, `HARITA_UZAK`, `MAPBOX_PUBLIC`,
> `TAC_CHUNKS`, `TAC_ECHO`, `TAC_TIMEOUT`. Env slotta donar → env değişince EXITED slotları `podTerminate`.

Doğrulama (2026-08-30, uzak uç ↔ yerel proxy):

| Aile | Uzak | Yerel | Sonuç |
|---|---|---|---|
| bbox statik | 200 · 582493 B | 200 · 582493 B | **md5 aynı** (`9edf237a…`) |
| `_dtile` karo z16 | 200 · 489898 B | 200 · 135110 B (z14 örneği) | md5 aynı (aynı istek karşılaştırıldı) |
| `streets-v12` | 200 · 370344 B | — | çalışıyor |
| geocoding | 200 · `features[0].text`+`context` | — | sözleşme şekli doğru |
| matching | `{"matchings":[]}` | `{"matchings":[]}` | **birebir aynı** |

## 3) Dockerfile.tac — düzeltilen eksikler

| # | Eksik | Düzeltme |
|---|---|---|
| E1 | `runpod` paketi kurulmuyordu → `import runpod` anında ölürdü | pip'e eklendi |
| E2 | `CMD gunicorn cr_handler_tac:app` (Cloud Run) → serverless handler hiç başlamazdı | `CMD python3 -u rp_handler_tac.py` |
| E3 | `openssh-client` yok (`render_job:87` scp) | kuruldu (cloud modda zaten çağrılmaz, güvence) |
| — | `libsndfile1` | kuruldu |
| P1 | Pillow imajda 12.2.0, host'ta **12.3.0** (görsel çıktı için kritik) | `Pillow==12.3.0` pinlendi |
| P2 | numpy/soundfile pinsizdi | `numpy==2.4.6`, `soundfile==0.14.0` pinlendi |
| — | build'de parite denetimi yoktu | `assert` içeren PARİTE RAPORU adımı eklendi |

**Taban imaj `python:3.14-slim` KORUNDU** (ubuntu:24.04 denendi, build çöktü). Sebep —
chatterbox-tts 0.1.7 metadata'sı: `torch==2.6.0 ; python_version < "3.14"` ve
`numpy<2.0.0 ; python_version < "3.13"`. Python 3.12'de chatterbox torch'u 2.6.0 CUDA'ya (766 MB)
ve numpy'ı 2.0 altına zorluyor; host'un kanıtlanmış `numpy 2.4.6 + torch 2.13.0+cpu` kombinasyonu
ancak 3.14'te çakışmasız kuruluyor. **Eski imajın 3.14 seçimi isabetliymiş.**

Kalan bilinçli parite farkları: Python 3.14 (host 3.12.3) ve ffmpeg 7.x (host 6.1.1) — ikisi de
Cloud Run taktik hattında aylarca üretim yapmış saha-kanıtlı kombinasyon; `render_job` çıkışı süre
+ LUFS ile kendi doğruluyor.

## 4) rp_handler_tac.py — taşıma revizyonu

- **TIMEOUT** 1500 sn sabitti → `TAC_TIMEOUT` env'i (varsayılan **3300**, Cloud Run karşılığı).
  3 dk'lık video (`speed=slow`, `_BUD=178.0`) 25 dk'ya sığmayabilirdi → sessiz kesilme riski kapandı.
- **AVATAR (keşif E6):** job'ta `avatar_url` (presigned GET) varsa indirilip `job["avatar"]` yerel
  yola çevrilir. `render_job.py:339` zaten `job.get("avatar")` önceliklidir → **mühürlü kod
  değişmeden** çözülür. R2'de `avatars/` bugün BOŞ → alan konmaz, bugünkü silüet davranışı korunur.

## 5) Dosyalar

- `rp_handler_tac.py` — RunPod serverless girişi (tek canlı entrypoint).
- `cr_handler_tac.py`, `cr_job_tac.py`, `tac_dispatch.py` — Cloud Run / lokal yollar. GCP 2026-08-05'te
  bilinçli kapatıldı; **köken kaydı** olarak duruyorlar, imajda kullanılmıyorlar.
- `endpoint-kur.py` — RunPod endpoint'ini kurar (kota açılınca; bkz §6).
- `_qa_render.py` — QA aracı, `.dockerignore`'da → imaja girmez.

## 6) AÇIK İŞLER (Barış kararı ister)

1. ~~**🔴 RunPod endpoint'i KURULAMADI — worker kotası 20/20 dolu.**~~
   **✅ KAPANDI 2026-08-31 (Barış kota onayı).** `movelog-render` wmax **15 → 12** (REST PATCH),
   boşalan 3 worker ile `movelog-tactical` = **`yvkajd6x7mp1lj`** kuruldu (CPU,
   `instanceIds=[cpu5g-8-32, cpu3g-8-32]`, wmin 0 / wmax 3, idle 30, REQUEST_COUNT/1,
   execTimeout 3.9 M ms, template `egptl6t4pr` → imaj **v2**). Toplam 20/20 korundu; diğer 7
   endpoint'in **hiçbir alanı** değişmedi (alan-alan diff ile kanıtlandı).
   Bağlandı: `dispatch` + `cron` wrangler.toml `RUNPOD_ENDPOINT_TAC`, ikisi de deploy edildi.
   `bekci-ortak.ts` `wmaxVars` render için 15→12 düşürüldü (yoksa ilk wmax=0 arızasında bekçi
   render'ı 15'e geri açıp kota devrini SESSİZCE geri alırdı), `imaj-surum-bekcisi.ts` hedefi v2.

   🔴 **TUZAK — REST `computeType` sessizce yok sayılıyor.** `POST /v1/endpoints` gövdesindeki
   `computeType:"CPU"` + `cpuFlavorIds` + `vcpuCount` uygulanmıyor; endpoint **GPU** kuruluyor ve
   REST GET `computeType`'ı hiç döndürmediği için fark edilmiyor. İlk deneme (`x02n1kbf932caz`)
   bu yüzden GPU çıktı, silindi. Gerçek tip yalnız GraphQL'de görünür
   (`query { myself { endpoints { computeType instanceIds } } }`, User-Agent ŞART); düzeltme
   `saveEndpoint` mutation'ı. `endpoint-kur.py` artık kurduktan sonra bunu **otomatik doğrular
   ve gerekirse CPU'ya çevirir** (`--cpuya-cevir` bayrağı da var).
2. **🟠 Kullanıcı müziği (keşif E5).** `render_job._music_http` müziği `BACKEND/api/internal/music`
   + `RENDER_DONE_SECRET` ile çeker; RunPod'da sır YOK → sessizce **rastgele müziğe** düşerdi
   (Barış'ın 2026-08-03 şikâyeti). Bu yüzden dispatch worker'ı özel müzikli işleri RunPod'a
   **göndermiyor** (bugünkü `tac_dispatch.py:90-93` kuralının aynısı). Kesim gününden önce karar
   gerekiyor — `usermusic/{user}/{mid}.m4a` R2'de MEVCUT, yani presigned GET + konteyner-içi mini
   müzik ucu ile mühür kırılmadan çözülebilir (~30 satır, ayrı onay).
