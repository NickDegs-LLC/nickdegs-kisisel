# Yama 01 — RunPod normal motoru: **KOD YAMASI YOK, SADECE ENV**

**Bulgu (kod okumasıyla kanıtlı):** `render3d.js` içinde `HARITA` sabiti YALNIZCA
dört yerde ve daima `HARITA + '/yol'` biçiminde kullanılıyor:

```
render-worker/3d/render3d.js:48   const HARITA = process.env.HARITA_TABAN || 'https://harita.nickdegs.com';
render-worker/3d/render3d.js:57   const YUK_URL = HARITA + '/yukseklik?bbox=...'
render-worker/3d/render3d.js:58   const SAT_URL = HARITA + '/xyz/sat/{z}/{x}/{y}.jpg?k=' + KATMAN
render-worker/3d/render3d.js:59   const STR_URL = HARITA + '/xyz/str/{z}/{x}/{y}.jpg?k=' + KATMAN
render-worker/3d/render3d.js:60   const MVT_URL = HARITA + '/mvt/{z}/{x}/{y}.mvt'
```
(`grep -n "HARITA" render3d.js` → tam bu 5 satır, başka kullanım yok.)

→ **Muafiyet öneği tabana yazılırsa dört uç birden önekli gider ve tek satır kod
değişmez.** İmaj rebuild YOK, sadece RunPod template env PATCH:

```
HARITA_TABAN = https://harita.nickdegs.com/<MUAFIYET_ONEGI>
HARITA_UC    = https://harita.nickdegs.com/<MUAFIYET_ONEGI>     # zaten önekli; önek aynıysa DEĞİŞMEZ
MOVELOG_KEY  = <movelog-harita-key.conf içindeki değer>          # yama 02 kullanır (ikincil, opsiyonel)
```

**Muafiyet öneği = mevcut capability öneği seçilirse** `HARITA_UC` hiç değişmez;
tek değişen satır `HARITA_TABAN` olur.

## Aynı env telefon motorunu da düzeltir (app güncellemesi GEREKMEZ)

`/motor3d` sayfasını sunucu üretiyor: `harita-proxy.py:481` `node telefon-html.js` çağrısını
`env = dict(os.environ, …)` ile çalıştırıyor; `telefon-html.js:18-31` de `render3d.js`'in
`HTML` sabitini aynen alıyor. Yani karo URL'leri **üretim anında sunucu env'inden** pişiyor.
→ Drop-in (yama 06) yeterli; WKWebView'e dokunulmaz, App Store turu gerekmez.

## Doğrulama (devir günü)
```
# önekli karo gerçekten geliyor mu + CORS başlıkları TAM mı (yoksa video BEMBEYAZ)
curl -s -o /dev/null -D - "https://harita.nickdegs.com/<ONEK>/xyz/sat/14/9600/6100.jpg" \
  | grep -iE "^HTTP|access-control-allow-origin|cross-origin-resource-policy|cache-control|cf-cache-status"
```
Beklenen: `200` + `access-control-allow-origin: *` + `cross-origin-resource-policy: cross-origin`
+ `cache-control: public, max-age=2592000, immutable` + ikinci istekte `cf-cache-status: HIT`.

⚠️ **2026-08-30 ölçümü:** bugünkü origin'de önekli `/xyz` 200 dönüyor **ama ACAO ve CORP
başlıkları YOK** (nginx `cf-harita` bu başlıkları yalnız `location /xyz/` altında ekliyor,
`location /<ONEK>/` altında eklemiyor) → bugünkü haliyle önekli karo WebGL'de okunamaz.
Bu, Hooder'dan istenen R3 maddesinin ta kendisi (bkz. ONERI-HOODER.md).
