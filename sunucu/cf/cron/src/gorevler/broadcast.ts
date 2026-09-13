// broadcast — movelog-broadcast.py (79 satır) CF eşleniği (dosya kuyruğu → KV süpürgesi).
// Orijinal 3 kuyruğu boşaltırdı: pushq/ (hedefli push) · adminq/ (Barış'a Telegram+WhatsApp) ·
// broadcast/ (tüm apns'li kullanıcılara, kişi başına TEK dilde).
// CF'de: pushq zaten KV 'push:bekleyen:*' (Faz 3 tüketicisi gönderecek — bu görev DOKUNMAZ);
//   adminq:bekleyen:*     → bildirim:bekleyen:* kaydına çevrilir (Telegram iletimi kuru mod)
//   broadcast:bekleyen:*  → D1 apns'li kullanıcı listesine fan-out, kişi başı kendi dilinde push kaydı
import type { GorevCtx } from '../takvim'
import { jsonParse, kvListe, pushBekleyen, bildirimBekleyen } from '../lib'

export async function kos(c: GorevCtx): Promise<void> {
  const { env, log } = c
  // --- adminq süpürmesi ---
  let nA = 0
  for (const k of await kvListe(env, 'adminq:bekleyen:', 200)) {
    const v = jsonParse<{ msg?: string }>(await env.KV.get(k), {})
    if (v.msg) { await bildirimBekleyen(env, v.msg, 'Move Log Olay'); nA++ }
    await env.KV.delete(k)
  }
  // --- broadcast fan-out ---
  let nB = 0
  const bKeys = await kvListe(env, 'broadcast:bekleyen:', 20)
  if (bKeys.length) {
    const users = await env.DB.prepare(
      `SELECT DISTINCT u.uid, u.lang FROM users u JOIN push_tokens t ON t.uid = u.uid WHERE t.platform = 'apns'`)
      .all<{ uid: string; lang: string | null }>()
    for (const k of bKeys) {
      const req = jsonParse<{ title?: string; body?: string; titles?: Record<string, string>; bodies?: Record<string, string> }>(
        await env.KV.get(k), {})
      let sent = 0
      for (const u of users.results) {
        // KİŞİ BAŞINA TEK DİL (2026-07-12): lang -> o dil; yoksa en; o da yoksa düz title/body
        const lng = u.lang || 'en'
        const t = req.titles?.[lng] || req.titles?.en || req.title || ''
        const b = req.bodies?.[lng] || req.bodies?.en || req.body || ''
        if (!t && !b) continue
        await pushBekleyen(env, { user: u.uid, title: t, body: b })
        sent++
      }
      await env.KV.delete(k)
      log(`broadcast '${req.title ?? ''}' → ${sent}/${users.results.length} kullanıcı`)
      nB++
    }
  }
  log(`adminq→bildirim: ${nA} · broadcast: ${nB} (pushq'ya dokunulmadı — Faz 3 tüketicisi)`)
}
