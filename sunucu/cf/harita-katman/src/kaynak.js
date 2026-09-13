// cf-harita-katman — PUBLIC KARO KAYNAKLARI + ortak yardımcılar (sunucusuzlaştırma, 31.08)
//
// Zincir `harita-kaynak.json`'un CANLI sırasının birebir karşılığı (31.08 okundu):
//   sat : Esri World_Imagery (z0-19)  →  Hooder /hooder-api/sat (z0-14)  →  EOX s2cloudless (z0-14)
//   str : Esri World_Street_Map (z0-19)
// Sunucudaki `dizin` kaynağı (/opt/payment/sat_cache, z0-10) Hooder'ın AYNI arşivinin yerel
// kopyasıydı; kenardan onun HTTP karşılığı (/hooder-api/sat, z0-14) kullanılır → kapsama DAHA GENİŞ.
//
// ÖLÇÜM (31.08, CF kenarı colo FRA — `wrangler dev --remote`):
//   Esri World_Imagery      200 · 16.049 B · 61 ms (2. tur 20 ms) · ACAO:* · anahtarsız
//   Esri World_Street_Map   200 · 14.863 B · 66 ms · ACAO:* · anahtarsız
//   Hooder /sat z10/13/14   200 (88-109 ms) · z15/z16 → 502 (kapsama boşluğu; 204 DEĞİL)
//   Hooder /vt  z8..z15     200 · z16/z17 → **400** (arşiv z15'te bitiyor)   ⚠️ tasarım tablosu
//                           "/mvt z16 → Hooder" diyordu; ÖLÇÜM ÇÜRÜTTÜ, z16 origin/204'e gider.
//   EOX s2cloudless         200 · 14.759 B · public, CC BY 4.0
//   crypto.subtle "MD5"     DESTEKLENİYOR ("abc"→900150983cd24fb0…) → Python'un md5 boş-karo
//                           tespiti BİREBİR taşınabildi.
//   cf.image trim+resize    `cf-resized: internal=ok/d`, 19.214 B → 11.011 B  → tavan üstü
//                           kırpma (premium z17 / ultra z18) kenarda mümkün.

export const ESRI = {
  sat: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  str: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
};
export const HOODER_SAT = "https://realvirtuality.app/hooder-api/sat/{z}/{x}/{y}.jpg";
export const HOODER_VT = "https://realvirtuality.app/hooder-api/vt/{z}/{x}/{y}.mvt";
// ⚠️ EOX WMTS yol sırası {z}/{y}/{x} — xyz'nin TERSİ (satır/sütun). Python'daki aynı tuzak.
export const EOX =
  "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg";

export const HOODER_VT_MAXZ = 15; // ÖLÇÜLDÜ 31.08: z16 → 400
export const HOODER_SAT_MAXZ = 14; // ÖLÇÜLDÜ 31.08: z15 → 502
export const EOX_MAXZ = 14; // 10 m/px — z15+ bulanık (harita-kaynak.json notu)

// 🔴 ESRİ "VERİ YOK" KAROSU — harita-proxy.py:133-145 birebir. Kapsama olmayan zoom'da Esri
// HTTP 200 ile "Map data not yet available" yazan GRİ karo döndürür; geçerli sanılırsa videonun
// ön planı gri levha olur (V127-PREMIUM vakası). Karo BAYT BAYT AYNI.
// ÖLÇÜM 31.08 (kenardan, 3 bağımsız nokta — İstanbul z19 / okyanus z18 / Sahra z19):
// üçü de 2521 B + md5 f27d9de7f80c → sabit BUGÜN DE GEÇERLİ.
const ESRI_BOS_BOYUT = 2521;
const ESRI_BOS_MD5 = "f27d9de7f80c";

export async function bosKaroMu(govde) {
  if (!govde || govde.byteLength !== ESRI_BOS_BOYUT) return false;
  try {
    const oz = await crypto.subtle.digest("MD5", govde);
    return [...new Uint8Array(oz)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .startsWith(ESRI_BOS_MD5);
  } catch {
    return true; // MD5 yoksa 2521 B tek başına da yeterince ayırt edici (ölçüldü)
  }
}

// Python `Image.new("RGB",(256,256),(10,12,18))` + JPEG q85 çıktısının BİREBİR baytları (1652 B).
// Hiçbir kaynak vermezse dönen "koyu karo" — beyaz/şeffaf kare yerine sahnenin gece tonu.
const KOYU_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAEAAQADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD5FooorUkKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA//9k=";

let _koyu = null;
/** 256×256 koyu (10,12,18) JPEG — Python'un son çare karosunun birebir baytları. */
export function koyuKaro() {
  if (!_koyu) {
    const ham = atob(KOYU_B64);
    const u = new Uint8Array(ham.length);
    for (let i = 0; i < ham.length; i++) u[i] = ham.charCodeAt(i);
    _koyu = u.buffer;
  }
  return _koyu.slice(0);
}

function bicim(sablon, z, x, y) {
  return sablon.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}

/** Tek adayı çek; geçerli görüntü değilse null (zincir devam eder). */
async function aday(url, msSure = 8000) {
  try {
    const y = await fetch(url, {
      signal: AbortSignal.timeout(msSure),
      headers: { "User-Agent": "cf-harita-katman/1.0" },
    });
    if (!y.ok) return null; // Hooder kapsama boşluğu 502, Esri 4xx vb.
    const govde = await y.arrayBuffer();
    if (!govde || govde.byteLength <= 200) return null;
    if (await bosKaroMu(govde)) return null; // Esri gri "veri yok" levhası → SIRADAKİ kaynak
    return { url, govde };
  } catch {
    return null;
  }
}

/**
 * İstenen zoom'da tek 256 px karo — public zincir. Dönüş {url, govde, kaynak} | null.
 * `url` kırpma için saklanır (CF Image Resizing aynı URL'i ısınmış CF önbelleğinden okur).
 */
export async function karoZinciri(kind, z, x, y) {
  const n = 2 ** z;
  if (!(y >= 0 && y < n)) return null; // Python: aralık dışı y → koyu karo
  const tx = ((x % n) + n) % n;

  const adaylar = [];
  if (kind === "sat") {
    if (z <= 19) adaylar.push(["esri", bicim(ESRI.sat, z, tx, y)]);
    if (z <= HOODER_SAT_MAXZ) adaylar.push(["hooder", bicim(HOODER_SAT, z, tx, y)]);
    if (z <= EOX_MAXZ) adaylar.push(["eox", bicim(EOX, z, tx, y)]);
  } else {
    if (z <= 19) adaylar.push(["esri", bicim(ESRI.str, z, tx, y)]);
  }
  for (const [ad, u] of adaylar) {
    const r = await aday(u);
    if (r) return { url: r.url, govde: r.govde, kaynak: ad };
  }
  return null;
}

/**
 * Ebeveyn karodan çeyrek kırpma — harita-proxy.py'nin PIL matematiğinin birebir karşılığı:
 *   _n = 1<<f ; _s = max(1, 256//_n) ; _cx,_cy = (x%_n)*_s, (y%_n)*_s
 *   ust.crop((_cx,_cy,_cx+_s,_cy+_s)).resize((256,256), LANCZOS)
 * Fark: yeniden örnekleyici PIL LANCZOS değil CF Image Resizing → tavan ÜSTÜ karolarda
 * piksel-birebir DEĞİL (yalnız z18/z19'u etkiler; sözleşme T1 z15↔z16 ölçeğine dokunmaz).
 * Dönüş null = kırpma yapılamadı (çağıran kendi yedeğine düşer).
 */
export async function kirpUst(url, f, x, y) {
  const n = 1 << f;
  const s = Math.max(1, Math.floor(256 / n));
  const cx = (((x % n) + n) % n) * s;
  const cy = (((y % n) + n) % n) * s;
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      cf: {
        image: {
          trim: { top: cy, left: cx, width: s, height: s },
          width: 256,
          height: 256,
          fit: "cover",
          format: "jpeg",
          quality: 85,
        },
      },
    });
    if (!r.ok) return null;
    if (!r.headers.get("cf-resized")) return null; // dönüşüm çalışmadı → ham dönmüş, kullanma
    const b = await r.arrayBuffer();
    return b && b.byteLength > 200 ? b : null;
  } catch {
    return null;
  }
}

// ── ortak başlıklar ──────────────────────────────────────────────────────────
// ÖLÇÜLDÜ 31.08: nginx ACAO+CORP+immutable'ı YALNIZ öneksiz /xyz /mvt location'larına koyuyordu;
// ÖNEKLİ yolda düşüyordu → tarayıcı tüketicisi (telefon 3B HTML / puppeteer) beyaz kare üretirdi.
// Worker bu boşluğu her uçta kapatır; origin nginx'e dokunulmaz.
export function basliklar(tip, maxAgeSn, ek) {
  const b = new Headers(ek || undefined);
  if (tip) b.set("Content-Type", tip);
  b.set("Access-Control-Allow-Origin", "*");
  b.set("Cross-Origin-Resource-Policy", "cross-origin");
  if (maxAgeSn) b.set("Cache-Control", "public, max-age=" + maxAgeSn + ", immutable");
  return b;
}

// SENTETİK ANAHTAR HOSTU — hiçbir yere istek gitmez, yalnız Cache API adresidir.
// İKİ nedenle gerçek istek hostu KULLANILMAZ:
//  1) ÖLÇÜLDÜ 31.08: workers.dev hostuyla kurulan anahtar Cache API'de SESSİZCE yazılmıyor
//     (aynı istek 2. turda MISS); sentetik host ile yazılıyor (geocoding/yukseklik HIT verdi).
//     workers.dev yedek erişim yolu olarak duyurulduğuna göre karo önbelleği orada da çalışmalı,
//     yoksa her karo Esri'ye gider.
//  2) Aynı görüntü hem route'tan hem workers.dev'den istenebilir; host anahtara girerse
//     önbellek İKİYE BÖLÜNÜR (aynı karo iki kez dış kaynağa iner).
const ANAHTAR_HOST = "https://harita-katman-onbellek.invalid";

/**
 * Cache API anahtarı: ÖNEKSİZ + host'suz + gürültüsüz normalize URL.
 * Öneksizlik şart — aynı karo hem capability hem muafiyet öneğinden istenebilir; önek anahtara
 * girerse önbellek yine ikiye bölünür. `tut` dışındaki tüm sorgu parametreleri
 * (access_token, cb, t…) atılır: içeriği değiştirmezler, anahtarı çöpe çevirirler.
 */
export function onbellekAnahtari(url, icYol, tut) {
  const kaynak = new URL(url);
  const ck = new URL(ANAHTAR_HOST);
  ck.pathname = icYol;
  const kalan = new URLSearchParams();
  for (const k of tut || []) {
    const v = kaynak.searchParams.get(k);
    if (v !== null) kalan.set(k, v);
  }
  ck.search = kalan.toString();
  return new Request(ck.toString());
}

/** Cache API'den oku (yoksa null). Hata YUTULUR — önbellek asla yolu kesmez. */
export async function onbellekBak(anahtar) {
  try {
    const y = await caches.default.match(anahtar);
    if (y) {
      const k = new Response(y.body, y);
      k.headers.set("X-Onbellek", "cache-api");
      return k;
    }
  } catch {}
  return null;
}

/** Cache API'ye yaz (arka planda; hata yutulur). */
export function onbellekYaz(ctx, anahtar, govde, bas) {
  try {
    ctx.waitUntil(
      caches.default.put(anahtar, new Response(govde, { status: 200, headers: bas })).catch(() => {}),
    );
  } catch {}
}
