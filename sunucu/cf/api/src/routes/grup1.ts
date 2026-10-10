// grup1 — api/rides (10 uç) — main.py birebir portu (sözleşme: cf/contracts/grup1.json)
//
// Kapsanan uçlar:
//   GET    /api/rides                       (main.py:840  + list_rides 251-404)
//   DELETE /api/rides/{ride_id}             (main.py:845)
//   GET    /api/rides/{ride_id}/video       (main.py:1012 + _r2_akit 967)
//   GET    /api/rides/{ride_id}/videourl    (main.py:1031)
//   POST   /api/rides/music                 (main.py:2055)
//   POST   /api/rides/photo                 (main.py:2204)
//   POST   /api/rides/{ride_id}/type        (main.py:2228)
//   POST   /api/rides/upload                (main.py:2435 + _parse_route_file 2367)
//   POST   /api/rides/generate              (main.py:2512 + _bump_daily_cap 2273)
//   POST   /api/rides/{ride_id}/regenerate  (main.py:2636)
//
// SAPMA NOTLARI (gölge-diff işaretleri):
//   1) list_rides yerel ROUTES_DIR/tcx/yan-meta dalları KALKTI (cf_mapping: Barış'ın yerel
//      render'ları import'ta videos kaydına çevrilir) — Worker yalnız D1 koleksiyonlarını görür.
//   2) /videourl: R2 S3 kimlikleri (R2_ENDPOINT/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY[/R2_BUCKET]
//      opsiyonel secret) yoksa presign yapılamaz → cv varsa göreli '/api/rides/{id}/video'
//      döner (sözleşmedeki yerel-yedek yanıt biçimi; alan kümesi aynı: {url}).
//   3) generate/regenerate cihaz çözümü (02.09 SUNUCU BAĞIMSIZ): önce D1 positions (tracker_id'nin
//      izi varsa cihaz var), Traccar (TRACCAR_USER/PASS[/URL] secret'ları, sunucu) yalnız D1'de hiç
//      iz yoksa yedek; o da yoksa orijinalin davranışı = 503 "cihaz Traccar'da bulunamadı".
//   4) regenerate'e sözleşme notunun EMRİYLE sahiplik (IDOR) kontrolü EKLENDİ (orijinalde yok):
//      _ride_owner != user → 404 "rota bulunamadi". Gölge diff'te davranış farkı olarak işaretli.
//   5) Kuyruk mesajı 120KB'ı aşarsa (gömülü GPX izi — Queues sınırı 128KB) req R2'ye
//      `genreq/{user}_{ts}.json` yazılır ve kuyruğa {genreq_r2,user,ts,vid} işaretçisi gönderilir.
//      movelog-dispatch tüketicisi bu işaretçiyi tanımalı (dönüş notunda bildirildi).
//   6) /api/rides/photo meta'sı D1 'photos' tablosuna DEĞİL (şemada yok) orijinaldeki gibi
//      R2 ridephotos/{user}_{session}/photos.json dizisine yazılır — davranış birebir
//      (count = dizi uzunluğu). 'photos' tablosu 0003 migration'ıyla gelirse geçilebilir.
//   7) render_counts gün/ay anahtarları: main.py time.localtime() (sunucu TZ = Europe/Berlin,
//      CEST) kullanır; Worker'da sunucu TZ'i yok → sabit TR günü (UTC+3, vid/upload ile aynı).
//      Gece 00:00 TR ile 00:00 CEST arasındaki 1-2 saatlik pencerede sayaç anahtarı orijinalden
//      farklı güne düşebilir (gölge-diff'te render_counts yazımlarında görülebilir; davranışsal
//      etki yalnız gün-sınırı anındaki limit/bütçe sıfırlama saatidir).

import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv, Env } from '../lib/env'
import { authUser } from '../lib/auth'
import { BARIS_UID, etkinSahip, getUser, ornekMi, simdi } from '../lib/db'
import { hata } from '../lib/hata'
import { aylikButceLimit, modMaliyet } from '../../../ortak/src/maliyet'

const g = new Hono<AppEnv>()

// Opsiyonel ek sırlar (wrangler secret put; env.ts'e DOKUNMADAN yerel genişletme):
type ExtEnv = Env & {
  R2_ENDPOINT?: string; R2_ACCESS_KEY_ID?: string; R2_SECRET_ACCESS_KEY?: string; R2_BUCKET?: string
  TRACCAR_URL?: string; TRACCAR_USER?: string; TRACCAR_PASS?: string
}

// ---------- sabitler (main.py eşlenikleri) ----------
const TYPE_EMOJI: Record<string, string> = { moto: '🏍️', car: '🚗', bike: '🚲', run: '🏃', walk: '🚶' }
// App Store inceleme hesapları — üretim tavanlarından muaf (bkz. bumpDailyCap ve dispatch).
// Aynı liste cron/gorevler/premium-suresi.ts DOKUNMA kümesiyle bilinçli olarak eşleşir.
export const INCELEME = new Set(['appreview', 'appreview2'])

// 🔴 05.09: ÜÇÜ DE 0 (= ölü) idi. İki sonucu vardı: (1) tek bir günde aylık payın tamamı
// yanabiliyordu, (2) $1,99'luk `boost` ürünü ("günlük limitin 2 katına çıkar") HİÇBİR ŞEY
// vermiyordu — `mult` çarpanı yalnız bu sabitlerle kullanılıyor, sıfırla çarpılınca etkisiz.
// D1'de 1 adet boost satın alımı var (Barış, 31.08) ve karşılığında hiçbir şey almamış.
// 🔴 DÜZELTME (adversaryel doğrulama): 3 YANLIŞTI — ölçülen günlük zirve **5** (Semra 09-04 ve
// Barış 09-05, ikisi de). Tavan zirvenin ALTINA konmaz; 3 olsaydı bu hafta iki kez gerçek
// kullanımı keserdi. Asıl amaç maliyet değil, `boost` ürününü işlevli kılmak.
const DAILY_VIDEO_CAP = 15                  // düz/kuşbakışı: ucuz ama sonsuz döngüye karşı tavan
const DAILY_3D_CAP = 6                      // ölçülen zirve 5 → tavan 6
const DAILY_AUTO_CAP = 3                    // 18.09 Barış: "günde bir çok az" → 3.
// ⚠️ Aylık tavanı ARTIRMAZ: KV butce-premium-usd 3,00 ÷ auto 0,24 ≈ ayda 12 video.
// Günlük 3, kullanıcının ayı 4 günde bitirmesine izin verir; toplam yine ~12.
// 🔴 FİKS 05.09 — MALİYET MODELİ ÖLÇÜME OTURTULDU (uçtan uca tarama bulgusu).
// ÖLÇÜM: D1 `gpu_costs` → 912 GPU saniyesi / 1 adet 3B video (≈15,2 dk). RunPod flex fiyatlarıyla
// ≈ $0,19-0,28. Kodda `'3d': 0.033` yazıyordu — gerçeğin 6-9 KATI DÜŞÜK. `flat: 0.0` ise
// `if (maliyet > 0 && ...)` kapısı yüzünden düz/flyover videoyu bütçeye HİÇ SOKMUYORDU.
// Bedel + aylık tavan artık ortak/src/maliyet.ts (dispatch ile AYNI düğme; motor KV
// `dispatch:motor`'a göre RunPod/Modal; tavan KV `butce-*-usd` yoksa BUTCE_VARSAYILAN).
// YENİ KURAL: GPU maliyeti ≤ net gelirin %30'u → katkı marjı ~%66.
//   premium.monthly $4,99 → net $4,24 → 1,25    ultra.monthly $9,99 → net $8,49 → 2,50
//   Small Business Program kaydı Barış tarafından teyit edildi → komisyon %15.

// ---------- Python semantiği yardımcıları ----------
/** Python str(): None→'None', True/False→'True'/'False'. */
function pyStr(v: unknown): string {
  if (v === null || v === undefined) return 'None'
  if (v === true) return 'True'
  if (v === false) return 'False'
  return String(v)
}

/** Python float() — çevrilemeyen değerde fırlatır (FastAPI'deki gibi yakalanmamış 500 olur). */
function pyFloat(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string') {
    const s = v.trim()
    if (s !== '') {
      if (/^[+-]?(inf|infinity)$/i.test(s)) return s.startsWith('-') ? -Infinity : Infinity
      const n = Number(s)
      if (Number.isFinite(n) || Number.isNaN(n) === false) return n
    }
    throw new Error(`ValueError: could not convert string to float: '${v}'`)
  }
  throw new Error('TypeError: float() argument must be a string or a real number')
}

/** Python int(float(v)) — NaN/Inf fırlatır. */
function pyIntFloat(v: unknown): number {
  const f = pyFloat(v)
  const t = Math.trunc(f)
  if (!Number.isFinite(t)) throw new Error('ValueError/OverflowError: cannot convert to int')
  return t
}

/** Python dict.get(k, d) — anahtar YOKSA d, varsa (null dahi olsa) değer. */
function bget(b: Record<string, unknown>, k: string, d: unknown): unknown {
  return k in b ? b[k] : d
}

/** int(x or y) benzeri: değer falsy ise yedek. */
const intOr = (v: unknown, yedek: number): number => {
  const n = Number(v ?? 0)
  return Math.trunc(n || yedek)
}

const round1 = (x: number) => Math.round(x * 10) / 10
const round4 = (x: number) => Math.round(x * 10000) / 10000
const round6 = (x: number) => Math.round(x * 1e6) / 1e6

/** TR günü (Europe/Istanbul, sabit UTC+3 — DST yok) 'YYYY-MM-DD'. */
const trDay = (epoch: number) => new Date((epoch + 3 * 3600) * 1000).toISOString().slice(0, 10)

/** FastAPI Body(...) eşleniği: JSON obje gövdesi; değilse 422. */
async function jsonBody(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  let b: unknown
  try {
    b = await c.req.json()
  } catch {
    hata(422, [{ loc: ['body'], msg: 'value is not a valid dict', type: 'type_error.dict' }])
  }
  if (typeof b !== 'object' || b === null || Array.isArray(b))
    hata(422, [{ loc: ['body'], msg: 'value is not a valid dict', type: 'type_error.dict' }])
  return b as Record<string, unknown>
}

/** data-URI base64 gövdesi → bayt — Python base64.b64decode(validate=False) eşleniği:
 *  alfabe dışı karakterler ATILIR (atob junk'ta fırlatırdı → Python'da 200 olan istek 500 olurdu),
 *  padding eksikse fırlatır ('Incorrect padding' → 500; atob bazı padding'sizleri kabul ederdi). */
function b64Coz(data: string): Uint8Array {
  const i = data.indexOf(',')
  if (i < 0) throw new Error("IndexError: list index out of range")   // data.split(',',1)[1] eşleniği
  const temiz = data.slice(i + 1).replace(/[^A-Za-z0-9+/=]/g, '')
  if (temiz.length % 4 !== 0) throw new Error('binascii.Error: Incorrect padding')
  const bin = atob(temiz)
  const out = new Uint8Array(bin.length)
  for (let j = 0; j < bin.length; j++) out[j] = bin.charCodeAt(j)
  return out
}

// ---------- sahiplik / örnek içerik ----------
/** main.py _ride_owner (418-425) birebir: cloud_videos→detected_rides→pending→failed; yoksa Barış. */
async function rideOwner(db: D1Database, rid: string): Promise<string> {
  const rs = await db.batch<{ uid: string | null }>([
    db.prepare('SELECT uid FROM videos WHERE rid = ?1').bind(rid),
    db.prepare('SELECT uid FROM rides  WHERE rid = ?1').bind(rid),
    db.prepare('SELECT uid FROM pending_videos WHERE vid = ?1').bind(rid),
    db.prepare('SELECT uid FROM failed_videos  WHERE vid = ?1').bind(rid),
  ])
  for (const r of rs) {
    const row = r.results[0]
    if (row !== undefined) return row.uid || BARIS_UID
  }
  return BARIS_UID
}

// ---------- R2 akış + presign ----------
/** main.py _r2_akit (967-1009): R2'den sunucu üzerinden akıt (302 YOK — AVPlayer Authorization tuzağı). */
async function r2Akit(r2: R2Bucket, key: string, rng?: string): Promise<Response> {
  let o: R2ObjectBody | null = null
  try {
    o = await r2.get(key, rng ? { range: new Headers({ Range: rng }) } : undefined)
  } catch {
    hata(404, 'video bulunamadı')
  }
  if (!o) hata(404, 'video bulunamadı')
  const total = o.size
  const bas = new Headers({
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
    'Content-Type': 'video/mp4',
  })
  let kod = 200
  const r = o.range as Record<string, number> | undefined
  if (rng && r) {
    let offset: number, length: number
    if (r.suffix !== undefined) { length = Math.min(r.suffix, total); offset = total - length }
    else { offset = r.offset ?? 0; length = r.length ?? (total - offset) }
    bas.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${total}`)
    bas.set('Content-Length', String(length))
    kod = 206
  } else {
    bas.set('Content-Length', String(total))
  }
  return new Response(o.body, { status: kod, headers: bas })
}

const enc = new TextEncoder()
const hex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('')
async function sha256Hex(s: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))))
}
async function hmacRaw(key: Uint8Array | ArrayBuffer, msg: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key as ArrayBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)))
}
const rfc3986 = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())

/** main.py r2_presigned (106-114) eşleniği — SigV4 query presign (6 saat). Kimlik yoksa null. */
async function r2Presign(env: ExtEnv, key: string, secs = 21600): Promise<string | null> {
  const ep = env.R2_ENDPOINT, ak = env.R2_ACCESS_KEY_ID, sk = env.R2_SECRET_ACCESS_KEY
  const bucket = env.R2_BUCKET || 'movelog'
  if (!ep || !ak || !sk || !key) return null
  try {
    const u = new URL(ep)
    const amzDate = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'
    const dateStamp = amzDate.slice(0, 8)
    const scope = `${dateStamp}/auto/s3/aws4_request`
    const path = `/${bucket}/` + key.split('/').map(rfc3986).join('/')
    const q = [
      ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
      ['X-Amz-Credential', `${ak}/${scope}`],
      ['X-Amz-Date', amzDate],
      ['X-Amz-Expires', String(secs)],
      ['X-Amz-SignedHeaders', 'host'],
    ].map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`).sort().join('&')
    const canonical = ['GET', path, q, `host:${u.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n')
    const sts = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonical)].join('\n')
    let k = await hmacRaw(enc.encode('AWS4' + sk), dateStamp)
    for (const parca of ['auto', 's3', 'aws4_request']) k = await hmacRaw(k, parca)
    const sig = hex(await hmacRaw(k, sts))
    return `${u.origin}${path}?${q}&X-Amz-Signature=${sig}`
  } catch {
    return null
  }
}

// ---------- Cihaz çözümü (02.09 SUNUCU BAĞIMSIZ: D1 önce, Traccar yalnız yedek) ----------
/** generate/regenerate cihaz kapısı. Kuyruktaki `device` alanı artık yalnız bilgi amaçlı: dispatch
 *  izi D1 positions'tan (users.tracker_id) doldurur, render_job Traccar'a gitmez (dispatch/src/index.ts:133).
 *  Eskiden tek yol Traccar'dı (sunucu) → sunucu kapalıyken her "üret" 503 "cihaz Traccar'da bulunamadı"
 *  veriyordu. Şimdi: D1'de bu tracker_id için en az bir konum varsa cihaz VAR sayılır; sayısal
 *  tracker_id (OsmAnd id, 6-12 hane) kendisi, değilse FNV-1a pozitif hash döner. D1'de hiç iz yoksa
 *  (tümüyle yeni cihaz) eski Traccar yolu denenir; o da yoksa çağıran eski 503'ü üretir. */
async function cihazIdCoz(env: ExtEnv, devid: string): Promise<number | null> {
  try {
    const r = await env.DB.prepare('SELECT 1 AS v FROM positions WHERE device = ?1 LIMIT 1').bind(devid).first()
    if (r) return cihazSayi(devid)
  } catch { /* D1 arızası → Traccar yedeğine düş */ }
  return traccarIdFor(env, devid)
}
function cihazSayi(devid: string): number {
  if (/^\d{1,15}$/.test(devid)) return Number(devid) || 1
  let h = 2166136261
  for (let i = 0; i < devid.length; i++) h = Math.imul(h ^ devid.charCodeAt(i), 16777619)
  return ((h >>> 1) || 1)
}
/** main.py _traccar_id_for (2622-2633): TRACCAR_USER yoksa null → çağıran 503 üretir. (Yalnız yedek.) */
async function traccarIdFor(env: ExtEnv, devid: string): Promise<number | null> {
  if (!env.TRACCAR_USER) return null
  try {
    const url = `${(env.TRACCAR_URL || 'https://gps.nickdegs.com').replace(/\/$/, '')}/api/devices?uniqueId=${encodeURIComponent(devid)}`
    const r = await fetch(url, {
      headers: { Authorization: 'Basic ' + btoa(`${env.TRACCAR_USER}:${env.TRACCAR_PASS ?? ''}`) },
    })
    if (r.status === 200) {
      const j = (await r.json()) as Array<{ id: number }>
      if (Array.isArray(j) && j.length) return j[0].id
    }
  } catch { /* orijinaldeki gibi yutulur */ }
  return null
}

// ---------- GPX/TCX parser (main.py _parse_route_file 2367-2432) ----------
type TrackPt = { t: number; lat: number; lon: number; spd: number; alt: number | null; hr: number | null }
type HamPt = { lat: number; lon: number; t: number | null; alt: number | null; hr: number | null }

function havM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000
  const [la1, lo1, la2, lo2] = [a.lat, a.lon, b.lat, b.lon].map((x) => (x * Math.PI) / 180)
  const h = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** GPX/TCX ISO8601 → epoch sn (main.py _xiso). */
function xiso(s: string): number | null {
  if (!s) return null
  s = s.trim().replace('Z', '+00:00')
  for (const cand of [s, s.split('.')[0] + '+00:00', s.split('.')[0]]) {
    const t = Date.parse(cand)
    if (!Number.isNaN(t)) return t / 1000
  }
  return null
}

/** İç blokta yerel-ad eşleşen SON boş-olmayan etiket metni (Python iter() son-yazan-kazanır). */
function sonTagText(inner: string, ad: string): string | null {
  const rx = new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${ad}(?:\\s[^>]*)?>([^<]*)<`, 'gi')
  let m: RegExpExecArray | null
  let son: string | null = null
  while ((m = rx.exec(inner))) {
    const tx = m[1].trim()
    if (tx) son = tx
  }
  return son
}

function attrNum(attrs: string, ad: string): number | null {
  const m = new RegExp(`(?:^|\\s)${ad}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs)
  const v = m ? (m[1] ?? m[2]) : null
  if (v === null || v === undefined) return null
  const n = Number(v.trim())
  return v.trim() !== '' && Number.isFinite(n) ? n : null   // float() hatası GPX'te try/except→continue
}

function parseRouteFile(metin: string): TrackPt[] {
  // ET.fromstring başarısızlığının kaba eşleniği: XML gibi başlamıyorsa 400
  if (!/^﻿?\s*</.test(metin)) hata(400, 'dosya okunamadı (geçerli GPX/TCX değil)')
  const raw: HamPt[] = []

  // GPX: trkpt / rtept (namespace bağımsız)
  const gpxRx = /<(?:[A-Za-z_][\w.-]*:)?(trkpt|rtept)\b([^>]*?)(\/?)>/gi
  let m: RegExpExecArray | null
  while ((m = gpxRx.exec(metin))) {
    const lat = attrNum(m[2], 'lat')
    const lon = attrNum(m[2], 'lon')
    if (lat === null || lon === null) continue                       // main.py:2380-2382
    let tm: number | null = null, alt: number | null = null, hr: number | null = null
    if (!m[3]) {
      const kapatRx = new RegExp(`</(?:[A-Za-z_][\\w.-]*:)?${m[1]}\\s*>`, 'gi')
      kapatRx.lastIndex = gpxRx.lastIndex
      const km2 = kapatRx.exec(metin)
      const inner = km2 ? metin.slice(gpxRx.lastIndex, km2.index) : ''
      if (km2) gpxRx.lastIndex = kapatRx.lastIndex
      const eleTx = sonTagText(inner, 'ele')
      if (eleTx) { const n = Number(eleTx); if (Number.isFinite(n)) alt = n }   // try/except pass
      const timeTx = sonTagText(inner, 'time')
      if (timeTx) tm = xiso(timeTx)
      const hrTx = sonTagText(inner, 'hr')                            // gpxtpx:hr
      if (hrTx) { const n = Number(hrTx); if (Number.isFinite(n)) hr = Math.trunc(n) }
    }
    raw.push({ lat, lon, t: tm, alt, hr })
  }

  // TCX: Trackpoint
  const tcxRx = /<(?:[A-Za-z_][\w.-]*:)?trackpoint\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?trackpoint\s*>/gi
  while ((m = tcxRx.exec(metin))) {
    const inner = m[1]
    let lat: number | null = null, lon: number | null = null
    let tm: number | null = null, alt: number | null = null, hr: number | null = null
    const latTx = sonTagText(inner, 'latitudedegrees')
    if (latTx) lat = pyFloat(latTx)                                   // main.py:2399 — hata YAKALANMAZ (500)
    const lonTx = sonTagText(inner, 'longitudedegrees')
    if (lonTx) lon = pyFloat(lonTx)
    const altTx = sonTagText(inner, 'altitudemeters')
    if (altTx) { const n = Number(altTx); if (Number.isFinite(n)) alt = n }
    const timeTx = sonTagText(inner, 'time')
    if (timeTx) tm = xiso(timeTx)
    const valTx = sonTagText(inner, 'value')                          // HeartRateBpm/Value (son kazanır)
    if (valTx) { const n = Number(valTx); if (Number.isFinite(n)) hr = Math.trunc(n) }
    if (lat !== null && lon !== null) raw.push({ lat, lon, t: tm, alt, hr })
  }

  if (raw.length < 3) hata(400, 'yetersiz konum noktası — dosyada GPS izi bulunamadı')
  if (raw.some((p) => p.t === null)) {                                // zaman yoksa sentetik 1sn aralık — TÜMÜ yeniden atanır
    const base = Date.now() / 1000 - raw.length
    raw.forEach((p, i) => { p.t = base + i })
  }
  raw.sort((a, b) => (a.t as number) - (b.t as number))
  let track: TrackPt[] = raw.map((p, i) => {
    let spd = 0
    if (i > 0) {
      const dt = (p.t as number) - (raw[i - 1].t as number)
      const d = havM(raw[i - 1], p)
      spd = dt > 0 ? (d / dt) * 3.6 : 0
      if (spd > 200) spd = 0                                          // GPS sıçraması
    }
    return { t: Math.trunc(p.t as number), lat: round6(p.lat), lon: round6(p.lon), spd: round1(spd), alt: p.alt, hr: p.hr }
  })
  const MAXP = 5000
  if (track.length > MAXP) {
    const step = (track.length - 1) / (MAXP - 1)
    track = Array.from({ length: MAXP }, (_, i) => track[Math.round(i * step)])
  }
  return track
}

// ---------- günlük limit + aylık bütçe (main.py _bump_daily_cap 2273-2337) ----------
// D1 yazımları ERTELENİR (stmts) — orijinaldeki "bellekte değiştir, _save'de kalıcılaştır"
// semantiği korunur: araya giren HTTPException'da hiçbir sayaç/hak yazılmaz.
type Prof = Record<string, unknown>
async function bumpDailyCap(
  db: D1Database, kv: KVNamespace, user: string, prof: Prof, mode: string, speed: string,
  hakOdendi = false,
): Promise<{ ok: boolean; why: string; stmts: D1PreparedStatement[] }> {
  // 🔴 FİKS 05.09: admin ÖNCE tamamen muaftı — "limitsiz VE sayaçsız". Barış admin olduğu için
  // kendi harcaması hiçbir yerde görünmüyordu ve bakiye eridiğinde nedeni ölçülemiyordu.
  // Artık: LİMİTSİZ (üretim asla engellenmez) ama SAYILIR (aylık sayaç işlenir).
  // 🔴 05.09 — APP STORE İNCELEME HESAPLARI TAVANA TABİ OLAMAZ. Hakem "Video oluştur"a basıp
  // "bu ayki payın doldu" görürse özelliği ÇALIŞMIYOR sayar ve sürüm REDDEDİLİR. Bu hesaplar
  // Ultra ($2,00 = ~5 adet 3B) tavanına takılabiliyordu; ayrıca o gün başkası günlük tavanı
  // doldurmuşsa iş hiç gönderilmiyordu. Admin gibi: LİMİTSİZ ama SAYILIR.
  const adminSinirsiz = !!prof.admin || INCELEME.has(user)
  const now = simdi()
  const today = trDay(now)
  const ayk = 'ay_' + today.slice(0, 7)
  const rows = await db.prepare('SELECT counter_key, value FROM render_counts WHERE uid = ?1').bind(user).all<{ counter_key: string; value: number }>()
  const u: Record<string, number> = {}
  for (const r of rows.results) u[r.counter_key] = Number(r.value)
  const stmts: D1PreparedStatement[] = []
  // eski gün + geçen ay temizliği (ertelenmiş)
  stmts.push(db.prepare(
    `DELETE FROM render_counts WHERE uid = ?1 AND (
       (counter_key LIKE 'ay\\_%' ESCAPE '\\' AND counter_key != ?2) OR
       (counter_key NOT LIKE 'ay\\_%' ESCAPE '\\' AND counter_key NOT LIKE '%' || ?3))`,
  ).bind(user, ayk, today))

  // 🔴 İKİ AYRI SINIFLANDIRMA (adversaryel doğrulama bulgusu):
  //  · `tur` = GÜNLÜK TAVAN kovası — `auto` kendi tavanına (DAILY_AUTO_CAP) girmeli, bu yüzden
  //    mod'dan ÖNCE bakılır.
  //  · `turMaliyet` = FİYAT kovası — MOD'a göre. Eskiden tek bir `tur` vardı ve `auto` mod'dan
  //    önce geldiği için UCUZ bir flat+auto videosu en pahalı fiyattan faturalanıyordu.
  const modKova = mode === '3d' ? '3d' : mode === 'flyover' ? 'flyover' : 'flat'
  const tur = speed === 'auto' ? 'auto' : modKova
  const turMaliyet = mode === '3d' ? '3d'
    : speed === 'auto' ? 'auto'               // uzun ama 3B değil → 3B ile aynı kovada
    : modKova
  const maliyet = await modMaliyet(kv, turMaliyet, 0.02)
  const butce = await aylikButceLimit(kv)                              // 18.09: tek katman
  const harcanan = Number(u[ayk] ?? 0)
  // 🔴 FİKS 05.09 — ÖDENMİŞ HAK İKİ KEZ ÖDETİLİYORDU: kullanıcı video paketini SATIN ALIYOR,
  // hak düşülüyor VE üstüne aylık bütçeden de düşülüyordu → 5'li paket alan biri 3-4 video
  // sonra kalanını kullanamıyordu. (18.09: `sokak_hak` dalı ürünle birlikte kalktı.)
  const kredili = hakOdendi
  const mult = 1 + Math.trunc(Number(u['boost_' + today] ?? 0))       // IAP boost yalnız OKUNUR
  // Boost aylık paya da eklenir: günlük tavanı 2'ye katlamak, aylık pay dolmuşsa kullanıcıya
  // hiçbir şey vermez — ödediği şeyin ulaşılabilir olması için pay da genişlemeli.
  // $0,75 ≈ 2 adet 3B; boost neti ~$1,69 → marj ~%56.
  const butceToplam = butce + 0.75 * (mult - 1)
  if (!adminSinirsiz && !kredili && maliyet > 0 && harcanan + maliyet > butceToplam) {
    return { ok: false, why: 'butce', stmts: [] }
  }
  const rcInc = (k: string, inc: number) => db.prepare(
    `INSERT INTO render_counts (uid, counter_key, value, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)
     ON CONFLICT(uid, counter_key) DO UPDATE SET value = ROUND(value + ?3, 4), updated_at = ?4`,
  ).bind(user, k, inc, now)

  if (tur === 'auto') {
    if (!adminSinirsiz && DAILY_AUTO_CAP && Number(u['auto_' + today] ?? 0) >= DAILY_AUTO_CAP) return { ok: false, why: 'auto', stmts: [] }
    stmts.push(rcInc('auto_' + today, 1))
  } else if (tur === '3d') {
    if (!adminSinirsiz && DAILY_3D_CAP && Number(u['3d_' + today] ?? 0) >= DAILY_3D_CAP * mult) return { ok: false, why: '3d', stmts: [] }
    stmts.push(rcInc('3d_' + today, 1))
  } else {
    if (!adminSinirsiz && DAILY_VIDEO_CAP && Number(u[today] ?? 0) >= DAILY_VIDEO_CAP * mult) return { ok: false, why: 'total', stmts: [] }
    stmts.push(rcInc(today, 1))
  }
  stmts.push(rcInc(ayk, hakOdendi ? 0 : maliyet))     // ödenmiş hakla üretim bütçeden DÜŞMEZ
  void round4                                                          // ROUND SQL'de; JS eşleniği referans için
  return { ok: true, why: '', stmts }
}

function kapasiteHatasi(why: string): never {
  // 🔴 FİKS 05.09: metin kullanıcıyı en PAHALI moda yönlendiriyordu. Payı tüketen şey 3B'nin
  // kendisi (düz videonun ~7,6 katı) → doğru yönlendirme: 3B yerine Kuşbakışı/Düz.
  if (why === 'butce')
    hata(429, "Bu ayki 3B üretim payını doldurdun 🙏 Kuşbakışı ve Düz görünüm hâlâ açık — onlar çok daha az pay kullanır, bu ay rahatça üretmeye devam edebilirsin. Payın her ayın 1'inde sıfırlanır.")
  if (why === 'auto')
    hata(429, `Günlük Otonom limiti doldu (${DAILY_AUTO_CAP}/gün). Otonom en uzun render olduğu için günlük sınırlı; Kısa/Orta/Uzun ile devam edebilir veya yarın tekrar Otonom deneyebilirsin.`)
  if (why === '3d')
    hata(429, `Günlük 3D limiti doldu (${DAILY_3D_CAP}/gün). Düz/Flyover ile devam edebilir veya yarın 3D deneyebilirsin.`)
  hata(429, `Günlük video limiti doldu (${DAILY_VIDEO_CAP}/gün). Yarın tekrar deneyebilirsin.`)
}

/** main.py _save_video_colors (2340-2344) — prefs_json'a TEK-DEYİM json_set (ertelenmiş). */
function videoRenkStmts(db: D1Database, user: string, body: Record<string, unknown>): D1PreparedStatement[] {
  const out: D1PreparedStatement[] = []
  const now = simdi()
  if (body.line)
    out.push(db.prepare(
      `UPDATE users SET prefs_json = json_set(COALESCE(prefs_json, '{}'), '$.video_line', json(?1)), updated_at = ?2 WHERE uid = ?3`,
    ).bind(JSON.stringify(pyStr(body.line).slice(0, 9)), now, user))
  if (body.dot)
    out.push(db.prepare(
      `UPDATE users SET prefs_json = json_set(COALESCE(prefs_json, '{}'), '$.video_dot', json(?1)), updated_at = ?2 WHERE uid = ?3`,
    ).bind(JSON.stringify(pyStr(body.dot).slice(0, 9)), now, user))
  return out
}

/** Kuyruk gönderimi — 128KB Queues sınırı: büyük req (gömülü iz) R2'ye, kuyruğa işaretçi. */
async function kuyrugaGonder(env: Env, req: Record<string, unknown>, user: string, ts: number, vid: string): Promise<void> {
  const govde = JSON.stringify(req)
  if (enc.encode(govde).length > 120_000) {
    const anahtar = `genreq/${user}_${ts}.json`
    await env.R2.put(anahtar, govde)
    await env.RENDER_Q.send({ genreq_r2: anahtar, user, ts, vid })
  } else {
    await env.RENDER_Q.send(req)
  }
}

// ════════════════════════════════════════════════════════════════════════════
// GET /api/rides — main.py:840 + list_rides (251-404)
// ════════════════════════════════════════════════════════════════════════════
g.get('/api/rides', authUser, async (c) => {
  const db = c.env.DB
  const user = c.get('user')
  const sahip = await etkinSahip(db, user)          // ÖRNEK İÇERİK: kendi kaydı olmayan → appreview
  // 10.10: örnek içerik işareti. Kendi kaydı olmayan kullanıcı appreview rotalarını görür ama
  // silemez/tipini değiştiremez (rideOwner ≠ user → 404). İstemci bu kartlarda sil/tip menüsünü
  // gizlesin diye `sample: true` eklenir (18.09–10.10 arası Android'den 27 DELETE + 27 type 404'ü).
  // Alan EKLENİR, hiçbir alan silinmez (canlı istemci kuralı).
  const ornek = sahip !== user
  const [ovrR, delR, cloudR, detR, pendR, failR] = await db.batch([
    db.prepare('SELECT rid, ride_type FROM ride_type_overrides'),
    db.prepare('SELECT rid FROM deleted_rides'),
    db.prepare(`SELECT * FROM videos WHERE COALESCE(NULLIF(uid, ''), ?1) = ?2`).bind(BARIS_UID, sahip),
    db.prepare(`SELECT * FROM rides  WHERE COALESCE(NULLIF(uid, ''), ?1) = ?2`).bind(BARIS_UID, sahip),
    db.prepare('SELECT * FROM pending_videos'),     // TÜM satırlar: failed'ın "rid in pend" kontrolü GLOBAL (main.py:365)
    db.prepare(`SELECT * FROM failed_videos WHERE COALESCE(NULLIF(uid, ''), ?1) = ?2`).bind(BARIS_UID, user),
  ])
  const overrides: Record<string, string> = {}
  for (const r of ovrR.results as Array<{ rid: string; ride_type: string }>) overrides[r.rid] = r.ride_type
  const deleted = new Set((delR.results as Array<{ rid: string }>).map((r) => r.rid))
  const emoji = (t: string) => TYPE_EMOJI[t] ?? '🎬'
  const byId: Record<string, Record<string, unknown>> = {}

  // (yerel ROUTES_DIR dalı kalktı — sapma notu 1; Barış'ın yerel render'ları videos'a taşınır)

  // bulut (R2) videoları — main.py:308-328
  for (const v of cloudR.results as Array<Record<string, unknown>>) {
    const rid = v.rid as string
    if (deleted.has(rid)) continue
    const done = Math.trunc(Number(v.done_at ?? 0))
    const cur = byId[rid]
    if (cur && Number(cur._mt) >= done) continue
    let ts = Math.trunc(Number(v.ts ?? 0))
    if (!ts) {
      const seg = Number(rid.split('_')[1])
      ts = Number.isFinite(seg) ? Math.trunc(seg) : 0
    }
    const typ = overrides[rid] || (v.ride_type as string) || ''
    byId[rid] = {
      id: rid, date: (v.date as string) || rid.split('_')[0], ts,
      to: intOr(v.to_ts, ts + 2 * 3600),
      type: typ, emoji: emoji(typ),
      mode: (v.mode as string) || 'flyover', speed: (v.speed as string) || 'medium',
      aspect: (v.aspect as string) || '16:9', size: intOr(v.size, 0) || 0,
      video_url: `/api/rides/${rid}/video`,
      // main.py paritesi: yerel ROUTES_DIR dalı (276-306) çıplak dosya adı döner ve `cloud` alanı KOYMAZ;
      // bulut dalı (312-329) tam key + cloud:true döner. Yerel göçü videos/yerel/ önekiyle ayırt edilir.
      // 05.09: göç arşivi arsiv/yerel/'e taşındı — `videos/` R2 lifecycle kuralı (7 gün) onları da
      // siliyordu. Eski önek geriye dönük uyum için listede kalıyor.
      ...((v.r2_key as string)?.startsWith('videos/yerel/') || (v.r2_key as string)?.startsWith('arsiv/yerel/')
        ? { file: (v.r2_key as string).split('/').pop() as string }
        : { file: (v.r2_key as string) || '', cloud: true }),
      done, _mt: done,
      ...(ornek ? { sample: true } : {}),
    }
  }

  // HÂLÂ RENDER OLAN videolar (pending) — main.py:331-361; SÜRE FİLTRESİ YOK
  const own = (u: unknown) => (u ? (u as string) : BARIS_UID)
  const pendRows = pendR.results as Array<Record<string, unknown>>
  const pendSet = new Set(pendRows.map((p) => p.vid as string))
  for (const pv of pendRows) {
    const rid = pv.vid as string
    if (deleted.has(rid)) continue
    if (own(pv.uid) !== user) continue                                // başkasının "Hazırlanıyor" kartı sızmasın
    const day = rid.split('_')[0]
    const base = byId[rid] ?? {}
    const typ = (pv.ride_type as string) || (base.type as string) || ''
    byId[rid] = {
      ...base,
      id: rid, date: (pv.date as string) || (base.date as string) || day,
      ts: intOr(pv.ts, Math.trunc(Number(base.ts ?? 0)) || 0) || 0,
      to: intOr(pv.to_ts, Math.trunc(Number(base.to ?? 0)) || 0) || 0,
      type: typ, emoji: emoji(typ),
      mode: (pv.mode as string) || (base.mode as string) || 'flyover',
      speed: (base.speed as string) || 'medium', aspect: (base.aspect as string) || '16:9',
      size: Number(base.size ?? 0), video_url: `/api/rides/${rid}/video`,
      rendering: true,
      done: Number(base.done ?? 0),
      _mt: Math.max(Number(base._mt ?? 0), Math.trunc(Number(pv.queued_at ?? 0))),
    }
  }

  // BAŞARISIZ videolar (hata kartı) — main.py:364-384
  for (const fv of failR.results as Array<Record<string, unknown>>) {
    const rid = fv.vid as string
    if (deleted.has(rid) || pendSet.has(rid)) continue
    const cur = byId[rid]
    if (cur && (cur.cloud || cur.rendering || cur.file)) continue     // üretilmiş/üretilen video kazanır
    const base = cur ?? {}
    const day = rid.includes('_') ? rid.split('_')[0] : pyStr(fv.date ?? 'None')   // main.py:374 str(None)='None' paritesi
    const typ = (fv.ride_type as string) || (base.type as string) || ''
    byId[rid] = {
      ...base,
      id: rid, date: (fv.date as string) || (base.date as string) || day,
      ts: intOr(fv.ts, Math.trunc(Number(base.ts ?? 0)) || 0) || 0,
      to: intOr(fv.to_ts, Math.trunc(Number(base.to ?? 0)) || 0) || 0,
      type: typ, emoji: emoji(typ),
      mode: (fv.mode as string) || (base.mode as string) || 'flyover',
      speed: (base.speed as string) || 'medium', aspect: (base.aspect as string) || '16:9',
      size: 0, failed: true, error: (fv.reason as string) || 'Video oluşturulamadı',
      done: Math.trunc(Number(fv.failed_at ?? 0)),
      _mt: Math.max(Number(base._mt ?? 0), Math.trunc(Number(fv.failed_at ?? 0))),
    }
  }

  // ALGILANAN ama videosuz rotalar — main.py:387-398 (video/pending varsa eklenmez)
  for (const dr of detR.results as Array<Record<string, unknown>>) {
    const rid = dr.rid as string
    if (deleted.has(rid) || rid in byId) continue
    const ts = Math.trunc(Number(dr.ts ?? 0))
    const typ = overrides[rid] || (dr.ride_type as string) || ''
    byId[rid] = {
      id: rid, date: (dr.date as string) || (rid.includes('_') ? rid.split('_')[0] : ''),
      ts, to: intOr(dr.to_ts, ts + 2 * 3600),
      type: typ, emoji: emoji(typ),
      mode: 'flyover', speed: 'medium', aspect: '16:9', size: 0,
      novideo: true, done: 0, _mt: ts,
      ...(ornek ? { sample: true } : {}),
    }
  }

  const out = Object.values(byId)
  for (const r of out) {
    r.added = Math.trunc(Number(r._mt ?? 0)) || 0
    delete r._mt
  }
  out.sort((a, b) => Number(b.ts) - Number(a.ts))
  return c.json({ rides: out })
})

// ════════════════════════════════════════════════════════════════════════════
// DELETE /api/rides/{ride_id} — main.py:845 (yumuşak sil; IDOR 404)
// ════════════════════════════════════════════════════════════════════════════
g.delete('/api/rides/:ride_id', authUser, async (c) => {
  const db = c.env.DB
  const user = c.get('user')
  const rid = c.req.param('ride_id')
  if ((await rideOwner(db, rid)) !== user) hata(404, 'rota bulunamadi')   // örnek içerik de silinemez
  const now = simdi()
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO deleted_rides (rid, created_at, updated_at) VALUES (?1, ?2, ?2)').bind(rid, now),
    db.prepare('DELETE FROM failed_videos WHERE vid = ?1').bind(rid),
  ])
  return c.json({ ok: true })
})

// ════════════════════════════════════════════════════════════════════════════
// GET /api/rides/{ride_id}/video — main.py:1012 (R2'den sunucu üzerinden AKIT; Range ŞART)
// ════════════════════════════════════════════════════════════════════════════
g.get('/api/rides/:ride_id/video', authUser, async (c) => {
  const db = c.env.DB
  const user = c.get('user')
  const rid = c.req.param('ride_id')
  if ((await rideOwner(db, rid)) !== user && !(await ornekMi(db, rid))) hata(404, 'video bulunamadı')
  const cv = await db.prepare('SELECT r2_key FROM videos WHERE rid = ?1').bind(rid).first<{ r2_key: string | null }>()
  // yerel dosya dalı kalktı (sapma notu 1) → bulut tek kaynak
  if (cv && cv.r2_key) return r2Akit(c.env.R2, cv.r2_key, c.req.header('range'))
  hata(404, 'video bulunamadı')
})

// ════════════════════════════════════════════════════════════════════════════
// GET /api/rides/{ride_id}/videourl — main.py:1031 (presigned URL; app header'sız oynatır)
// ════════════════════════════════════════════════════════════════════════════
g.get('/api/rides/:ride_id/videourl', authUser, async (c) => {
  const db = c.env.DB
  const user = c.get('user')
  const rid = c.req.param('ride_id')
  if ((await rideOwner(db, rid)) !== user && !(await ornekMi(db, rid))) hata(404, 'video bulunamadı')
  const cv = await db.prepare('SELECT r2_key FROM videos WHERE rid = ?1').bind(rid).first<{ r2_key: string | null }>()
  if (cv) {
    const url = await r2Presign(c.env as ExtEnv, cv.r2_key ?? '')
    if (url) return c.json({ url })
    // presign kimliği yoksa: video R2'de ve /video akıtıyor → göreli URL (sapma notu 2)
    if (cv.r2_key) return c.json({ url: `/api/rides/${rid}/video` })
  }
  hata(404, 'video bulunamadı')
})

// ════════════════════════════════════════════════════════════════════════════
// POST /api/rides/music — main.py:2055 (session müziği + GLOBAL aktif müzik)
// ════════════════════════════════════════════════════════════════════════════
g.post('/api/rides/music', authUser, async (c) => {
  const user = c.get('user')
  const body = await jsonBody(c)
  const session = String(pyIntFloat(bget(body, 'session', 0)))        // bozuk session → 500 (main.py:2058)
  const data = bget(body, 'data', '')
  if (typeof data !== 'string') throw new Error("AttributeError: 'startswith'")   // Python .startswith → 500
  if (!session || !data.startsWith('data:audio')) hata(400, 'geçersiz ses')
  const raw = b64Coz(data)                                            // bozuk base64 → 500 (main.py:2062)
  if (raw.length > 20_000_000) hata(413, 'ses çok büyük')
  // grup4 /api/music/file 'upload' dalıyla AYNI önek (ridephotos/) — sözleşme çapraz-uyum notu
  await c.env.R2.put(`ridephotos/${user}_${session}/music.m4a`, raw)
  await c.env.R2.put(`usermusic/${user}/active.m4a`, raw)             // GLOBAL: son yüklenen = aktif müzik
  return c.json({ ok: true })
})

// ════════════════════════════════════════════════════════════════════════════
// POST /api/rides/photo — main.py:2204 (konumlu anı fotoğrafı; meta photos.json)
// ════════════════════════════════════════════════════════════════════════════
g.post('/api/rides/photo', authUser, async (c) => {
  const user = c.get('user')
  const body = await jsonBody(c)
  const session = String(pyIntFloat(bget(body, 'session', 0)))
  const data = bget(body, 'data', '')
  if (typeof data !== 'string') throw new Error("AttributeError: 'startswith'")
  if (!session || !data.startsWith('data:image')) hata(400, 'geçersiz')
  const raw = b64Coz(data)
  if (raw.length > 4_000_000) hata(413, 'görsel çok büyük')
  const pd = `ridephotos/${user}_${session}/`
  const liste = await c.env.R2.list({ prefix: pd })
  const n = liste.objects.filter((o) => o.key.endsWith('.jpg')).length   // main.py:2217 (aynı yarış korunur)
  await c.env.R2.put(`${pd}${n}.jpg`, raw)
  const meta = {
    file: `${n}.jpg`,
    lat: pyFloat(bget(body, 'lat', 0)),                               // bozuk lat/lon → 500 (main.py:2219)
    lon: pyFloat(bget(body, 'lon', 0)),
    ts: pyFloat(bget(body, 'ts', Date.now() / 1000)),
  }
  let arr: unknown[] = []
  try {
    const mf = await c.env.R2.get(`${pd}photos.json`)
    if (mf) {
      const j = await mf.json()
      if (Array.isArray(j)) arr = j
    }
  } catch { /* bozuk meta → boş dizi (main.py:2222-2223) */ }
  arr.push(meta)
  await c.env.R2.put(`${pd}photos.json`, JSON.stringify(arr))
  return c.json({ ok: true, count: arr.length })
})

// ════════════════════════════════════════════════════════════════════════════
// POST /api/rides/{ride_id}/type — main.py:2228 (elle tip düzeltme; IDOR 404)
// ════════════════════════════════════════════════════════════════════════════
g.post('/api/rides/:ride_id/type', authUser, async (c) => {
  const db = c.env.DB
  const user = c.get('user')
  const rid = c.req.param('ride_id')
  const body = await jsonBody(c)
  const t = pyStr(bget(body, 'type', ''))
  if (!['moto', 'car', 'bike', 'run', 'walk'].includes(t)) hata(400, 'geçersiz tip')
  if ((await rideOwner(db, rid)) !== user) hata(404, 'rota bulunamadi')
  const now = simdi()
  await db.prepare(
    `INSERT INTO ride_type_overrides (rid, ride_type, uid, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)
     ON CONFLICT(rid) DO UPDATE SET ride_type = ?2, uid = ?3, updated_at = ?4`,
  ).bind(rid, t, user, now).run()
  return c.json({ ok: true, type: t })
})

// ════════════════════════════════════════════════════════════════════════════
// POST /api/rides/upload — main.py:2435 (GPX/TCX ham gövde; premium)
// ════════════════════════════════════════════════════════════════════════════
g.post('/api/rides/upload', authUser, async (c) => {
  const db = c.env.DB
  const user = c.get('user')
  const prof = await getUser(db, user)
  if (!prof?.premium) hata(402, 'GPX/TCX yükleme premium özelliğidir')
  const govde = await c.req.arrayBuffer()
  if (govde.byteLength > 100 * 1024 * 1024) hata(413, 'dosya çok büyük (en fazla 100MB)')
  const track = parseRouteFile(new TextDecoder('utf-8').decode(govde))
  const frm = Math.trunc(track[0].t)
  const to = Math.trunc(track[track.length - 1].t)
  const day = trDay(frm)
  let distKm = 0
  for (let i = 1; i < track.length; i++) distKm += havM(track[i - 1], track[i]) / 1000
  const now = simdi()
  const rid = `up_${now}_${frm}`
  // İz R2'ye (uploaded_tracks D1'e GİRMEZ — SEMA-NOTLARI): tracks/{frm}.json
  await c.env.R2.put(`tracks/${frm}.json`, JSON.stringify(track))
  await db.prepare(
    `INSERT OR REPLACE INTO rides (rid, uid, date, ts, to_ts, ride_type, uploaded, track_key, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'bike', 1, ?6, ?7, ?7)`,
  ).bind(rid, user, day, frm, to, `tracks/${frm}.json`, now).run()
  return c.json({ ok: true, ride_id: rid, from: frm, to, points: track.length, km: round1(distKm) })
})

// ════════════════════════════════════════════════════════════════════════════
// POST /api/rides/generate — main.py:2512 (kuyruk + pending; TÜM yazımlar tek batch)
// ════════════════════════════════════════════════════════════════════════════
g.post('/api/rides/generate', authUser, async (c) => {
  const db = c.env.DB
  const env = c.env as ExtEnv
  const user = c.get('user')
  const body = await jsonBody(c)
  const profRow = await getUser(db, user)
  const prof: Prof = (profRow ?? {}) as unknown as Prof
  const yaz: D1PreparedStatement[] = []                                // ERTELENMİŞ yazımlar (_save eşleniği)
  const now = simdi()

  // 18.09: TEK-SEFERLİK BEDAVA TAKTİK + Ultra taktik kapısı KALKTI (taktik modu kaldırıldı).
  let hakOdendi = false          // satın alınmış video hakkıyla üretim (aylık bütçeden düşmez)
  // VİDEO HAKKI (main.py:2529-2541): free katman üretmez; paket varsa hak düşer
  if (!prof.premium) {
    const vh = Math.trunc(Number(prof.video_hak ?? 0))
    if (vh <= 0) hata(402, 'video premium özelliği')
    yaz.push(db.prepare('UPDATE users SET video_hak = COALESCE(video_hak, 0) - 1, updated_at = ?2 WHERE uid = ?1').bind(user, now))
    hakOdendi = true      // 05.09: satın alınmış hakla üretim aylık bütçeden DÜŞMEZ
  }

  // YÜKLENEN GPX/TCX izi (Traccar'sız yol) — R2 tracks/{frm}.json
  const frmInt = pyIntFloat(bget(body, 'from', 0))
  let upl: TrackPt[] | null = null
  const uplObj = await env.R2.get(`tracks/${frmInt}.json`)
  if (uplObj) { try { upl = (await uplObj.json()) as TrackPt[] } catch { upl = null } }
  if (upl && !upl.length) upl = null    // Python'da [] falsy: `if not _upl` Traccar'a düşer (JS'te [] truthy — parite)
  const nowF = Date.now() / 1000

  let traccarId: number | null = 0
  if (!upl) {
    const devid = (prof.tracker_id as string) || ''
    if (!devid) hata(400, 'önce takip aç (cihaz yok)')
    traccarId = await cihazIdCoz(env, devid)                          // 02.09: D1 önce, Traccar yedek
    if (!traccarId) hata(503, "cihaz Traccar'da bulunamadı")
  }

  // req sözleşmesi (main.py:2562-2583 birebir; kabartma MÜHÜRLÜ false)
  const speed = ['fast', 'medium', 'slow', 'auto'].includes(body.speed as string) ? (body.speed as string) : 'medium'
  // 18.09: `tactical` modu KALKTI. Güncellenmemiş istemciler (Android 1.70 / iOS 1.67) hâlâ
  // gönderiyor → 402 yerine 3B'ye çevriliyor: kullanıcı hata değil gerçek bir video alır.
  const modeHam = bget(body, 'mode', 'flyover')
  const mode = modeHam === 'tactical' ? '3d' : modeHam
  // 🔴 FİKS 05.09: gövdede `music` anahtarı YOKSA sunucu da kullanıcının son yüklediği parçayı
  // ("active") seçiyordu — istemcideki otomatik seçimden AYRI üçüncü kaynak. Barış: "garip bir
  // müzik çalıyor, müzik seçmediğim halde". Varsayılan artık SESSİZ; müzik yalnız istemci
  // açıkça isterse eklenir.
  const music = 'music' in body ? body.music : ''
  const req: Record<string, unknown> = {
    device: traccarId, user,
    name: (prof.name as string) || user,
    from: pyFloat(bget(body, 'from', 0)), to: pyFloat(bget(body, 'to', nowF)),
    type: bget(body, 'type', 'moto'),
    mode,
    aspect: body.aspect === '4:5' ? '4:5' : body.aspect === '9:16' ? '9:16' : '16:9',
    speed,
    premium: !!bget(body, 'premium', false),
    music, ts: now,
    kabartma: false,                                                   // MÜHÜRLÜ (2026-08-11 Barış NİHAİ)
    line: bget(body, 'line', ''), dot: bget(body, 'dot', ''),
    camdist: ['yakin', 'orta', 'uzak'].includes(body.camdist as string) ? body.camdist : 'orta',
    lang: (prof.lang as string) || 'en',
    theme: ['thermal', 'night', 'day', 'auto'].includes(body.theme as string) ? body.theme : 'default',
    callsign: [...pyStr(bget(body, 'callsign', '')).toUpperCase()].filter((ch) => /[\p{L}\p{N} -]/u.test(ch)).join('').slice(0, 16),
    reel: !!body.reel,
    photodir: `${user}_${frmInt}`,
  }
  yaz.push(...videoRenkStmts(db, user, body))

  const kap = await bumpDailyCap(db, env.KV, user, prof, req.mode as string, req.speed as string, hakOdendi)
  if (!kap.ok) kapasiteHatasi(kap.why)
  yaz.push(...kap.stmts)

  // BENZERSİZ VIDEO ID: {gün}_{from}_{üretim_ts} (main.py:2602-2606)
  const day = trDay(frmInt)
  const vid = `${day}_${frmInt}_${now}`
  req.vid = vid
  if (upl) req.track = upl

  yaz.push(db.prepare(
    `INSERT OR REPLACE INTO pending_videos (vid, uid, date, ts, to_ts, ride_type, mode, queued_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?8)`,
  ).bind(vid, user, day, frmInt, Math.trunc(req.to as number), (req.type as string) ?? null, (req.mode as string) ?? null, now))
  yaz.push(db.prepare('DELETE FROM failed_videos WHERE vid = ?1').bind(vid))

  if (!profRow) yaz.unshift(db.prepare('INSERT OR IGNORE INTO users (uid, created_at, updated_at) VALUES (?1, ?2, ?2)').bind(user, now))
  await db.batch(yaz)                                                  // _save eşleniği: tek atomik yazım
  await kuyrugaGonder(env, req, user, now, vid)                        // genreq → Queue (sapma notu 5)
  return c.json({ ok: true, queued: `${user}_${now}.json`, vid })
})

// ════════════════════════════════════════════════════════════════════════════
// POST /api/rides/{ride_id}/regenerate — main.py:2636 (+ sözleşme emriyle IDOR kontrolü)
// ════════════════════════════════════════════════════════════════════════════
g.post('/api/rides/:ride_id/regenerate', authUser, async (c) => {
  const db = c.env.DB
  const env = c.env as ExtEnv
  const user = c.get('user')
  const rideId = c.req.param('ride_id')
  const body = await jsonBody(c)
  const parts = rideId.split('_')
  if (parts.length < 2) hata(400, 'geçersiz id')
  const day = parts[0], baseTs = parts[1]
  const profRow = await getUser(db, user)
  const prof: Prof = (profRow ?? {}) as unknown as Prof
  const yaz: D1PreparedStatement[] = []
  const now = simdi()

  // ⚠️ SAPMA 4 (sözleşme notu emri): orijinalde OLMAYAN sahiplik kontrolü — IDOR kapatıldı.
  if ((await rideOwner(db, rideId)) !== user) hata(404, 'rota bulunamadi')

  const src = await db.prepare('SELECT ts, to_ts FROM videos WHERE rid = ?1').bind(rideId).first<{ ts: number; to_ts: number }>()
  // yan meta dosyası rota_{day}_{ts}.json → D1 rides kolonları (cf_mapping)
  const meta = await db.prepare('SELECT ts, to_ts, ride_type FROM rides WHERE rid = ?1').bind(`${day}_${baseTs}`).first<{ ts: number; to_ts: number; ride_type: string | null }>()
  const frm = Number(src?.ts) || Number(meta?.ts) || pyFloat(baseTs)   // float(base_ts): sayı değilse 500
  let to = Number(src?.to_ts) || Number(meta?.to_ts) || Math.trunc(frm) + 2 * 3600

  if (!prof.premium) hata(402, 'video premium özelliği')

  // YÜKLENEN GPX/TCX izi + pencere fix'i (main.py:2654-2658)
  const frmInt = Math.trunc(frm)
  let upl: TrackPt[] | null = null
  const uplObj = await env.R2.get(`tracks/${frmInt}.json`)
  if (uplObj) { try { upl = (await uplObj.json()) as TrackPt[] } catch { upl = null } }
  if (upl && !upl.length) upl = null    // Python [] falsy paritesi (bkz. generate)
  if (upl && upl[upl.length - 1]?.t && to <= frm + 2 * 3600 + 1) to = Number(upl[upl.length - 1].t)

  let traccarId: number | null = 0
  if (!upl) {
    const devid = (prof.tracker_id as string) || ''
    if (!devid) hata(400, 'cihaz yok')
    traccarId = await cihazIdCoz(env, devid)                          // 02.09: D1 önce, Traccar yedek
    if (!traccarId) hata(503, "cihaz Traccar'da bulunamadı")
  }

  const speed = ['fast', 'medium', 'slow', 'auto'].includes(body.speed as string) ? (body.speed as string) : 'medium'
  // 🔴 FİKS 05.09: gövdede `music` anahtarı YOKSA sunucu da kullanıcının son yüklediği parçayı
  // ("active") seçiyordu — istemcideki otomatik seçimden AYRI üçüncü kaynak. Barış: "garip bir
  // müzik çalıyor, müzik seçmediğim halde". Varsayılan artık SESSİZ; müzik yalnız istemci
  // açıkça isterse eklenir.
  const music = 'music' in body ? body.music : ''
  const req: Record<string, unknown> = {
    device: traccarId, user,
    name: (prof.name as string) || user,
    from: frm, to,
    type: bget(body, 'type', meta?.ride_type ?? 'moto'),
    mode: bget(body, 'mode', 'flyover') === 'tactical' ? '3d' : bget(body, 'mode', 'flyover'),
    aspect: body.aspect === '9:16' ? '9:16' : '16:9',                  // regenerate'te 4:5 dalı YOK
    speed,
    premium: !!bget(body, 'premium', false),
    music, ts: now,
    kabartma: false,                                                   // MÜHÜRLÜ
    line: bget(body, 'line', ''), dot: bget(body, 'dot', ''),
    camdist: ['yakin', 'orta', 'uzak'].includes(body.camdist as string) ? body.camdist : 'orta',
    lang: (prof.lang as string) || 'en',
    theme: ['thermal', 'night', 'day', 'auto'].includes(body.theme as string) ? body.theme : 'default',
    callsign: [...pyStr(bget(body, 'callsign', '')).toUpperCase()].filter((ch) => /[\p{L}\p{N} -]/u.test(ch)).join('').slice(0, 16),
    reel: !!body.reel,
    photodir: `${user}_${frmInt}`,
  }
  yaz.push(...videoRenkStmts(db, user, body))

  const kap = await bumpDailyCap(db, env.KV, user, prof, req.mode as string, req.speed as string, false)
  if (!kap.ok) kapasiteHatasi(kap.why)
  yaz.push(...kap.stmts)

  const vid = `${day}_${frmInt}_${now}`                                // main.py:2707-2709
  req.vid = vid
  if (upl) req.track = upl

  yaz.push(db.prepare(
    `INSERT OR REPLACE INTO pending_videos (vid, uid, date, ts, to_ts, ride_type, mode, queued_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?8)`,
  ).bind(vid, user, day, frmInt, Math.trunc(to), (req.type as string) ?? null, (req.mode as string) ?? null, now))
  yaz.push(db.prepare('DELETE FROM failed_videos WHERE vid = ?1').bind(vid))

  if (!profRow) yaz.unshift(db.prepare('INSERT OR IGNORE INTO users (uid, created_at, updated_at) VALUES (?1, ?2, ?2)').bind(user, now))
  await db.batch(yaz)
  await kuyrugaGonder(env, req, user, now, vid)
  return c.json({ ok: true, queued: `${user}_${now}.json`, vid })
})

export default g
