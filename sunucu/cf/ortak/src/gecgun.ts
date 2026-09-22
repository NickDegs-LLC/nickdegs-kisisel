// gecgun — GEÇ GELEN GÜN SÖZLEŞMESİ (22.09 "otobüs vakası"). gps worker'ı YAZAR, cron OKUR.
// Anahtar biçimi ve kayıt şekli iki worker'ın anlaşması gereken tek şey olduğu için burada;
// ayrışırsa hiçbir hata logu çıkmadan gezi üretilmez (izsuzgec.ts/maliyet.ts ile aynı gerekçe).
//
// ── NEDEN SU SEVİYESİ (VAR/YOK DEĞİL) ─────────────────────────────────────────────────────
// İLK TASARIM (kırıktı): gps "bu (cihaz, gün) için işaret var mı" diye bakıp YOKSA yazıyordu,
// cron iş bitince anahtarı SİLİYORDU. İki ölümcül sonuç:
//   1) İZOLAT YARIŞI: gps aynı (cihaz, gün) için bir kez yazdıktan sonra izolat-içi Set yüzünden
//      BİR DAHA yazmıyordu. Cron ilk dakikada anahtarı silince, boşalmanın GERİ KALANI için
//      (otobüs vakasında 1440 noktanın ~1000'i) geriye dönük işaret bir daha OLUŞMUYOR →
//      noktalar positions'a yazılıyor ama o gün bir daha HİÇ segmentlenmiyordu.
//   2) BAYAT OKUMA: KV nihai tutarlı. Cron sildikten sonra gps bir süre daha "dolu" okuyup
//      yazmıyor; varlığa bakan her model bu yüzden yapısal olarak güvenilmez.
// ŞİMDİ: `gerigun:` HER geç noktada KOŞULSUZ yazılır (ÖNCE OKUMA YOK → bayat okuma sorunu
// ortadan kalkar), `gerigun-islendi:` cron'un işlediği seviyeyi tutar. Cron yalnız
// `işaret.t > işlendi.sv` olan çiftleri işler. Yeni nokta = yeni seviye = gün yeniden işlenir.
// Anahtar SİLİNMEZ (yalnız bozuk/çok eski/temizlenmiş olanlar düşer) — silme, yukarıdaki (1)
// yarışının ta kendisiydi.

export const GERIGUN_ONEK = 'gerigun:'
export const GERIGUN_ISLENDI_ONEK = 'gerigun-islendi:'

// TTL 30 gün: sözleşme "iş işlenene kadar kalsın". Cron 7 günden eski işareti zaten kendisi
// düşürür; bu TTL yalnızca cron hiç koşamazsa anahtarın sonsuza dek kalmasını engeller.
export const GERIGUN_TTL_SN = 30 * 86400

/**
 * Geç gün işareti = SU SEVİYESİ.
 *  · `t`  — işaretin YAZILDIĞI an (epoch sn). KANONİK SEVİYE BUDUR.
 *  · `ts` — o geç noktanın kendi fix zamanı (teşhis/log için).
 * 🔴 SEVİYE NEDEN `t`, NOKTANIN `ts`'İ DEĞİL: yazım koşulsuz ve OKUMASIZ olduğu için son yazan
 * kazanır. Kuyruk sırayla boşalır ama tek bir sıra dışı nokta (yeniden deneme, ikinci cihaz)
 * seviyeyi GERİ çekseydi `işaret > işlendi` kıyası false olur ve o noktalar sessizce düşerdi.
 * Yazma zamanı tanımı gereği monotoniktir; ayrıca yerleşme (settle) penceresi de bunu kullanır.
 */
export type GeriGunIsaret = { t: number; ts: number }

/**
 * Cron'un işlediği seviye.
 *  · `sv`    — işlenmiş işaret seviyesi (GeriGunIsaret.t). Bundan büyük seviye = yeni iş.
 *  · `hata`  — üst üste başarısız tur sayısı (sonsuz tur emniyeti).
 *  · `t`     — son güncelleme anı.
 */
export type GeriGunIslendi = { sv: number; hata: number; t: number }

/** `gerigun:<device>_<TRgun>` */
export function gerigunAnahtar(dev: string, gun: string): string {
  return `${GERIGUN_ONEK}${dev}_${gun}`
}

/** `gerigun-islendi:<device>_<TRgun>` */
export function gerigunIslendiAnahtar(dev: string, gun: string): string {
  return `${GERIGUN_ISLENDI_ONEK}${dev}_${gun}`
}

/**
 * `gerigun:<device>_<TRgun>` → {dev, gun}; biçim bozuksa null (çağıran anahtarı düşürür).
 * device rakam, gün 'YYYY-MM-DD' olduğu için ayraç SON alt çizgidir.
 */
export function gerigunCoz(anahtar: string): { dev: string; gun: string } | null {
  if (!anahtar.startsWith(GERIGUN_ONEK)) return null
  const kalan = anahtar.slice(GERIGUN_ONEK.length)
  const alt = kalan.lastIndexOf('_')
  if (alt <= 0) return null
  const dev = kalan.slice(0, alt)
  const gun = kalan.slice(alt + 1)
  if (!/^\d{6,12}$/.test(dev) || !/^\d{4}-\d{2}-\d{2}$/.test(gun)) return null
  return { dev, gun }
}
