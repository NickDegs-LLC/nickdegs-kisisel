// cf-harita-katman — ORIGIN = **OPSİYONEL YEDEK** (sunucusuzlaştırma, 31.08)
//
// Devir öncesi origin (bu sunucu, nginx→harita-proxy.py) ZORUNLU birincil kaynaktı; artık
// yalnız "elde varsa daha iyisini ver" rolünde. Hiçbir uç origin'e BAĞIMLI değildir:
// her çağıranın origin null dönerse çalışan bir public/sunucusuz yolu vardır.
//
// ⚡ DEVRE KESİCİ (kritik): bir 3B render ~13.000 karo çeker. Origin ölüyse her karoda TCP
// zaman aşımı beklemek render'ı öldürür (V125-ULTRA dersi: 619 adet nginx 499 → beyaz video).
// Bu yüzden ilk arıza `_oluTs` damgası koyar ve 60 sn boyunca origin HİÇ denenmez —
// istek başına maliyet sıfıra iner, sunucu geri gelince kendiliğinden yeniden denenir
// (kendini onarma; elle müdahale yok).
//
// ⚠️ DÖNGÜ: route'lar harita.nickdegs.com'da. ORIGIN_TABAN aynı host olduğu için bağlantı
// ORIGIN_COZUM (gri-bulut A kaydı harita-origin.nickdegs.com → sunucu IP) üzerinden
// cf.resolveOverride ile gider. ORIGIN_COZUM yoksa origin KAPALI sayılır (sessiz döngü yerine
// temiz "yok" — çağıran public zincire düşer).

const OLU_MS = 60000; // arıza sonrası origin'i dinlendirme süresi
let _oluTs = 0; // isolate-yerel damga (DO/KV maliyeti yok; render trafiği az sayıda isolate'e düşer)

// ⚠️ "YAVAŞ" ≠ "ÖLÜ" — 31.08 ÖLÇÜMÜ ile bulundu ve düzeltildi.
// İlk yazımda her zaman aşımı devre kesiciyi açıyordu. Ölçüm (10 taze z14 karosu):
// origin'in `mvt_bina.harman` SOĞUK sentezi 1,5-5,8 sn sürüyor → 10 karonun 2'si 5 sn'lik
// zaman aşımını geçti, devre kesici açıldı ve SAĞLIKLI sunucuya rağmen 60 sn boyunca
// Hooder'ın SEYREK binaları (586 vs 5.353) servis edildi. Sessiz kalite kaybı.
// AYRIM: gerçekten ölü sunucu HIZLI hata verir (DNS/connect reddi, CF 5xx) → devre kesici
// ANINDA açılır. Yavaş sunucu zaman aşımı verir → ancak ÜST ÜSTE 3 kez olursa açılır.
const ZAMAN_ASIMI_ESIK = 3;
let _ardisikZamanAsimi = 0;

/** Origin bu istek için hiç denenmemeli mi? (yapılandırma yok / KV kapalı / devre kesici açık) */
export function originKapali(env, ayar, istekHost) {
  if (ayar && ayar.originYedek === false) return true;
  const taban = (env.ORIGIN_TABAN || "").trim();
  if (!taban) return true;
  if (Date.now() < _oluTs) return true;
  try {
    if (new URL(taban).host === istekHost && !env.ORIGIN_COZUM) return true; // döngü sigortası
  } catch {
    return true;
  }
  return false;
}

/** Tanı amaçlı: devre kesici ne zamana kadar açık (0 = kapalı/sağlıklı). */
export function originOluKalan() {
  return Math.max(0, _oluTs - Date.now());
}

/**
 * Origin'e tek istek. Dönüş: Response | null (null = "origin yok, public zincire düş").
 * 5xx/ağ hatası devre kesiciyi kurar; 4xx kurmaz (yol yok demektir, sunucu ölü değil).
 */
export async function originIste(env, ayar, istekHost, onek, icYol, arama, zamanAsimiMs = 4000) {
  if (originKapali(env, ayar, istekHost)) return null;
  const taban = (env.ORIGIN_TABAN || "").replace(/\/+$/, "");
  // Origin nginx YALNIZ capability öneğini (ONEK) tanır — muafiyet öneği (MLOG_ONEK) ile
  // gelen istek de origin'e ONEK ile gider (origin tarafına hiç dokunulmaz).
  const hedef = taban + "/" + onek + icYol + (arama || "");
  const sec = {
    headers: { "User-Agent": "cf-harita-katman/1.0" },
    signal: AbortSignal.timeout(zamanAsimiMs),
  };
  if (env.MOVELOG_KEY) sec.headers["X-Movelog-Key"] = env.MOVELOG_KEY; // K0 §A3 muafiyet
  if (env.ORIGIN_COZUM) sec.cf = { resolveOverride: env.ORIGIN_COZUM };
  try {
    const y = await fetch(hedef, sec);
    if (y.status >= 500) {
      _oluTs = Date.now() + OLU_MS; // 502/504/523 = sunucu/nginx ölü → ANINDA dinlendir
      _ardisikZamanAsimi = 0;
      return null;
    }
    _ardisikZamanAsimi = 0; // sağlıklı cevap → sayaç sıfırlanır
    return y;
  } catch (e) {
    if (e && e.name === "TimeoutError") {
      // Yavaş olabilir (soğuk karo sentezi). Üst üste 3 kez olmadan sunucuyu ölü sayma.
      _ardisikZamanAsimi++;
      if (_ardisikZamanAsimi >= ZAMAN_ASIMI_ESIK) _oluTs = Date.now() + OLU_MS;
    } else {
      _oluTs = Date.now() + OLU_MS; // DNS/connect hatası = hızlı ve kesin ölü işareti
    }
    return null;
  }
}
