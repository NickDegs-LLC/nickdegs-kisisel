// pending-reconcile — movelog-pending-reconcile.py (114 satır) portu.
// (a) R2'de videosu VAR ama pending'de kalmış → render-done (D1 transaction)
// (b) videosuz + >90dk eski → render-failed (pgrep karşılığı CF'de yok — RunPod job-status D1'e
//     yazılınca eklenecek; şimdilik STALE tek ölçüt, kaynaktaki gibi eventually-consistent)
// (c) yetim süpürmesi: R2'de olup videos'ta kaydı olmayan mp4 → rides metadata'sıyla render-done
import type { GorevCtx } from '../takvim'
import { trGun } from '../lib'
import { renderDone, renderFailed } from '../ic'

const STALE = 5400 // 90dk (2026-07-26 false-fail engeli)

export async function kos(c: GorevCtx): Promise<void> {
  const { env, now, log } = c

  // ===== (c) YETİM VİDEO SÜPÜRMESİ (Semra vakası, 2026-08-08) =====
  try {
    const listed = await env.R2.list({ prefix: 'videos/', limit: 1000 })
    for (const o of listed.objects) {
      if (!o.key.endsWith('.mp4')) continue
      const rid = o.key.slice('videos/'.length, -'.mp4'.length)
      if (!rid) continue
      const kayit = await env.DB.prepare('SELECT 1 x FROM videos WHERE rid = ?1').bind(rid).first()
      if (kayit) continue
      const yas = now - Math.floor(o.uploaded.getTime() / 1000)
      // 🔴 FİKS 05.09: üst sınır 1 GÜN'dü ama gerçek R2 lifecycle kuralı (videos-expire-interim7d)
      // 7 GÜN. Aradaki 6 gün kör noktaydı: bir gün geciken yetim asla kurtarılamıyordu.
      if (yas < 300 || yas > 7 * 86400) continue
      // 🔴 FİKS 05.09: `_ozet_` rid'i (`{gün}_ozet_{ts}`) `rides` tablosunda ASLA eşleşmiyordu
      // (registerRide yalnız `{gün}_{ts}` yazar) → süpürge her turda "rides metadata yok" deyip
      // atlıyordu. ÖLÇÜLDÜ: 2/2 özet videosu R2'de duruyor, D1'de hiç kaydı yok (36 MB + ~50 dk
      // GPU boşa gitti). Özet, günün İLK aktivitesinin ts'iyle üretiliyor → taban rid oradan bulunur.
      const tabanRid = rid.includes('_ozet_') ? rid.replace('_ozet_', '_') : rid
      const m = await env.DB.prepare('SELECT uid, date, ts, to_ts, ride_type FROM rides WHERE rid = ?1')
        .bind(tabanRid)
        .first<{ uid: string | null; date: string | null; ts: number; to_ts: number; ride_type: string | null }>()
      if (!m || !m.uid) { log(`yetim ATLANDI ${rid} (rides metadata yok, taban=${tabanRid})`); continue }
      // 🔴 FİKS 05.09: mode SABİT '3d' idi → flyover videolar D1'e "3d" diye yazılıyordu
      // (3 vaka doğrulandı). Gerçek mod kuyruk kaydında duruyor.
      let vmode = '3d'
      let vaspect = '9:16'
      try {
        const kq = await env.KV.get(`render:kuyruk:${rid}`)
        if (kq) {
          const j = JSON.parse(kq)
          if (typeof j.mode === 'string' && j.mode) vmode = j.mode
          if (typeof j.aspect === 'string' && j.aspect) vaspect = j.aspect
        }
      } catch { /* varsayılanlar */ }
      await renderDone(env, {
        ride_id: rid, key: o.key, user: m.uid, date: m.date, ts: m.ts, to: m.to_ts,
        type: m.ride_type || 'moto', mode: vmode, speed: 'medium', aspect: vaspect, size: o.size,
        // 6 saatten eski kurtarmada bildirim GÖNDERME: kullanıcıya günler önceki bir video için
        // "videon hazır" demek kafa karıştırır; kayıt yine de D1'e girer ve listede görünür.
        nopush: yas > 6 * 3600,
      })
      log(`YETİM KURTARILDI ${rid} (mode=${vmode}, yaş ${Math.floor(yas / 60)} dk, taban=${tabanRid})`)
    }
  } catch (e) { log('yetim süpürmesi hata: ' + String(e).slice(0, 120)) }

  // ===== pending taraması =====
  const pend = await env.DB.prepare('SELECT vid, uid, date, ts, to_ts, ride_type, mode, queued_at FROM pending_videos')
    .all<{ vid: string; uid: string; date: string | null; ts: number; to_ts: number; ride_type: string | null; mode: string | null; queued_at: number }>()
  if (!pend.results.length) { log('pending yok, temiz'); return }
  let acted = 0
  for (const pv of pend.results) {
    const key = `videos/${pv.vid}.mp4`
    const obj = await env.R2.head(key)
    const age = now - (pv.queued_at || pv.ts || 0)
    if (obj) {
      // (a) video HAZIR ama takılı -> finalize. aspect/type: KV tacwork job'ı varsa oradan (tac hattı Faz T)
      let aspect = '9:16'
      let typ = pv.ride_type || 'moto'
      try {
        const jf = await env.KV.get(`tacwork:job:${pv.vid}`)
        if (jf) { const j = JSON.parse(jf); aspect = j.aspect || aspect; typ = j.type || typ }
      } catch { /* varsayılanlar */ }
      await renderDone(env, {
        ride_id: pv.vid, key, user: pv.uid, date: pv.date ?? trGun(pv.ts || now), ts: pv.ts || 0,
        to: pv.to_ts || 0, type: typ, mode: pv.mode || 'tactical', speed: 'medium', aspect, size: obj.size,
      })
      log(`FINALIZE ${pv.vid} (video vardı -> kilit açıldı)`); acted++
    } else if (age > STALE) {
      // (b) videosuz + eski -> çökmüş render hayaleti
      await renderFailed(env, pv.vid, pv.uid, 'render tamamlanamadı (oto-temizlik)')
      log(`FAILED ${pv.vid} (yaş ${age}s, videosuz -> temizlendi)`); acted++
    } else {
      log(`bekle ${pv.vid} (yaş ${age}s, henüz render olabilir)`)
    }
  }
  log(`tamamlandı: ${acted} aksiyon, ${pend.results.length} pending tarandı`)
}
