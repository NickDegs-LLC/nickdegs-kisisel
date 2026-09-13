// cf-harita-katman — B8 geocoding `/geocoding/v5/mapbox.places/{lon},{lat}.json`
// (sunucusuzlaştırma, 31.08) — `harita-proxy.py:308-368` (_geocode) BİREBİR portu.
//
// ⚠️ K0 A4 ÇÜRÜTÜLDÜ (ölçüldü 31.08): "geocoding katmanda kalır, Hooder'ın 235k'lık geo/
// önbelleği kullanılır" TAAHHÜDÜ uygulanmamış. `X-Movelog-Key` ile ve başlıksız; GET+POST×4
// gövde biçimi; `geo/`, `geo/{lon}/{lat}`, `geo/{lat},{lon}`, `geo/…json`, `geo?lat=&lon=`,
// `geo/v1/…`, `geo/reverse?…` → **11 denemenin 11'i 405 `method_not_allowed`**. Aynı 405
// `/hooder-api/zzz-yok-boyle-bir-sey` için de dönüyor → 405 = genel geri düşüş, yani UÇ YOK.
// Bu yüzden kaynak Nominatim'e alındı (kenardan ÖLÇÜLDÜ: 200 / 179 ms).
//
// SÖZLEŞME (B8) — motorun okuduğu ALANLAR yalnız bunlar, birebir korunur:
//   features[0].text = neighbourhood|suburb|quarter|village|hamlet|town  ?? city
//   features[0].context = [{"id":"place.1","text":city}]   (city yoksa [])
//   city = city|town|province|state
//   types=country dalı → zoom=3 + YALNIZ country, context []
//   hata → {"features":[]}
//
// ÖNBELLEK: Cache API 7 g + **R2 kalıcı**. Anahtar Python'un disk anahtarıyla AYNI biçimde:
//   geo/[ulke_]{lon.4}_{lat.4}.json  → sunucudaki sıcak önbellek (36 kayıt) R2'ye olduğu gibi
//   kopyalanabilir, uç bir gün bile Nominatim'e gitmeden ısınmış başlar.
// Boş sonuç ÖNBELLEĞE YAZILMAZ (Nominatim arızası 7 gün kalıcılaşmasın — mevcut kural).
//
// HIZ SINIRI: Nominatim politikası 1 istek/sn. Bugünkü hacim 65 istek/gün (ölçüldü) → sorun yok;
// yine de 429/arıza durumunda Esri reverse geocode yedeği devreye girer (kenardan ölçüldü: 200).
import { basliklar } from "./kaynak.js";

const RX = /^\/geocoding\/v5\/mapbox\.places\/(-?[\d.]+),(-?[\d.]+)\.json$/;
const MAXAGE = 604800; // 7 g
const NOMINATIM = "https://nominatim.openstreetmap.org";
const ESRI_TERS =
  "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode";
const BOS = '{"features":[]}';

export async function geokodIsle(istek, env, ctx, ic, ayar) {
  const yol = ic.split("?")[0];
  const m = RX.exec(yol);
  if (!m) return null;
  const lon = Number(m[1]);
  const lat = Number(m[2]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

  const url = new URL(istek.url);
  const ulke = (url.searchParams.get("types") || "").includes("country");

  // Python satır 311 ile AYNI anahtar biçimi (yuvarlama dahil).
  const ad = "geo/" + (ulke ? "ulke_" : "") + d4(lon) + "_" + d4(lat) + ".json";
  const anahtar = new Request("https://harita-geo.invalid/" + ad);

  try {
    const on = await caches.default.match(anahtar);
    if (on) {
      const k = new Response(on.body, on);
      k.headers.set("X-Onbellek", "cache-api");
      return k;
    }
  } catch {}
  try {
    if (env.MATCH_CACHE) {
      const o = await env.MATCH_CACHE.get(ad);
      if (o) {
        const g = await o.text();
        cacheYaz(ctx, anahtar, g, "r2");
        return json(g, "r2");
      }
    }
  } catch {}

  let govde = null;
  let kaynak = "";
  if (ayar.geoKaynak !== "esri") {
    govde = await nominatim(lon, lat, ulke);
    kaynak = "nominatim";
  }
  if (!govde) {
    govde = await esriTers(lon, lat, ulke); // Nominatim ölü/429 → yedek
    kaynak = "esri";
  }
  if (!govde) return json(BOS, "bos"); // önbelleğe YAZILMAZ

  cacheYaz(ctx, anahtar, govde, kaynak);
  if (env.MATCH_CACHE) {
    ctx.waitUntil(
      env.MATCH_CACHE.put(ad, govde, { httpMetadata: { contentType: "application/json" } }).catch(
        () => {},
      ),
    );
  }
  return json(govde, kaynak);
}

// Python satır 311: round(lon,4) → "28.9784". JS toFixed(4) sondaki sıfırları TUTAR ("29.0000"),
// Python repr TUTMAZ ("29.0"). Anahtar birebir olsun diye Python davranışı taklit edilir.
function d4(v) {
  return String(Math.round(v * 1e4) / 1e4);
}

async function nominatim(lon, lat, ulke) {
  const zoom = ulke ? 3 : 14; // Python satır 334
  try {
    const y = await fetch(
      `${NOMINATIM}/reverse?lat=${lat}&lon=${lon}&format=jsonv2&zoom=${zoom}&accept-language=en`,
      {
        signal: AbortSignal.timeout(12000),
        headers: { "User-Agent": "cf-harita-katman/1.0 (movelog; harita.nickdegs.com)" },
      },
    );
    if (!y.ok) return null;
    const raw = await y.json();
    const ad = (raw && raw.address) || {};
    if (ulke) {
      const co = ad.country || "";
      return JSON.stringify({ features: co ? [{ text: co, context: [] }] : [] });
    }
    // Python satır 352-358 birebir
    const loc =
      ad.neighbourhood || ad.suburb || ad.quarter || ad.village || ad.hamlet || ad.town || "";
    const city = ad.city || ad.town || ad.province || ad.state || "";
    return bicimle(loc, city);
  } catch {
    return null;
  }
}

// YEDEK — yalnız Nominatim ölü/429 iken. Esri alan adları farklı; sözleşme alanlarına eşlenir.
// ÖLÇÜM 31.08 (28.9784,41.0082): City="Alemdar" Neighborhood="" Subregion="Fatih" Region="İstanbul".
async function esriTers(lon, lat, ulke) {
  try {
    const y = await fetch(
      `${ESRI_TERS}?location=${lon},${lat}&f=json&langCode=en` +
        (ulke ? "&featureTypes=Locality" : ""),
      { signal: AbortSignal.timeout(12000), headers: { "User-Agent": "cf-harita-katman/1.0" } },
    );
    if (!y.ok) return null;
    const j = await y.json();
    const a = (j && j.address) || {};
    if (ulke) {
      const co = a.CntryName || a.CountryName || "";
      return JSON.stringify({ features: co ? [{ text: co, context: [] }] : [] });
    }
    const loc = a.Neighborhood || a.District || a.City || "";
    const city = a.Region || a.Subregion || a.City || "";
    return bicimle(loc, city);
  } catch {
    return null;
  }
}

function bicimle(loc, city) {
  const t = loc || city;
  if (!t) return JSON.stringify({ features: [] });
  return JSON.stringify({
    features: [{ text: t, context: city ? [{ id: "place.1", text: city }] : [] }],
  });
}

function bosMu(govde) {
  try {
    const j = JSON.parse(govde);
    return !Array.isArray(j.features) || j.features.length === 0;
  } catch {
    return true;
  }
}

function json(govde, kaynak) {
  // Boş sonuca 7 g başlığı KOYULMAZ — aksi halde tarayıcı/CF katmanında da kalıcılaşır.
  const bos = bosMu(govde);
  const bas = basliklar("application/json", bos ? 0 : MAXAGE);
  if (bos) bas.set("Cache-Control", "public, max-age=60");
  bas.set("X-Kaynak", kaynak);
  return new Response(govde, { status: 200, headers: bas });
}

function cacheYaz(ctx, anahtar, govde, kaynak) {
  if (bosMu(govde)) return;
  try {
    const bas = basliklar("application/json", MAXAGE);
    bas.set("X-Kaynak", kaynak);
    ctx.waitUntil(
      caches.default.put(anahtar, new Response(govde, { status: 200, headers: bas })).catch(() => {}),
    );
  } catch {}
}
