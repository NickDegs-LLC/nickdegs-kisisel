// integrity-auto — movelog-integrity-auto.py (216 satır) YENİDEN TASARIMLI portu (cf_plan kararı).
// Karar mantığı (eşikler) BİREBİR; mekanizma CF'ye çevrildi:
//   config.env + docker restart  → KV 'integrity:enforce' {android,ios} (api her istekte okuyabilir — restart ölür)
//   integrity_stats.db (sqlite)  → D1 integrity_stats tablosu (movelog-api geçme/kalma sayacını yazacak)
//   nginx access.log 403 ölçümü  → D1 istek_403_sayac tablosu (Worker kendi sayacı — Faz sonrası)
// İKİ KAYNAK DA henüz dolmuyorsa karar VERİLMEZ ve KAPALI tarafta kalınır (Hooder 17/22 dersi:
// "doğrulamanın başarısız olması hileci demek değildir; şüphede KAPALI kal").
import type { GorevCtx } from '../takvim'
import { bildirimBekleyen, kvJson, kvJsonYaz } from '../lib'

const ESIK = 98.0          // bu oranın ALTINDA asla açma
const MIN_ORNEK = 50       // bu kadar deneme görmeden karar verme
const GERI_AL_ESIK = 3.0   // enforce açıkken %3+ 403 -> geri al
const GERI_AL_DK = 30
const MIN_403_ORNEK = 20

type Enforce = { android: boolean; ios: boolean }

export async function kos(c: GorevCtx): Promise<void> {
  const { env, now, log } = c
  const enf = await kvJson<Enforce>(env, 'integrity:enforce', { android: false, ios: false })

  // ── 1) enforce açıkken gerçek istemci 403 oranı -> GERİ AL ──
  if (enf.android || enf.ios) {
    try {
      const r = await env.DB.prepare(
        'SELECT COALESCE(SUM(toplam),0) top, COALESCE(SUM(kotu),0) kotu FROM istek_403_sayac WHERE ts >= ?1')
        .bind(now - GERI_AL_DK * 60).first<{ top: number; kotu: number }>()
      const ornek = r?.top ?? 0
      const oran = ornek ? ((r?.kotu ?? 0) * 100) / ornek : 0
      if (ornek >= MIN_403_ORNEK && oran > GERI_AL_ESIK) {
        await kvJsonYaz(env, 'integrity:enforce', { android: false, ios: false })
        await bildirimBekleyen(env,
          `⛔ Move Log cihaz doğrulama GERİ ALINDI: gerçek istemcilerde 403 oranı %${oran.toFixed(1)} ` +
          `(${ornek} istek, son ${GERI_AL_DK} dk). Doğrulama tekrar 'yalnız ölç' moduna alındı.`, 'Move Log Integrity')
        return
      }
      log(`enforce açık — 403 oranı %${oran.toFixed(1)} (${ornek} istek), eşik %${GERI_AL_ESIK}`)
    } catch {
      log('403 ölçüm kaynağı yok (istek_403_sayac tablosu doldurulmuyor) — geri-alma kararı verilemedi')
    }
  }

  // ── 2) ölçüme göre AÇ ──
  let rows: { plat: string; sonuc: string; adet: number }[] = []
  try {
    const r = await env.DB.prepare(
      "SELECT plat, sonuc, SUM(adet) adet FROM integrity_stats WHERE gun >= date('now','-1 day') GROUP BY plat, sonuc")
      .all<{ plat: string; sonuc: string; adet: number }>()
    rows = r.results
  } catch {
    log('ölçüm verisi yok (integrity_stats tablosu henüz yok/boş) — karar verilmedi (doğru davranış: KAPALI kal)')
    return
  }
  if (!rows.length) { log('ölçüm verisi yok — karar verilmedi (KAPALI kal)'); return }
  const o = new Map<string, { top: number; gecti: number; ayrinti: Map<string, number> }>()
  for (const r of rows) {
    const d = o.get(r.plat) ?? { top: 0, gecti: 0, ayrinti: new Map() }
    d.top += r.adet
    if (r.sonuc === 'gecti') d.gecti += r.adet
    else d.ayrinti.set(r.sonuc, (d.ayrinti.get(r.sonuc) || 0) + r.adet)
    o.set(r.plat, d)
  }
  const yeni: Enforce = { ...enf }
  const kararlar: string[] = []
  for (const [plat, d] of [...o.entries()].sort()) {
    const oran = d.top ? (d.gecti * 100) / d.top : 0
    const acik = plat === 'android' ? enf.android : enf.ios
    if (acik) { log(`${plat}: zaten açık (geçme %${oran.toFixed(1)}, ${d.top} deneme)`); continue }
    if (d.top < MIN_ORNEK) { log(`${plat}: örnek az (${d.top}/${MIN_ORNEK}) — AÇILMADI`); continue }
    if (oran >= ESIK) {
      if (plat === 'android') yeni.android = true
      else yeni.ios = true
      kararlar.push(`${plat} (geçme %${oran.toFixed(1)}, ${d.top} deneme)`)
    } else {
      const ay = [...d.ayrinti.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}=${v}`).join(', ')
      log(`${plat}: AÇILMADI — geçme %${oran.toFixed(1)} (eşik ${ESIK}) · ${ay}`)
    }
  }
  if (kararlar.length && (yeni.android !== enf.android || yeni.ios !== enf.ios)) {
    await kvJsonYaz(env, 'integrity:enforce', yeni)   // KV bayrak: restart kavramı yok, api anında okur
    await bildirimBekleyen(env,
      '🔒 Move Log cihaz doğrulama AÇILDI: ' + kararlar.join(' · ') +
      `\nEmülatör/kurcalanmış istemciler artık giremez. Gerçek kullanıcılar kapıda kalırsa ${GERI_AL_DK} dk içinde OTOMATİK geri alınır.`,
      'Move Log Integrity')
  }
  await kvJsonYaz(env, 'integrity:durum', { ts: now, android: yeni.android, ios: yeni.ios })
}
