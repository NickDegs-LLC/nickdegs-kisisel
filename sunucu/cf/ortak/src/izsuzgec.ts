// izsuzgec — ORTAK ışınlanma/çöp-koordinat süzgeci. Tüm worker'lar (api, cron, dispatch) buradan
// okur; her worker'ın kendi bundle'ına dahil edilir (paylaşılan runtime YOK, sadece paylaşılan kaynak).
//
// NEDEN (uçtan uca tarama, 2026-09-05): süzgeç YALNIZCA api/src/motor3d/iz.ts içinde vardı.
// Ham `positions` okuyan üç yol daha var ve hiçbiri süzmüyordu:
//   · api/src/routes/grup7.ts  (/api/track — detay ve yol-eşleme dalları)
//   · dispatch/src/index.ts    (isiHazirla — RunPod'a giden iz)
//   · cron/.../activity-detect (rides.km'yi ÜRETEN yer)
// Sonuç ölçüldü: `positions` içinde 91 saniyede 744,96 km'lik bir sıçrama var (41.046,29.034 →
// 40.980,37.898) ve bu D1'de "748,7 km yürüyüş / 13 dk" diye üç HAYALET rota doğurmuş. Kartlarda
// "Video oluştur" düğmesiyle duruyorlardı: basılsaydı çöp iz gerçek GPU parasıyla render edilecekti.
//
// KURALLAR (motor3d/iz.ts'teki orijinalle birebir):
//   · NaN / |lat|>90 / |lon|>180  → at
//   · (0,0) Null Island           → at
//   · tam-tamsayı çift (41, 29)   → at  (gerçek GPS'te olmaz; yer tutucu/çöp)
//   · ima edilen hız > 400 km/s   → o noktayı at (uçak bile değil = ışınlanma)

export const ISINMA_KMS = 400

export type IzP = { lat: number; lon: number; t?: number }

const R_KM = 6371
const rad = (d: number): number => (d * Math.PI) / 180

export function mesafeKm(a: IzP, b: IzP): number {
  const dp = rad(b.lat - a.lat), dl = rad(b.lon - a.lon)
  const x = Math.sin(dp / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dl / 2) ** 2
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(x)))
}

/** Tek bir noktanın kendi başına geçersiz olup olmadığı (komşusundan bağımsız). */
export function noktaCop(p: IzP): boolean {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return true
  if (Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) return true
  if (p.lat === 0 && p.lon === 0) return true
  if (Number.isInteger(p.lat) && Number.isInteger(p.lon)) return true
  return false
}

/** Çöp + ışınlanma süzgeci. Giriş dizisinin ALT TİPİNİ korur (spd/alt/hr gibi alanlar kaybolmaz). */
export function izSuz<T extends IzP>(pts: readonly T[]): T[] {
  const out: T[] = []
  for (const p of pts) {
    if (noktaCop(p)) continue
    const son = out[out.length - 1]
    if (son) {
      const dt = Math.max(1, Number(p.t ?? 0) - Number(son.t ?? 0))   // zaman yoksa 1 sn varsay
      if ((mesafeKm(son, p) / dt) * 3600 > ISINMA_KMS) continue
    }
    out.push(p)
  }
  return out
}
