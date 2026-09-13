// cf-harita-katman — B3-B6 statik `/styles/v1/mapbox/{stil}/static/...` (sunucusuzlaştırma, 31.08)
//
// ═══ NEDEN BU UÇ SUNUCUSUZLAŞTIRILAMAZ ═══
// Statik görüntü = N×M karonun BİRLEŞTİRİLİP kırpılması (harita-proxy `_stitch`/`_stitch_bbox`).
// Bu RASTER iştir: Worker'da PIL yok, WASM daha önce ölçümle elendi (128 MB sınırı aşıyor),
// CF Image Resizing tek görüntüyü dönüştürür — N karoyu MOZAİKLEYEMEZ. Karar (TASARIM §2a):
// dikiş çekirdeği **motor imajına yan-servis (sidecar)** olarak konur ve konteyner içinde
// 127.0.0.1:8890'de dinler. `route_gen.py:13` varsayılanı ZATEN `http://127.0.0.1:8890` →
// RunPod tactical template'inden `HARITA_TABAN/HARITA_STATIK` env'lerini KALDIRMAK yeter;
// mühürlü dosyanın kod yolu tek karakter değişmeden bugünküyle birebir kalır (512·2^z, bbox fit,
// LANCZOS, JPEG q87/q92 — hepsi AYNI kod; imajda Pillow 12.3.0 pinli → çıktı da birebir).
//
// ═══ NEDEN BUGÜN HÂLÂ 501 DEĞİL ═══
// ÖLÇÜLDÜ 31.08: canlı RunPod `movelog-tactical` template'i (egptl6t4pr) hâlâ
// `HARITA_STATIK=https://harita.nickdegs.com/{ONEK}` diyor ve bu uca bugün 1.104 istek geldi
// (Python-urllib = taktik motor, gerçek üretim trafiği). Koşulsuz 501 basmak CANLI RENDER'I
// ÖLDÜRÜR. Bu yüzden davranış **KV `statik_mod`** ile seçilir, deploy gerekmez:
//   "origin" (VARSAYILAN, bugün) → origin'e ilet; origin ölüyse 501 + açıklama
//   "501"                        → origin'e hiç dokunma, doğrudan 501
// Motor yan-servisi (GÖREV B) canlıya çıktığında TEK KV yazımı ile kapatılır:
//   wrangler kv key put --remote --namespace-id <id> statik_mod '501'
// Geri alma da aynı yerden, saniyeler içinde.
//
// Origin AYAKTAYKEN davranış bugünküyle BİREBİR: aynı PIL kodu ürettiği için 512·2^z (B4),
// bbox fit (B5) ve strm kalibrasyonu (B6) yapısal olarak birebir; Worker yalnız iletir + 30 g
// Cache API + Cache-Control/ACAO/CORP ekler (B11 bonus — origin bu başlıkları vermiyor).
import { basliklar, onbellekAnahtari, onbellekBak, onbellekYaz } from "./kaynak.js";
import { originIste, originKapali, originOluKalan } from "./origin.js";

const MAXAGE = 2592000; // 30 g

const ACIKLAMA =
  "Statik görüntü birleştirme (stitch) RASTER iştir; Worker'da PIL yok ve WASM 128 MB sınırında " +
  "elendi. Bu uç motor imajındaki yan-servise taşındı: konteyner içinde 127.0.0.1:8890. " +
  "Yapılacak: RunPod tactical template'inden HARITA_TABAN/HARITA_STATIK env'lerini KALDIR — " +
  "route_gen.py:13 varsayılanı zaten http://127.0.0.1:8890, mühürlü kod yolu değişmez.";

export async function statikIsle(istek, env, ctx, onek, ic, ayar) {
  const url = new URL(istek.url);
  const yol = ic.split("?")[0];

  if (ayar.statikMod === "501" || originKapali(env, ayar, url.host)) {
    return elli(env, ayar, url.host);
  }

  const anahtar = onbellekAnahtari(istek.url, yol, []); // access_token vb. atılır
  const on = await onbellekBak(anahtar);
  if (on) return on;

  const y = await originIste(env, ayar, url.host, onek, ic, "", 60000); // 1280×1280@2x ~7 sn ölçüldü
  if (!y) return elli(env, ayar, url.host);
  const govde = await y.arrayBuffer();
  const bas = basliklar(y.headers.get("Content-Type") || "image/jpeg", 0);
  bas.set("X-Kaynak", "origin");
  if (y.ok && govde.byteLength > 0) {
    bas.set("Cache-Control", "public, max-age=" + MAXAGE + ", immutable");
    onbellekYaz(ctx, anahtar, govde.slice(0), bas);
  }
  return new Response(govde, { status: y.status, headers: bas });
}

function elli(env, ayar, host) {
  const govde = JSON.stringify({
    hata: "statik_motor_icinde",
    kod: 501,
    aciklama: ACIKLAMA,
    statik_mod: ayar.statikMod,
    sunucu_yedegi: originKapali(env, ayar, host)
      ? originOluKalan() > 0
        ? "devre-kesici-acik-" + Math.round(originOluKalan() / 1000) + "sn"
        : "yapilandirilmamis-veya-kapali"
      : "acik",
  });
  const bas = basliklar("application/json", 0);
  bas.set("Cache-Control", "no-store"); // 501 önbelleğe girmemeli
  return new Response(govde, { status: 501, headers: bas });
}
