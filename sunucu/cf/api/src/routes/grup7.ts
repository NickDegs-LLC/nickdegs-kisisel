// grup7 — api/invite + health + api/track + api/videos + api/activities + api/gps + api/stats
//         + api/feedback + api/redeem + api/auth + api/mapconfig + api/announcement
//         + api/pushtoken + api/trackdebug + api/tracker (16 uç)
// Sözleşme: cf/contracts/grup7.json · davranış kaynağı: /opt/movelog/backend/main.py
//
// Kapsanan uçlar (hepsi dolduruldu, 501 YOK):
//   GET    /health                  main.py:532
//   GET    /api/track               main.py:859  (+ _yol_esle 904-964 birebir port)
//   POST   /api/videos/upload       main.py:1211
//   GET    /api/activities          main.py:1271 (+ list_activities 463-528)
//   GET    /api/gps/live            main.py:1276
//   GET    /api/stats               main.py:1315
//   POST   /api/feedback            main.py:1430
//   POST   /api/redeem              main.py:1450
//   POST   /api/auth/signout-all    main.py:1860
//   GET    /api/mapconfig           main.py:1878
//   GET    /api/announcement        main.py:1886
//   POST   /api/pushtoken           main.py:1980
//   POST   /api/trackdebug          main.py:2035
//   GET    /api/tracker             main.py:2724
//   POST   /api/invite              main.py:4005
//   POST   /api/invite/accept       main.py:4014 (+ _profile_of 1389-1407)
//
// cf_mapping kararları (sözleşmeden):
//   · Traccar okumaları → D1 positions — kanonik kolonlar: device, ts, lat, lon, spd(KNOT),
//     alt, acc, brg, batt, charge, created_at (gps worker'ın yazdığı fiili tablo).
//     spd KNOT saklanır → okurken main.py gibi ×1.852 km/h. hr KOLONU YOK (telefon GPS'e
//     nabız göndermez; nabız /api/live/hr-report → users.state_json.hr_live).
//   · uploaded_tracks   → R2 'tracks/{ts}.json' (rides.uploaded=1 + ts ile sahiplik)
//   · yerel ROUTES_DIR mp4 sayımı TAŞINMAZ (health/list_rides — sözleşme notu: birebir eşitlik beklenmez)
//   · adminq/pushq dosya kuyrukları → KV ('adminq:{ms}', 'push:bekleyen:*') — Faz 3'te gerçek gönderim
//   · sv-kapali bayrak dosyası → KV 'sv_off'; announcement + free_tactical_enabled → D1 config tablosu
//   · rate limit (in-memory _rate_ok) → KV kayan pencere (rl:*; eventual consistency notu aşağıda)
//   · Traccar cihaz-oluşturma adımı (tracker) KALKTI — movelog-gps ingest users.tracker_id ile eşler

import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv, Env } from '../lib/env'
import { authUser, b64uEncode } from '../lib/auth'
import { hata } from '../lib/hata'
import { adminq as adminqLib, svKapali } from '../lib/ortak'
import { izSuz } from '../../../ortak/src/izsuzgec'
import { BARIS_UID, etkinSahip, getUser, jsonSet, simdi } from '../lib/db'

const g = new Hono<AppEnv>()
const enc = new TextEncoder()

// ---------------------------------------------------------------------------
// ortak küçük yardımcılar
// ---------------------------------------------------------------------------

/** Python int(x or 0) eşleniği — NaN/null/undefined → 0, kesirli → trunc. */
const int_ = (x: unknown): number => {
  const n = Math.trunc(Number(x ?? 0))
  return Number.isFinite(n) ? n : 0
}

/** Python round(x, 1) yaklaşık eşleniği (JS half-up; Python banker's — tam .x5 yarımlarda nadir fark). */
const round1 = (x: number): number => Math.round(x * 10) / 10

/** TR günü (UTC+3 sabit — main.py:28 TR = timezone(timedelta(hours=3))). */
const trGunu = (ts: number): string => new Date((ts + 3 * 3600) * 1000).toISOString().slice(0, 10)

const TYPE_EMOJI: Record<string, string> = { moto: '🏍️', car: '🚗', bike: '🚲', run: '🏃', walk: '🚶' }
const emojiOf = (t: string): string => TYPE_EMOJI[t] ?? '🎬'

/** FastAPI Body(...) eşleniği: JSON gövde; bozuk/eksik → 422 (FastAPI doğrulama biçimi). */
async function govde(c: Context<AppEnv>): Promise<Record<string, any>> {
  let j: unknown
  try {
    j = await c.req.json()
  } catch {
    hata(422, [{ type: 'json_invalid', loc: ['body', 0], msg: 'JSON decode error', input: {}, ctx: { error: 'Expecting value' } }])
  }
  if (j === null || typeof j !== 'object' || Array.isArray(j)) {
    hata(422, [{ type: 'model_attributes_type', loc: ['body'], msg: 'Input should be a valid dictionary or object to extract fields from', input: j }])
  }
  return j as Record<string, any>
}

/** main.py _rate_ok (171-180) → KV kayan pencere. KV hatasında FAIL-OPEN (taze süreç gibi).
 *  Not: KV eventual consistency — izolatlar arası ~60sn gecikmede limit kaçağı olabilir
 *  (orijinal in-memory sayaç da süreç yeniden başlayınca sıfırlanıyordu; kabul edilen gevşeklik). */
async function rateOk(env: Env, key: string, limit: number, window: number): Promise<boolean> {
  try {
    const now = Date.now() / 1000
    let arr: number[] = []
    const raw = await env.KV.get('rl:' + key)
    if (raw) {
      try { arr = (JSON.parse(raw) as number[]).filter((t) => now - t < window) } catch { arr = [] }
    }
    if (arr.length >= limit) return false
    arr.push(now)
    await env.KV.put('rl:' + key, JSON.stringify(arr), { expirationTtl: Math.max(window, 60) })
    return true
  } catch {
    return true
  }
}

/** main.py _adminq (2957-2964) eşleniği — lib/ortak adminq'ya devredildi (bütünleştirme 08-30;
 *  tek önek 'adminq:bekleyen:' — Faz 3 Telegram ileticisi tek önek tarar). */
async function adminq(env: Env, msg: string): Promise<void> {
  await adminqLib(env, msg)
}

// main.py _SV_MSG anahtar SIRASI (2473-2486) — _req_lang bu sırayla tarar
const DILLER = ['tr', 'en', 'de', 'fr', 'es', 'it', 'ru', 'ar', 'pt', 'ja', 'ko', 'zh']

/** main.py _req_lang (2500-2509): Accept-Language → app dillerinden biri, yoksa 'en'. */
function reqLang(c: Context<AppEnv>): string {
  try {
    const al = (c.req.header('accept-language') || '').toLowerCase()
    for (const code of DILLER) {
      if (al.startsWith(code) || al.includes(',' + code) || al.includes(' ' + code)) return code
    }
  } catch { /* yut */ }
  return 'en'
}

// ---------------------------------------------------------------------------
// list_rides D1 portu (main.py:251-404) — stats / activities / health kullanır.
// Yerel ROUTES_DIR rota_*.mp4 dalı (277-306) TAŞINMADI (sözleşme /health notu:
// Barış'ın eski Traccar render'ları; gölge modda birebir sayı eşitliği beklenmez).
// ---------------------------------------------------------------------------
async function listRides(env: Env, user: string): Promise<Record<string, any>[]> {
  // ÖRNEK İÇERİK (main.py:267-270): kendi kaydı olmayan kullanıcı appreview'u görür —
  // yalnız cloud/detected için; pending/failed HER ZAMAN gerçek kullanıcıyla filtrelenir (339, 367).
  const sahip = await etkinSahip(env.DB, user)
  const [ovR, delR, cloudR, detR, pendR, failR, pendAllR] = await env.DB.batch<Record<string, any>>([
    env.DB.prepare('SELECT rid, ride_type FROM ride_type_overrides'),
    env.DB.prepare('SELECT rid FROM deleted_rides'),
    env.DB.prepare("SELECT * FROM videos WHERE COALESCE(NULLIF(uid,''), ?2) = ?1").bind(sahip, BARIS_UID),
    env.DB.prepare("SELECT * FROM rides WHERE COALESCE(NULLIF(uid,''), ?2) = ?1").bind(sahip, BARIS_UID),
    env.DB.prepare("SELECT * FROM pending_videos WHERE COALESCE(NULLIF(uid,''), ?2) = ?1").bind(user, BARIS_UID),
    env.DB.prepare("SELECT * FROM failed_videos WHERE COALESCE(NULLIF(uid,''), ?2) = ?1").bind(user, BARIS_UID),
    env.DB.prepare('SELECT vid FROM pending_videos'),   // failed filtresi GLOBAL pending'e bakar (main.py:365)
  ])
  const overrides: Record<string, string> = {}
  for (const r of ovR.results) overrides[String(r.rid)] = String(r.ride_type)
  const deleted = new Set(delR.results.map((r) => String(r.rid)))
  const pendAll = new Set(pendAllR.results.map((r) => String(r.vid)))
  const byId: Record<string, Record<string, any>> = {}

  // bulut (R2) videoları (main.py:308-328)
  for (const cv of cloudR.results) {
    const rid = String(cv.rid)
    if (deleted.has(rid)) continue
    const done = int_(cv.done_at)
    const cur = byId[rid]
    if (cur && cur._mt >= done) continue
    let ts = int_(cv.ts)
    if (!ts) { const p = rid.split('_')[1]; ts = int_(p) }   // rid'i parse ETME kuralına yedek (314-318)
    const typ = overrides[rid] || (cv.ride_type as string) || ''
    byId[rid] = {
      id: rid, date: (cv.date as string) || rid.split('_')[0], ts,
      to: int_(cv.to_ts || ts + 2 * 3600),
      type: typ, emoji: emojiOf(typ),
      mode: (cv.mode as string) ?? 'flyover', speed: (cv.speed as string) ?? 'medium',
      aspect: (cv.aspect as string) ?? '16:9', size: int_(cv.size),
      video_url: `/api/rides/${rid}/video`, file: (cv.r2_key as string) || '',
      cloud: true, done, _mt: done,
    }
  }

  // HÂLÂ RENDER OLAN videolar → rendering:true (main.py:336-361)
  for (const pv of pendR.results) {
    const rid = String(pv.vid)
    if (deleted.has(rid)) continue
    const day = rid.split('_')[0]
    const base = byId[rid] ?? {}
    const typ = (pv.ride_type as string) || (base.type as string) || ''
    Object.assign(base, {
      id: rid, date: (pv.date as string) || base.date || day,
      ts: int_(pv.ts || base.ts || 0), to: int_(pv.to_ts || base.to || 0),
      type: typ, emoji: emojiOf(typ),
      mode: (pv.mode as string) || base.mode || 'flyover',
      speed: base.speed ?? 'medium', aspect: base.aspect ?? '16:9',
      size: base.size ?? 0, video_url: `/api/rides/${rid}/video`,
      rendering: true, done: base.done ?? 0,
      _mt: Math.max(int_(base._mt), int_(pv.queued_at)),
    })
    byId[rid] = base
  }

  // BAŞARISIZ videolar → hata kartı (main.py:364-384)
  for (const fv of failR.results) {
    const rid = String(fv.vid)
    if (deleted.has(rid) || pendAll.has(rid)) continue
    const cur = byId[rid]
    if (cur && (cur.cloud || cur.rendering || cur.file)) continue   // üretilmiş/üretilen kazanır
    const base = cur ?? {}
    const day = rid.includes('_') ? rid.split('_')[0] : String(fv.date ?? '')
    const typ = (fv.ride_type as string) || (base.type as string) || ''
    Object.assign(base, {
      id: rid, date: (fv.date as string) || base.date || day,
      ts: int_(fv.ts || base.ts || 0), to: int_(fv.to_ts || base.to || 0),
      type: typ, emoji: emojiOf(typ),
      mode: (fv.mode as string) || base.mode || 'flyover', speed: base.speed ?? 'medium',
      aspect: base.aspect ?? '16:9', size: 0,
      failed: true, error: (fv.reason as string) || 'Video oluşturulamadı',
      done: int_(fv.failed_at), _mt: Math.max(int_(base._mt), int_(fv.failed_at)),
    })
    byId[rid] = base
  }

  // ALGILANAN ama videosuz rotalar → novideo:true (main.py:387-398)
  for (const dr of detR.results) {
    const rid = String(dr.rid)
    if (deleted.has(rid) || byId[rid]) continue
    const ts = int_(dr.ts)
    const typ = overrides[rid] || (dr.ride_type as string) || ''
    byId[rid] = {
      id: rid, date: (dr.date as string) || (rid.includes('_') ? rid.split('_')[0] : ''),
      ts, to: int_(dr.to_ts || ts + 2 * 3600),
      type: typ, emoji: emojiOf(typ),
      mode: 'flyover', speed: 'medium', aspect: '16:9', size: 0,
      novideo: true, done: 0, _mt: ts,
    }
  }

  const out = Object.values(byId)
  for (const r of out) { r.added = int_(r._mt); delete r._mt }   // main.py:400-402
  out.sort((a, b) => int_(b.ts) - int_(a.ts))                    // kararlı sıralama — Python ile aynı
  return out
}

// ---------------------------------------------------------------------------
// _profile_of D1 portu (main.py:1389-1407) — invite/accept kullanır
// ---------------------------------------------------------------------------
async function profileOf(env: Env, u: string): Promise<Record<string, unknown>> {
  const p = await getUser(env.DB, u)   // profil yoksa Python p={} varsayılanları
  let avatar: unknown = null
  if (p?.avatar_json) { try { avatar = JSON.parse(p.avatar_json) } catch { avatar = null } }
  // sv-kapali bayrak dosyası → lib/ortak svKapali (tek KV anahtarı 'sv_off'; anahtar VARSA kapalı)
  const svOff = await svKapali(env)
  // 18.09: ultra / sokak_hak / free_tactical alanlari kaldirildi (Ultra katmani + sokak modu cikti).
  return {
    username: u,
    name: p?.name || u,
    handle: p?.handle || '',
    avatar: avatar || { type: 'initials' },
    premium: !!p?.premium,
    sv_off: svOff,
    video_hak: int_(p?.video_hak),
    // ⚠️ SABİT false — 19.09'da GERİ KONDU. iOS `Profile` struct'ında `ultra` ZORUNLU alan;
    // Swift'in sentezlediği Codable çözücüsü VARSAYILAN DEĞERİ KULLANMAZ, eksik anahtarda
    // fırlatır -> profilin TAMAMI çözülemez (kullanıcı adı + avatar kaybolur, 1.67 dahil).
    ultra: false,
    sokak_hediye: false,   // SABİT false — eski sürüm uyumluluğu (main.py:1400-1405)
    admin: !!p?.admin,
  }
}

// ---------------------------------------------------------------------------
// GET /health — auth YOK (main.py:532-534)
// Not: yerel mp4 sayımı taşınmadığı için 'rides' canlıyla birebir eşit OLMAYABİLİR (sözleşme notu).
// ---------------------------------------------------------------------------
g.get('/health', async (c) => {
  const rides = await listRides(c.env, BARIS_UID)
  return c.json({ ok: true, rides: rides.length })
})

// ---------------------------------------------------------------------------
// GET /api/track (main.py:859-901 + _yol_esle 904-964)
// ---------------------------------------------------------------------------
g.get('/api/track', authUser, async (c) => {
  const user = c.get('user')
  // FastAPI query doğrulaması (422 biçimi) — frm/to zorunlu float, detay opsiyonel int
  const hatalar: Record<string, unknown>[] = []
  const num = (ad: string, zorunlu: boolean): number | null => {
    const s = c.req.query(ad)
    if (s === undefined) {
      if (zorunlu) hatalar.push({ type: 'missing', loc: ['query', ad], msg: 'Field required', input: null })
      return null
    }
    if (s.trim() === '' || Number.isNaN(Number(s))) {
      hatalar.push({ type: 'float_parsing', loc: ['query', ad],
        msg: 'Input should be a valid number, unable to parse string as a number', input: s })
      return null
    }
    return Number(s)
  }
  const frm = num('frm', true)
  const to = num('to', true)
  let detay = 0
  const dS = c.req.query('detay')
  if (dS !== undefined) {
    if (!/^[+-]?\d+$/.test(dS.trim())) {
      hatalar.push({ type: 'int_parsing', loc: ['query', 'detay'],
        msg: 'Input should be a valid integer, unable to parse string as an integer', input: dS })
    } else detay = parseInt(dS, 10)
  }
  if (hatalar.length) hata(422, hatalar)

  // 1) yüklenen GPX/TCX izi: R2 tracks/{int(frm)}.json — sadece SAHİBİ (IDOR, main.py:863-872)
  const anahtar = Math.trunc(frm!)
  // 🔴 FİKS 04.09: bu R2.get try/catch'siz'di; R2'nin geçici iç hatası (10001) yakalanmamış
  // istisna olarak 500'e dönüşüyordu. Ölçüldü 22:34:28 — telefon iz alamadı, video üretemedi.
  // Geçici arıza artık 503 + "tekrar dene": istemci geri çekilip yeniden dener, 500 gürültüsü yok.
  let obj: R2ObjectBody | null = null
  try {
    obj = await c.env.R2.get(`tracks/${anahtar}.json`)
  } catch (e) {
    console.error('tracks R2.get hatasi:', String(e).slice(0, 200))
    hata(503, 'depolama gecici olarak erisilemiyor, tekrar dene')
  }
  if (obj) {
    const pts = await obj.json<Record<string, any>[]>()
    const row = await c.env.DB
      .prepare("SELECT COALESCE(NULLIF(uid,''), ?2) AS o FROM rides WHERE uploaded = 1 AND ts = ?1 LIMIT 1")
      .bind(anahtar, BARIS_UID).first<{ o: string }>()
    const sahibi = row ? row.o : BARIS_UID   // detected kaydı yoksa Barış sayılır (main.py:870 _own or BARIS)
    if (sahibi !== user) hata(404, 'iz bulunamadi')
    return c.json({ points: pts.map((p) => ({ lat: p.lat, lon: p.lon, spd: p.spd || 0 })) })
  }

  // 2) cihaz izi: Traccar yerine D1 positions (cf_mapping) — spd KNOT saklanır,
  //    main.py:891 gibi ×1.852 → km/h burada çevrilir
  const u = await c.env.DB.prepare('SELECT tracker_id FROM users WHERE uid = ?1')
    .bind(user).first<{ tracker_id: string | null }>()
  const devid = u?.tracker_id
  if (!devid) hata(503, "cihaz Traccar'da yok")
  const res = await c.env.DB
    .prepare('SELECT ts, lat, lon, spd, alt FROM positions WHERE device = ?1 AND ts >= ?2 AND ts <= ?3 ORDER BY ts')
    .bind(devid, Math.floor(frm!), Math.floor(to!)).all<Record<string, any>>()
  // 🔴 FİKS 05.09: her iki dal da HAM okuyordu → çöp koordinat (41,29) telefon motoruna ve
  // yol-eşlemeye kadar gidiyordu (motor3d/iz.ts'te süzgeç vardı, BU yolda yoktu).
  const rows = izSuz<Record<string, any> & { lat: number; lon: number; t: number }>(
    res.results.map((p) => ({
      ...p, lat: Number(p.lat), lon: Number(p.lon), t: Math.trunc(Number(p.ts ?? 0)),
    })))

  if (detay) {
    // TELEFON MOTORU: HAM iz + t/alt/hr (main.py:884-895) — t epoch, alt null olabilir.
    // hr: positions'ta nabız YOK (telefon GPS ingest'e göndermiyor) → üretimdeki
    // attributes.heartRate eşleniği hep null (nabız /api/live/hr-report yolunda yaşar).
    return c.json({
      points: rows.map((p) => ({
        lat: p.lat, lon: p.lon, spd: round1((Number(p.spd) || 0) * 1.852),
        t: int_(p.ts), alt: p.alt ?? null, hr: null,
      })),
    })
  }
  const ham = rows.map((p) => ({ lat: Number(p.lat), lon: Number(p.lon), spd: round1((Number(p.spd) || 0) * 1.852) }))
  return c.json({ points: await yolEsle(c.env, ham) })
})

type Nokta = { lat: number; lon: number; spd: number }

/** haversine metre (main.py:911-914). */
function hav(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = Math.PI / 180
  const la1 = a.lat * r, lo1 = a.lon * r, la2 = b.lat * r, lo2 = b.lon * r
  const h = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}

/** main.py _yol_esle (904-964) birebir portu — matching HARITA_UC üzerinden (kural 4). */
async function yolEsle(env: Env, raw: Nokta[]): Promise<{ lat: number; lon: number; spd?: number }[]> {
  const onek = env.HARITA_UC
  if (!onek || raw.length < 8) return raw
  // 25m seyreltme (909-918)
  const sey: Nokta[] = [raw[0]]
  for (const p of raw.slice(1)) if (hav(sey[sey.length - 1], p) >= 25) sey.push(p)
  if (sey.length < 8) return raw
  const ort = sey.reduce((s, p) => s + p.spd, 0) / sey.length
  const prof = ort >= 23 ? 'driving' : ort >= 10 ? 'cycling' : 'walking'
  const esli: { lat: number; lon: number; spd?: number }[] = []
  try {
    let i = 0
    while (i < sey.length - 1) {
      const seg = sey.slice(i, i + 80)
      if (seg.length < 2) break
      const coords = seg.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';')
      const params = new URLSearchParams({
        geometries: 'geojson', overview: 'full', tidy: 'true',
        radiuses: seg.map(() => '32').join(';'),
      })
      // Python httpx timeout=30 eşleniği — aşım istisnası dış catch'e düşer → HAM iz (birebir)
      const rr = await fetch(`${onek}/matching/v5/mapbox/${prof}/${coords}?${params}`,
        { signal: AbortSignal.timeout(30_000) })
      // Python: 200 + bozuk JSON → istisna → tüm eşleme iptal, HAM döner (dış except) — aynen
      const d: Record<string, any> = rr.status === 200 ? await rr.json() : {}
      if (d.code === 'Ok' && d.matchings) {
        for (const m of d.matchings) for (const cc of m.geometry.coordinates) esli.push({ lat: cc[1], lon: cc[0] })
      } else {
        for (const p of seg) esli.push({ lat: p.lat, lon: p.lon })   // dilim tutmadı → ham
      }
      i += 79   // 1 nokta bindirme
    }
  } catch {
    return raw
  }
  if (esli.length < 8) return raw
  // >120m boşlukta ham iz köprüsü (947-957)
  const argmin = (hedef: { lat: number; lon: number }): number => {
    let en = 0, enD = Infinity
    for (let k = 0; k < sey.length; k++) { const dd = hav(sey[k], hedef); if (dd < enD) { enD = dd; en = k } }
    return en
  }
  const kopruli: { lat: number; lon: number; spd?: number }[] = [esli[0]]
  for (const p of esli.slice(1)) {
    if (hav(kopruli[kopruli.length - 1], p) > 120) {
      const a = argmin(kopruli[kopruli.length - 1])
      const b = argmin(p)
      if (b > a + 1) for (const q of sey.slice(a + 1, b)) kopruli.push({ lat: q.lat, lon: q.lon })
    }
    kopruli.push(p)
  }
  // hızları en yakın ham noktadan aktar — tek yönlü işaretçi (958-963)
  let ri = 0
  for (const p of kopruli) {
    while (ri < sey.length - 1 && hav(sey[ri + 1], p) <= hav(sey[ri], p)) ri++
    p.spd = sey[ri].spd
  }
  return kopruli
}

// ---------------------------------------------------------------------------
// POST /api/videos/upload (main.py:1211-1240)
// DİKKAT (sözleşme): Workers tek-istek gövde limiti plana bağlı (100-500MB) — 200MB tavan
// limiti aşarsa istek Worker'a hiç ulaşmadan kesilir; Faz sonrası R2 presigned PUT düşünülür.
// ---------------------------------------------------------------------------
g.post('/api/videos/upload', authUser, async (c) => {
  const user = c.get('user')
  const q = c.req.query()
  const ts = int_(Number(q.ts ?? 0))
  const to = int_(Number(q.to ?? 0))
  if (!ts) hata(400, 'ts eksik')
  const buf = new Uint8Array(await c.req.arrayBuffer())
  if (buf.length < 50_000 || buf.length > 200 * 1024 * 1024) hata(400, 'geçersiz video boyutu')
  if (!(buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70)) hata(400, 'mp4 değil')  // b'ftyp'
  const day = trGunu(ts)
  const now = simdi()
  const rid = `${day}_${ts}_${now}`   // ÜÇ parçalı vid — rid'i PARSE ETME (main.py:314 notu)
  try {
    await c.env.R2.put(`videos/${rid}.mp4`, buf, { httpMetadata: { contentType: 'video/mp4' } })
  } catch (e) {
    // 🔴 FİKS 04.09: 503 dönüyordu ama HİÇBİR YERDE İZ KALMIYORDU — telefon işi yerel kuyrukta
    // öylece kalıyor, kullanıcı ne video ne hata görüyordu (ölçüldü 22:34:28, Semra).
    // Artık failed_videos'a düşer; yerelq-bekcisi de 6 saat sonra işi buluta devreder.
    console.error('video upload R2.put hatasi:', String(e).slice(0, 200))
    try {
      await c.env.DB.prepare(
        `INSERT INTO failed_videos (vid, uid, reason, failed_at, date, ts, to_ts, mode, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?4, ?4)
         ON CONFLICT(vid) DO UPDATE SET reason = excluded.reason, failed_at = excluded.failed_at,
                                        updated_at = excluded.updated_at`)
        .bind(rid, user, 'telefon yuklemesi: R2 put hatasi', now, day, ts, ts, 'yerel').run()
    } catch { /* iz bırakılamadı; asıl hata aşağıda döner */ }
    hata(503, 'depolama hazır değil')
  }
  // cloud_videos kaydı → videos satırı. NOT: kaynaktaki 'local':true bayrağına şemada kolon YOK
  // (0001_init.sql) — hiçbir okuyucu filtrelemiyor; gerekirse 0002'de kolon (dönüş notuna yazıldı).
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO videos (rid, uid, r2_key, date, ts, to_ts, ride_type, mode, speed, aspect, size, done_at, is_group, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?12, ?12)
       ON CONFLICT(rid) DO UPDATE SET uid=?2, r2_key=?3, date=?4, ts=?5, to_ts=?6, ride_type=?7,
         mode=?8, speed=?9, aspect=?10, size=?11, done_at=?12, is_group=?13, updated_at=?12`)
      .bind(rid, user, `videos/${rid}.mp4`, day, ts, to,
        q.type ?? 'moto', q.mode ?? 'flyover', q.speed ?? 'medium', q.aspect ?? '9:16',
        buf.length, now, q.grup === '1' ? 1 : 0),   // 05.11: telefonda üretilen ORTAK sürüş videosu
    // silinmiş geziyi yeniden üretti → tekrar görünür (main.py:1236-1238)
    c.env.DB.prepare('DELETE FROM deleted_rides WHERE rid = ?1').bind(rid),
    // 🔴 FİKS 05.09: telefon işi buluttaki "Hazırlanıyor" kilidini AÇMIYORDU. Yerel kuyruğun
    // ride_id'si iki parçalı (`{gün}_{ts}`), yükleme üç parçalı yeni rid üretiyor → pending
    // satırı ortada kalıyor, pending-reconcile 90 dk sonra "render tamamlanamadı" diye HATA
    // kartına çeviriyordu (kullanıcı videoyu almış olmasına rağmen).
    c.env.DB.prepare('DELETE FROM pending_videos WHERE vid = ?1 OR vid = ?2').bind(rid, `${day}_${ts}`),
    c.env.DB.prepare('DELETE FROM failed_videos WHERE vid = ?1 OR vid = ?2').bind(rid, `${day}_${ts}`),
  ])
  // 🔴 GERİ ALINDI 05.09 (Barış: "telefonda gözümün önünde ürettiğim klibin bildirim yollaması
  // saçma"). Bugün buraya bildirim eklemiştim; yanlıştı. GEREKÇE: telefon render'ı YALNIZCA
  // uygulama ÖN PLANDAYKEN çalışabiliyor — arka plana düşerse WKWebView snapshot'ları boş döner
  // ve `ArkaPlanGozcu` üretimi iptal eder (WebRouteVideo.swift). Yani telefonda üretim biten
  // kullanıcı HER ZAMAN ekrana bakıyordur; üstelik istemci bitince `store.jumpToVideos = true`
  // ile onu videoya götürüyor. Bildirim saf gürültü.
  // Bulut yolu farklı: orası gerçekten eşzamansız, orada bildirim KALIYOR (ic.ts / grup3.ts).
  try {
    // bu iş bitti → yerel kuyruktan SADECE bu kaydı düş (liste başka işler taşıyabilir)
    const ham = await c.env.KV.get(`yerelq:${user}`)
    if (ham) {
      const lst = (JSON.parse(ham) as Array<Record<string, unknown>>)
        .filter((x) => Math.trunc(Number(x.from ?? 0)) !== ts)
      await c.env.KV.put(`yerelq:${user}`, JSON.stringify(lst))
    }
  } catch { /* kuyruk temizlenemedi; yerelq-bekcisi 6 saat sonra devralır */ }
  return c.json({ ok: true, vid: rid })
})

// ---------------------------------------------------------------------------
// GET /api/activities (main.py:1271-1273 + list_activities 463-528)
// Özet dosyaları (ACT_DIR/*_ozet.txt) → D1 'activities' tablosu (sözleşme cf_mapping).
// ⚠️ Tablo 0001_init.sql'de HENÜZ YOK — sorgu savunmalı: tablo yoksa boş liste döner
// (üreten taraf movelog-cron Faz 3; dönüş notuna yazıldı). Beklenen şema:
//   activities(id TEXT PK, uid TEXT NOT NULL, day TEXT, summary TEXT, created_at INT, updated_at INT)
// uid kolonu NOT NULL → 08-13 gizlilik fiksi (sahipsiz özet KİMSEYE görünmez) sınıf olarak çözülür.
// ---------------------------------------------------------------------------
g.get('/api/activities', authUser, async (c) => {
  const user = c.get('user')
  const rides = await listRides(c.env, user)
  // günlük kart aralıkları (466-476)
  const spanByDate: Record<string, [number, number]> = {}
  for (const r of rides) {
    const d = String(r.date); const frm = int_(r.ts); const t = int_(r.to)
    if (!frm) continue
    const s = spanByDate[d]
    if (!s) spanByDate[d] = [frm, t || frm]
    else { s[0] = Math.min(s[0], frm); s[1] = Math.max(s[1], t || frm) }
  }
  let satirlar: Record<string, any>[] = []
  try {
    satirlar = (await c.env.DB
      .prepare('SELECT day, summary FROM activities WHERE uid = ?1 ORDER BY created_at DESC')
      .bind(user).all<Record<string, any>>()).results
  } catch (e) {
    // 🔴 04.09: bu catch 4+ gün boyunca "no such table: activities" hatasını YUTTU → uç 200 + boş
    // liste döndü, ekran bomboş kaldı ve hiçbir yerde iz kalmadı. Tablo artık var (migration 0005);
    // yine de savunmalı kalıyor ama SESSİZ DEĞİL: hata worker log'una düşer.
    console.error('activities okunamadi:', String(e).slice(0, 200))
    satirlar = []
  }
  const out: Record<string, unknown>[] = []
  for (const row of satirlar) {
    const day = String(row.day ?? '')
    const text = String(row.summary ?? '').trim()
    let [frm, to] = parseRangeName(day)   // aralık kartı? (507)
    if (frm === null) {                   // günlük kart → o günün rides aralığı (508-518)
      const sp = spanByDate[day]
      if (sp) { frm = sp[0]; to = sp[1] } else {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
        if (m && gecerliGun(+m[1], +m[2], +m[3])) {
          frm = Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 1000) - 3 * 3600   // TR gece yarısı
          to = frm + 86399
        }
      }
    }
    // pencereye düşen EN YENİ gerçek video (novideo/rendering hariç; ±90sn — 519-525)
    let vid: string | null = null
    if (frm && to) {
      let enYeni: Record<string, any> | null = null
      for (const r of rides) {
        if (r.novideo || r.rendering) continue
        const rts = int_(r.ts)
        if (frm - 90 <= rts && rts <= to + 90 && (!enYeni || rts > int_(enYeni.ts))) enYeni = r
      }
      if (enYeni) vid = String(enYeni.id)
    }
    out.push({ date: day, summary: text || '(özet metni yok)', video_id: vid, from: frm, to })
  }
  return c.json({ activities: out })
})

/** Gerçek takvim günü mü? (Python datetime ValueError eşleniği — Date.UTC taşmayı sessizce yuvarlar) */
function gecerliGun(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/** main.py _parse_range_name (429-442): 'DD-MM-YYYY_HHMM_-_HHMM' → [from,to] TR; değilse [null,null]. */
function parseRangeName(day: string): [number | null, number | null] {
  const m = /^(\d{2})-(\d{2})-(\d{4})_(\d{2})(\d{2})_-_(\d{2})(\d{2})$/.exec(day)
  if (!m) return [null, null]
  const [dd, mm, yy, h1, mi1, h2, mi2] = m.slice(1).map(Number)
  if (!gecerliGun(yy, mm, dd) || h1 > 23 || h2 > 23 || mi1 > 59 || mi2 > 59) return [null, null]
  const f = Math.floor(Date.UTC(yy, mm - 1, dd, h1, mi1) / 1000) - 3 * 3600   // TR = UTC+3
  let t = Math.floor(Date.UTC(yy, mm - 1, dd, h2, mi2) / 1000) - 3 * 3600
  if (t <= f) t += 86400   // gece yarısını geçen aralık
  return [f, t]
}

// ---------------------------------------------------------------------------
// GET /api/gps/live (main.py:1276-1312) — Traccar yerine D1 positions
// 503 'traccar yapılandırılmadı' / 502 'traccar erişilemedi' D1 dünyasında OLUŞMAZ (cf_mapping).
// ---------------------------------------------------------------------------
g.get('/api/gps/live', authUser, async (c) => {
  const user = c.get('user')
  // GİZLİLİK (2026-07-09): yalnız kendisi + arkadaşları (1295-1303)
  const fr = (await c.env.DB.prepare('SELECT friend_uid FROM friends WHERE uid = ?1')
    .bind(user).all<{ friend_uid: string }>()).results
  const gorunur = [user, ...fr.map((r) => r.friend_uid)]
  const ph = gorunur.map((_, i) => `?${i + 1}`).join(',')
  const rows = (await c.env.DB.prepare(
    `SELECT u.uid, u.name, u.avatar_json, p.lat, p.lon, p.spd, p.ts
       FROM users u JOIN positions p ON p.device = u.tracker_id
      WHERE u.uid IN (${ph}) AND u.tracker_id IS NOT NULL
        AND p.ts = (SELECT MAX(ts) FROM positions WHERE device = u.tracker_id)`)
    .bind(...gorunur).all<Record<string, any>>()).results
  const now = simdi()
  const out = rows.map((r) => {
    let avatar: unknown = null
    if (r.avatar_json) { try { avatar = JSON.parse(String(r.avatar_json)) } catch { avatar = null } }
    return {
      device: (r.name as string) || String(r.uid),   // Traccar cihaz adı /api/tracker'da name||uid ile açılıyordu — aynı yedek
      avatar,                                        // {"type","value"} veya null
      lat: r.lat, lon: r.lon,
      speed_kmh: round1((Number(r.spd) || 0) * 1.852),  // positions.spd KNOT — main.py:1308 gibi ×1.852
      time: new Date(int_(r.ts) * 1000).toISOString(),
      online: now - int_(r.ts) < 300,                // Traccar status=='online' → yaş<5dk eşiği (cf_mapping)
    }
  })
  return c.json({ positions: out })
})

// ---------------------------------------------------------------------------
// GET /api/stats (main.py:1315-1322)
// ---------------------------------------------------------------------------
g.get('/api/stats', authUser, async (c) => {
  const rides = await listRides(c.env, c.get('user'))
  const byType: Record<string, number> = {}
  for (const r of rides) {
    const k = (r.type as string) || 'diğer'   // boş tip → 'diğer' (UTF-8 Türkçe anahtar — birebir)
    byType[k] = (byType[k] ?? 0) + 1
  }
  return c.json({ total_rides: rides.length, by_type: byType, latest: rides[0] ?? null })
})

// ---------------------------------------------------------------------------
// POST /api/feedback (main.py:1430-1447)
// ---------------------------------------------------------------------------
g.post('/api/feedback', authUser, async (c) => {
  const user = c.get('user')
  const body = await govde(c)
  const text = String(body.text ?? '').trim().slice(0, 1000)
  if (text.length < 3) hata(400, 'boş fikir')
  if (!(await rateOk(c.env, 'feedback:' + user, 5, 86400))) hata(429, 'bugünlük bu kadar fikir yeter :)')
  const p = await getUser(c.env.DB, user)
  const ad = p?.name || ''
  const kulp = p?.handle || ''
  const lang = p?.lang || reqLang(c)
  const ts = simdi()
  const hx = new Uint8Array(4); crypto.getRandomValues(hx)
  const id = `fb_${ts}_${[...hx].map((b) => b.toString(16).padStart(2, '0')).join('')}`
  await c.env.DB.prepare(
    'INSERT INTO feedbacks (id, uid, name, handle, lang, text, ts, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?7,?7)')
    .bind(id, user, ad, kulp, lang, text, ts).run()
  const kim = (ad || user.slice(0, 10)) + (kulp ? ` (@${kulp})` : '')
  await adminq(c.env, `💡 FİKİR — ${kim} [${lang}]:\n${text}`)
  return c.json({ ok: true })
})

// ---------------------------------------------------------------------------
// POST /api/redeem (main.py:1450-1466) — D1'de ATOMİK (dosya+flock serileştirmesi yok)
// ---------------------------------------------------------------------------
g.post('/api/redeem', authUser, async (c) => {
  const user = c.get('user')
  const body = await govde(c)
  const code = String(body.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')   // _CODE_RE (1427)
  if (code.length < 6) hata(400, 'geçersiz kod')
  const rec = await c.env.DB.prepare('SELECT used_by FROM gift_codes WHERE code = ?1')
    .bind(code).first<{ used_by: string | null }>()
  if (!rec) hata(404, 'kod bulunamadı')
  if (rec.used_by && rec.used_by !== user) hata(409, 'kod zaten kullanılmış')   // aynı kullanıcı → idempotent 200
  const now = simdi()
  // yarış koruması: iki kullanıcı aynı anda — yalnız used_by boş/kendisiyken yazılır.
  // Python falsy kuralı: used_by = '' de "kullanılmamış" sayılır (rec.get("used_by") falsy, main.py:1460).
  const upd = await c.env.DB.prepare(
    "UPDATE gift_codes SET used_by = ?1, used_at = ?2, updated_at = ?2 WHERE code = ?3 AND (used_by IS NULL OR used_by = '' OR used_by = ?1)")
    .bind(user, now, code).run()
  if (!(upd.meta.changes ?? 0)) hata(409, 'kod zaten kullanılmış')
  await c.env.DB.prepare(
    `INSERT INTO users (uid, premium, created_at, updated_at) VALUES (?1, 1, ?2, ?2)
     ON CONFLICT(uid) DO UPDATE SET premium = 1, updated_at = ?2`)
    .bind(user, now).run()   // profiles setdefault eşleniği (satır yoksa açılır)
  return c.json({ ok: true, premium: true })
})

// ---------------------------------------------------------------------------
// POST /api/auth/signout-all (main.py:1860-1868) — tv bump; authUser HER istekte D1'den okur,
// izolat cache'i yok → _tv_cache sıfırlama adımının eşleniği gerekmez.
// ---------------------------------------------------------------------------
g.post('/api/auth/signout-all', authUser, async (c) => {
  const now = simdi()
  await c.env.DB.prepare(
    `INSERT INTO users (uid, tv, created_at, updated_at) VALUES (?1, 1, ?2, ?2)
     ON CONFLICT(uid) DO UPDATE SET tv = tv + 1, updated_at = ?2`)
    .bind(c.get('user'), now).run()
  return c.json({ ok: true })
})

// ---------------------------------------------------------------------------
// GET /api/mapconfig — auth YOK (main.py:1878-1883); KV 'mapconfig' ne içeriyorsa AYNEN
// ---------------------------------------------------------------------------
g.get('/api/mapconfig', async (c) => {
  try {
    const v = await c.env.KV.get('mapconfig', 'json')
    if (v !== null) return c.json(v as Record<string, unknown>)
  } catch { /* bozuk/erişilemedi → sessiz varsayılan (dosya davranışı) */ }
  return c.json({ tiles: '', attribution: '' })
})

// ---------------------------------------------------------------------------
// GET /api/announcement — auth YOK (main.py:1886-1891); config tablosu 'announcement'
// ---------------------------------------------------------------------------
g.get('/api/announcement', async (c) => {
  let a: Record<string, any> = {}
  try {
    const row = await c.env.DB.prepare("SELECT value_json FROM config WHERE key = 'announcement'")
      .first<{ value_json: string }>()
    if (row) a = JSON.parse(row.value_json) ?? {}
  } catch { a = {} }
  if (!a.active) return c.json({ announcement: null })   // kayıt silinmez, gizlenir; active DIŞARI verilmez
  return c.json({ announcement: { title: a.title ?? null, body: a.body ?? null, url: a.url ?? null, ts: a.ts ?? null } })
})

// ---------------------------------------------------------------------------
// POST /api/pushtoken (main.py:1980-2032)
// ---------------------------------------------------------------------------

// 12 dilde hoş geldin metni (main.py:2011-2024 birebir)
const HOSGELDIN: Record<string, string> = {
  tr: 'Hoş geldin! Sürüşlerin kendiliğinden videoya dönüşür — telefon cebindeyken bile',
  en: 'Welcome! Your rides turn into cinematic videos on their own — even with your phone in your pocket',
  de: 'Willkommen! Deine Fahrten werden von selbst zu Videos — sogar mit dem Handy in der Tasche',
  fr: 'Bienvenue ! Tes trajets deviennent des vidéos tout seuls — même le téléphone en poche',
  es: '¡Bienvenido! Tus rutas se convierten solas en vídeos — incluso con el móvil en el bolsillo',
  it: 'Benvenuto! I tuoi giri diventano video da soli — anche col telefono in tasca',
  pt: 'Bem-vindo! Suas viagens viram vídeos sozinhas — mesmo com o celular no bolso',
  ru: 'Добро пожаловать! Ваши поездки сами превращаются в видео — даже когда телефон в кармане',
  ja: 'ようこそ！走行が自動で動画になります — スマホがポケットの中でも',
  ko: '환영합니다! 주행이 저절로 영상이 됩니다 — 휴대폰이 주머니에 있어도',
  zh: '欢迎！你的骑行会自动变成视频——即使手机在口袋里',
  ar: 'أهلاً بك! تتحول رحلاتك تلقائيًا إلى فيديوهات — حتى والهاتف في جيبك',
}

g.post('/api/pushtoken', authUser, async (c) => {
  const user = c.get('user')
  const body = await govde(c)
  const t = String(body.token ?? '').trim()
  if (!t) hata(400, 'token yok')
  const plat = ['android', 'fcm'].includes(String(body.platform ?? '').toLowerCase()) ? 'fcm' : 'apns'
  const now = simdi()
  const u = await getUser(c.env.DB, user)
  const isler = [
    // profiles setdefault eşleniği
    c.env.DB.prepare('INSERT OR IGNORE INTO users (uid, created_at, updated_at) VALUES (?1, ?2, ?2)').bind(user, now),
    // GİZLİLİK (2026-07-26): token GLOBALDE tek hesap — PK üzerinden çapraz temizlik tek deyimde
    // (dosyadaki O(n) profil taraması 1992-1998'in şematik eşleniği)
    c.env.DB.prepare(
      `INSERT INTO push_tokens (token, uid, platform, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)
       ON CONFLICT(token) DO UPDATE SET uid = ?2, platform = ?3, updated_at = ?4`)
      .bind(t, user, plat, now),
    // kişi+platform başına EN YENİ 5 token (1999-2003: >5 → en eski atılır)
    c.env.DB.prepare(
      `DELETE FROM push_tokens WHERE uid = ?1 AND platform = ?2 AND token NOT IN
       (SELECT token FROM push_tokens WHERE uid = ?1 AND platform = ?2 ORDER BY updated_at DESC, token DESC LIMIT 5)`)
      .bind(user, plat),
  ]
  await c.env.DB.batch(isler)
  if (!u?.welcomed) {
    // HOŞ GELDİN PUSH'U: bir kez (2004-2030); pushq dosyası → KV 'push:bekleyen:*' (kural 3, Faz 3'te gerçek APNs/FCM).
    // TAM-BİR-KEZ: koşullu UPDATE'i kazanan TEK istek KV kaydını düşer (orijinal tek süreç + dosya
    // kilidiyle serileşiyordu; eşzamanlı iki ilk-kayıtta çift welcome push olmasın — denetim fiksi 08-30).
    const w = await c.env.DB.prepare(
      'UPDATE users SET welcomed = ?2, updated_at = ?2 WHERE uid = ?1 AND (welcomed IS NULL OR welcomed = 0)')
      .bind(user, now).run()
    if (w.meta.changes ?? 0) {
      try {
        const lng = u?.lang || 'en'
        await c.env.KV.put(`push:bekleyen:welcome_${user}_${now}`,
          JSON.stringify({ user, title: 'Move Log 🏍️', body: HOSGELDIN[lng] ?? HOSGELDIN.en }),
          { expirationTtl: 7 * 86400 })   // FİKS 05.09: TTL yoktu
      } catch { /* orijinaldeki gibi yutulur (2029) */ }
    }
  }
  return c.json({ ok: true })
})

// ---------------------------------------------------------------------------
// POST /api/trackdebug (main.py:2035-2047) — state_json.trackdbg TEK DEYİM json_set
// ---------------------------------------------------------------------------
g.post('/api/trackdebug', authUser, async (c) => {
  const user = c.get('user')
  const body = await govde(c)
  const now = simdi()
  await c.env.DB.prepare('INSERT OR IGNORE INTO users (uid, created_at, updated_at) VALUES (?1, ?2, ?2)')
    .bind(user, now).run()   // profiles setdefault eşleniği
  await jsonSet(c.env.DB, user, 'state_json', 'trackdbg', {
    auth: body.auth ?? null, precise: body.precise ?? null,
    recv: body.recv ?? null, sent: body.sent ?? null, acc: body.acc ?? null,
    err: String(body.err ?? '').slice(0, 200),
    active: body.active ?? null, recording: body.recording ?? null, idle: body.idle ?? null,
    ts: now,
  })
  return c.json({ ok: true })
})

// ---------------------------------------------------------------------------
// GET /api/tracker (main.py:2724-2745)
// Traccar cihaz-oluşturma adımı KALKTI (cf_mapping): movelog-gps ingest uniqueId'yi
// users.tracker_id ile eşler, ön-kayıt gerekmez. Orijinal de Traccar hatalarını yutup
// hep 200 döndüğünden gölge diffte fark yaratmaz (sözleşme notu 08-30).
// ---------------------------------------------------------------------------
g.get('/api/tracker', authUser, async (c) => {
  const user = c.get('user')
  const now = simdi()
  const u = await c.env.DB.prepare('SELECT tracker_id FROM users WHERE uid = ?1')
    .bind(user).first<{ tracker_id: string | null }>()
  let devid = u?.tracker_id || ''
  if (!devid) {
    // deterministik 8 hane: sha256(user) % 90000000 + 10000000 (main.py:2732) — mevcut cihazlar aynı id
    const dg = await crypto.subtle.digest('SHA-256', enc.encode(user))
    const hex = [...new Uint8Array(dg)].map((b) => b.toString(16).padStart(2, '0')).join('')
    devid = String(BigInt('0x' + hex) % 90000000n + 10000000n)
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT OR IGNORE INTO users (uid, created_at, updated_at) VALUES (?1, ?2, ?2)').bind(user, now),
      // Python falsy kuralı (main.py:2731 `if not devid`): '' de "yok" sayılır — yazım onu da kapsasın,
      // yoksa yanıt deviceId verirken users.tracker_id boş kalır ve GPS ingest eşleşmesi kopar.
      c.env.DB.prepare("UPDATE users SET tracker_id = ?2, updated_at = ?3 WHERE uid = ?1 AND (tracker_id IS NULL OR tracker_id = '')")
        .bind(user, devid, now),
    ])
  }
  // TUZAK (sözleşme): url sahadaki TÜM istemcilerin hedefi — Faz 4 DNS geçişine dek sabit kalır
  return c.json({ deviceId: devid, url: 'https://gpsdata.nickdegs.com' })
})

// ---------------------------------------------------------------------------
// POST /api/invite (main.py:4005-4011)
// ---------------------------------------------------------------------------
g.post('/api/invite', authUser, async (c) => {
  const user = c.get('user')
  const b = new Uint8Array(8)
  crypto.getRandomValues(b)
  const tok = b64uEncode(b)   // secrets.token_urlsafe(8) eşleniği — 11 karakter url-safe
  const now = simdi()
  await c.env.DB.prepare('INSERT INTO invites (code, by_uid, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)')
    .bind(tok, user, now).run()
  return c.json({ token: tok, link: `https://app.nickdegs.com/?invite=${tok}` })
})

// ---------------------------------------------------------------------------
// POST /api/invite/accept (main.py:4014-4028)
// Token TÜKETİLMEZ (viral tasarım); self-accept → friends yazılmaz ama 200 + kendi profili.
// ---------------------------------------------------------------------------
g.post('/api/invite/accept', authUser, async (c) => {
  const user = c.get('user')
  const body = await govde(c)
  const tok = String(body.token ?? '')
  const inv = await c.env.DB.prepare('SELECT by_uid FROM invites WHERE code = ?1')
    .bind(tok).first<{ by_uid: string }>()
  if (!inv) hata(404, 'geçersiz davet')
  const diger = inv.by_uid
  if (diger !== user) {
    const now = simdi()
    await c.env.DB.batch([   // iki yönlü, idempotent (OR IGNORE — 'yoksa ekle' 4024-4026)
      c.env.DB.prepare('INSERT OR IGNORE INTO friends (uid, friend_uid, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)')
        .bind(user, diger, now),
      c.env.DB.prepare('INSERT OR IGNORE INTO friends (uid, friend_uid, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)')
        .bind(diger, user, now),
    ])
  }
  return c.json({ ok: true, friend: await profileOf(c.env, diger) })
})

export default g
