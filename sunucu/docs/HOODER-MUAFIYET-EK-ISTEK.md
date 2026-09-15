# MOVE LOG → HOODER: MUAFİYET EK İSTEĞİ (sunucu kapanıyor)

**Tarih:** 2026-08-31 · **Yazan:** matrix / Move Log
**Önceki yazışma:** `HOODER-MUAFIYET-ISTEGI.md` (A3) → `HOODER-MUAFIYET-CEVAP.md` (dev10, 31.08)
**Neden ek istek:** Move Log bugün Cloudflare'e taşındı. Backend/GPS/cron/dispatch CF'de canlı,
**sunucu backend'i KAPALI**. Sıradaki adım haritanın da sunucudan kopması. Önceki muafiyet
yazışması "sunucu ayakta" varsayımıyla yazılmıştı; aşağıdaki tablo **sunucu tamamen kapalıyken**
neyi nereden tüketeceğimizi tarif ediyor. Yeni bir ayrıcalık istemiyoruz — mevcut muafiyetin
yeni düzende de geçerli olduğunu teyit + 3 soru.

> Cevabınızdaki iki tespiti not aldık ve **plana aynen işledik**:
> karo yolları (`vt|sat|glyphs|…`) `BOT_ATLA` sayesinde zaten sayılmıyor (§1),
> ve muafiyet işareti **başlık** (`X-Movelog-Key`) — yol öneki gerekmiyor (§3).

---

## 1) Yeni durumda Hooder katmanından NE tüketeceğiz

| Uç | Tüketici | Kimlik | Tahmini hacim | Durum (ölçüm 31.08) |
|---|---|---|---|---|
| `/hooder-api/geo/ara?q=…` | RunPod render motoru, CF Worker (`harita-katman`) | `X-Movelog-Key` | **~5-20 çağrı/video**, tepe ~500/gün | ✅ 200 (bkz §3) |
| `/hooder-api/vt/{z}/{x}/{y}.mvt` | RunPod 3B worker (MapLibre GL, bina çıkarımı) | `X-Movelog-Key` | **~13.000 karo/3B video**, tepe **30-45k/gün** | ✅ 200, canlı |
| `/hooder-api/sat/{z}/{x}/{y}.jpg` | (zincirden ÇIKARDIK) | — | 0 | ❌ 502 (bkz §4) |

**Kimlik:** her istekte tek işaret —
`X-Movelog-Key: mlog_2dd21f99…` (cevabınız §2/§5'teki anahtar, `MOVELOG_KEY` sırrı).
Bu bacakların **hepsi sunucu-yanı** (RunPod konteyneri / CF Worker), tarayıcı değil →
CORS ön-uçuş sorunu yok, başlık bedava taşınıyor. Yol öneki kullanmıyoruz (§3 cevabınız).

**Değişen tek şey:** bu çağrıların çıkış IP'si. Eskiden çoğu bizim sunucudan (AS36351,
beyaz listede) çıkıyordu. Sunucu kapanınca **hepsi RunPod + Cloudflare Workers ağından**
çıkacak → datacenter ASN bloğunuzun tam hedefi. Cevabınız §5'te "ASN bloğu artık
`X-Movelog-Key` başlığına bakıyor" demiştiniz; **bu bizim için artık tek dayanak.**
→ **Teyit isteği:** başlık muafiyeti ASN bloğunun önünde mi çalışıyor (yani doğru başlıkla
gelen RunPod IP'si 403 yemiyor)? Sunucu kapandıktan sonra geri düşecek bir yolumuz kalmıyor.

---

## 2) Beklenen yük (ölçüldü, önceki istekle aynı — değişmedi)

- 2D/flyover video: ~3-6 istek · **3B video: ~13.000 karo / ~15.000 istek** · taktik video: yüzlerce
- Tepe: **30-45k karo/gün**
- Bir render işi **dakikada yüzlerce karo** çeker, "oyun etkileşimi" sıfırdır — davranış imzası
  kazıyıcıya benzer. Cevabınız §1 + §6 uyarınca bu bizim için artık risk değil
  (karo yolları sayılmıyor + IP yasağı tamamen kapatıldı); yine de hacmi haber veriyoruz.

---

## 3) SORU-1: `/hooder-api/geo/` doğru çağrı biçimi nedir?

Önceki notta "GET 405 aldık" demiştik. **Bugün ölçtük ve çalışan biçimi bulduk** — teyit rica ediyoruz:

```
# ÇALIŞMAYAN (bizim önceki denememiz) — çıplak koleksiyon yolu
GET  /hooder-api/geo/            → 405  {"error":"method_not_allowed"}
POST /hooder-api/geo/            → 405  (aynı)
OPTIONS /hooder-api/geo/         → 204  access-control-allow-methods: GET,POST,PUT,DELETE,OPTIONS

# ÇALIŞAN — alt yol
GET /hooder-api/geo/ara?q=Istanbul   → 200
{"features":[
  {"name":"Istanbul, Fatih, …, Turkey","lat":41.006381,"lng":28.9758715,"tur":"city"},
  {"name":"Istanbul, Marmara Region, Turkey","lat":41.0707456,"lng":29.0509414,"tur":"province"}]}
```
Anahtarlı da anahtarsız da 200 döndü.

**Sorularımız:**
1. `geo/ara` **kararlı/yayınlanmış** uç mu, yoksa iç kullanım mı? (Sözleşmeye yazabilir miyiz?)
2. **Ters geocoding** (koordinat → yer adı) var mı? Denediklerimiz 405 verdi:
   `geo/41.0,29.0` · `geo/ters?lat=41&lon=29`. Bizim video hattımızın asıl ihtiyacı **bu**
   (rota noktası → şehir/mahalle adı). Doğru yol nedir?
3. Hız sınırı / adil kullanım eşiği nedir? (Bizim tarafta 1 istek/sn'lik Nominatim
   kısıtına göre kurulmuş bir kuyruk var; sizinkine uydururuz.)
4. Şema notu: alan adınız `lng`, bizim mevcut tüketicilerimiz Mapbox biçimi
   (`features[].center=[lon,lat]`) bekliyor. Dönüşümü **biz** yaparız — sizden değişiklik
   istemiyoruz, sadece şemanın kararlı olduğunu teyit edin yeter.

> Not: K0 A4 "geocoding katmanda kalır" kararı duruyor; `geo/ara`'yı **yedek/ikinci kaynak**
> olarak bağlamak istiyoruz (sizin 235k'lık `geo/` önbelleğiniz bizim Nominatim'den hızlı).

---

## 4) SORU-2: `/hooder-api/sat` şu an 502 — kalıcı mı, dönecek mi?

```
GET /hooder-api/sat/12/2400/1540.jpg   → 502   (anahtarlı, 31.08)
GET /hooder-api/vt/12/2400/1540.mvt    → 200   6139 B      ← vektör AYAKTA
GET /hooder-api/harita-durum           → 200   sentinel: {"gb":5.21,"hazir":true}
                                                protomaps:{"gb":137.24,"hazir":true}
                                                saglik.sentinel:{"acik":true,"hata":0}
```
İlginç olan: `harita-durum` **sentinel'i "hazır + sağlıklı"** gösteriyor ama `sat` 502 dönüyor →
veri duruyor, **önündeki origin bacağı düşmüş** gibi görünüyor (vektör CF'den servis edildiği
için ayakta, raster origin'e bağlı olduğu için değil).

**Bunu bizim zincirimizden ÇIKARDIK** — sizden bir şey istemiyoruz, kendi raster kaynağımıza
geçtik. Sadece bilmemiz gereken: **`sat` kalıcı olarak mı kapandı, yoksa dönecek mi?**
Dönecekse yedek kaynak olarak geri bağlarız; kapandıysa dokümandan siler, bir daha sormayız.

**Ek gözlem (vt için, bizim sorunumuz — sizden düzeltme istemiyoruz):**
`vt/` yanıtında **`Access-Control-Allow-Origin` başlığı yok** (`OPTIONS` 204 dönüyor, GET'te ACAO
düşüyor). Sunucu-yanı tüketimimiz (RunPod worker) bundan etkilenmiyor. Ama **tarayıcı** tüketicisi
(telefon 3B önizleme HTML'i, MapLibre GL) doğrudan çekemez. Biz kendi Worker'ımızdan proxy'leyip
ACAO'yu ekleyeceğiz. → Sadece teyit: `vt/`'yi bu şekilde **proxy'lemek sizin için sorun mu?**
(hacim §2'deki gibi, başlık taşınır, önbellek bizde 30 g.)

---

## 5) SORU-3: App Attest / Play Integrity — Hooder katmanına erişimde kısıt doğar mı?

Barış'ın sorusu: "gerçek cihazlar girsin diye App Attest / Play Integrity yaptık — bu, cihaz
doğrulaması olan istemcilerimizin Hooder katmanına erişiminde bir kısıt doğurur mu?"

**Bizim taraftaki durum (ölçüldü 31.08):**

| Ne | Nerede | Değer | Anlamı |
|---|---|---|---|
| `APPATTEST_ENFORCE` | sunucu `backend/config.env:24` | `0` | zorlama KAPALI |
| `config:APPATTEST_ENFORCE` | CF KV (canlı) | **anahtar yok** | `kvBayrak()` → `false` → KAPALI |
| `config:INTEGRITY_ENFORCE` | CF KV (canlı) | **anahtar yok** | KAPALI |
| `integrity:enforce` | CF KV (canlı) | **anahtar yok** | `{android:false, ios:false}` → KAPALI |

**Etkilediği uçlar — yalnız ikisi, ikisi de bizim kendi API'miz:**
`GET /api/attest/challenge` ve `POST /api/attest` (worker `movelog-api`, `grup6.ts:775`).
Tasarım **agresif fail-open**: attestation gelmezse `no-attestation` → `ok:true`;
doğrulama patlarsa `unavailable` → `ok:true`. `enforce` açılsa bile yalnız *kesin* doğrulama
başarısızlığında `ok:false` döner. Otomatik açma bekçisi (`integrity-auto`) de
"şüphede KAPALI kal" kuralıyla çalışıyor (eşik %98, min 50 örnek).

**Cevabımız/beklentimiz: kısıt DOĞMAZ, çünkü**
1. App Attest **bizim kendi backend'imizin kapısı** — Hooder katmanına giden hiçbir istekte
   attestation token'ı **taşınmıyor**. Harita/karo/geocoding trafiğimiz sizin tarafınızda anonim.
2. Cihaz doğrulaması olan istemcilerimiz (telefonlar) sizin katmanınıza **doğrudan hiç gitmiyor**;
   karoları bizim Worker'ımız proxy'liyor (§4). Sizden gelen yanıtın cihazla ilişkisi yok.
3. Şu an **her iki tarafta da zorlama KAPALI** (yukarıdaki tablo) — enforce açılsa bile
   etki alanı `/api/attest*` ile sınırlı, harita yolu hiç uğramıyor.

**Size sorumuz sadece şu:** Hooder tarafında, `/hooder-api/*` çağıran istemciden **cihaz
kimliği / attestation kanıtı isteyen** (veya ileride isteyecek) bir kapı var mı?
Varsa/olacaksa: bizim çağrılarımız sunucu-yanı (RunPod konteyneri, CF Worker) — **cihaz değil**,
dolayısıyla App Attest/Play Integrity kanıtı **üretemezler**. Böyle bir kapı gelirse
`X-Movelog-Key` muafiyetinin onun da önünde çalışması gerekir.

> Ayrıca korunması şart olan bir bağımız var (bilgi): `attest_key` (App Attest `keyId`) =
> cihaz-benzersiz kimlik, **bedava-aksiyon videosu cihaz-dedup'u buna dayanıyor**. Bu tamamen
> bizim tarafta, sizi etkilemiyor — sadece "App Attest'i kaldırın" önerisi gelirse diye not.

---

## 6) Özet — sizden istediğimiz

| # | İstek | Tip |
|---|---|---|
| 1 | Başlık muafiyeti (`X-Movelog-Key`) **datacenter ASN bloğunun ÖNÜNDE** çalıştığının teyidi — sunucu kapanınca tek dayanağımız | **teyit** |
| 2 | `geo/ara` kararlı mı + **ters geocoding** yolu + hız sınırı | **cevap** |
| 3 | `sat` 502: kalıcı mı, dönecek mi? | **cevap** |
| 4 | `vt/`'yi kendi Worker'ımızdan ACAO ekleyerek proxy'lemek sorun mu? | **onay** |
| 5 | `/hooder-api/*` önünde cihaz-attestation isteyen bir kapı var mı / gelecek mi? | **cevap** |

Yeni ayrıcalık istemiyoruz; 1. madde dışında hepsi bilgi. Teşekkürler — matrix / Move Log
