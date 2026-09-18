// kendi-kendini-test — saatlik UÇTAN UCA DUMAN TESTİ (Faz T, 2026-08-31).
// GERÇEK RENDER YOK: hiçbir adım para harcamaz, hiçbir kullanıcı işini tetiklemez.
//
// AYAKLAR (her biri bağımsız try/catch — biri düşerse diğerleri koşar):
//   1) api /health            → movelog-api ayakta mı, D1'i görüyor mu
//   2) D1 yaz/oku             → bekci_duman tablosuna yaz, geri oku, eşitliği doğrula (izole tablo)
//   3) R2 yaz/oku/sil         → 'bekci/duman.txt' (uygulama önekleri: videos/ genreq/ tracks/ — DEĞMEZ)
//   4) Queue üretici          → RENDER_Q'ya 'golge:duman:<ts>' işi bırak. 🔴 'golge:' öneki dispatch
//      tarafında MUTLAK durdurucudur (ORTAM ne olursa olsun RunPod'a gitmez, ack + KV izi). Bir
//      SONRAKİ tur o izi arar → üretici+tüketici zinciri gerçekten uçtan uca doğrulanır.
//   5) RunPod /health         → yalnız ORTAM=canli (kuru modda RunPod'a fetch YOK)
//   6) dispatch /health       → tüketici worker'ı ayakta mı
//   7) görev canlılığı        → gorev_takvimi'nde dakikalık/10dk görevlerden 2 saattir koşmayan var mı
//
// ONARIM: kırık ayağın SAHİBİ bekçi hemen sıraya alınır (gorev_takvimi.next_run=0) — CF'de "servisi
// yeniden başlat" karşılığı budur. Kuru modda yalnız 'YAPARDIM' yazılır.
import type { GorevCtx } from '../takvim'
import type { Env } from '../env'
import { hexRasgele, kvJson, kvJsonYaz } from '../lib'
import { motorOku } from '../../../ortak/src/maliyet'
import { bildir, endpointler, kuru, olayYaz, onar, rpHealth, saglamOlay } from './bekci-ortak'

const BEKCI = 'kendi-kendini-test'
const DURDU_SN = 7200
const DUMAN_SQL = 'CREATE TABLE IF NOT EXISTS bekci_duman (k TEXT PRIMARY KEY, v TEXT NOT NULL, ts INTEGER NOT NULL)'
const MODAL_RUN: Record<string, string> = {
  'movelog-render': 'https://daclen10--movelog-render-run.modal.run',
}

type Ayak = { ad: string; ok: boolean; not: string; ms: number }

async function olc(ad: string, f: () => Promise<string>): Promise<Ayak> {
  const t0 = Date.now()
  try { return { ad, ok: true, not: await f(), ms: Date.now() - t0 } } catch (e) {
    return { ad, ok: false, not: String(e).slice(0, 200), ms: Date.now() - t0 }
  }
}

export async function kos(c: GorevCtx): Promise<void> {
  const { env, now, log } = c
  const ayaklar: Ayak[] = []

  // ── 1) api /health (SERVICE BINDING — Worker→Worker HTTP fetch aynı bölgede 1042 verir) ──
  ayaklar.push(await olc('api-health', async () => {
    if (!env.API) return 'API service binding yok — atlandı'
    const r = await env.API.fetch(new Request('https://movelog-api/health'))
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const j = (await r.json()) as Record<string, unknown>
    if (j.ok !== true) throw new Error(`ok!=true: ${JSON.stringify(j).slice(0, 100)}`)
    return `ok, rides=${j.rides ?? '?'}`
  }))

  // ── 2) D1 yaz/oku ──
  ayaklar.push(await olc('d1-yaz-oku', async () => {
    const beklenen = hexRasgele(8)
    await env.DB.prepare(DUMAN_SQL).run()
    await env.DB.prepare('INSERT OR REPLACE INTO bekci_duman (k, v, ts) VALUES (?1,?2,?3)')
      .bind('duman', beklenen, now).run()
    const geri = await env.DB.prepare('SELECT v, ts FROM bekci_duman WHERE k = ?1').bind('duman')
      .first<{ v: string; ts: number }>()
    if (geri?.v !== beklenen) throw new Error(`geri okuma eşleşmedi (${geri?.v ?? 'null'})`)
    return `yazıldı+okundu (${beklenen})`
  }))

  // ── 3) R2 yaz/oku/sil ──
  ayaklar.push(await olc('r2-yaz-oku', async () => {
    const k = 'bekci/duman.txt'
    const beklenen = `duman ${now} ${hexRasgele(4)}`
    await env.R2.put(k, beklenen, { httpMetadata: { contentType: 'text/plain' } })
    const h = await env.R2.head(k)
    if (!h) throw new Error('head boş döndü')
    const o = await env.R2.get(k)
    const govde = o ? await o.text() : ''
    if (govde !== beklenen) throw new Error('içerik eşleşmedi')
    await env.R2.delete(k)
    return `put/head/get/delete ok (${h.size} B)`
  }))

  // ── 4) Queue üretici (+ önceki turun tüketim doğrulaması) ──
  ayaklar.push(await olc('queue-uretici', async () => {
    const onceki = await kvJson<string>(env, 'bekci:duman:kuyruk', '')
    const tuketilmedi = !!onceki && (await env.KV.get(`dispatch:golge:${onceki}`)) === null
    const dogrulama = !onceki ? 'önceki tur yok'
      : tuketilmedi ? `⚠️ önceki iş TÜKETİLMEDİ (${onceki})` : `önceki iş tüketildi (${onceki})`
    // Zincir kırıksa bile yeni iş HER TUR bırakılır — yoksa test bir kez düşünce bir daha primelenmez.
    const rid = `golge:duman:${now}`                 // 'golge:' = dispatch'te MUTLAK durdurucu
    await env.RENDER_Q.send({ ride_id: rid, mode: 'duman', kaynak: BEKCI, ts: now })
    await kvJsonYaz(env, 'bekci:duman:kuyruk', rid, 3 * 86400)
    if (tuketilmedi) throw new Error(`${dogrulama} — üretici→tüketici zinciri kırık; yeni iş yine bırakıldı (${rid})`)
    return `${dogrulama}; yeni iş bırakıldı (${rid})`
  }))

  // ── 5) RunPod /health (yalnız canli + dal RunPod) · Modal /run 403 sonda (dal modal) ──
  const { bilinen, eksik } = endpointler(env)
  const hepsi = [...bilinen, ...eksik]
  for (const e of hepsi) {
    const motor = await motorOku(env.KV)
    if (motor === 'modal') {
      // NEDEN: motor Modal — RunPod health kırık sayılmaz, runpod-saglik tetiklenmez.
      ayaklar.push({ ad: `runpod-health:${e.ad}`, ok: true, ms: 0,
        not: 'atlandı (motor modal)' })
      const uc = MODAL_RUN[e.ad]
      if (!uc) continue
      if (kuru(env)) {
        ayaklar.push({ ad: `modal-run:${e.ad}`, ok: true, ms: 0,
          not: 'KURU: Modal /run sonda atlandı' })
      } else {
        // NEDEN: yanlış sır GPU açmaz; 403 = kapı sağlam.
        ayaklar.push(await olc(`modal-run:${e.ad}`, async () => {
          const r = await fetch(uc, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ secret: 'yanlis', input: { track: [1, 2, 3] } }),
          })
          if (r.status === 403) return '403 (sır kapısı sağlam)'
          throw new Error(`HTTP ${r.status} (403 beklenirdi)`)
        }))
      }
      continue
    }
    if (kuru(env) || !env.RUNPOD_API_KEY) {
      if (e.id) {
        ayaklar.push({ ad: `runpod-health:${e.ad}`, ok: true, ms: 0,
          not: `KURU: /health atlandı (${kuru(env) ? 'ORTAM=golge' : 'anahtar yok'})` })
      }
      continue
    }
    if (!e.id) continue
    ayaklar.push(await olc(`runpod-health:${e.ad}`, async () => {
      const h = await rpHealth(env, e.id)
      if (h.status === 402) throw new Error('HTTP 402 — bakiye bitti')
      if (h.status >= 400) throw new Error(`HTTP ${h.status}`)
      const w = (h.j?.workers ?? {}) as Record<string, number>
      return `ok (ready=${w.ready ?? 0} running=${w.running ?? 0})`
    }))
  }

  // ── 6) dispatch /health ──
  ayaklar.push(await olc('dispatch-health', async () => {
    if (!env.DISPATCH) return 'DISPATCH service binding yok — atlandı'
    const r = await env.DISPATCH.fetch(new Request('https://movelog-dispatch/health'))
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const j = (await r.json()) as Record<string, unknown>
    if (j.ok !== true) throw new Error('ok!=true')
    return `ok (worker=${j.worker ?? '?'} ortam=${j.ortam ?? '?'})`
  }))

  // ── 7) görev canlılığı ──
  const durmus: string[] = []
  ayaklar.push(await olc('gorev-canliligi', async () => {
    const r = await env.DB.prepare(
      `SELECT name, last_run, last_ok, hata, created_at FROM gorev_takvimi
       WHERE enabled = 1 AND cron_grubu IN ('dakikalik','on_dk')`)
      .all<{ name: string; last_run: number | null; last_ok: number | null; hata: string | null; created_at: number }>()
    const hatalilar: string[] = []
    for (const g of r.results) {
      if (g.name === BEKCI) continue
      const taze = now - g.created_at < DURDU_SN
      if (g.last_ok === null ? !taze : now - g.last_ok > DURDU_SN) durmus.push(g.name)
      if (g.hata) hatalilar.push(`${g.name}: ${g.hata.slice(0, 60)}`)
    }
    if (durmus.length || hatalilar.length) {
      throw new Error(`durmuş: ${durmus.join(', ') || '-'} · hatalı: ${hatalilar.join(' | ') || '-'}`)
    }
    return `${r.results.length} sık görev canlı`
  }))

  // ── değerlendirme ──
  const kirik = ayaklar.filter((a) => !a.ok)
  for (const a of ayaklar) log(`${a.ok ? '✓' : '✗'} ${a.ad} (${a.ms}ms): ${a.not}`)
  await kvJsonYaz(env, 'bekci:duman:son', { t: now, ayaklar }, 7 * 86400)

  if (!kirik.length) {
    await saglamOlay(env, BEKCI, 'duman-testi-gecti', { ayak: ayaklar.length, ayaklar: ayaklar.map((a) => a.ad) }, 3)
    return
  }
  await olayYaz(env, {
    bekci: BEKCI, tespit: 'duman-testi-kirik',
    aksiyon: `${kirik.length}/${ayaklar.length} ayak kırık`, sonuc: 'basarisiz',
    detay: { kirik: kirik.map((a) => ({ ayak: a.ad, not: a.not })) },
  })
  // ONARIM: kırık ayağın sahibi bekçiyi HEMEN sıraya al (CF'de 'restart' karşılığı)
  const sahipler = new Set<string>()
  for (const a of kirik) {
    if (a.ad.startsWith('runpod-health')) sahipler.add('runpod-saglik')
    if (a.ad === 'queue-uretici') sahipler.add('kuyruk-bekcisi')
    if (a.ad === 'd1-yaz-oku') sahipler.add('d1-tutarlilik')
  }
  for (const g of durmus) sahipler.add(g)
  if (sahipler.size) {
    const liste = [...sahipler]
    await onar(c, {
      bekci: BEKCI, tespit: 'kirik-ayak-sahibini-sirala',
      aksiyon: `gorev_takvimi.next_run=0 → ${liste.join(', ')} bir sonraki tetikte HEMEN koşar`,
      detay: { gorevler: liste, kirik: kirik.map((a) => a.ad) },
      uygula: async () => {
        await env.DB.batch(liste.map((n) =>
          env.DB.prepare('UPDATE gorev_takvimi SET next_run = 0, updated_at = ?2 WHERE name = ?1').bind(n, now)))
      },
      dogrula: async () => await sirayaAlindi(env, liste),
    })
  }
  await bildir(c, {
    bekci: BEKCI, tespit: 'duman-kirik', saat: 3,
    msg: `🧪 Move Log duman testi ${kirik.length}/${ayaklar.length} ayakta KIRIK:\n` +
      kirik.map((a) => `• ${a.ad}: ${a.not}`).join('\n') +
      (sahipler.size ? `\n→ sıraya alındı: ${[...sahipler].join(', ')}` : ''),
    detay: { kirik: kirik.map((a) => a.ad) },
  })
}

async function sirayaAlindi(env: Env, liste: string[]): Promise<boolean> {
  const ph = liste.map((_, i) => `?${i + 1}`).join(',')
  const r = await env.DB.prepare(`SELECT COUNT(*) n FROM gorev_takvimi WHERE name IN (${ph}) AND next_run = 0`)
    .bind(...liste).first<{ n: number }>()
  return Number(r?.n ?? 0) === liste.length
}
