# Move Log Cron Görevleri — 26 systemd timer → Cloudflare Cron (Faz 0 çıktısı)

**Tarih:** 2026-08-30 · **Kaynak:** `/etc/systemd/system/*.timer` + `.service` ExecStart + scriptlerin kendisi (hepsi açıldı, satır referansları `tasks.json`'da).
**Makine tablosu:** `/opt/matrix/cf/cron/tasks.json` (26 kayıt).
**Plan bağlamı:** `/opt/matrix/docs/MOVELOG-CLOUDFLARE-PLAN.md` §3 (movelog-cron worker) ve Faz 3.

## Ölçülen gerçekler (tahmin değil)

- Sunucu TZ = **CEST (UTC+2)**, `timedatectl` ile ölçüldü. `OnCalendar` yerel saatleri UTC'ye buna göre çevrildi; **Cloudflare Cron UTC'dir**, kışın CET'e dönüşte sunucu takvimli 4 görev (hava, ilkvideo-nudge, rozet, optimize) 1 saat kayardı — CF'de sabitlenecek.
- İki timer'ın AÇIKLAMASI süresiyle çelişiyor (ölçüldü):
  - `movelog-broadcast.timer` "her dakika" der, gerçek `OnUnitActiveSec=20` → **20 saniye**.
  - `movelog-pending-reconcile.timer` "3 dakikada" der, gerçek `OnUnitActiveSec=60` → **1 dakika**.
- **30 sn'lik iki görev dakikaya yuvarlandı** (CF cron minimumu 1 dk): `activity-detect` (30s) ve `movelog-rangereq` (30s). 20 sn'lik `movelog-broadcast` da dakikaya yuvarlandı; üçünde de doğru CF çözümü cron değil **olay-güdümlü** çalışmak (aşağıda görev notlarında).

## Tetik grupları (Cron Triggers sınırı: Worker başına 5 ifade)

`movelog-cron` worker'ı **3 cron ifadesi** kullanır; görevler grup içinde dakika/saat eşleşmesiyle (modulo) seçilir. 2 ifade yedek kalır.

| Tetik grubu | Cron ifadesi | Görevler |
|---|---|---|
| **dakikalık** | `* * * * *` | activity-detect (30s→1dk), pending-reconcile (1dk), broadcast (20s→1dk, geçiş sonrası Queue consumer), rangereq (30s→1dk, geçiş sonrası API-anında), genreq (2dk: `dk%2==0`) |
| **10dk** | `*/10 * * * *` | render-bekci (10dk), grupsurus (10dk), olay-watch (15dk→10dk), review-state-watch (12dk→10dk), rearm (30dk: `dk∈{0,30}`; bugünkü 5,35 ofseti önemsiz), integrity-auto (30dk), yorum-watch (30dk) |
| **saatlik** | `0 * * * *` | video-kontrol (6h: `saat%6==0`), gunluk-rapor (06:00), hava (→16:00), ilkvideo-nudge (→16:00), rozet (→18:00), kulup-karne (Paz→16:00), weekly-recap (Paz 16:00), wrapped (20 Ara 15:00) |

Saatlik gruptaki günlük görevlerin dakikaları saat başına yuvarlanır (15:40/15:45→16:00, 18:15→18:00, Paz 15:30→16:00) — hepsi bildirim/rapor işi, dakika hassasiyeti yok. Birebir dakika istenirse yedek 2 ifadeden biri (`40-45 15 * * *` gibi) kullanılabilir.

## Görev özeti (öncelik sırasıyla)

### KRİTİK (kullanıcı bunlar durunca fark eder)

| Görev | Tempo | Ne yapar | CF'de |
|---|---|---|---|
| **activity-detect** | 30s→1dk | Traccar GPS → aktivite algıla → ride kaydı + OTO-VİDEO dispatch (RunPod/taktik/telefon) + retry | Çekirdek TS'e portlanır: D1 positions + Queue dispatch + R2 retry + KV `.bulut-kapali`. **En büyük port işi.** TCX→Element ayağı TAŞINMAZ (kişisel). |
| **movelog-pending-reconcile** | 1dk | Takılı "Hazırlanıyor"ı iyileştir: R2'de varsa finalize, çökmüşse failed, yetim videoyu kurtar | Temiz aday: D1 + R2 binding; render-done HTTP yerine D1 transaction (bugünkü oku-değiştir-yaz yarışı da kapanır). pgrep yerine RunPod job status. |
| **movelog-render-bekci** | 10dk | RunPod wmax=0'ı kendisi açar, bakiye/kuyruk/genreq bekçiliği, `.bulut-kapali` bayrağı | Neredeyse birebir: fetch + KV durum + Telegram. Bayrak KV anahtarı olur (activity-detect ve dispatch aynı anahtarı okur). |

### YÜKSEK (kullanıcıya görünür akışlar)

| Görev | Tempo | Ne yapar | CF'de |
|---|---|---|---|
| **movelog-broadcast** | 20s→1dk | pushq/adminq/broadcast kuyruklarını boşaltır (arkadaşlık, canlı-takip sessiz push, duyuru) | Dosya kuyruğu ölür → push doğrudan Queue/D1'e yazılır, consumer saniyeler içinde gönderir (bugünden hızlı). Cron sadece süpürge. |
| **movelog-genreq** | 2dk | Manuel video kuyruğu → LOKAL route-video.py (flat/flyover); tactical/3d'yi movelog-cloud'a bırakır | Kuyruk Queue'ya taşınır; **render Worker'da imkânsız (PIL/ffmpeg)** → RunPod motoruna (Faz T deseni). Tek-tüketici Queue bugünkü genreq/movelog-cloud yarışını da bitirir. |
| **movelog-rangereq** | 30s→1dk | Tarih-aralığı özeti: Traccar → km/hız/tip → `sent_act/*_ozet.txt` + push | Cron ölür: `/api/rangereq` movelog-api'de anında işlenir (D1 positions), özet D1'e. rsync zinciri de ortadan kalkar. |
| **movelog-rearm** | 30dk | 2-48 saattir sessiz cihaza sessiz push → iOS takip tetiklerini diriltir | D1 son-fix + KV marker (TTL 2h) + Worker APNs. Oto-takip zincirinin parçası, activity-detect ile birlikte gelmeli. |

### ORTA

| Görev | Tempo | Ne yapar | CF'de |
|---|---|---|---|
| movelog-grupsurus | 10dk | Birlikte sürüş algıla → ortak 3D video dispatch / upsell | Algoritma TS'e port (yüksek efor); D1 positions + Queue. |
| movelog-integrity-auto | 30dk | Cihaz doğrulamayı ölçerek aç, 403 patlarsa geri al | Yeniden tasarım: enforce bayrağı KV (restart kavramı ölür), istatistik D1, 403 ölçümü Worker'ın kendi sayacından (nginx log yok). |
| movelog-video-kontrol | 6h | Son videoları kullanıcı gibi indirip oynatılabilirlik sınar | R2 head + teslim GET + ftyp/moov bayt kontrolü taşınır; **ffprobe adımı taşınmaz** (subprocess yok) — bayt kontrolü yeter, istenirse RunPod QA job'ı. |
| movelog-hava | günlük | Yarın hava güzelse "sürüş havası" push'u (Open-Meteo) | Kolay: D1 son konum + Open-Meteo fetch + KV sayaç. |
| movelog-rozet | günlük | detected_rides'tan rozet hesabı → internal/badges | Kolay: D1 + internal fonksiyon. ⚠️ Koddaki gömülü REG_SECRET (rozet+activity-detect'te aynı) wrangler secret'a alınıp ROTATE edilmeli. |
| movelog-weekly-recap | haftalık | 12 dilde haftalık özet push'u (CANLI) | Kolay: D1 + Worker APNs/FCM. |

### DÜŞÜK

| Görev | Tempo | Ne yapar | CF'de |
|---|---|---|---|
| movelog-gunluk-rapor | günlük | Üye/satış sayımı; yalnız YENİ satın alımda Barış'a bildirim | Kolay: D1 COUNT + KV + Telegram. |
| movelog-ilkvideo-nudge | günlük | Video üretmemişe ömür boyu 1 davet (günde ≤5) | D1 + km sorgusu positions'tan. |
| movelog-kulup-karne | haftalık | Kulüp karnesi push'u | Kolay. |
| movelog-olay-watch | 15dk | Hediye/kulüp/grup-video olaylarını Barış'a bildir | Doğrusu olay kaynağında bildirim; cron süpürge kalır. |
| movelog-yorum-watch | 30dk | ASC yeni yorum bildirimi | ES256 WebCrypto + KV; review-state-watch ile birleştirilebilir. |
| movelog-review-state-watch | 12dk | iOS review durumu değişince bildir | Aynı desen. |
| movelog-wrapped | yılda 1 | 20 Aralık Wrapped duyurusu | En kolay. |

## TAŞINMAYACAKLAR (6 görev) ve nedenleri

1. **traccar-gpx** — Barış'ın KİŞİSEL günlük rota GPX'i → Element. Move Log kullanıcılarıyla ilgisi yok; Matrix/Synapse ve Traccar bu sunucuda kalıyor. Kapsam dışı.
2. **movelog-adminnum-sync** — eski iki-makine (10.99.0.2/ND2) rsync kalıntısı. admin-numbers Faz 2'de bir kez KV'ye alınır; senkron görevi kavramen ölür.
3. **movelog-routes-sync** — sunucular arası dosya rsync'i. CF'de videolar R2'de, özetler D1'de doğar; "iki dizini eşitle" diye bir iş kalmaz.
4. **movelog-tacclean** — yerel disk hijyeni. CF'de disk yok; Faz T sonrası taktik work-dir RunPod'un geçici diskinde ölür, R2 lifecycle (1 gün) zaten var. Sunucu emekli olana dek sunucuda kalır.
5. **movelog-optimize** — Meta reklam bütçe optimizasyonu; backend'in değil pazarlamanın parçası, app buna bağlı değil. Teknik engel yok (fetch+WebCrypto yeterdi) ama bu göçün kapsamı dışında — sunucu emekliliğinde kaderi Barış'a sorulacak.
6. **movelog-yenisurum-hatirlatma** — tek atımlık: v1.9 onayında kampanyayı açıp FLAG yazıyor ve KENDİ timer'ını disable ediyor. Göç bitmeden ömrünü tamamlar; taşımaya değmez.

Ayrıca **kısmen taşınmayan parçalar**: activity-detect'in TCX→Element ayağı (kişisel), integrity-auto'nun nginx-log/docker-restart mekanizması (KV bayrakla gereksizleşir), video-kontrol'ün ffprobe adımı (Worker'da subprocess yok), activity-detect'teki ölü gcloud pubsub yolu (hiç portlanmaz).

## Porta gömülü tuzaklar (scriptlerden ölçüldü)

- **Sabit URL'ler:** `127.0.0.1:8084` (Traccar) 8 scriptte, `127.0.0.1:8780` (backend) 4 scriptte, `127.0.0.1:8890` (harita-proxy geocoding) activity-detect satır 30'da. Plan §2 "sabit URL tuzağı" ile tutarlı; cron worker'da hepsi binding/env olur.
- **Gömülü sır:** `REG_SECRET` activity-detect.py:19 ve movelog-rozet.py:12'de düz metin; Matrix bot token'ı activity-detect.py:16 ve traccar-gpx.py:12'de. `cf/SECRETS.md` envanterine girmeli + rotate.
- **RunPod GraphQL User-Agent şart** (render-bekci satır 105-111) — Worker fetch'inde UA başlığı unutulmamalı.
- **pgrep bağımlılığı** (pending-reconcile, tacclean): CF'de süreç yok; karşılığı D1'e yazılmış RunPod job id + status sorgusu. ([[feedback-monitor-pgrep-footgun]] zaten bu deseni yasaklıyor.)
- **flock kilitleri** (claude-shared.lock, activity-detect.lock, fcntl): CF'de eşzamanlılık koruması cron worker'ın tek-uçuş kuralı + D1 `INSERT OR IGNORE` kilit satırıyla sağlanır; Queues zaten tek tüketici.
- **DST:** OnCalendar'lı 6 görevden 4'ü yerel saat (yazın/kışın 1 saat oynar), 2'si UTC sabit (gunluk-rapor, weekly-recap). CF'de hepsi UTC'ye sabitlenecek; Barış'a görünür tek fark hava/nudge/rozet push'larının kışın 1 saat kayması (bugün de sunucu TZ'siyle kayıyordu).

---

# BEKÇİ KATMANI — kendi kendini onaran hat (Faz T, 2026-08-31)

Barış'ın şartı: *"sunucudan tamamen bağımsız, kendi kendine çalışan, kendi kendine onaracak."*
6 yeni görev + genişletilen `render-bekci` bu katmanı kurar. Her tur **TESPİT → ONAR → DOĞRULA →
D1 `bekci_olay` → gerekirse bildirim kuyruğu** çevrimini işletir (`src/gorevler/bekci-ortak.ts`).

| Bekçi | Grup / tempo | Ne tespit eder | Nasıl onarır |
|---|---|---|---|
| `runpod-saglik` | 10dk | Her endpoint'te `workersMax==0` sessiz arızası · bakiye eşiği · `/health` 402 · taktik endpoint hiç yok | `PATCH workersMax=<son iyi değer>` + RE-GET doğrulama · KV `bulut-kapali` bayrağı (kuyruk telefona) · kurulmamış endpoint onarılamaz → bildirim |
| `kuyruk-bekcisi` | 5dk | `dispatch:bekleyen:*` park edilmiş iş · izi kayıp `render:kuyruk:*` kaydı | Engel kalktıysa RENDER_Q'ya yeniden gönderim (max 3) · geçmezse `render-failed` + kullanıcıya "üretilemedi" (sonsuz *Hazırlanıyor* önlenir) |
| `imaj-surum-bekcisi` | 30dk | Template imajı ↔ KV'deki beklenen sürüm · yeni imaj sonrası **sıcak worker** | `wmax 0→N` flush (yalnız `/health` boşken; koşan render kesilmez). İmajı DEĞİŞTİRMEZ — o yapılandırma işidir, bildirilir |
| `video-butunluk` | 3 saat | Son videoların R2 bütünlüğü (yok / <0.3 MB / `ftyp` yok / `moov` ilk 256 KB'de yok) | Rotayı D1 `positions`'tan yeniden kurup `pending_videos` + RENDER_Q'ya alır (max 2 deneme) |
| `d1-tutarlilik` | 30dk | Hayalet `videos` satırı (R2'de yok) · 6 saati aşan `pending` (emniyet ağı) · `videos`∩`pending`/`failed` çelişkisi | Hayaleti siler (1 saatten taze satıra dokunmaz, tur başına ≤25) · `render-failed` · çelişen satırı siler · `bekci_olay` 30 gün budaması |
| `kendi-kendini-test` | saatlik | api `/health` · D1 yaz/oku · R2 yaz/oku/sil · **Queue üretici→tüketici** · RunPod `/health` · dispatch `/health` · görev canlılığı | Kırık ayağın sahibi bekçiyi `gorev_takvimi.next_run=0` ile hemen sıraya alır (CF'de "restart" karşılığı) |

## Kuru (golge) ↔ canlı farkı — mutlak

`ORTAM != 'canli'` iken `onar()` **uygula()'yı hiç çağırmaz**; satır `sonuc='kuru'`,
`aksiyon='YAPARDIM: …'` olarak yazılır ve **RunPod'a tek fetch bile gitmez** (bakiye korunur).
Bildirimler her iki modda da `bildirimBekleyen` → KV `bildirim:bekleyen:*` kuyruğuna düşer
(gerçek Telegram/Matrix gönderimi Faz 3 tüketicisinin işi). `ORTAM='canli'` olunca aynı kod
gerçekten onarır ve `dogrula()` ile teyit eder.

## Çift-sahiplik koruması (sahiplik kirası)

`runpod-saglik` her turda KV `bekci:runpod:sahip` kirasını **1 saat TTL** ile yeniler.
`render-bekci` kirayı görürse kendi wmax/bakiye bloklarını atlar → **çift PATCH / çift bildirim
olmaz**. `runpod-saglik` durursa kira 1 saatte düşer ve `render-bekci` görevi **kendiliğinden geri
alır** (tek nokta arıza yok). Kuyruk tıkanıklığı + gönderilemeyen iş blokları her zaman
`render-bekci`'de kalır.

## ⚠️ Worker→Worker HTTP YASAK (2026-08-31 ölçüldü)

Aynı `*.workers.dev` bölgesindeki başka bir worker'a `fetch()` **"error code: 1042" + HTTP 404**
döner (dışarıdan `curl` aynı adrese 200 verir). Doğru mekanizma **service binding**'dir;
`kendi-kendini-test` `env.API` / `env.DISPATCH` binding'lerini kullanır
(`cron/wrangler.toml` → `[[services]]`).
**Açık kalan:** `video-kontrol` görevinin teslim-ucu ayağı hâlâ `${API_UC}/api/rides/{rid}/video`
HTTP çağrısı yapıyor. Bugün zararsız (cron'da `JWT_SECRET` yok → R2 bayt yoluna düşüyor) ama
o sır yüklendiği anda **her turda yanlış alarm** verir. Düzeltmesi tek satır (service binding),
Barış'ın onayı bekleniyor.

## Olay tablosu

`bekci_olay(id, ts, bekci, tespit, aksiyon, sonuc, detay_json)` — migration
`db/migrations/0004_bekci_olay.sql`. `sonuc ∈ saglam | onarildi | kuru | bildirildi | basarisiz | atlandi`.
Rutin satırlar (`saglam` / rutin `kuru` / `atlandi`) KV geçidiyle **en fazla saatte-birkaç kez**
yazılır; gerçek tespit ve onarım satırları **asla** kısılmaz. `d1-tutarlilik` 30 günden eskiyi budar.
