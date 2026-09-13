// render-bekci — movelog-render-bekci.py (204 satır) portu.
// RunPod bekçisi: wmax=0'ı açar, bakiye izler, .bulut-kapali bayrağını (KV) yönetir, kuyruk/genreq alarmı.
// ⚠️ ORTAM=golge: RunPod'a HİÇBİR çağrı yapılmaz (MUTLAK KURAL — bakiye korunur, PATCH yasak);
//    yapılacak işlemler KV izine yazılır. canli'da fetch'ler birebir (GraphQL User-Agent ŞART!).
//
// 🔁 SAHİPLİK KİRASI (Faz T, 2026-08-31): wmax + bakiye/bulut-kapali bloklarının sahibi artık
// runpod-saglik bekçisidir (o BİRDEN ÇOK endpoint'e bakar: movelog-render + movelog-tactical).
// runpod-saglik her turda KV 'bekci:runpod:sahip' kirasını 1 saat TTL ile yeniler; bu görev kirayı
// görürse 1/2 bloklarını ATLAR → çift PATCH / çift bildirim OLMAZ. runpod-saglik durursa kira 1
// saatte düşer ve bu görev sorumluluğu KENDİLİĞİNDEN geri alır (tek nokta arıza yok).
// Kuyruk tıkanıklığı (3/4) ve bekleyen-iş (5) blokları HER ZAMAN buradadır; artık D1 bekci_olay'a da yazar.
import type { GorevCtx } from '../takvim'
import type { Env } from '../env'
import { bildirimBekleyen, kvJson, kvJsonYaz, simdi } from '../lib'
import { atlandiOlay, kuruOlay, olayYaz, saglamOlay } from './bekci-ortak'
import { SAHIP_ANAHTAR } from './runpod-saglik'

const WMAX_NORMAL = 15
const BAKIYE_ESIK = 2.0
const BULUT_KAPALI_ESIK = 0.5
const KUYRUK_DK = 25
const GENREQ_DK = 30
const RETRY_MAX = 3
const SESSIZ_SAAT = 6

type Durum = {
  retry: Record<string, number>
  sonbildirim: Record<string, number>
  kuyruk_t0?: number
  bakiye_hata?: number
}

function sessizde(st: Durum, konu: string): boolean {
  const son = st.sonbildirim[konu] || 0
  if (simdi() - son < SESSIZ_SAAT * 3600) return true
  st.sonbildirim[konu] = simdi()
  return false
}

async function rp(env: Env, yol: string, method = 'GET', body?: unknown, rest = false): Promise<unknown> {
  const kok = rest ? 'https://rest.runpod.io/v1' : `https://api.runpod.ai/v2/${env.RUNPOD_ENDPOINT_ID}`
  const r = await fetch(kok + yol, {
    method,
    headers: { authorization: `Bearer ${env.RUNPOD_API_KEY}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) throw new Error(`RunPod ${yol} HTTP ${r.status}`)
  return r.json()
}

export async function kos(c: GorevCtx): Promise<void> {
  const { env, now, log } = c
  const st = await kvJson<Durum>(env, 'bekci:render', { retry: {}, sonbildirim: {} })
  const golge = env.ORTAM === 'golge'
  // wmax/bakiye sorumluluğu runpod-saglik'te mi? (kira canlıysa 1/2 blokları atlanır)
  const devredildi = (await env.KV.get(SAHIP_ANAHTAR)) !== null
  const canliRp = !golge && !!env.RUNPOD_API_KEY

  if (devredildi) {
    log('wmax+bakiye blokları runpod-saglik bekçisine devredildi (kira canlı) — burada tekrar edilmedi')
    await atlandiOlay(env, 'render-bekci', 'sahiplik-kirasi',
      'wmax + bakiye/bulut-kapali sahibi runpod-saglik — çift PATCH/çift bildirim önlendi',
      { kira: SAHIP_ANAHTAR })
  } else if (!canliRp) {
    // KURU TUR: RunPod'a dokunulmaz; ne yapılacağı izlenir. Bayrak durumu yine raporlanır.
    const bayrak = (await env.KV.get('bulut-kapali')) !== null
    log(`KURU MOD (${golge ? 'golge' : 'RUNPOD_API_KEY yok'}): RunPod çağrıları atlandı; ` +
      `canli'da yapılacaklar: endpoint wmax kontrolü (0→${WMAX_NORMAL} PATCH), GraphQL clientBalance ` +
      `(User-Agent: movelog-bekci/1.0 ŞART), /health kuyruk kontrolü. bulut-kapali=${bayrak}`)
    await kuruOlay(env, 'render-bekci', 'runpod-kontrol',
      `wmax 0→${WMAX_NORMAL} PATCH · GraphQL bakiye · /health kuyruk`,
      { bulut_kapali: bayrak, neden: golge ? 'ORTAM=golge' : 'RUNPOD_API_KEY yok' })
  } else {
    // --- 1) endpoint kapalı mı ---
    try {
      const cfg = (await rp(env, `/endpoints/${env.RUNPOD_ENDPOINT_ID}`, 'GET', undefined, true)) as { workersMax?: number }
      if (cfg.workersMax === 0) {
        await rp(env, `/endpoints/${env.RUNPOD_ENDPOINT_ID}`, 'PATCH', { workersMax: WMAX_NORMAL }, true)
        await bildirimBekleyen(env,
          `⚠️ RENDER ENDPOINT KAPALIYDI (workersMax=0) — otomatik ${WMAX_NORMAL}'e açıldı. Video üretimi durmuştu, şimdi akıyor.`,
          'Move Log Render')
      }
    } catch (e) {
      if (!sessizde(st, 'endpoint-okunamadi')) {
        await bildirimBekleyen(env, `⚠️ RunPod endpoint ayarı okunamadı: ${String(e).slice(0, 120)}`, 'Move Log Render')
      }
    }
    // --- 2) bakiye (GraphQL — User-Agent ŞART, UA'sız 403; satır 105-111) ---
    try {
      const r = await fetch(`https://api.runpod.io/graphql?api_key=${env.RUNPOD_API_KEY}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'movelog-bekci/1.0' },
        body: JSON.stringify({ query: 'query { myself { clientBalance } }' }),
      })
      if (!r.ok) throw new Error(`GraphQL HTTP ${r.status}`)
      const j = (await r.json()) as { data?: { myself?: { clientBalance?: number | null } } }
      const bak = j.data?.myself?.clientBalance ?? null
      if (bak !== null && bak < BAKIYE_ESIK && !sessizde(st, 'bakiye')) {
        await bildirimBekleyen(env,
          `💳 RunPod bakiyesi düşük: $${bak.toFixed(2)} (eşik $${BAKIYE_ESIK}). Bitince videolar üretilemez.`, 'Move Log Render')
      }
      if (bak !== null) {
        const bayrak = (await env.KV.get('bulut-kapali')) !== null
        if (bak < BULUT_KAPALI_ESIK && !bayrak) {
          await kvJsonYaz(env, 'bulut-kapali', bak.toFixed(2))
          await bildirimBekleyen(env,
            `📱 Bulut kapatıldı (bakiye $${bak.toFixed(2)}) — Premium videolar artık TELEFONDA üretilecek. Bakiye yüklenince otomatik buluta döner.`, 'Move Log Render')
        } else if (bak >= BULUT_KAPALI_ESIK && bayrak) {
          await env.KV.delete('bulut-kapali')
          await bildirimBekleyen(env, `☁️ Bulut yeniden açıldı (bakiye $${bak.toFixed(2)}) — videolar buluta döndü.`, 'Move Log Render')
        }
      }
      if (st.bakiye_hata) st.bakiye_hata = 0
    } catch (e) {
      // SESSİZ ARIZA TUZAĞI fix'i (2026-08-28): kalıcı okuma hatası 3 turda bildirilir
      st.bakiye_hata = (st.bakiye_hata || 0) + 1
      if (st.bakiye_hata >= 3 && !sessizde(st, 'bakiye-okunamiyor')) {
        await bildirimBekleyen(env,
          `⚠️ RunPod bakiyesi ${st.bakiye_hata} turdur OKUNAMIYOR: ${String(e).slice(0, 110)}\nBulut/telefon yönlendirmesi karar veremiyor.`, 'Move Log Render')
      }
    }
  }

  // --- 3/4) kuyruk sağlığı — HER ZAMAN bu görevin (devredilmez); yalnız canli+anahtar ---
  if (canliRp) {
    try {
      const h = (await rp(env, '/health')) as { jobs: Record<string, number>; workers: Record<string, number> }
      const bekleyen = h.jobs?.inQueue ?? 0
      const calisan = (h.workers?.running ?? 0) + (h.workers?.initializing ?? 0) + (h.workers?.ready ?? 0)
      if (bekleyen > 0 && calisan === 0) {
        const t0 = st.kuyruk_t0 || now
        st.kuyruk_t0 = t0
        if (now - t0 > KUYRUK_DK * 60 && !sessizde(st, 'kuyruk-tikali')) {
          await bildirimBekleyen(env,
            `🚨 RENDER KUYRUĞU TIKALI: ${bekleyen} iş bekliyor, hiç worker açılmıyor (${KUYRUK_DK} dk'dır).`, 'Move Log Render')
          await olayYaz(env, {
            bekci: 'render-bekci', tespit: 'kuyruk-tikali',
            aksiyon: 'bildirim kuyruğuna (worker açılmıyor — RunPod tarafı)', sonuc: 'bildirildi',
            detay: { bekleyen, calisan, dk: KUYRUK_DK },
          })
        }
      } else { delete st.kuyruk_t0; await saglamOlay(env, 'render-bekci', 'kuyruk', { bekleyen, calisan }) }
    } catch { /* health okunamadı — sonraki tur */ }
  }

  // --- 5) uzun süredir bekleyen iş (genreq eşleniği: pending_videos yaşı) ---
  // Kaynak genreq dizin yaşına bakıyordu; CF'de dispatch edilemeyen işin izi pending_videos'ta
  // (queued_at). Videosu R2'ye düşmemiş + GENREQ_DK'dan yaşlı pending = gönderilemeyen iş.
  try {
    const pend = await env.DB.prepare('SELECT vid, queued_at FROM pending_videos').all<{ vid: string; queued_at: number }>()
    const takili = pend.results.filter((p) => now - (p.queued_at || 0) > GENREQ_DK * 60)
    if (takili.length) {
      for (const p of takili) st.retry[p.vid] = (st.retry[p.vid] || 0) + 1
      const asanlar = Object.entries(st.retry).filter(([, n]) => n >= RETRY_MAX).map(([a]) => a)
      if (asanlar.length && !sessizde(st, 'genreq-takili')) {
        await bildirimBekleyen(env,
          `🚨 ${takili.length} video isteği ${GENREQ_DK} dk'dır gönderilemiyor (${RETRY_MAX}+ deneme): ${asanlar.slice(0, 3).map((a) => a.slice(0, 34)).join(', ')}`, 'Move Log Render')
      }
      await olayYaz(env, {
        bekci: 'render-bekci', tespit: 'gonderilemeyen-is',
        aksiyon: `sayaç artırıldı; ${RETRY_MAX}+ denemede bildirim — kesin temizlik kuyruk-bekcisi/d1-tutarlilik'te`,
        sonuc: asanlar.length ? 'bildirildi' : 'saglam',
        detay: { takili: takili.length, asan: asanlar.slice(0, 5), dk: GENREQ_DK },
      })
    } else if (Object.keys(st.retry).length) st.retry = {}
  } catch (e) { log('bekleyen-iş kontrolü hata: ' + String(e).slice(0, 100)) }

  await kvJsonYaz(env, 'bekci:render', st)
}
