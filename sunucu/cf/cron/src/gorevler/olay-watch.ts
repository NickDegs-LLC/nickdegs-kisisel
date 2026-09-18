// olay-watch — movelog-olay-watch.py (52 satır) portu.
// adminq'nun kapsamadığı olaylar → Barış bildirimi (kuru: bildirim:bekleyen):
//   🎁 yeni hediye video (KV 'gift:{uid}' işaretleri — eski .gift_* marker eşleniği)
//   🏍️🏍️ yeni grup videosu (D1)
// 18.09: 'yeni kulüp' izleyicisi KALDIRILDI (kulüpler çıktı). Grup videosu izleyicisi KALIYOR —
// ikili sürüş videosu duruyor. Eski KV 'olay:durum' kayıtlarındaki clubs alanı yok sayılır.
import type { GorevCtx } from '../takvim'
import { bildirimBekleyen, gorunenAd, kvJson, kvJsonYaz, kvListe } from '../lib'

type Durum = { gifts: string[]; grupvids: string[] }

export async function kos(c: GorevCtx): Promise<void> {
  const { env, log } = c
  const st = await kvJson<Durum>(env, 'olay:durum', { gifts: [], grupvids: [] })
  let changed = false
  const ad = async (uid: string) => gorunenAd(
    await env.DB.prepare('SELECT uid, name, handle FROM users WHERE uid = ?1').bind(uid)
      .first<{ uid: string; name: string | null; handle: string | null }>() ?? { uid })
  // 1) hediye videolar (KV marker)
  for (const k of await kvListe(env, 'gift:', 100)) {
    const u = k.slice('gift:'.length)
    if (!u || st.gifts.includes(u)) continue
    st.gifts.push(u); changed = true
    await bildirimBekleyen(env, `🎁 İLK HEDİYE VİDEO: ${await ad(u)} ilk sürüşünün tadımlık videosunu aldı! (deneme dönüşümü için izle)`, 'Move Log Olay')
  }
  // 2) grup videoları (_w2.._w8 kopyaları hariç)
  const vids = await env.DB.prepare(`SELECT rid, uid, users_json FROM videos WHERE rid LIKE '%\\_grup\\_%' ESCAPE '\\'`)
    .all<{ rid: string; uid: string | null; users_json: string | null }>()
  for (const v of vids.results) {
    if (st.grupvids.includes(v.rid) || /_w[2-8]$/.test(v.rid)) continue
    st.grupvids.push(v.rid); changed = true
    let uyeler: string[] = []
    try { uyeler = JSON.parse(v.users_json || '[]') } catch { /* tek kullanıcı */ }
    if (!uyeler.length) uyeler = [v.uid || '?']
    const adlar = (await Promise.all(uyeler.map(ad))).join(', ')
    await bildirimBekleyen(env, `🏍️🏍️ İLK GRUP VİDEOSU ÜRETİLDİ: ${adlar} birlikte sürdü — ortak video hazır! (${v.rid})`, 'Move Log Olay')
  }
  if (changed) await kvJsonYaz(env, 'olay:durum', st)
  else log('yeni olay yok')
}
