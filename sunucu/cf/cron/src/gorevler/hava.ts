// hava — movelog-hava.py (92 satır) portu. 16:00 UTC'ye sabitlendi (kaynak 17:45 CEST; GOREVLER.md yuvarlaması).
// Son D1 konumuna Open-Meteo YARIN tahmini (gerçek GET — ücretsiz/anahtar yok, dış yazım değil);
// 08-20 arası yağışsız + 15-32°C + rüzgar<30, en az 4 saatlik pencere → kendi dilinde push (kuru).
// Kullanıcı başına haftada en çok 3 (KV sayaç, TTL 7 gün).
import type { GorevCtx } from '../takvim'
import { kvJson, kvJsonYaz, pushBekleyen } from '../lib'

const T: Record<string, string> = {
  en: 'Perfect riding weather tomorrow ☀️', tr: 'Yarın mükemmel sürüş havası ☀️',
  es: 'Mañana, clima perfecto para rodar ☀️', fr: 'Météo parfaite pour rouler demain ☀️',
  de: 'Morgen perfektes Fahrwetter ☀️', it: 'Domani tempo perfetto per guidare ☀️',
  pt: 'Amanhã, clima perfeito para pilotar ☀️', ru: 'Завтра идеальная погода для езды ☀️',
  ja: '明日は絶好のライド日和☀️', zh: '明天是骑行的完美天气 ☀️', ko: '내일은 완벽한 라이딩 날씨 ☀️',
  ar: 'غداً طقس مثالي للقيادة ☀️', hi: 'कल राइडिंग के लिए बढ़िया मौसम ☀️',
}
const B: Record<string, string> = {
  en: '{w} window, around {t}°C and dry. The road is calling — your video will be waiting 🏍️',
  tr: '{w} arası ~{t}°C ve yağışsız. Yol çağırıyor — videon hazır bekliyor olacak 🏍️',
  es: 'Ventana de {w}, ~{t}°C y seco. La carretera llama — tu vídeo estará esperando 🏍️',
  fr: "Créneau {w}, ~{t}°C et sec. La route t'appelle — ta vidéo t'attendra 🏍️",
  de: 'Fenster {w}, ~{t}°C und trocken. Die Straße ruft — dein Video wartet 🏍️',
  it: 'Finestra {w}, ~{t}°C e asciutto. La strada chiama — il tuo video ti aspetterà 🏍️',
  pt: 'Janela de {w}, ~{t}°C e seco. A estrada chama — seu vídeo estará esperando 🏍️',
  ru: 'Окно {w}, ~{t}°C и сухо. Дорога зовёт — видео будет ждать 🏍️',
  ja: '{w}、約{t}°Cで降水なし。道が呼んでいます — 動画も待っています🏍️',
  zh: '{w}，约{t}°C，无雨。公路在召唤 — 你的视频会等着你 🏍️',
  ko: '{w}, 약 {t}°C에 비 없음. 도로가 부릅니다 — 영상이 기다릴 거예요 🏍️',
  ar: 'نافذة {w}، حوالي {t}° وجاف. الطريق ينادي — فيديوك سينتظرك 🏍️',
  hi: '{w}, ~{t}°C और सूखा। सड़क बुला रही है — आपका वीडियो इंतज़ार करेगा 🏍️',
}

export async function kos(c: GorevCtx): Promise<void> {
  const { env, now, log } = c
  const users = await env.DB.prepare(
    `SELECT DISTINCT u.uid, u.lang, u.tracker_id FROM users u JOIN push_tokens t ON t.uid = u.uid
     WHERE t.platform = 'apns' AND u.tracker_id IS NOT NULL AND u.tracker_id != ''`)
    .all<{ uid: string; lang: string | null; tracker_id: string }>()
  let n = 0
  for (const u of users.results) {
    const pos = await env.DB.prepare('SELECT lat, lon FROM positions WHERE device = ?1 ORDER BY ts DESC LIMIT 1')
      .bind(u.tracker_id).first<{ lat: number; lon: number }>()
    if (!pos) continue
    const sayac = await kvJson<number[]>(env, `hava:sayac:${u.uid}`, [])
    if (sayac.filter((t) => now - t < 7 * 86400).length >= 3) continue   // haftada en çok 3
    let w: { hourly?: { time?: string[]; temperature_2m?: (number | null)[]; precipitation_probability?: (number | null)[]; wind_speed_10m?: (number | null)[] } }
    try {
      const r = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${pos.lat.toFixed(3)}&longitude=${pos.lon.toFixed(3)}` +
        `&hourly=temperature_2m,precipitation_probability,wind_speed_10m&forecast_days=2&timezone=auto`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      w = (await r.json()) as typeof w
    } catch (e) { log(`hava api hata (${u.uid}): ${String(e).slice(0, 80)}`); continue }
    const hrs = w.hourly ?? {}
    const times = hrs.time ?? []
    // yarın = timezone=auto (yerel) — kaynaktaki sunucu-yerel gün mantığının eşleniği
    const yarin = new Date((now + 86400) * 1000).toISOString().slice(0, 10)
    let best: { st: string; en: string; len: number; avg: number } | null = null
    let run: { t: string; temp: number }[] = []
    for (let i = 0; i < times.length; i++) {
      const ts = times[i]
      const saat = Number(ts.slice(11, 13))
      if (!ts.startsWith(yarin) || saat < 8 || saat > 20) continue
      const temp = hrs.temperature_2m?.[i] ?? 0
      const yagis = hrs.precipitation_probability?.[i] ?? 0
      const ruzgar = hrs.wind_speed_10m?.[i] ?? 0
      const ok = temp >= 15 && temp <= 32 && yagis < 20 && ruzgar < 30
      if (ok) {
        run.push({ t: ts, temp })
        if (run.length >= 3 && (best === null || run.length > best.len)) {
          best = { st: run[0].t, en: run[run.length - 1].t, len: run.length, avg: run.reduce((s, x) => s + x.temp, 0) / run.length }
        }
      } else run = []
    }
    if (!best || best.len < 4) continue      // en az 4 saatlik pencere (gerçekten güzel gün)
    const lng = u.lang || 'en'
    const bit = new Date(Date.parse(best.en + ':00Z') + 3600000).toISOString().slice(11, 16)
    const win = `${best.st.slice(11, 16)}-${bit}`
    await pushBekleyen(env, {
      user: u.uid, title: T[lng] || T.en,
      body: (B[lng] || B.en).replace('{w}', win).replace('{t}', best.avg.toFixed(0)),
    })
    sayac.push(now)
    await kvJsonYaz(env, `hava:sayac:${u.uid}`, sayac.filter((t) => now - t < 7 * 86400), 7 * 86400)
    log(`hava push(kuru): ${u.uid} ${win} ${best.avg.toFixed(0)}C`)
    n++
  }
  log(`bitti: ${n} kullanıcıya hava push kuyruklandı (${users.results.length} aday)`)
}
