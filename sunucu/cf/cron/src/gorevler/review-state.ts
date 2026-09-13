// review-state — movelog-review-state-watch.py (23 satır) portu. 12dk'da bir.
// ⚠️ VARSAYILAN KAPALI (gorev_takvimi.enabled=0): sunucudaki timer da DISABLED (tasks.json ölçümü
// 2026-08-30, 1.57 süreci bitti). Açma kararı Barış'a — /internal/tick force ya da D1 UPDATE ile açılır.
import type { GorevCtx } from '../takvim'
import { ascGet, ascHazir } from '../asc'
import { bildirimBekleyen, kvJsonYaz } from '../lib'

const NICE: Record<string, string> = {
  IN_REVIEW: '🔎 İNCELEMEYE GİRDİ', PENDING_DEVELOPER_RELEASE: '✅ ONAYLANDI (yayına hazır)',
  READY_FOR_SALE: '🎉 YAYINDA', REJECTED: '❌ REDDEDİLDİ', METADATA_REJECTED: '❌ METADATA RED',
  DEVELOPER_REJECTED: '↩️ geri çekildi',
}

export async function kos(c: GorevCtx): Promise<void> {
  const { env, log } = c
  if (!ascHazir(env) || !env.ASC_APP_ID) { log('ASC sırları yok — atlandı'); return }
  const r = await ascGet(env, `/v1/apps/${env.ASC_APP_ID}/appStoreVersions?limit=1`)
  if (r.status !== 200) { log(`appStoreVersions hata: ${r.status}`); return }
  const a = (r.data as { data?: { attributes?: { appStoreState?: string; versionString?: string } }[] })?.data?.[0]?.attributes
  if (!a?.appStoreState) { log('sürüm verisi boş'); return }
  const last = (await env.KV.get('review:state')) || ''
  if (a.appStoreState !== last) {
    await kvJsonYaz(env, 'review:state', a.appStoreState)
    if (last) {   // ilk çalıştırmada bildirim yok
      await bildirimBekleyen(env, `iOS ${a.versionString}: ${last} → ${NICE[a.appStoreState] ?? a.appStoreState}`, '🍎 iOS Review')
    }
    log(`DEĞİŞTİ: ${last} -> ${a.appStoreState}`)
  } else log(`aynı: ${a.appStoreState}`)
}
