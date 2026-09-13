// cf-harita-katman — yönlendirici (KARAR.md #4 + sunucusuzlaştırma 31.08)
//
// ═══ SUNUCUSUZLAŞTIRMA (Barış: "sunucu kapansa bile çalışsın, kendini onarsın") ═══
// Devirde bu worker yalnız matching'i kendi çalıştırıyor, statik+geocoding'i ORIGIN'e
// iletiyordu → sunucu kapanınca harita 502. 31.08 ölçümlerinden sonra uçların kaynakları:
//
//   Uç                    Kaynak                                        Sunucu gerekir mi?
//   ──────────────────    ──────────────────────────────────────────    ──────────────────
//   /matching/*           OSRM (public) + Cache API/R2                  HAYIR (zaten yoktu)
//   /xyz/{sat|str}/*      Esri → Hooder /sat → EOX (hepsi public)       HAYIR
//   /mvt/*                Hooder /vt (public); z13-16'da origin varsa   HAYIR (yoksa seyrek bina)
//                         daha zengin harman kullanılır                 → opsiyonel ÜSTÜNLÜK
//   /yukseklik            Cache API → R2 (kalıcı) → origin → sıfır-grid HAYIR (fail-soft)
//   /geocoding/v5/*       Nominatim → Esri reverse (public)             HAYIR
//   /styles/v1/* (statik) RASTER dikiş → MOTOR İÇİ yan-servis           501 + açıklama
//                         (KV statik_mod; bugün "origin", motor hazır olunca "501")
//
// Kalan TEK sunucu bağı = /styles (KV ile kapatılır) + /mvt z13-16 kalite üstünlüğü +
// /yukseklik ilk hesap. Üçü de "opsiyonel yedek": origin ölünce devre kesici (origin.js)
// 60 sn susturur, uçlar public/önbellek yoluna düşer, sunucu dönünce kendiliğinden geri gelir.
//
// Önek denetimi: öneksiz motor ucu → 404 (T11, bugünkü nginx cf-harita davranışıyla aynı).
// ⚠️ ÖNEKSİZ /xyz /mvt /yukseklik'e ROUTE BAĞLANMAZ: ölçüldü 31.08, harita.nickdegs.com/xyz/'e
// gelen 4.510 isteğin ~4.400'ü HOODER'IN OYUN İSTEMCİLERİ (Hooder/2.4 MapLibre iOS,
// app.realvirtuality.landlord Android). Çıplak yolu claim etmek Hooder'ın haritasını öldürür.
// Bizim tüketicilerimiz önekli yoldan gelir; render3d.js çıplak yolu kullanıyorsa çözüm
// HARITA_TABAN env'ini önekli adrese almaktır (nginx/Hooder'a dokunmadan).
//
// /saglik: anonim (B12) — hem öneksiz hem önekli kabul edilir. `?tam=1` kaynak teşhisi verir.
// ═══ K0 §A3 MUAFİYET ═══
// Hooder zone'unda otonom bot savunması var (datacenter/cloud ASN bloğu + davranış-tabanlı
// kalıcı /64 yasağı). Move Log render trafiği o savunmadan MUAF tutulmalı; muafiyet işareti
// **yol öneki**dir (başlık DEĞİL — tarayıcı tüketicilerinde CORS ön-uçuş gerekir ve
// ölçümde `OPTIONS /xyz/...` → 501). Ayrıntı: muafiyet/ONERI-HOODER.md
//   MLOG_ONEK tanımsızsa muafiyet öneki = ONEK (mevcut capability öneki yeniden kullanılır
//   → tüketicilerde sıfır kod değişikliği). Hooder ayrı bir önek isterse MLOG_ONEK ile ayrılır.
import { matchingIsle } from "./matching.js";
import { statikIsle } from "./statik.js";
import { karoIsle } from "./karo.js";
import { mvtIsle } from "./mvt.js";
import { yukseklikIsle } from "./yukseklik.js";
import { geokodIsle } from "./geokod.js";
import { ayarYukle } from "./cache.js";
import { originKapali, originOluKalan } from "./origin.js";
import { pmtilesOzet } from "./pmtiles.js";

const SAGLIK = JSON.stringify({ ok: true, katman: "cf-harita-katman" });

export default {
  async fetch(istek, env, ctx) {
    const url = new URL(istek.url);
    const yol = url.pathname;
    const kirp = (v) => (v || "").replace(/^\/+|\/+$/g, "");
    const onek = kirp(env.ONEK);
    const mlogOnek = kirp(env.MLOG_ONEK) || onek; // ayrı muafiyet öneki verilmediyse aynısı

    if (
      yol === "/saglik" ||
      (onek && yol === `/${onek}/saglik`) ||
      (mlogOnek && yol === `/${mlogOnek}/saglik`)
    ) {
      if (url.searchParams.get("tam") === "1") return saglikTam(istek, env, url);
      return new Response(SAGLIK, {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // ONEK tanımsız deploy = motor uçları kapalı (yanlış yapılandırma sigortası).
    if (!onek) return yok();

    // T11: önek yoksa/yanlışsa 404 — bilgi sızdırmadan, düz metin (bugünkü proxy gibi).
    // İki önek de kabul edilir (aynı davranış); hangisi geldiyse o soyulur.
    const eslesen = yol.startsWith(`/${mlogOnek}/`)
      ? mlogOnek
      : yol.startsWith(`/${onek}/`)
        ? onek
        : null;
    if (!eslesen) return yok();
    const ic = yol.slice(eslesen.length + 1); // önek soyuldu: "/matching/...", "/xyz/..."

    // Tarayıcı tüketicisi (telefon 3B HTML / puppeteer) için CORS ön-uçuşu.
    // ÖLÇÜLDÜ: bugünkü origin `OPTIONS /xyz/...` → 501; MapLibre bu yüzden beyaz kare üretebiliyordu.
    if (istek.method === "OPTIONS") return onUcus();
    if (istek.method !== "GET" && istek.method !== "HEAD") {
      return new Response("yontem desteklenmiyor", {
        status: 405,
        headers: { "Content-Type": "text/plain", Allow: "GET, HEAD, OPTIONS" },
      });
    }

    if (ic.startsWith("/matching/v5/mapbox/")) {
      return matchingIsle(istek, env, ctx, ic);
    }
    // Forward'da origin'e DAİMA `onek` ile gidilir: origin nginx yalnız o location'ı tanır
    // (muafiyet öneği ayrı verilse bile origin tarafı değişmez → nginx'e dokunulmaz).
    if (ic.startsWith("/styles/v1/")) {
      return statikIsle(istek, env, ctx, onek, ic, await ayarYukle(env));
    }
    if (ic.startsWith("/geocoding/v5/")) {
      return (await geokodIsle(istek, env, ctx, ic, await ayarYukle(env))) || yok();
    }
    if (ic.startsWith("/xyz/")) {
      return (await karoIsle(istek, env, ctx, ic)) || yok();
    }
    if (ic.startsWith("/mvt/")) {
      return (await mvtIsle(istek, env, ctx, ic, onek, await ayarYukle(env))) || yok();
    }
    if (ic.startsWith("/yukseklik")) {
      return yukseklikIsle(istek, env, ctx, ic, onek, await ayarYukle(env));
    }
    return yok();
  },
};

// Teşhis ucu: hangi kaynak ayakta, origin devre kesicisi açık mı, KV ne diyor.
// Sunucu kapandığında "harita neden böyle" sorusunun tek komutluk cevabı.
async function saglikTam(istek, env, url) {
  const ayar = await ayarYukle(env);
  const dene = async (ad, u, sec) => {
    const t0 = Date.now();
    try {
      const y = await fetch(u, {
        signal: AbortSignal.timeout(8000),
        headers: { "User-Agent": "cf-harita-katman/1.0" },
        ...(sec || {}),
      });
      const b = await y.arrayBuffer();
      return { ad, kod: y.status, n: b.byteLength, ms: Date.now() - t0 };
    } catch (e) {
      return { ad, kod: 0, hata: String(e).slice(0, 80), ms: Date.now() - t0 };
    }
  };
  // Referans karo: İstanbul z12 = x 2377 / y 1535 (z10 = 594/383). ⚠️ YOL SIRALARI FARKLI —
  // Esri ve EOX {z}/{y}/{x}, Hooder {z}/{x}/{y}. Karıştırılırsa sağlıklı kaynak "502/boş"
  // görünür (ilk yazımda tam bu oldu: hooder-sat 502, esri-sat 678 B okyanus karosu).
  // 02.09 — R2 sunucusuz veri kaynakları: ortak PMTiles (mvt) + GHS blokları (yukseklik) + MS binaları.
  const r2 = async (ad, f) => {
    const t0 = Date.now();
    try {
      return { ad, ...(await f()), ms: Date.now() - t0 };
    } catch (e) {
      return { ad, hata: String(e && e.message ? e.message : e).slice(0, 80), ms: Date.now() - t0 };
    }
  };
  const r2Kaynaklar = await Promise.all([
    r2("pmtiles", () => pmtilesOzet(env)),
    r2("ghs", async () => {
      const o = await env.MATCH_CACHE.get("ghs/index.json");
      if (!o) throw new Error("ghs/index.json yok");
      const v = await o.json();
      return { raster: v.rasterlar.length, blok: v.blok };
    }),
    r2("ms-bina", async () => {
      const o = await env.MATCH_CACHE.head("ms-bina/15/19024/12275.json"); // Levent (İstanbul kuşağı)
      return { var: !!o, n: o ? o.size : 0 };
    }),
  ]);
  const kaynaklar = await Promise.all([
    dene(
      "esri-sat",
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/12/1535/2377",
    ),
    dene(
      "esri-str",
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/12/1535/2377",
    ),
    dene("hooder-sat", "https://realvirtuality.app/hooder-api/sat/12/2377/1535.jpg"),
    dene("hooder-vt", "https://realvirtuality.app/hooder-api/vt/12/2377/1535.mvt"),
    dene(
      "eox",
      "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/10/383/594.jpg",
    ),
    dene(
      "nominatim",
      "https://nominatim.openstreetmap.org/reverse?lat=41.0082&lon=28.9784&format=jsonv2&zoom=14",
    ),
    dene("osrm", "https://router.project-osrm.org/nearest/v1/driving/28.9784,41.0082"),
  ]);
  return new Response(
    JSON.stringify(
      {
        ok: true,
        katman: "cf-harita-katman",
        ayar: {
          statik_mod: ayar.statikMod,
          mvt_kaynak: ayar.mvtKaynak,
          geo_kaynak: ayar.geoKaynak,
          origin_yedek: ayar.originYedek,
        },
        origin: {
          taban: (env.ORIGIN_TABAN || "") ? "tanimli" : "yok",
          cozum: env.ORIGIN_COZUM ? "tanimli" : "yok",
          kapali: originKapali(env, ayar, url.host),
          devre_kesici_kalan_ms: originOluKalan(),
        },
        r2: r2Kaynaklar,
        kaynaklar,
      },
      null,
      1,
    ),
    { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } },
  );
}

function onUcus() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "86400",
      "Cross-Origin-Resource-Policy": "cross-origin",
    },
  });
}

function yok() {
  return new Response("yol taninmadi", {
    status: 404,
    headers: { "Content-Type": "text/plain" },
  });
}
