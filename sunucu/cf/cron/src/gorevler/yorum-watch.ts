// yorum-watch — movelog-yorum-watch.py (51 satır) portu. 30dk'da bir.
// ASC customerReviews izleme: görülmemiş yorumu Barış'a bildir (kuru: bildirim:bekleyen).
// İlk koşu mevcutları sessizce tohumlar. ASC sırları yoksa görev kendini atlar.
import type { GorevCtx } from '../takvim'
import { ascGet, ascHazir } from '../asc'
import { bildirimBekleyen, kvJsonYaz } from '../lib'

type Yorum = { id: string; attributes: { rating?: number; title?: string; body?: string; reviewerNickname?: string; territory?: string } }

export async function kos(c: GorevCtx): Promise<void> {
  const { env, log } = c
  if (!ascHazir(env)) { log('ASC sırları yok (ASC_KEY_ID/ASC_ISSUER_ID/ASC_P8) — atlandı'); return }
  if (!env.ASC_APP_ID) { log('ASC_APP_ID yok — atlandı'); return }
  const r = await ascGet(env, `/v1/apps/${env.ASC_APP_ID}/customerReviews?sort=-createdDate&limit=50` +
    '&fields[customerReviews]=rating,title,body,reviewerNickname,territory,createdDate')
  if (r.status !== 200) { log(`customerReviews hata: ${r.status}`); return }
  const reviews = ((r.data as { data?: Yorum[] })?.data ?? [])
  const ids = new Set(reviews.map((x) => x.id))
  const seenRaw = await env.KV.get('yorum:seen')
  if (seenRaw === null) {                     // ilk koşu: bildirim yok, tohum at
    await kvJsonYaz(env, 'yorum:seen', [...ids].sort())
    log(`ilk koşu: ${ids.size} mevcut yorum tohumlandı`)
    return
  }
  let seen: string[] = []
  try { seen = JSON.parse(seenRaw) } catch { seen = [] }
  const seenSet = new Set(seen)
  const yeni = reviews.filter((x) => !seenSet.has(x.id))
  for (const x of [...yeni].reverse()) {      // eskiden yeniye
    const a = x.attributes
    const stars = '⭐'.repeat(Math.trunc(a.rating || 0))
    await bildirimBekleyen(env,
      `🗣️ Move Log'a YENİ YORUM ${stars} (${a.territory || '?'})\n${a.reviewerNickname || '?'}: ${(a.title || '').trim()}\n` +
      `${(a.body || '').trim().slice(0, 400)}\n— Yanıtlamak istersen: bana 'şu yoruma yanıt yaz' de.`, 'Move Log Yorum')
    log(`bildirildi: ${x.id} ${stars}`)
  }
  if (yeni.length) await kvJsonYaz(env, 'yorum:seen', [...new Set([...seen, ...ids])].sort())
  else log(`yeni yorum yok (${ids.size} toplam)`)
}
