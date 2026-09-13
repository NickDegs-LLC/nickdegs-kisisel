// kulup-karne — movelog-kulup-karne.py (60 satır) portu. Pazar 16:00 UTC (kaynak 17:30 CEST yuvarlaması).
// Her kulübe haftalık karne: toplam km, sürüş sayısı, lider, en uzun sürüş → üyelere kendi dilinde push.
import type { GorevCtx } from '../takvim'
import { gorunenAd, pushBekleyen } from '../lib'

const T: Record<string, string> = {
  en: '🏁 {c} — weekly report', tr: '🏁 {c} — haftalık karne', es: '🏁 {c} — informe semanal',
  fr: '🏁 {c} — bilan de la semaine', de: '🏁 {c} — Wochenbericht', it: '🏁 {c} — report settimanale',
  pt: '🏁 {c} — resumo da semana', ru: '🏁 {c} — итоги недели', ja: '🏁 {c} — 週間レポート',
  zh: '🏁 {c} — 周报', ko: '🏁 {c} — 주간 리포트', ar: '🏁 {c} — تقرير الأسبوع', hi: '🏁 {c} — साप्ताहिक रिपोर्ट',
}
const B: Record<string, string> = {
  en: 'Total {km} km in {r} rides. Leader: {l} ({lk} km) 🏆 Longest ride: {mx} km. Keep rolling!',
  tr: 'Toplam {km} km, {r} sürüş. Lider: {l} ({lk} km) 🏆 En uzun sürüş: {mx} km. Gaza devam!',
  es: 'Total {km} km en {r} rutas. Líder: {l} ({lk} km) 🏆 Ruta más larga: {mx} km.',
  fr: 'Total {km} km en {r} rides. Leader : {l} ({lk} km) 🏆 Plus longue : {mx} km.',
  de: 'Insgesamt {km} km in {r} Fahrten. Führend: {l} ({lk} km) 🏆 Längste Fahrt: {mx} km.',
  it: 'Totale {km} km in {r} giri. Leader: {l} ({lk} km) 🏆 Giro più lungo: {mx} km.',
  pt: 'Total de {km} km em {r} rolês. Líder: {l} ({lk} km) 🏆 Mais longo: {mx} km.',
  ru: 'Всего {km} км за {r} поездок. Лидер: {l} ({lk} км) 🏆 Самая длинная: {mx} км.',
  ja: '合計{km}km・{r}回のライド。リーダー: {l}（{lk}km）🏆 最長: {mx}km。',
  zh: '共 {km} 公里，{r} 次骑行。领先: {l}（{lk} 公里）🏆 最长: {mx} 公里。',
  ko: '총 {km}km, {r}회 라이딩. 리더: {l} ({lk}km) 🏆 최장: {mx}km.',
  ar: 'إجمالي {km} كم في {r} رحلة. المتصدر: {l} ({lk} كم) 🏆 الأطول: {mx} كم.',
  hi: 'कुल {km} km, {r} राइड्स। लीडर: {l} ({lk} km) 🏆 सबसे लंबी: {mx} km।',
}

export async function kos(c: GorevCtx): Promise<void> {
  const { env, now, log } = c
  const wk = now - 7 * 86400
  const rides = await env.DB.prepare('SELECT uid, km FROM rides WHERE ts >= ?1 AND uid IS NOT NULL')
    .bind(wk).all<{ uid: string; km: number | null }>()
  const stats = new Map<string, { km: number; r: number; mx: number }>()
  for (const v of rides.results) {
    const st = stats.get(v.uid) ?? { km: 0, r: 0, mx: 0 }
    const k = Number(v.km || 0)
    st.km += k; st.r += 1; st.mx = Math.max(st.mx, k)
    stats.set(v.uid, st)
  }
  const clubs = await env.DB.prepare('SELECT cid, name FROM clubs').all<{ cid: string; name: string }>()
  for (const cl of clubs.results) {
    const mem = (await env.DB.prepare('SELECT uid FROM club_members WHERE cid = ?1').bind(cl.cid)
      .all<{ uid: string }>()).results.map((r) => r.uid)
    if (mem.length < 2) continue
    const tot = mem.reduce((s, u) => s + (stats.get(u)?.km ?? 0), 0)
    const rds = mem.reduce((s, u) => s + (stats.get(u)?.r ?? 0), 0)
    if (tot < 1) continue                        // sessiz kulüp: karne yok
    const lead = mem.reduce((m, u) => ((stats.get(u)?.km ?? 0) > (stats.get(m)?.km ?? 0) ? u : m), mem[0])
    const lp = await env.DB.prepare('SELECT uid, name, handle FROM users WHERE uid = ?1').bind(lead)
      .first<{ uid: string; name: string | null; handle: string | null }>()
    const ln = lp ? gorunenAd(lp) : '?'
    const mx = Math.max(...mem.map((u) => stats.get(u)?.mx ?? 0))
    for (const u of mem) {
      const up = await env.DB.prepare('SELECT lang FROM users WHERE uid = ?1').bind(u).first<{ lang: string | null }>()
      const lng = up?.lang || 'en'
      await pushBekleyen(env, {
        user: u, title: (T[lng] || T.en).replace('{c}', cl.name || ''),
        body: (B[lng] || B.en).replace('{km}', tot.toFixed(0)).replace('{r}', String(rds))
          .replace('{l}', ln).replace('{lk}', (stats.get(lead)?.km ?? 0).toFixed(0)).replace('{mx}', mx.toFixed(0)),
      })
    }
    log(`karne(kuru): ${cl.name} -> ${mem.length} üye (${tot.toFixed(0)} km)`)
  }
}
