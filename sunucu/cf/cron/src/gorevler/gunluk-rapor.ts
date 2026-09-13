// gunluk-rapor — movelog-gunluk-rapor.py (49 satır) portu. 06:00 UTC (09:00 TR).
// Sayımlar D1'den; SADECE yeni satın alım varsa Barış'a bildirim (2026-08-26 kuralı).
import type { GorevCtx } from '../takvim'
import { BARIS_UID, bildirimBekleyen, kvJson, kvJsonYaz } from '../lib'

const DEMO = new Set(['appreview', 'appreview2', 'baris', 'u54c58ec41b54', 'apple_157e2233'])

export async function kos(c: GorevCtx): Promise<void> {
  const { env, now, log } = c
  const users = await env.DB.prepare(
    `SELECT uid, premium, last_seen_at, json_extract(state_json,'$.trackdbg.ts') AS tdbg FROM users`)
    .all<{ uid: string; premium: number | null; last_seen_at: number | null; tdbg: number | null }>()
  const real = users.results.filter((u) => !DEMO.has(u.uid) && !u.uid.startsWith('demo_'))
  const realSet = new Set(real.map((u) => u.uid))
  const aktif24 = real.filter((u) => Math.max(u.last_seen_at || 0, u.tdbg || 0) > now - 86400).length
  const pushOk = (await env.DB.prepare(`SELECT COUNT(DISTINCT uid) n FROM push_tokens WHERE platform = 'apns'`)
    .first<{ n: number }>())!.n            // real filtresi: apns'li demo hesap yok (kaynakta da profiles bazlı)
  const iap = (await env.DB.prepare('SELECT COUNT(*) n FROM iap_transactions').first<{ n: number }>())!.n
  const prem = real.filter((u) => u.premium && u.uid !== BARIS_UID).length
  const rides24 = (await env.DB.prepare(
    'SELECT (SELECT COUNT(*) FROM videos WHERE COALESCE(done_at, ts) > ?1) + (SELECT COUNT(*) FROM rides WHERE ts > ?1) n')
    .bind(now - 86400).first<{ n: number }>())!.n
  const st = await kvJson<{ uyeler?: number; iap?: number }>(env, 'rapor:durum', {})
  const yeni = realSet.size - (st.uyeler ?? realSet.size)
  const yeniIap = iap - (st.iap ?? iap)
  const msg = `📊 Move Log günlük rapor\n👥 Üye: ${realSet.size}` + (yeni > 0 ? ` (+${yeni} yeni)` : '') +
    `\n🟢 Son 24s aktif: ${aktif24} · 🔔 Push izinli: ${pushOk}\n🏍️ Son 24s sürüş/video hareketi: ${rides24}` +
    `\n💰 Toplam satın alım: ${iap}` + (yeniIap > 0 ? ` (+${yeniIap} YENİ! 🎉)` : '') + (prem ? ` · Premium üye: ${prem}` : '')
  if (yeniIap > 0) {
    await bildirimBekleyen(env, msg, 'Move Log Rapor')
    log('bildirim kuyruklandı (yeni satın alım var)')
  } else log('rutin gün — bildirim yok (yeni satın alım yok)')
  await kvJsonYaz(env, 'rapor:durum', { uyeler: realSet.size, iap, ts: now })
  log(`rapor: ${realSet.size} üye, ${iap} satın alım, aktif24=${aktif24}, rides24=${rides24}`)
}
