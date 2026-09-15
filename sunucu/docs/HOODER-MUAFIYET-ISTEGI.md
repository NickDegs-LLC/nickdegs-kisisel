# MOVE LOG → HOODER: BOT-AVCISI MUAFİYET İSTEĞİ (A3)

K0 §0.3 + §A3 gereği. Bu tanımlanmadan DNS katmana çevrilirse **ilk render işi bloklanır.**

## 1) Neden IP tabanlı muafiyet İŞE YARAMAZ
Trafiğimiz üç ayrı kaynaktan geliyor, ikisinin IP'si sabit değil:
- **RunPod render worker'ları** — her iş yeni konteyner, değişken datacenter IP (ASN bloğunuzun tam hedefi)
- **Cloudflare Workers** (movelog-api / movelog-cron) — CF'in kendi ağından çıkar
- **Kullanıcı telefonları** (WKWebView 3B önizleme) — mobil/ev IP'leri, dünyanın her yerinden

## 2) Muafiyet iki işaretle tanınsın (ikisi de aynı anda geçerli)

**(a) YOL ÖNEKİ — birincil, telefon için ZORUNLU**
```
https://harita.nickdegs.com/24579d9db6c7c001/...
```
Bu bizim mevcut capability önekimiz — bugün de kullanılıyor, **değişiklik gerekmiyor**.
Bu önekle gelen istekler: ASN bloğundan MUAF + bot-avcısı sayaçlarına HİÇ girmesin.

> Neden telefonda başlık kullanamıyoruz (ölçtük, 31.08): WKWebView'de alt-kaynak isteğine
> özel başlık ekleyen public API yok; `X-Movelog-Key` safelisted olmadığı için her karo
> CORS ön-uçuşu (OPTIONS) yapar ve origin OPTIONS'a **501** döner → karolar hiç yüklenmez.
> Sayfa bir URL'den değil string'den yüklendiği için ana-çerçeve isteği de yok.

**(b) BAŞLIK — ikincil, sunucu/Worker bacakları için**
```
X-Movelog-Key: mlog_2dd21f99341058238c664d2ec8040c4f78f1860f035db554
```
RunPod motoru, CF Workers ve sunucu scriptleri bu başlığı da gönderecek. Öneksiz bir yol
kullanmak zorunda kalırsak (veya önek dönerse) muafiyet buradan tanınsın.

## 3) Beklenen yük (ölçüldü)
- 2D/flyover video: ~3-6 istek · **3B video: ~13.000 karo / ~15.000 istek** · taktik video: yüzlerce
  (9 intro + 13 outro statik + yakın-plan karolar + ~124 matching dilimi)
- Tepe: **30-45k karo/gün**. Bir render işi **dakikada yüzlerce karo** çeker ve "oyun etkileşimi"
  sıfırdır — davranış imzası kazıyıcıya benzer, muafiyet olmadan /64 kalıcı yasağa girer.

## 4) Ayrıca: bizim sunucudan sizin zone'a giden bir çağrı var (bizim tarafın kaçağı)
`harita-kaynak.json` zincirinde 3. kaynak olarak
`https://realvirtuality.app/hooder-api/sat/{z}/{x}/{y}.jpg` duruyor (z11-14'te Esri boş karo
dönünce devreye giriyor; canlı ölçüm 200). Çağıran IP = sunucumuz, **datacenter ASN**.
Sizden bir şey istemiyoruz — bu satırı kendi tarafımızdan kaldırabiliriz; ama kaldırana kadar
o IP'nin (sunucumuz) yasaklanmaması için haberiniz olsun.
Ek soru: sunucu-yanı avcınızın (`bot-avcisi.py` BEYAZ listesi) taşıdığı sunucu IP'miz,
**CF kenarındaki yeni ASN bloğunda da** beyaz listede mi? (ASN bloğu IP tabanlı olduğu için
eski liste onu kapsamıyor olabilir.)

## 5) Doğrulama (devir günü, 2 dk)
Muafiyet açıldıktan sonra biz şunu koşacağız — 403/429 görürsek DNS çevrilmez:
```
# 300 karoluk hızlı seri (bot imzası taklidi) — önekli yoldan
for i in $(seq 1 300); do curl -s -o /dev/null -w "%{http_code} " \
  "https://harita.nickdegs.com/24579d9db6c7c001/xyz/sat/14/$((9600+i))/6160.jpg"; done
# Beklenen: hepsi 200. Tek 403/429 = muafiyet eksik.
```

Teşekkürler — matrix/Move Log
