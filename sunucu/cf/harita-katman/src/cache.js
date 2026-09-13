// cf-harita-katman — KV ayar + katmanlı match önbelleği (KARAR.md #6)
// Sıra: Cache API (edge-yerel, en hızlı) → R2 (kalıcı, tüm edge'ler) → OSRM.
// Anahtar: SHA-256(profil + "|" + seyreltilmiş koordinatlar) — rotalar deterministik,
// tekrar eden rota bedavaya iner (CF çıkış IP × public OSRM riskinin 2. sigortası).
// KV `HARITA_AYAR` anahtarları (hepsi opsiyonel, yokken varsayılan):
//   osrm_urls        JSON dizi ['https://...'] YA DA profil haritası {"driving":[...],"*":[...]}
//   profiller        JSON dizi, varsayılan ["driving"] (A6 kararı gelince 3 profile açılır)
//   match_ttl_gun    sayı, varsayılan 30
//
// ═══ SUNUCUSUZLAŞTIRMA ANAHTARLARI (31.08) — hepsi DEPLOY'SUZ, saniyeler içinde geri alınır ═══
//   statik_mod       "origin" (VARSAYILAN) | "501". Motor yan-servisi canlıya çıkınca "501" yaz.
//                    Bkz statik.js başlığı: koşulsuz 501 bugün canlı render'ı öldürür (ölçüldü).
//   mvt_kaynak       "r2" (VARSAYILAN, 02.09) | "origin-once" | "yalniz-hooder".
//                    "r2": ortak R2 PMTiles arşivi + worker-içi harman (mvt_bina.py portu, bayt
//                    bayt aynı) → sunucusuz ve z14'te 5.353 bina. "origin-once": eski davranış
//                    (z13+ önce origin, sonra R2, sonra Hooder). "yalniz-hooder": teşhis/acil.
//   geo_kaynak       "nominatim" (VARSAYILAN) | "esri". Nominatim ölürse kod zaten Esri'ye düşer;
//                    bu anahtar Nominatim'i tamamen atlatmak için (ör. kalıcı 429).
//   origin_yedek     "1" (VARSAYILAN) | "0". **ANA ŞALTER**: "0" yazılırsa hiçbir uç origin'e
//                    DOKUNMAZ (statik → 501, mvt → yalnız Hooder, yükseklik → R2/sıfır-grid).
//                    Sunucu kalıcı kapandığında tek yazımla tam sunucusuz moda geçilir.
//   geocoding_forward ARTIK KULLANILMIYOR (geocoding worker İÇİNDE, Nominatim; bkz geokod.js).
//                    Anahtar okunmaz; KV'de kalması zararsız.

const VARSAYILAN_OSRM = ["https://router.project-osrm.org"];

export async function ayarYukle(env) {
  const kv = env.HARITA_AYAR;
  const oku = async (k) => {
    try {
      return kv ? await kv.get(k, { cacheTtl: 60 }) : null;
    } catch {
      return null;
    }
  };
  const [ourl, prof, ttl, smod, mvtk, geok, oyed] = await Promise.all([
    oku("osrm_urls"),
    oku("profiller"),
    oku("match_ttl_gun"),
    oku("statik_mod"),
    oku("mvt_kaynak"),
    oku("geo_kaynak"),
    oku("origin_yedek"),
  ]);

  let osrmDizi = VARSAYILAN_OSRM;
  /** @type {Record<string, string[]>|null} profil haritası biçimi */
  let osrmHarita = null;
  try {
    const v = JSON.parse(ourl);
    if (Array.isArray(v) && v.length) osrmDizi = v;
    else if (v && typeof v === "object") osrmHarita = v;
  } catch {}

  let profiller = ["driving"];
  try {
    const v = JSON.parse(prof);
    if (Array.isArray(v) && v.length) profiller = v;
  } catch {}

  return {
    profiller,
    matchTtlGun: Math.max(1, parseInt(ttl, 10) || 30),
    beklemeMs: Math.max(0, parseInt(env.OSRM_BEKLEME_MS, 10) || 120),
    // Varsayılanlar KV OKUNAMAZSA da geçerli olmalı — bugünkü canlı davranışı korurlar.
    statikMod: smod === "501" ? "501" : "origin",
    mvtKaynak: mvtk === "yalniz-hooder" || mvtk === "origin-once" ? mvtk : "r2",
    geoKaynak: geok === "esri" ? "esri" : "nominatim",
    // ANA ŞALTER: yalnız açıkça "0"/"false" origin'i tamamen kapatır (fail-safe yön).
    originYedek: !(oyed === "0" || oyed === "false"),
    osrmUrls(profil) {
      if (!osrmHarita) return osrmDizi;
      const v = osrmHarita[profil] || osrmHarita["*"];
      return Array.isArray(v) && v.length ? v : VARSAYILAN_OSRM;
    },
  };
}

export async function sha256Hex(metin) {
  const oz = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(metin),
  );
  return [...new Uint8Array(oz)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function matchAnahtar(profil, seyrekCs) {
  return sha256Hex(profil + "|" + seyrekCs.join(";"));
}

function cacheUrl(anahtar) {
  // Sentetik anahtar-URL (yalnız Cache API adresi; hiçbir yere istek gitmez).
  return "https://harita-match-cache.invalid/" + anahtar;
}

export async function matchOnbellekBak(env, ctx, anahtar, ttlGun) {
  try {
    const y = await caches.default.match(cacheUrl(anahtar));
    if (y) return { govde: await y.text(), kaynak: "cache-api" };
  } catch {}
  try {
    if (env.MATCH_CACHE) {
      const ad = "match/" + anahtar + ".json";
      const o = await env.MATCH_CACHE.get(ad);
      if (o) {
        if (Date.now() - o.uploaded.getTime() <= ttlGun * 86400e3) {
          const govde = await o.text();
          ctx.waitUntil(cacheApiYaz(anahtar, govde, ttlGun)); // edge'e geri doldur
          return { govde, kaynak: "r2" };
        }
        ctx.waitUntil(env.MATCH_CACHE.delete(ad)); // TTL doldu → temizle
      }
    }
  } catch {}
  return null;
}

async function cacheApiYaz(anahtar, govde, ttlGun) {
  try {
    await caches.default.put(
      cacheUrl(anahtar),
      new Response(govde, {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=" + ttlGun * 86400,
        },
      }),
    );
  } catch {}
}

export async function matchOnbellekYaz(env, anahtar, govde, ttlGun) {
  await cacheApiYaz(anahtar, govde, ttlGun);
  try {
    if (env.MATCH_CACHE) {
      await env.MATCH_CACHE.put("match/" + anahtar + ".json", govde, {
        httpMetadata: { contentType: "application/json" },
      });
    }
  } catch {}
}
