// movelog-cron — 21 systemd timer'ın CF karşılığı (Faz 3 dolumu, 2026-08-30).
// Mimari: 3 cron ifadesi → tek scheduled() → D1 gorev_takvimi → sırası gelen görevler.
// Görev mantığı src/gorevler/<ad>.ts (kaynak scriptler /opt/matrix/scripts/*.py, birebir port notlarıyla).
// KURU MOD: push→KV push:bekleyen · Barış bildirimi→KV bildirim:bekleyen · RunPod→RENDER_Q 'golge:' önekli.
import type { Env } from './env'
import { GOREVLER, Grup, Gorev, sonrakiKosum } from './takvim'
import { kvJsonYaz, simdi } from './lib'

export type { Env }

// gorev_takvimi şeması (0003 migration'la aynı; ilk tickte de garanti edilir — izolat başına 1 kez)
const TAKVIM_SQL = `CREATE TABLE IF NOT EXISTS gorev_takvimi (
  name       TEXT PRIMARY KEY,
  cron_grubu TEXT NOT NULL,
  next_run   INTEGER NOT NULL DEFAULT 0,
  last_run   INTEGER,
  last_ok    INTEGER,
  hata       TEXT,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`

let hazirlandi = false
async function hazirla(env: Env): Promise<void> {
  if (hazirlandi) return
  await env.DB.prepare(TAKVIM_SQL).run()
  const now = simdi()
  await env.DB.batch(GOREVLER.map((g) => env.DB.prepare(
    'INSERT OR IGNORE INTO gorev_takvimi (name, cron_grubu, next_run, enabled, created_at, updated_at) VALUES (?1,?2,0,?3,?4,?4)')
    .bind(g.ad, g.grup, g.acik ? 1 : 0, now)))
  hazirlandi = true
}

type Sonuc = { gorev: string; durum: string; ms?: number; log?: string[]; hata?: string }

async function gorevKostur(env: Env, g: Gorev, now: number): Promise<Sonuc> {
  const loglar: string[] = []
  const t0 = Date.now()
  try {
    await g.kos({ env, now, log: (s) => { loglar.push(s); console.log(`[${g.ad}] ${s}`) } })
    const ms = Date.now() - t0
    await env.DB.prepare('UPDATE gorev_takvimi SET last_run=?2, last_ok=?2, hata=NULL, updated_at=?2 WHERE name=?1')
      .bind(g.ad, now).run()
    await kvJsonYaz(env, `gorev:log:${g.ad}`, { t: now, ok: true, ms, log: loglar.slice(0, 80) }, 3 * 86400)
    return { gorev: g.ad, durum: 'kostu', ms, log: loglar }
  } catch (e) {
    const ms = Date.now() - t0
    const hata = String(e).slice(0, 500)
    console.log(`[${g.ad}] HATA: ${hata}`)
    await env.DB.prepare('UPDATE gorev_takvimi SET last_run=?2, hata=?3, updated_at=?2 WHERE name=?1')
      .bind(g.ad, now, hata).run().catch(() => { /* takvim yazılamadı — log yeter */ })
    await kvJsonYaz(env, `gorev:log:${g.ad}`, { t: now, ok: false, ms, hata, log: loglar.slice(0, 80) }, 3 * 86400)
    return { gorev: g.ad, durum: 'hata', ms, hata, log: loglar }
  }
}

/**
 * Tek tur: grubun sırası gelen görevlerini koştur.
 * zorla: görev adı → takvime bakmadan HEMEN koş (manuel tetik; enabled=0 olsa bile).
 */
async function tick(env: Env, grup: Grup | 'hepsi', zorla?: string): Promise<Sonuc[]> {
  await hazirla(env)
  const now = simdi()
  const rows = await env.DB.prepare('SELECT name, next_run, enabled FROM gorev_takvimi')
    .all<{ name: string; next_run: number; enabled: number }>()
  const durumlar = new Map(rows.results.map((r) => [r.name, r]))
  const sonuclar: Sonuc[] = []
  for (const g of GOREVLER) {
    if (zorla) {
      if (g.ad !== zorla) continue
    } else {
      if (grup !== 'hepsi' && g.grup !== grup) continue
    }
    const row = durumlar.get(g.ad)
    if (!row) continue
    if (!zorla) {
      if (!row.enabled) { sonuclar.push({ gorev: g.ad, durum: 'kapali' }); continue }
      if (row.next_run > now) { sonuclar.push({ gorev: g.ad, durum: 'sirasi-degil' }); continue }
      // bootstrap: takvimli (periyot dışı) görev ilk görüşte koşmaz, sadece saatini kurar
      if (row.next_run === 0 && g.zaman.tip !== 'periyot') {
        const nx = sonrakiKosum(g.zaman, now)
        await env.DB.prepare('UPDATE gorev_takvimi SET next_run=?2, updated_at=?3 WHERE name=?1 AND next_run=0')
          .bind(g.ad, nx, now).run()
        sonuclar.push({ gorev: g.ad, durum: `bootstrap→${new Date(nx * 1000).toISOString()}` })
        continue
      }
    }
    // atomik claim: eşzamanlı tetik aynı görevi kapamasın (flock eşleniği)
    const nx = sonrakiKosum(g.zaman, now)
    const claim = await env.DB.prepare(
      'UPDATE gorev_takvimi SET next_run=?2, updated_at=?3 WHERE name=?1 AND next_run=?4')
      .bind(g.ad, nx, now, row.next_run).run()
    if ((claim.meta.changes ?? 0) === 0 && !zorla) { sonuclar.push({ gorev: g.ad, durum: 'yariş-kaybedildi' }); continue }
    sonuclar.push(await gorevKostur(env, g, now))
  }
  return sonuclar
}

function grupFromCron(cron: string): Grup {
  if (cron === '*/10 * * * *') return 'on_dk'
  if (cron === '0 * * * *') return 'saatlik'
  return 'dakikalik'
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const u = new URL(req.url)
    if (u.pathname === '/health') {
      let takvim: unknown = null
      try {
        await hazirla(env)
        takvim = (await env.DB.prepare(
          'SELECT name, cron_grubu, next_run, last_run, last_ok, enabled, hata FROM gorev_takvimi ORDER BY name').all()).results
      } catch (e) { takvim = String(e).slice(0, 200) }
      return Response.json({ ok: true, worker: 'movelog-cron', ortam: env.ORTAM, gorev_sayisi: GOREVLER.length, takvim })
    }
    // manuel tetik: /internal/tick?secret=...&grup=dakikalik|on_dk|saatlik|hepsi  veya  &gorev=<ad>
    if (u.pathname === '/internal/tick') {
      const secret = u.searchParams.get('secret') ?? ''
      if (!env.TICK_SECRET || secret !== env.TICK_SECRET) return new Response('yetkisiz', { status: 403 })
      const gorev = u.searchParams.get('gorev') ?? undefined
      const grup = (u.searchParams.get('grup') ?? 'dakikalik') as Grup | 'hepsi'
      const sonuclar = await tick(env, grup, gorev)
      return Response.json({ ok: true, ortam: env.ORTAM, sonuclar })
    }
    return new Response('not found', { status: 404 })
  },
  async scheduled(ev: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const grup = grupFromCron(ev.cron)
    console.log('tick', new Date(ev.scheduledTime).toISOString(), env.ORTAM, grup)
    ctx.waitUntil(tick(env, grup).then((s) => {
      const koşan = s.filter((x) => x.durum === 'kostu' || x.durum === 'hata')
      if (koşan.length) console.log('tick sonucu:', JSON.stringify(koşan.map((x) => ({ g: x.gorev, d: x.durum, ms: x.ms }))))
    }))
  },
}
