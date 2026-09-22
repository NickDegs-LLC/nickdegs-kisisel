// zaman — ORTAK TR günü yardımcıları. gps + cron buradan okur; her worker kendi bundle'ına
// dahil eder (paylaşılan runtime YOK, sadece paylaşılan kaynak — izsuzgec.ts / maliyet.ts kalıbı).
//
// NEDEN (22.09 "otobüs vakası" incelemesi): TR_OFSET ve trGun gps/src/index.ts'e ELLE
// KOPYALANMIŞTI ve iki kopyanın aynı kalacağını yalnızca bir yorum satırı garanti ediyordu.
// Kopyaların ayrışması SESSİZ ama ölümcül: gps geç gün işaretini `..._2026-09-20` anahtarına
// yazar, cron `2026-09-21` için bakar → işaret HİÇ görülmez, gezi HİÇ üretilmez. Yani tam da
// kapatmaya çalıştığımız kaybın aynısı, üstelik tek bir hata logu bile bırakmadan.
//
// ⚠️ HÂLÂ DURAN KOPYALAR (22.09 turunda BİLEREK dokunulmadı — o dosyalar görev kapsamı dışıydı):
//   · cron/src/lib.ts      → TR_OFSET/trGun/trSaat/hhmm/trGunAralik (öteki cron görevleri kullanıyor)
//   · ortak/src/maliyet.ts → TR_OFS/trGunu (dispatch + api bütçe hattı)
// Üçü de BİREBİR aynı; bir sonraki dokunuşta ikisi de buradan re-export etmeli.

/** TR = UTC+3 (scriptlerdeki timezone(timedelta(hours=3)) eşleniği) */
export const TR_OFSET = 3 * 3600

/** TR (UTC+3) günü 'YYYY-MM-DD' */
export function trGun(ts: number): string {
  return new Date((ts + TR_OFSET) * 1000).toISOString().slice(0, 10)
}

/** TR saati (0-23) */
export function trSaat(ts: number): number {
  return new Date((ts + TR_OFSET) * 1000).getUTCHours()
}

/** TR 'HH:MM' */
export function hhmm(ts: number): string {
  return new Date((ts + TR_OFSET) * 1000).toISOString().slice(11, 16)
}

/** TR gününün epoch aralığı [başlangıç, bitiş) */
export function trGunAralik(gun: string): [number, number] {
  const g0 = Math.floor(Date.parse(gun + 'T00:00:00Z') / 1000) - TR_OFSET
  return [g0, g0 + 86400]
}
