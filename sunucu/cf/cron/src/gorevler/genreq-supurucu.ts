// genreq süpürücü — movelog-genreq.py (49 satır) CF eşleniği.
// Orijinal: genreq dosyalarını LOKAL route-video.py ile üretirdi (PIL/ffmpeg — Worker'da imkânsız).
// CF'de: api /api/rides/generate isteği zaten R2 genreq/{user}_{ts}.json + RENDER_Q işaretçisi bırakıyor
// (grup1). Bu görev SÜPÜRGE: kuyruk tüketicisi düşürmüş/takılmış R2 genreq dosyalarını yeniden kuyruklar.
// Kaynaktaki kural korunur: tactical/3d işine DOKUNMA (onların hattı dispatch/tac — yarış çıkmasın);
// flat/flyover 10dk'dan eskiyse yeniden RENDER_Q'ya (golge modda 'golge:' önekli, gerçek render YOK).
import type { GorevCtx } from '../takvim'
import { kvJsonYaz } from '../lib'

const ESKI_SN = 600      // 10 dk: tüketicinin normal işleme şansı
const TEKRAR_TTL = 3600  // aynı dosya saatte 1 kez yeniden kuyruklanır (spam freni)

export async function kos(c: GorevCtx): Promise<void> {
  const { env, now, log } = c
  const listed = await env.R2.list({ prefix: 'genreq/', limit: 200 })
  if (!listed.objects.length) { log('genreq boş'); return }
  let n = 0
  for (const o of listed.objects) {
    if (!o.key.endsWith('.json')) continue
    const yas = now - Math.floor(o.uploaded.getTime() / 1000)
    if (yas < ESKI_SN) continue
    const mk = `genreq:sweep:${o.key}`
    if ((await env.KV.get(mk)) !== null) continue
    const obj = await env.R2.get(o.key)
    if (!obj) continue
    let req: Record<string, unknown>
    try { req = (await obj.json()) as Record<string, unknown> } catch { log(`bozuk json atlandı: ${o.key}`); continue }
    // ⚠️ TAKTİK/3D İŞE DOKUNMA (2026-08-05 yarış dersi) — dosya SİLİNMEDEN atlanır
    if (req.mode === 'tactical' || req.mode === '3d') { log(`atla (${req.mode}): ${o.key}`); continue }
    const rid = String(req.ride_id ?? `${String(req.user ?? 'x')}_${Math.trunc(Number(req.from ?? 0))}`)
    await env.RENDER_Q.send({
      genreq_r2: o.key, user: req.user, ts: req.from,
      ride_id: env.ORTAM === 'golge' ? `golge:${rid}` : rid, kaynak: 'genreq-supurucu',
    })
    await kvJsonYaz(env, mk, now, TEKRAR_TTL)
    await kvJsonYaz(env, `render:kuyruk:${env.ORTAM === 'golge' ? 'golge:' : ''}${rid}`,
      { t: now, kaynak: 'genreq-supurucu', r2: o.key }, 86400)
    log(`yeniden kuyruklandı: ${o.key} (yaş ${yas}s)`)
    n++
  }
  log(`süpürme bitti: ${n}/${listed.objects.length} yeniden kuyruklandı`)
}
