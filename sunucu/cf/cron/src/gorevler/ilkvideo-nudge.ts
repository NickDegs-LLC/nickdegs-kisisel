// ilkvideo-nudge — movelog-ilkvideo-nudge.py --live (123 satır) portu. 16:00 UTC.
// Sürüşü olan ama HİÇ video üretmemiş kullanıcıya ÖMÜR BOYU 1 davet, günde en çok 5 kişi.
// Traccar reports/summary km'si → D1 rides km toplamı (cf_plan: positions/rides tabanı);
// ömür-boyu durum KV 'nudge:ilkvideo:{uid}' (SEMA-NOTLARI KV envanteriyle aynı anahtar).
import type { GorevCtx } from '../takvim'
import { kvJsonYaz, pushBekleyen, pushluKullanicilar } from '../lib'

const GUNLUK_TAVAN = 5
const SON_GUN = 14
const MIN_KM = 2.0
const ATLA_TAM = new Set(['baris', 'appreview', 'appreview2'])

const T: Record<string, { t: string; b: string }> = {
  // ⚠️ METİN KURALI (Barış 2026-08-12): bu bir DAVET — 'hazır' kelimesi KULLANILMAZ
  tr: { t: 'Sürüşünü videoya çevir 🎬', b: 'Kayıtlı sürüşün var — tek dokunuşla film yapabilirsin.' },
  en: { t: 'Turn your ride into a video 🎬', b: 'You have a saved ride — make a movie with one tap.' },
  de: { t: 'Mach ein Video aus deiner Fahrt 🎬', b: 'Du hast eine gespeicherte Fahrt — mit einem Tipp zum Film.' },
  fr: { t: 'Transforme ta sortie en vidéo 🎬', b: 'Tu as une sortie enregistrée — un geste suffit pour en faire un film.' },
  es: { t: 'Convierte tu ruta en vídeo 🎬', b: 'Tienes una ruta guardada — hazla película con un toque.' },
  it: { t: 'Trasforma il tuo giro in video 🎬', b: 'Hai un giro salvato — fanne un film con un tocco.' },
  pt: { t: 'Transforme seu pedal em vídeo 🎬', b: 'Você tem um pedal salvo — vire filme com um toque.' },
  ru: { t: 'Преврати поездку в видео 🎬', b: 'У тебя есть сохранённая поездка — фильм в одно касание.' },
  ja: { t: '走行を動画にしよう 🎬', b: '保存された走行があります — ワンタップでムービーに。' },
  zh: { t: '把骑行变成视频 🎬', b: '你有已保存的骑行 — 一键生成大片。' },
  ko: { t: '주행을 영상으로 만들어보세요 🎬', b: '저장된 주행이 있어요 — 한 번의 탭으로 영화로.' },
  ar: { t: 'حوّل رحلتك إلى فيديو 🎬', b: 'لديك رحلة محفوظة — اصنع فيلماً بلمسة واحدة.' },
  hi: { t: 'अपनी राइड को वीडियो बनाएं 🎬', b: 'आपकी सेव की गई राइड है — एक टैप में फिल्म बनाएं।' },
}

export async function kos(c: GorevCtx): Promise<void> {
  const { env, now, log } = c
  const esik = now - SON_GUN * 86400
  const users = await env.DB.prepare('SELECT uid, name, lang, admin, alias, tracker_id FROM users')
    .all<{ uid: string; name: string | null; lang: string | null; admin: number | null; alias: string | null; tracker_id: string | null }>()
  const pushlu = await pushluKullanicilar(env)
  let gonderilen = 0
  for (const u of users.results) {
    if (gonderilen >= GUNLUK_TAVAN) break
    if (ATLA_TAM.has(u.uid) || u.uid.startsWith('demo_') || u.uid.startsWith('appreview')) continue
    if (u.admin || u.alias) continue
    if ((await env.KV.get(`nudge:ilkvideo:${u.uid}`)) !== null) continue   // ömür boyu 1
    if (!pushlu.has(u.uid)) continue                                       // push gidemez
    const rc = await env.DB.prepare('SELECT 1 x FROM render_counts WHERE uid = ?1 LIMIT 1').bind(u.uid).first()
    if (rc) continue                                                       // zaten video üretmiş
    // son 14 günde hareket + >=2 km sürüş (rides toplamı)
    const oz = await env.DB.prepare('SELECT COALESCE(SUM(km),0) km, MAX(ts) son FROM rides WHERE uid = ?1 AND ts >= ?2')
      .bind(u.uid, esik).first<{ km: number; son: number | null }>()
    if (!oz?.son || oz.son < esik) continue                                // sürüşü bayat
    if ((oz.km || 0) < MIN_KM) continue
    const s = T[u.lang || 'en'] ?? T.en
    await pushBekleyen(env, { user: u.uid, title: s.t, body: s.b, route: 'videos' })
    await kvJsonYaz(env, `nudge:ilkvideo:${u.uid}`, now)                   // TTL'siz: ömür boyu
    log(`GÖNDERİLDİ(kuru) ${u.uid} (${u.lang || 'en'}, ${(oz.km || 0).toFixed(1)} km)`)
    gonderilen++
  }
  if (!gonderilen) log('aday yok')
}
