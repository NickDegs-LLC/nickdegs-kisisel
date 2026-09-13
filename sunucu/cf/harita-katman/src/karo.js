// cf-harita-katman — B-KARO `/xyz/{sat|str}/{z}/{x}/{y}.jpg` (sunucusuzlaştırma, 31.08)
// `harita-proxy.py:511-544` + `_tile` (148-222) portu. SUNUCUYA HİÇ BAKMAZ — zincir tamamen public.
//
// Davranış eşleştirmesi (Python ↔ burada):
//   • kaynak sırası            harita-kaynak.json canlı sırası (bkz kaynak.js)          BİREBİR
//   • Esri gri "veri yok"      2521 B + md5 f27d9de7f80c → kaynağı ATLA                 BİREBİR
//   • üst-zoom yedeği          en fazla 4 kademe, z>3 iken (Python `_derinlik<4`)       BİREBİR mantık
//   • katman tavanı            `?k=premium`→z17, aksi halde z18 (Python satır 525)      BİREBİR
//   • tavan üstü kırpma        (x%n)*s / (y%n)*s çeyrek → 256×256                       BİREBİR formül
//   • aralık dışı y / son çare koyu (10,12,18) karo                                     BİREBİR bayt
//   • Cache-Control            public, max-age=2592000                                  BİREBİR (+immutable)
// TEK bilinçli fark: yeniden örnekleyici PIL LANCZOS değil CF Image Resizing (kaynak.js notu).
import { karoZinciri, kirpUst, koyuKaro, basliklar, onbellekAnahtari, onbellekBak, onbellekYaz } from "./kaynak.js";

const RX = /^\/xyz\/(sat|str)\/(\d+)\/(\d+)\/(\d+)\.jpg$/;
const MAXAGE = 2592000; // 30 g

export async function karoIsle(istek, env, ctx, ic) {
  const yol = ic.split("?")[0];
  const m = RX.exec(yol);
  if (!m) return null; // yönlendirici 404 üretir
  const kind = m[1];
  const z = parseInt(m[2], 10);
  const x = parseInt(m[3], 10);
  const y = parseInt(m[4], 10);
  if (!(z >= 0 && z <= 24)) return yanit(koyuKaro(), "aralik-disi");

  const url = new URL(istek.url);
  const kq = url.searchParams.get("k");
  const kt = kq === "ultra" ? "ultra" : kq === "premium" ? "premium" : null;
  // Python satır 525: `_tavan = 17 if _kt == "premium" else 18` — parametre YOKSA da 18.
  // (Dosyadaki "parametre yoksa z19" yorumu ESKİ; kodun kendisi 18 diyor, kod esas alındı.)
  const tavan = kt === "premium" ? 17 : 18;

  // `k` içeriği değiştirir → anahtara girer. Diğer her şey (cb, t, access_token) atılır.
  const anahtar = onbellekAnahtari(istek.url, yol, kt ? ["k"] : []);
  const on = await onbellekBak(anahtar);
  if (on) return on;

  const uret = await karoUret(kind, z, x, y, tavan);
  const bas = basliklar("image/jpeg", MAXAGE);
  bas.set("X-Kaynak", uret.kaynak);
  if (uret.kaynak !== "koyu") onbellekYaz(ctx, anahtar, uret.govde.slice(0), bas);
  return new Response(uret.govde, { status: 200, headers: bas });
}

async function karoUret(kind, z, x, y, tavan) {
  // ── 1) KATMAN TAVANI (ürün ayrımı: Ultra yere daha yakın/net görür) ────────
  // ⚠️ HATA DERSİ (Python 527-535): zoom'u kısarken x/y'yi OLDUĞU GİBİ bırakmak karoyu aralık
  // dışına düşürür → SİYAH karo. DOĞRUSU: ebeveyni al, denk gelen ÇEYREĞİ kırp, büyüt.
  if (z > tavan) {
    const f = z - tavan;
    const ust = await karoZinciri(kind, tavan, x >> f, y >> f);
    if (ust) {
      const k = await kirpUst(ust.url, f, x, y);
      if (k) return { govde: k, kaynak: ust.kaynak + "+tavan" + f };
      // Kırpma çalışmadı (Image Resizing kapalı/arızalı). DOĞRU GÖRÜNTÜ > katman ayrımı:
      // istenen zoom'un gerçek karosunu ver. Premium bu karede Ultra detayını görür — ürün
      // farkı geçici olarak kaybolur ama video BOZULMAZ. `X-Kaynak` ile görünür kalır.
      const gercek = await karoZinciri(kind, z, x, y);
      if (gercek) return { govde: gercek.govde, kaynak: gercek.kaynak + "+tavansiz" };
      return { govde: ust.govde, kaynak: ust.kaynak + "+kirpilamadi" };
    }
    // Tavan zoom'unda da yok → aşağıdaki genel üst-zoom yedeğine düş.
  }

  // ── 2) İSTENEN ZOOM ───────────────────────────────────────────────────────
  const hedefZ = Math.min(z, tavan);
  if (hedefZ === z) {
    const r = await karoZinciri(kind, z, x, y);
    if (r) return { govde: r.govde, kaynak: r.kaynak };
  }

  // ── 3) ÜST ZOOM YEDEĞİ (Python `_derinlik < 4 and osmz > 3`) ──────────────
  // Bu zoom'da görüntü yok ama üst seviyede VAR → ebeveynin çeyreğini kırp, büyüt.
  // Bulanık ama GERÇEK görüntü; gri "veri yok" levhasından da koyu kareden de iyidir.
  for (let f = 1; f <= 4 && hedefZ - f >= 3; f++) {
    const ust = await karoZinciri(kind, hedefZ - f, x >> (z - hedefZ + f), y >> (z - hedefZ + f));
    if (!ust) continue;
    const k = await kirpUst(ust.url, z - hedefZ + f, x, y);
    if (k) return { govde: k, kaynak: ust.kaynak + "+ust" + f };
  }
  return { govde: koyuKaro(), kaynak: "koyu" };
}

function yanit(govde, kaynak) {
  const bas = basliklar("image/jpeg", MAXAGE);
  bas.set("X-Kaynak", kaynak);
  return new Response(govde, { status: 200, headers: bas });
}
