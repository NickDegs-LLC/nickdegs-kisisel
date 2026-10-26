// kart — paylaşılabilir PNG kartlar (26.10.2026, Barış: "1 ve 5'i yap").
//
//   GET /api/rides/{ride_id}/kart?f=dikey|kare    sürüş kartı (rota sanatı + km/süre/hız)
//   GET /api/summary/kart?gun=YYYY-MM-DD&f=...     haftalık özet kartı (gun'la biten 7 gün; vars. bugün)
//
// Her ikisi de kullanıcının KENDİ verisi; premium şartı YOK (bilerek: ücretsiz kullanıcının ilk
// sürüşte elle tutulur bir şey görmesi için — video premium'da kalır). Harita karosu/GPU yok:
// veri burada toplanır, çizim movelog-kart worker'ında (service binding KART) yapılır.
// İz kaynağı /api/rides/generate ile aynı sıra: yüklenen GPX (R2 tracks/{ts}.json) → D1 positions.
import { Hono } from 'hono'
import type { AppEnv } from '../lib/env'
import { authUser } from '../lib/auth'
import { hata } from '../lib/hata'
import { BARIS_UID, ORNEK_UID, simdi } from '../lib/db'
import { izSuz, mesafeKm } from '../../../ortak/src/izsuzgec'
import { trGun } from '../../../ortak/src/zaman'

const g = new Hono<AppEnv>()

type Iz = { lat: number; lon: number; t: number }
type Profil = { lang: string | null; handle: string | null; tracker_id: string | null }
type RideRow = { rid: string; uid: string | null; date: string | null; ts: number; to_ts: number; ride_type: string | null; km: number | null; track_key: string | null }

const MAX_NOKTA = 400          // karta giden iz (DP sadeleştirme kart tarafında)
const MAX_POS = 20000          // D1'den okunacak en çok nokta (bir sürüş)
const KM_SPIKE = 400           // bunun üstü GPS sıçraması, hız örneğine girmez

function bicim(c: { req: { query: (k: string) => string | undefined } }): 'dikey' | 'kare' {
  const f = c.req.query('f') ?? c.req.query('format') ?? ''
  return f === 'kare' ? 'kare' : 'dikey'
}

async function profil(db: D1Database, uid: string): Promise<Profil> {
  return (await db.prepare('SELECT lang, handle, tracker_id FROM users WHERE uid = ?1').bind(uid).first<Profil>())
    ?? { lang: null, handle: null, tracker_id: null }
}

/** generate ile aynı öncelik: R2 yüklenen iz → D1 positions (tracker_id, [ts,to]). İz süzgeci ortak. */
async function izYukle(env: AppEnv['Bindings'], trackKey: string | null, trackerId: string | null, ts: number, to: number): Promise<Iz[]> {
  let ham: Iz[] = []
  if (trackKey) {
    const o = await env.R2.get(trackKey)
    if (o) {
      try {
        const j = (await o.json()) as Array<{ lat: number; lon: number; t?: number | null }>
        ham = j.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
          .map((p, i) => ({ lat: p.lat, lon: p.lon, t: Number(p.t ?? ts + i) }))
      } catch { ham = [] }
    }
  }
  if (!ham.length && trackerId) {
    const r = await env.DB.prepare(
      'SELECT ts AS t, lat, lon FROM positions WHERE device = ?1 AND ts >= ?2 AND ts <= ?3 ORDER BY ts LIMIT ?4')
      .bind(trackerId, ts, to, MAX_POS).all<Iz>()
    ham = r.results ?? []
  }
  return izSuz(ham)
}

/** km (toplam) + maks hız. Hız ≥5 sn'lik pencerelerle ölçülür: telefon 1-2 sn'de bir nokta
 *  atar, nokta-nokta hız GPS gürültüsüyle sıçrar; 97. yüzdelik tekil sıçramayı da eler. */
function olc(iz: Iz[]): { km: number; maksKmh: number } {
  let km = 0
  for (let i = 1; i < iz.length; i++) km += mesafeKm(iz[i - 1], iz[i])
  const hizlar: number[] = []
  let a = 0, mesafe = 0
  for (let j = 1; j < iz.length; j++) {
    mesafe += mesafeKm(iz[j - 1], iz[j])
    const dt = iz[j].t - iz[a].t
    if (dt >= 5) {
      if (dt <= 120) { const v = (mesafe / dt) * 3600; if (v < KM_SPIKE) hizlar.push(v) }
      a = j; mesafe = 0
    }
  }
  hizlar.sort((x, y) => x - y)
  const maks = hizlar.length ? hizlar[Math.min(hizlar.length - 1, Math.floor(hizlar.length * 0.97))] : 0
  return { km, maksKmh: maks }
}

function seyrelt(iz: Iz[], n: number): Array<{ lat: number; lon: number }> {
  if (iz.length <= n) return iz.map((p) => ({ lat: p.lat, lon: p.lon }))
  const out: Array<{ lat: number; lon: number }> = []
  const adim = (iz.length - 1) / (n - 1)
  for (let i = 0; i < n; i++) { const p = iz[Math.round(i * adim)]; out.push({ lat: p.lat, lon: p.lon }) }
  return out
}

async function kartCiz(env: AppEnv['Bindings'], tip: 'surus' | 'hafta', bicimi: 'dikey' | 'kare', veri: unknown, svg: boolean): Promise<Response> {
  if (!env.KART) hata(503, 'kart servisi bağlı değil')
  const r = await env.KART.fetch(`https://movelog-kart/${svg ? '?svg=1' : ''}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tip, bicim: bicimi, veri }),
  })
  if (!r.ok) hata(502, `kart üretilemedi (${r.status})`)
  return r
}

function yanit(r: Response, dosya: string, cache: string): Response {
  const h = new Headers()
  h.set('content-type', r.headers.get('content-type') ?? 'image/png')
  h.set('cache-control', cache)
  h.set('content-disposition', `inline; filename="${dosya}"`)
  return new Response(r.body, { status: 200, headers: h })
}

/** rides → videos sırası (rideOwner ile aynı); sahibi boşsa Barış (main.py _own kuralı). */
async function rideBul(db: D1Database, rid: string): Promise<RideRow | null> {
  const r = await db.prepare('SELECT rid, uid, date, ts, to_ts, ride_type, km, track_key FROM rides WHERE rid = ?1')
    .bind(rid).first<RideRow>()
  if (r) return r
  const v = await db.prepare('SELECT rid, uid, date, ts, to_ts, ride_type, km FROM videos WHERE rid = ?1')
    .bind(rid).first<Omit<RideRow, 'track_key'>>()
  return v ? { ...v, track_key: null } : null
}

// ---------- GET /api/rides/{ride_id}/kart ----------
g.get('/api/rides/:ride_id/kart', authUser, async (c) => {
  const user = c.get('user')
  const rid = c.req.param('ride_id')
  const ride = await rideBul(c.env.DB, rid)
  if (!ride) hata(404, 'rota bulunamadi')
  const sahip = ride.uid || BARIS_UID
  // örnek içerik (appreview) herkese görünür; başkasının rotası → 404 (IDOR: var/yok sızdırma)
  if (sahip !== user && sahip !== ORNEK_UID) hata(404, 'rota bulunamadi')

  const ovr = await c.env.DB.prepare('SELECT ride_type FROM ride_type_overrides WHERE rid = ?1')
    .bind(rid).first<{ ride_type: string }>()
  const tur = ovr?.ride_type || ride.ride_type || ''
  const ts = Math.trunc(Number(ride.ts)), to = Math.trunc(Number(ride.to_ts)) || ts
  const [p, izSahip] = await Promise.all([profil(c.env.DB, user), profil(c.env.DB, sahip)])
  const iz = await izYukle(c.env, ride.track_key, izSahip.tracker_id, ts, to)
  if (iz.length < 2 && !(Number(ride.km) > 0)) hata(404, 'bu rota için iz yok')

  const o = olc(iz)
  const km = Number(ride.km) > 0 ? Number(ride.km) : o.km
  const sureSn = Math.max(0, (iz.length ? iz[iz.length - 1].t - iz[0].t : 0) || (to - ts))
  const ortKmh = sureSn > 0 ? km / (sureSn / 3600) : 0
  const veri = {
    dil: p.lang || 'en', kullanici: p.handle || undefined, tur, ts, to,
    km, sureSn, ortKmh, maksKmh: Math.max(o.maksKmh, ortKmh), iz: seyrelt(iz, MAX_NOKTA),
  }
  const r = await kartCiz(c.env, 'surus', bicim(c), veri, c.req.query('svg') === '1')
  return yanit(r, `movelog-${rid}.${c.req.query('svg') === '1' ? 'svg' : 'png'}`, 'private, max-age=86400')
})

// ---------- GET /api/summary/kart ----------
function gunKaydir(gun: string, n: number): string {
  return new Date(Date.parse(gun + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)
}

g.get('/api/summary/kart', authUser, async (c) => {
  const user = c.get('user')
  const now = simdi()
  const gunQ = c.req.query('gun') ?? ''
  const g1 = /^\d{4}-\d{2}-\d{2}$/.test(gunQ) ? gunQ : trGun(now)
  const g0 = gunKaydir(g1, -6)
  const db = c.env.DB
  // Barış'ın eski kayıtlarında uid boş olabilir (main.py:255) — _own kuralıyla aynı
  const sahipKosul = user === BARIS_UID ? "(uid = ?1 OR uid IS NULL OR uid = '')" : 'uid = ?1'
  const [haftaR, silR, gunlerR] = await db.batch<Record<string, unknown>>([
    db.prepare(`SELECT rid, uid, date, ts, to_ts, ride_type, km, track_key FROM rides WHERE ${sahipKosul} AND date >= ?2 AND date <= ?3 ORDER BY ts`)
      .bind(user, g0, g1),
    db.prepare('SELECT rid FROM deleted_rides'),
    db.prepare(`SELECT DISTINCT date FROM rides WHERE ${sahipKosul} AND date <= ?2 AND date IS NOT NULL ORDER BY date DESC LIMIT 90`)
      .bind(user, g1),
  ])
  const silinen = new Set((silR.results as Array<{ rid: string }>).map((r) => r.rid))
  const rides = (haftaR.results as unknown as RideRow[]).filter((r) => !silinen.has(r.rid))
  if (!rides.length) hata(404, 'bu hafta sürüş yok')

  const gunler = Array.from({ length: 7 }, (_, i) => ({ gun: gunKaydir(g0, i), km: 0, n: 0, dk: 0 }))
  const idx = new Map(gunler.map((d, i) => [d.gun, i]))
  let toplamKm = 0, toplamDk = 0
  let enUzun: RideRow | null = null
  for (const r of rides) {
    const gun = r.date || trGun(Number(r.ts))
    const i = idx.get(gun); if (i === undefined) continue
    const km = Number(r.km) || 0
    const dk = Math.max(0, Math.floor((Number(r.to_ts) - Number(r.ts)) / 60))
    gunler[i].km += km; gunler[i].n += 1; gunler[i].dk += dk
    toplamKm += km; toplamDk += dk
    if (!enUzun || km > (Number(enUzun.km) || 0)) enUzun = r
  }
  // seri: g1'den (ya da g1 boşsa bir önceki günden) geriye kesintisiz aktif gün
  const aktif = new Set((gunlerR.results as Array<{ date: string }>).map((r) => r.date))
  let seri = 0
  let d = aktif.has(g1) ? g1 : gunKaydir(g1, -1)
  while (aktif.has(d) && seri < 365) { seri += 1; d = gunKaydir(d, -1) }

  const p = await profil(db, user)
  let iz: Array<{ lat: number; lon: number }> | undefined
  let izKm: number | undefined
  if (enUzun && Number(enUzun.km) > 0) {
    const ham = await izYukle(c.env, enUzun.track_key, p.tracker_id, Math.trunc(Number(enUzun.ts)), Math.trunc(Number(enUzun.to_ts)))
    if (ham.length > 1) { iz = seyrelt(ham, 250); izKm = Number(enUzun.km) }
  }
  const veri = {
    dil: p.lang || 'en', kullanici: p.handle || undefined, gunler,
    toplamKm, toplamN: rides.length, toplamDk, seri, iz, izKm,
  }
  const r = await kartCiz(c.env, 'hafta', bicim(c), veri, c.req.query('svg') === '1')
  // bugünle biten hafta değişebilir (yeni sürüş) → kısa önbellek; geçmiş hafta sabit
  const cache = g1 === trGun(now) ? 'private, max-age=600' : 'private, max-age=86400'
  return yanit(r, `movelog-hafta-${g1}.${c.req.query('svg') === '1' ? 'svg' : 'png'}`, cache)
})

export default g
