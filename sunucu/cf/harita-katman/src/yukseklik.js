// cf-harita-katman — `/yukseklik?bbox=minlon,minlat,maxlon,maxlat[&n=160]` (sunucusuzlaştırma, 31.08 → R2 02.09)
// `harita-proxy.py:590-664` portu. Çıktı sözleşmesi: {"n","bbox","grid","kule"}.
//
// GRID KAYNAĞI = GHS-BUILT-H ANBH (Copernicus/JRC, 100 m hücre). 02.09'dan itibaren GeoTIFF'ler
// R2 bloklarına çıkarıldı (scripts/ghs-r2-export.py → MATCH_CACHE `ghs/…`) ve örnekleme worker
// İÇİNDE (ghs.js: Mollweide + Python round/json birebir; test/uyum-yukseklik.mjs 13/13 bbox BAYT
// BAYT aynı — raster sınırları, n=16..256, kapsam dışı dahil). Katmanlar; İSTEK ASLA HATA VERMEZ:
//   1) Cache API (7 g)            — aynı kenar, aynı rota
//   2) R2 kalıcı önbellek         — daha önce hesaplanmış bbox (tüm kenarlar, süresiz)
//   3) **R2-GHS hesap**           — SUNUCUSUZ ana yol: bloklar R2'den, grid kenarda; sonuç 2'ye yazılır
//   4) origin (opsiyonel yedek)   — yalnız 3 FIRLATIRSA (ghs/index.json yok, R2 hatası) ve sunucu varsa
//   5) SIFIR GRID fail-soft       — hiçbiri yoksa {"grid":[0,…],"kule":[]} + 200
//
// (5) NEDEN GÜVENLİ — render3d.js:100-135 okundu (31.08):
//   yükseklik önceliği ① karodaki `height` (Protomaps/OSM, BİREBİR) ② GHS grid (feature-state)
//   ③ id-hash yedeği `7+id%9`. `_yukOrnek` zaten `v > 0.5` değilse **null** döndürüyor ve
//   fetch hatasında `_yuk` null kalıp aynı yola giriyor. Yani sıfır grid = bugünkü "yükseklik
//   servisi cevap vermedi" dalının BİREBİR aynısı: binalar karo height'ı veya id-hash ile
//   çizilir, video ÖLMEZ. Sessiz kalite kaybı `X-Kaynak: bos-grid` ile görünür.
//
// `kule` alanı KALICI BOŞ (Python 647-651: kule katmanı 11.08'de söküldü, yükseklikler artık
// karonun içinde taşınıyor). Geriye uyumluluk için alan duruyor.
import { basliklar } from "./kaynak.js";
import { originIste } from "./origin.js";
import { sha256Hex } from "./cache.js";
import { ghsGrid, ghsJson } from "./ghs.js";

const MAXAGE = 604800; // 7 g (Python ile birebir)

export async function yukseklikIsle(istek, env, ctx, ic, onek, ayar) {
  const url = new URL(istek.url);
  let bb;
  let n;
  try {
    bb = (url.searchParams.get("bbox") || "").split(",").map(Number);
    if (bb.length !== 4 || bb.some((v) => !Number.isFinite(v))) throw new Error("bbox");
    n = Math.max(16, Math.min(256, parseInt(url.searchParams.get("n") || "160", 10) || 160));
  } catch {
    return new Response('{"hata":"bbox gerekli"}', {
      status: 400,
      headers: basliklar("application/json", 0),
    });
  }

  // Anahtar bbox+n'e deterministik. Python'un disk anahtarıyla aynı OLMAK ZORUNDA DEĞİL
  // (ayrı depolar); kendi içinde tutarlı olması yeter.
  const ad = "yukseklik/" + (await sha256Hex(bb.join(",") + "|" + n)).slice(0, 32) + ".json";
  const anahtar = new Request("https://harita-yukseklik.invalid/" + ad);

  try {
    const on = await caches.default.match(anahtar);
    if (on) {
      const k = new Response(on.body, on);
      k.headers.set("X-Onbellek", "cache-api");
      return k;
    }
  } catch {}

  // 2) R2 — kalıcı, tüm kenarlar ortak, TTL yok (bbox→GHS ilişkisi zamanla değişmez).
  try {
    if (env.MATCH_CACHE) {
      const o = await env.MATCH_CACHE.get(ad);
      if (o) {
        const govde = await o.text();
        yaz(ctx, anahtar, govde, "r2");
        return json(govde, "r2");
      }
    }
  } catch {}

  // 3) R2-GHS — sunucusuz hesap. Hata FIRLATIRSA (indeks/blok yok, R2 arızası) origin'e düşülür;
  //    başlıkta X-GHS-Hata ile görünür. Sonuç origin yolundaki gibi R2'ye kalıcı yazılır.
  let ghsHata = null;
  try {
    const govde = ghsJson(n, bb, await ghsGrid(env, bb, n));
    yaz(ctx, anahtar, govde, "r2-ghs");
    ctx.waitUntil(
      env.MATCH_CACHE.put(ad, govde, { httpMetadata: { contentType: "application/json" } }).catch(() => {}),
    );
    return json(govde, "r2-ghs");
  } catch (e) {
    ghsHata = String(e && e.message ? e.message : e).slice(0, 80);
  }

  // 4) origin (opsiyonel yedek)
  const y = await originIste(
    env,
    ayar,
    url.host,
    onek,
    "/yukseklik",
    "?bbox=" + bb.join(",") + "&n=" + n,
    12000, // GHS örneklemesi 160×160'ta saniyeler sürebilir
  );
  if (y && y.ok) {
    const govde = await y.text();
    if (govde && govde.length > 20 && govde.includes('"grid"')) {
      yaz(ctx, anahtar, govde, "origin");
      if (env.MATCH_CACHE) {
        ctx.waitUntil(
          env.MATCH_CACHE.put(ad, govde, {
            httpMetadata: { contentType: "application/json" },
          }).catch(() => {}),
        );
      }
      const c = json(govde, "origin");
      if (ghsHata) c.headers.set("X-GHS-Hata", ghsHata);
      return c;
    }
  }

  // 5) fail-soft sıfır grid — ÖNBELLEĞE YAZILMAZ (sunucu dönünce gerçek grid gelsin;
  //    yoksa 7 günlük kalıcı boşluk oluşurdu — geocoding'deki `bosCache:false` ile aynı ders).
  const bosGovde = JSON.stringify({ n, bbox: bb, grid: new Array(n * n).fill(0), kule: [] });
  const bas = basliklar("application/json", 0);
  bas.set("Cache-Control", "public, max-age=60"); // kısa: sunucu 1 dk sonra tekrar denensin
  bas.set("X-Kaynak", "bos-grid");
  if (ghsHata) bas.set("X-GHS-Hata", ghsHata);
  return new Response(bosGovde, { status: 200, headers: bas });
}

function json(govde, kaynak) {
  const bas = basliklar("application/json", MAXAGE);
  bas.set("X-Kaynak", kaynak);
  return new Response(govde, { status: 200, headers: bas });
}

function yaz(ctx, anahtar, govde, kaynak) {
  try {
    const bas = basliklar("application/json", MAXAGE);
    bas.set("X-Kaynak", kaynak);
    ctx.waitUntil(
      caches.default.put(anahtar, new Response(govde, { status: 200, headers: bas })).catch(() => {}),
    );
  } catch {}
}
