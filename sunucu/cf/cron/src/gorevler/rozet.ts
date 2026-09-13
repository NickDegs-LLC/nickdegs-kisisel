// rozet — movelog-rozet.py (64 satır) portu. 18:00 UTC (kaynak 18:15 → saat başına yuvarlandı, GOREVLER.md).
// rides geçmişinden rozet hesabı; yeni rozet ic.rozetEkle ile DOĞRUDAN D1'e (gömülü REG_SECRET ölür).
import type { GorevCtx } from '../takvim'
import { jsonParse, trGun, TR_OFSET } from '../lib'
import { rozetEkle } from '../ic'

export async function kos(c: GorevCtx): Promise<void> {
  const { env, log } = c
  const rides = await env.DB.prepare(
    `SELECT r.uid, r.ts, r.km, r.lat, r.lon FROM rides r JOIN users u ON u.uid = r.uid WHERE r.uid IS NOT NULL AND r.uid != ''`)
    .all<{ uid: string; ts: number; km: number | null; lat: number | null; lon: number | null }>()
  type P = { km: number; mx: number; night: number; cells: Set<string>; days: Set<string>; n: number }
  const per = new Map<string, P>()
  for (const v of rides.results) {
    const p = per.get(v.uid) ?? { km: 0, mx: 0, night: 0, cells: new Set<string>(), days: new Set<string>(), n: 0 }
    const k = Number(v.km || 0)
    p.km += k; p.mx = Math.max(p.mx, k); p.n += 1
    const saatTR = new Date((v.ts + TR_OFSET) * 1000).getUTCHours()
    if (saatTR >= 22 || saatTR < 5) p.night += 1
    p.days.add(trGun(v.ts))
    if (v.lat !== null && v.lon !== null) p.cells.add(`${Math.round(v.lat * 4) / 4},${Math.round(v.lon * 4) / 4}`)
    per.set(v.uid, p)
  }
  const grup = await env.DB.prepare('SELECT uid, users_json FROM videos WHERE is_group = 1')
    .all<{ uid: string | null; users_json: string | null }>()
  const grupUsers = new Set<string>()
  for (const g of grup.results) {
    for (const u of jsonParse<string[]>(g.users_json, [])) grupUsers.add(u)
    if (g.uid) grupUsers.add(g.uid)
  }
  let toplam = 0
  for (const [u, p] of per) {
    const badges: string[] = []
    if (p.n >= 1) badges.push('first')
    if (p.km >= 1000) badges.push('km1000')
    if (p.km >= 5000) badges.push('km5000')
    if (p.mx >= 150) badges.push('longride')
    if (p.night >= 5) badges.push('night')
    if (p.cells.size >= 5) badges.push('cities5')
    const days = [...p.days].sort()
    let streak = 1, best = 1
    for (let i = 1; i < days.length; i++) {
      const fark = (Date.parse(days[i] + 'T00:00Z') - Date.parse(days[i - 1] + 'T00:00Z')) / 86400000
      streak = fark === 1 ? streak + 1 : 1
      best = Math.max(best, streak)
    }
    if (best >= 7) badges.push('streak7')
    if (grupUsers.has(u)) badges.push('social')
    const eklenen = await rozetEkle(env, u, badges)
    if (eklenen.length) { log(`rozet: ${u} += ${eklenen.join(',')}`); toplam += eklenen.length }
  }
  log(`tarama bitti: ${per.size} kullanıcı, ${toplam} yeni rozet`)
}
