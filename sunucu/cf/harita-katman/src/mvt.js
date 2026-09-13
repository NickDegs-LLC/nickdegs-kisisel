// cf-harita-katman — B-MVT `/mvt/{z}/{x}/{y}.mvt|.pbf` (sunucusuzlaştırma, 31.08 → R2 02.09)
// `harita-proxy.py:545-589` portu. Tüketici: MapLibre GL (RunPod 3B worker) → fill-extrusion binalar.
//
// ⚠️ 404 DÖNDÜRMEZ: eksik karoda **204**. Gerekçe Python'daki ile aynı ve hâlâ geçerli —
// CrowdSec http-probing kuralı (10 adet 404/10 sn) tetiklenirse render'ın binlerce karo çeken
// IP'si banlanır ve render ölür; MapLibre 204'ü sorunsuz yutar.
//
// KAYNAK ZİNCİRİ (02.09, Barış: "yüzde yüz sunucu bağımsız" + "PMTiles R2'de zaten var, ortak"):
//   1) R2 PMTiles (ORTAK `hooder-harita/pmtiles/…`, SALT-OKUR, `PMTILES` bağı) — origin'in
//      okuduğu arşivin AYNISI. z13-15: `harman.js` (OSM + Microsoft, mvt_bina.py'nin birebir
//      portu; MS satırları kendi kovamızda `MATCH_CACHE/ms-bina/15/…`) → boşsa ham karo.
//      z≤12: ham karo. z≥16: arşiv z15'te biter → origin de 204 verirdi → doğrudan 204.
//      KANIT (test/uyum-harman.mjs): 184 sağlıklı referans karonun 184'ü BAYT BAYT aynı
//      (47'si MS satırlı İstanbul karosu). "Karo yok" cevabı da origin'inkiyle aynı → R2
//      sağlıklı cevap verdiyse zincir BİTER; Hooder/origin'e yalnız R2 HATA fırlatırsa inilir.
//   2) Hooder /hooder-api/vt (z≤15, aynı arşiv ama harmansız: z14'te 586 bina vs bizim 5.353).
//   3) origin (yalnız `origin_yedek`≠0 ve mvt_kaynak≠yalniz-hooder) — sunucu varsa; yoksa 204.
// KV `mvt_kaynak`: "r2" (VARSAYILAN) | "origin-once" (eski: z13+ önce origin, sonra R2, Hooder)
//   | "yalniz-hooder" (R2'ye de origin'e de dokunma; teşhis/acil durum).
import { HOODER_VT, HOODER_VT_MAXZ, basliklar, onbellekAnahtari, onbellekBak, onbellekYaz } from "./kaynak.js";
import { originIste } from "./origin.js";
import { karoOku } from "./pmtiles.js";
import { harman } from "./harman.js";

const RX = /^\/mvt\/(\d+)\/(\d+)\/(\d+)\.(?:mvt|pbf)$/;
const MAXAGE = 2592000; // 30 g
const TIP = "application/vnd.mapbox-vector-tile";
const PM_MAXZ = 15; // arşiv z0-15 (başlık da doğrular; karoOku z>maxz'da null)

export async function mvtIsle(istek, env, ctx, ic, onek, ayar) {
  const yol = ic.split("?")[0];
  const m = RX.exec(yol);
  if (!m) return null;
  const z = parseInt(m[1], 10);
  const x = parseInt(m[2], 10);
  const y = parseInt(m[3], 10);
  const n = 2 ** z;
  if (!(z >= 0 && z <= 24 && y >= 0 && y < n)) return bos();

  // Önbellek anahtarı "/r2" ön ekli (02.09): 01-02.09'da origin'in BOZUK (yükseklik anahtarsız, eksik
  // bina) ürettiği karolar Cache API'de 30 gün kalmasın diye ad alanı değiştirildi; eski kayıtlar
  // kendiliğinden düşer. Kaynak artık R2 harman (bayt bayt ölçüldü, test/uyum-harman.mjs).
  const anahtar = onbellekAnahtari(istek.url, "/r2" + yol, []);
  const on = await onbellekBak(anahtar);
  if (on) return on;
  // Arşiv z15'te biter; origin de z16+'da 204 veriyordu (pmtiles_okuyucu._bul → None). Hooder
  // /vt z16'da 400 (ÖLÇÜLDÜ). Kaynak yok → doğrudan 204, kimseye sorulmaz.
  if (z > PM_MAXZ) return bos();

  const istekHost = new URL(istek.url).host;
  const xn = ((x % n) + n) % n; // x sarmalı (MapLibre dünya kopyaları)
  const yalnizHooder = ayar.mvtKaynak === "yalniz-hooder";
  const originOnce = ayar.mvtKaynak === "origin-once" && z >= 13;
  const r2Var = !yalnizHooder && !!env.PMTILES && z <= PM_MAXZ;

  const sira = [];
  if (originOnce) sira.push("origin");
  if (r2Var) sira.push("r2");
  if (z <= HOODER_VT_MAXZ) sira.push("hooder");
  if (!originOnce && !yalnizHooder) sira.push("origin");

  let r2Hata = null;
  for (const kaynak of sira) {
    let govde = null;
    let etiket = kaynak;
    if (kaynak === "r2") {
      try {
        const r = await r2Karo(env, z, xn, y);
        if (r) {
          govde = r.govde;
          etiket = r.etiket;
        } else break; // R2 sağlıklı "karo yok" = origin'in 204'ü → zincir biter
      } catch (e) {
        r2Hata = String(e && e.message ? e.message : e).slice(0, 80);
        continue; // R2/bağ hatası → Hooder → origin
      }
    } else if (kaynak === "hooder") {
      govde = await hooderVt(z, xn, y);
    } else {
      // origin: 20 sn (ÖLÇÜLDÜ 31.08 — harman soğuk sentezi 1,5-5,8 sn). Sunucu kapalıysa
      // origin.js devre kesicisi kısa keser; `origin_yedek=0` ile tamamen kapanır.
      const y2 = await originIste(env, ayar, istekHost, onek, yol, "", 20000);
      if (y2 && y2.ok) {
        const b = await y2.arrayBuffer();
        if (b && b.byteLength > 0) govde = b; // origin 204 = "bu karoda veri yok" → zincire devam
      }
    }
    if (govde) {
      const bas = basliklar(TIP, MAXAGE);
      bas.set("X-Kaynak", etiket);
      if (r2Hata) bas.set("X-R2-Hata", r2Hata);
      onbellekYaz(ctx, anahtar, govde.slice(0), bas);
      return new Response(govde, { status: 200, headers: bas });
    }
  }
  const b = bos();
  if (r2Hata) b.headers.set("X-R2-Hata", r2Hata);
  return b;
}

/** R2 arşivinden karo: z13-15 harman (boşsa ham), diğer ham. null = karo yok. Hata FIRLATIR. */
async function r2Karo(env, z, x, y) {
  const oku = (zz, xx, yy) => karoOku(env, zz, xx, yy);
  if (z >= 13) {
    const h = await harman(oku, (x15, y15) => msOku(env, x15, y15), z, x, y);
    if (h) return { govde: h, etiket: "r2-harman" };
  }
  const ham = await oku(z, x, y);
  return ham && ham.length ? { govde: ham, etiket: "r2-ham" } : null;
}

/** Microsoft ML binaları — Move Log'un KENDİ kovası (MATCH_CACHE), `ms-bina/15/{x}/{y}.json`.
 *  Yoksa [] (DB İstanbul kuşağıyla sınırlı; kapsam dışı = satır yok, Python'da da öyle). */
async function msOku(env, x15, y15) {
  if (!env.MATCH_CACHE) return [];
  const o = await env.MATCH_CACHE.get(`ms-bina/15/${x15}/${y15}.json`);
  if (!o) return [];
  const v = await o.json();
  return Array.isArray(v) ? v : [];
}

async function hooderVt(z, x, y) {
  try {
    const u = HOODER_VT.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
    const y2 = await fetch(u, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "cf-harita-katman/1.0" },
    });
    if (!y2.ok) return null; // z16+ → 400, kapsama boşluğu → 204/404
    const b = await y2.arrayBuffer();
    return b && b.byteLength > 0 ? b : null;
  } catch {
    return null;
  }
}

// 204'ün gövdesi olamaz; ACAO/CORP yine de konur (MapLibre CORS ön-uçuşu için gerekli).
function bos() {
  return new Response(null, { status: 204, headers: basliklar(null, 0) });
}
