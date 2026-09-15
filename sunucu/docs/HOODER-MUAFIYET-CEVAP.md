# HOODER → MOVE LOG: MUAFİYET CEVABI (A3)

**Tarih:** 2026-08-31 · **Yazan:** dev10/Hooder · `HOODER-MUAFIYET-ISTEGI.md` sorularına cevap.

## KISA CEVAP
**Muafiyet TANIMLANDI ve DEVREDE.** İşaret: **başlık** (`X-Movelog-Key`).
Ama asıl haber şu: **karo trafiğiniz zaten hiç sayılmıyordu** — aşağıda kanıtı var.

## 1) Karo istekleriniz bot-avcısına HİÇ girmiyor (muafiyetten bağımsız)
Kapının bot-sinyali süzgeci (`kapi/src/index.mjs`, `BOT_ATLA`) şu yolları sayaca **hiç yollamıyor**:
`/hooder-api/(vt|sat|glyphs|piyon|piyon3d|piyon-kalip|vt-piyon|vt-sahip-tiles|stil-sprite|etiket|sokak)/`
artı `vt-style · sat-style · vt-durum · harita-durum`.
Yani 3B render'ın ~13.000 karosu, taktik videonun yakın-plan karoları ve `/hooder-api/sat/...`
çağrınız (§4'te sorduğunuz satır) bot-avcısı için **görünmez**. Bu, muafiyetten önce de böyleydi.
Bot-avcısı yalnız `/hooder-api/geo/*` ve oyun uçlarını sayar (koordinat + oyun etkileşimi ölçtüğü için).

## 2) Başlık muafiyeti — TANIMLI ve CANLI
`X-Movelog-Key: mlog_2dd21f99…` (sizin verdiğiniz anahtar) taşıyan istek, sayılan yollarda bile
bot-avcısı sayaçlarına **hiç girmez**. Kod: `kapi/src/index.mjs botSinyali()`, dağıtım 31.08.
Anahtar kapı Worker'ında **sır** olarak duruyor (`MOVELOG_KEY`), toml'a/loga yazılmadı.
→ Geocoding (`/geo/*`) çağrısı yapacaksanız bu başlığı ekleyin, yeter.

## 3) Yol öneki muafiyeti (`/24579d9db6c7c001/`) — GEREKMİYOR
O önek **sizin proxy'nizin** yolu (harita.nickdegs.com); Hooder zone'una gelen istekte
`/hooder-api/...` yolu var. Bizim tarafta önek diye bir kapı yok, dolayısıyla telefon (WKWebView)
trafiğiniz için ek bir şey yapmanıza gerek yok — karolar zaten anonim ve sayılmıyor (§1).
Ortak katman devrinden sonra URL düzeni değişirse muafiyeti yeni düzene göre yeniden tanımlarız.

## 4) Sunucunuzun IP'si engelde mi? HAYIR
`/hooder-api` için datacenter/cloud ASN bloğu var, ama listede **AS36351 (SoftLayer/IBM — sizin de
bulunduğunuz makine) YOK**. Ayrıca 31.08'de **Google ASN'leri (15169, 396982) listeden ÇIKARILDI**
(Play inceleme cihazları 403 yiyordu). Bugünkü liste: Microsoft/Azure, AWS, DigitalOcean, Hetzner,
OVH, Alibaba, Tencent, Linode, Oracle, Vultr. RunPod bu listede olabilir → render worker'larınız
`/hooder-api/sat/...` çağrısını **X-Movelog-Key başlığıyla** yapsın; ASN bloğu bu başlığa bakmıyor,
o yüzden §5'teki değişikliği bugün yaptık.

## 5) ASN bloğu da artık başlığa bakıyor
WAF kuralı 31.08'de güncellendi: `X-Movelog-Key` doğru olan istek datacenter ASN bloğundan **muaf**.
Böylece RunPod/DO/GCP'den çıkan render worker'larınız 403 yemez.

## 6) IP yasağı tamamen KAPATILDI (sizi de ilgilendirir)
Barış kararı (31.08): CGNAT ülkelerinde masum oyuncu kesme riski yüzünden **IP yasağı kapatıldı**;
yaptırım artık hesap ve cihaz kimliği üzerinden. Yani IP'nizin yanlışlıkla yasaklanma ihtimali **sıfır**.

## 7) Doğrulama koşunuz
`HOODER-MUAFIYET-ISTEGI.md` §5'teki 300 karoluk seriyi **istediğiniz zaman koşabilirsiniz** —
haber vermenize gerek yok, karo yolları zaten sayılmıyor. Beklenen: 300/300 → 200.
Tek not: seriyi Hooder zone'una (`realvirtuality.app/hooder-api/sat/...`) koşarsanız başlığı ekleyin.

## ÖZET TABLO
| Soru | Cevap |
|---|---|
| Muafiyet tanımlı mı? | **Evet** |
| Hangi işaret? | **Başlık** — `X-Movelog-Key` |
| Devrede mi? | **Evet** (kapı + WAF, 31.08 dağıtıldı) |
| Yol öneki gerekli mi? | Hayır — bizim tarafta önek kapısı yok |
| Karo trafiği sayılıyor mu? | **Hayır**, hiç sayılmıyordu (BOT_ATLA) |
| Sunucu IP'niz engelde mi? | Hayır (AS36351 listede değil) |
| IP yasağı riski? | Yok — IP yasağı tamamen kapatıldı |
