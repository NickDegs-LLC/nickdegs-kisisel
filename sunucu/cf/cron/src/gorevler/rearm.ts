// rearm — movelog-rearm-watchdog.py (51 satır) portu.
// Güncelleme sonrası ölü kalan iOS oto-takibi diriltir: apns'li kullanıcının cihazı 2-48 saattir
// sessizse SESSİZ push (kuru: KV push:bekleyen, silent:1). Kullanıcı başına 2 saatte 1 (KV TTL marker).
// lastUpdate → D1 positions son fix zamanı (cf_plan kararı).
import type { GorevCtx } from '../takvim'
import { kvJsonYaz, pushBekleyen } from '../lib'

export async function kos(c: GorevCtx): Promise<void> {
  const { env, now, log } = c
  const users = await env.DB.prepare(
    `SELECT DISTINCT u.uid, u.tracker_id FROM users u JOIN push_tokens t ON t.uid = u.uid
     WHERE t.platform = 'apns' AND u.tracker_id IS NOT NULL AND u.tracker_id != ''`)
    .all<{ uid: string; tracker_id: string }>()
  let n = 0
  for (const u of users.results) {
    const son = await env.DB.prepare('SELECT MAX(ts) t FROM positions WHERE device = ?1')
      .bind(u.tracker_id).first<{ t: number | null }>()
    const age = son?.t ? now - son.t : 1e9
    if (!(age > 7200 && age < 48 * 3600)) continue    // 2-48 saat sessiz: uyandırmaya değer pencere
    if ((await env.KV.get(`rearm:${u.uid}`)) !== null) continue   // kullanıcı başına 2 saatte 1
    await kvJsonYaz(env, `rearm:${u.uid}`, now, 7200)
    await pushBekleyen(env, { user: u.uid, silent: 1 })
    log(`RE-ARM: ${u.uid} cihazı ${(age / 3600).toFixed(1)} saattir sessiz -> sessiz uyandırma push`)
    n++
  }
  if (!n) log(`aday yok (${users.results.length} apns'li kullanıcı tarandı)`)
}
