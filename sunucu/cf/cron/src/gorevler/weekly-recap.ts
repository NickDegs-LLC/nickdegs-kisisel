// weekly-recap — movelog-weekly-recap.py --live (85 satır) portu. Pazar 16:00 UTC (=19:00 TR, DST'siz).
// Son 7 günün rides'ından kullanıcı başına sürüş sayısı/aktif gün/toplam süre/streak → kendi dilinde push.
// Kuru mod: push:bekleyen (Faz 3 tüketicisi gerçek APNs/FCM atacak).
import type { GorevCtx } from '../takvim'
import { pushBekleyen, pushluKullanicilar, trGun } from '../lib'

const WINDOW_DAYS = 7
const MIN_RIDES = 1

const T: Record<string, { title: string; body: string; s: string; cta: string }> = {
  tr: { title: 'Haftalık özetin 🏍️', body: '{n} sürüş · {d} gün · {t}', s: ' · {s} gün üst üste 🔥', cta: ' Seriyi koru!' },
  en: { title: 'Your week in review 🏍️', body: '{n} rides · {d} days · {t}', s: ' · {s}-day streak 🔥', cta: ' Keep it going!' },
  de: { title: 'Deine Woche 🏍️', body: '{n} Fahrten · {d} Tage · {t}', s: ' · {s} Tage in Folge 🔥', cta: ' Bleib dran!' },
  fr: { title: 'Ta semaine 🏍️', body: '{n} sorties · {d} jours · {t}', s: " · {s} jours d'affilée 🔥", cta: ' Continue !' },
  es: { title: 'Tu semana 🏍️', body: '{n} rutas · {d} días · {t}', s: ' · {s} días seguidos 🔥', cta: ' ¡Sigue así!' },
  it: { title: 'La tua settimana 🏍️', body: '{n} giri · {d} giorni · {t}', s: ' · {s} giorni di fila 🔥', cta: ' Continua così!' },
  pt: { title: 'Sua semana 🏍️', body: '{n} pedais · {d} dias · {t}', s: ' · {s} dias seguidos 🔥', cta: ' Continue!' },
  ru: { title: 'Итоги недели 🏍️', body: '{n} поездок · {d} дн. · {t}', s: ' · серия {s} дн. 🔥', cta: ' Не останавливайся!' },
  ja: { title: '今週のまとめ 🏍️', body: '{n}走行 · {d}日 · {t}', s: ' · {s}日連続 🔥', cta: ' その調子！' },
  zh: { title: '本周回顾 🏍️', body: '{n} 次骑行 · {d} 天 · {t}', s: ' · 连续 {s} 天 🔥', cta: ' 继续保持！' },
  ko: { title: '이번 주 요약 🏍️', body: '{n}회 주행 · {d}일 · {t}', s: ' · {s}일 연속 🔥', cta: ' 계속 달려요!' },
  ar: { title: 'أسبوعك 🏍️', body: '{n} رحلات · {d} أيام · {t}', s: ' · {s} أيام متتالية 🔥', cta: ' واصل!' },
  hi: { title: 'आपका सप्ताह 🏍️', body: '{n} राइड · {d} दिन · {t}', s: ' · {s} दिन लगातार 🔥', cta: ' जारी रखें!' },
}

function durLabel(mins: number, lang: string): string {
  const h = Math.floor(mins / 60), m = mins % 60
  if (lang === 'tr') return h ? `${h} sa ${m} dk` : `${m} dk`
  return h ? `${h}h ${m}m` : `${m}m`
}

export async function kos(c: GorevCtx): Promise<void> {
  const { env, now, log } = c
  const cutoff = now - WINDOW_DAYS * 86400
  const rides = await env.DB.prepare(
    `SELECT r.uid, r.ts, r.to_ts FROM rides r JOIN users u ON u.uid = r.uid WHERE r.ts >= ?1 AND r.uid IS NOT NULL AND r.uid != ''`)
    .bind(cutoff).all<{ uid: string; ts: number; to_ts: number }>()
  const per = new Map<string, { n: number; mins: number; days: Set<string> }>()
  for (const v of rides.results) {
    const p = per.get(v.uid) ?? { n: 0, mins: 0, days: new Set<string>() }
    p.n += 1
    p.mins += Math.floor(Math.max(0, (v.to_ts || v.ts) - v.ts) / 60)
    p.days.add(trGun(v.ts))
    per.set(v.uid, p)
  }
  const pushlu = await pushluKullanicilar(env)
  let sent = 0
  for (const [u, p] of per) {
    if (p.n < MIN_RIDES) continue
    if (!pushlu.has(u)) continue
    const prof = await env.DB.prepare('SELECT lang, name FROM users WHERE uid = ?1').bind(u)
      .first<{ lang: string | null; name: string | null }>()
    const days = [...p.days].sort()
    let streak = 1
    for (let i = days.length - 1; i > 0; i--) {
      const fark = (Date.parse(days[i] + 'T00:00Z') - Date.parse(days[i - 1] + 'T00:00Z')) / 86400000
      if (fark === 1) streak += 1
      else break
    }
    const lang = (prof?.lang || 'en').split('-')[0].toLowerCase()
    const tp = T[lang] ?? T.en
    let body = tp.body.replace('{n}', String(p.n)).replace('{d}', String(p.days.size)).replace('{t}', durLabel(p.mins, lang))
    if (streak >= 2) body += tp.s.replace('{s}', String(streak)) + tp.cta
    await pushBekleyen(env, { user: u, title: tp.title, body })
    log(`PUSH(kuru) ${u} [${lang}] ${tp.title} | ${body}`)
    sent++
  }
  log(`kuyruğa yazıldı: ${sent} kullanıcı (${per.size} aktif)`)
}
