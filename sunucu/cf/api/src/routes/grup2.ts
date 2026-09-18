// grup2 — api/live (7 uç). 18.09: KULÜPLER + Ultra'ya bağlı canlı takip uçları KALDIRILDI.
// Sözleşme: cf/contracts/grup2.json; davranış kaynağı: /opt/movelog/backend/main.py
//
// Kapsanan uçlar:
//   GET    /api/live/hr-poll
//   POST   /api/live/beacon
//   POST   /api/live/hr-request
//   POST   /api/live/hr-report
//   POST   /api/live/hr-share
//   POST   /api/live/wave
//
// cf_mapping çevirileri (sözleşme kuralı 3):
//   Traccar 127.0.0.1:8084          → D1 positions (spd ZATEN km/h — şema kararı, ×1.852 YOK)
//   DATA_DIR/pushq dosya kuyruğu    → KV "push:bekleyen:<ad>" kayıtları (Faz 3'te gerçek APNs/FCM)
//   last_beacon / hr_live / hr_want_until / hr_woke → KV sıcak durum (beacon:<uid> kalıcı,
//       hr_live:<uid> / hr_want:<uid> / hr_woke:<uid> TTL 60 sn); beacon okuma D1
//       state_json.last_beacon'a (içe aktarılan eski veri) geri düşer
//   open-meteo _WCACHE (süreç-içi)  → KV wx:<lat0.1>:<lon0.1> (TTL 900 sn)
//   /opt/movelog/data/sv-kapali dosya bayrağı → lib/ortak svKapali (tek KV anahtarı "sv_off")
//   hr_share (kalıcı gizlilik)      → D1 users.prefs_json.$.hr_share (tek-deyim json_set sözleşmesi)
//
// ✅ 18.09 — ÜRETİMDEKİ ROTA-GÖLGESİ BUG'I ARTIK YOK (kaldırmanın yan faydası):
//   Eskiden GET /api/live/{username} kaydı GET /api/live/hr-poll'u gölgeliyordu (hem Starlette hem
//   Hono ilk eşleşen kaydı çalıştırır) → hr-poll istekleri live_get("hr-poll") olarak işlenip
//   402 "Ultra gerekli" / 403 "sadece arkadaşını izleyebilirsin" dönüyordu (üretim ölçümü 30.08).
//   :username Ultra kapısına bağlı olduğu için Ultra ile birlikte KALDIRILDI; gölge de kalktı,
//   Nabız Peek (hr-poll) artık gerçekten erişilebilir. Uç sözleşmesi değişmedi: {want, share}.

import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv, Env } from '../lib/env'
import { authUser } from '../lib/auth'
import { getUser, jsonGet, simdi } from '../lib/db'
import { hata, Hata } from '../lib/hata'
import { pushq, svKapali } from '../lib/ortak'

const g = new Hono<AppEnv>()

// ============================================================================
// Ortak yardımcılar (grup2'ye özel — lib'e dokunulmadı, kural 5)
// ============================================================================

/** FastAPI `body: dict = Body(...)` eşleniği: gövde yok/bozuk/dict-değil → 422 (FastAPI detail şekli). */
async function govdeAl(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  let ham = ''
  try { ham = await c.req.text() } catch { ham = '' }
  if (!ham)
    throw new Hata(422, [{ type: 'missing', loc: ['body'], msg: 'Field required', input: null }])
  let v: unknown
  try { v = JSON.parse(ham) } catch {
    throw new Hata(422, [{ type: 'json_invalid', loc: ['body', 0], msg: 'JSON decode error', input: {}, ctx: { error: 'Expecting value' } }])
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v))
    throw new Hata(422, [{ type: 'dict_type', loc: ['body'], msg: 'Input should be a valid dictionary', input: v }])
  return v as Record<string, unknown>
}

/** Python float(x) eşleniği: sayı/sayısal-string/bool → number, aksi (None dahil) → null (çağıran atlar). */
function pySayi(v: unknown): number | null {
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const s = v.trim()
    if (s && /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return parseFloat(s)
  }
  return null
}

/** Python str(x) eşleniği (dict.get gövde alanları için): None→'None', bool→'True'/'False'.
 *  main.py kulüp uçları `str(body.get("k",""))` kullanır (falsy-koruması YOK) — name=null
 *  Python'da "None" (4 karakter, geçerli ad!) olur; String(v ?? '') bunu 400'e çevirirdi. */
function pyStr(v: unknown): string {
  if (v === undefined) return ''                    // .get("k","") — anahtar yok → varsayılan ''
  if (v === null) return 'None'
  if (v === true) return 'True'
  if (v === false) return 'False'
  return String(v)
}

const yuvarla1 = (x: number) => Math.round(x * 10) / 10          // Python round(x, 1)
const yuvarla5 = (x: number) => Math.round(x * 1e5) / 1e5        // Python round(x, 5)

/** TR = UTC+3 sabit dilim: bugünün 00:00 epoch'u (main.py TR kullanımı birebir). */
const gunBasi = (now: number) => Math.floor((now + 3 * 3600) / 86400) * 86400 - 3 * 3600

/** secrets.token_hex(n) eşleniği: n bayt → 2n hex karakter. */
function hexUret(n: number): string {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}


/** friends[user] üyelik şartı (yönlü kenar: uid → friend_uid). */
async function arkadasSart(db: D1Database, user: string, hedef: string, mesaj: string): Promise<void> {
  const r = await db.prepare('SELECT 1 AS x FROM friends WHERE uid = ?1 AND friend_uid = ?2')
    .bind(user, hedef).first()
  if (!r) hata(403, mesaj)
}

/** _pushq (main.py:2986-2997) eşleniği — lib/ortak pushq'ya devredildi (bütünleştirme 08-30). */
async function pushKuyruk(env: Env, user: string, title: string, body: string, route?: string): Promise<void> {
  await pushq(env, user, title, body, route)
}

/** Sessiz push kaydı (pushq/live_* ve hr_* dosyaları) → KV. Python'da yazım SARILI DEĞİL — hata fırlar. */
async function sessizPush(env: Env, anahtar: string, target: string, tur: string): Promise<void> {
  await env.KV.put(`push:bekleyen:${anahtar}`, JSON.stringify({ user: target, silent: tur }), { expirationTtl: 3600 })
}

type Beacon = { ts?: number; lat?: number; lon?: number; batt?: number | null; charging?: boolean }
type HrLive = { hr?: number; ts?: number }

/** last_beacon: önce KV (taze yazımlar), yoksa D1 state_json.last_beacon (içe aktarılan eski veri). */
async function beaconOku(env: Env, uid: string, stateJson: string | null | undefined): Promise<Beacon | null> {
  const v = await env.KV.get<Beacon>(`beacon:${uid}`, 'json')
  if (v) return v
  if (stateJson) {
    try {
      const st = JSON.parse(stateJson) as { last_beacon?: Beacon }
      if (st && st.last_beacon) return st.last_beacon
    } catch { /* bozuk state_json → beacon yok say */ }
  }
  return null
}

/** _live_hr (main.py:3129-3138): hr_live <12 sn tazeyse onu, değilse base'i döndür. */
function canliNabiz(hl: HrLive | null, now: number, base: number | null): number | null {
  if (hl && hl.hr && now - (hl.ts || 0) < 12) return Math.trunc(hl.hr)
  return base
}

/** _weather_at (main.py:3105-3121): open-meteo + KV önbelleği (0.1° hücre, 900 sn). */
async function havaDurumu(env: Env, lat: number, lon: number): Promise<[number | null, number | null]> {
  const anahtar = `wx:${lat.toFixed(1)}:${lon.toFixed(1)}`
  try {
    const onbellek = await env.KV.get<{ t: number | null; w: number | null }>(anahtar, 'json')
    if (onbellek) return [onbellek.t ?? null, onbellek.w ?? null]
  } catch { /* önbellek okunamazsa canlıya düş */ }
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code`)
    const j = (await r.json()) as { current?: { temperature_2m?: number; weather_code?: number } } | null
    const cur = j?.current ?? {}
    const t = cur.temperature_2m ?? null
    const w = cur.weather_code ?? null
    try { await env.KV.put(anahtar, JSON.stringify({ t, w }), { expirationTtl: 900 }) } catch { /* önbelleksiz devam */ }
    return [t, w]
  } catch {
    return [null, null]
  }
}

/** detected_rides bugünkü km toplamı (main.py:3192/3213 — uid TAM eşitlik, _own fallback YOK). */
async function gunlukKm(db: D1Database, uid: string, t0: number): Promise<number> {
  const r = await db.prepare('SELECT COALESCE(SUM(km), 0) AS t FROM rides WHERE uid = ?1 AND ts >= ?2')
    .bind(uid, t0).first<{ t: number }>()
  return r?.t ?? 0
}

// ---------------------------------------------------------------------------
// _profile_of (main.py:1389-1407) — toplu sürüm (kulüp üye listeleri için tek sorgu)
// ---------------------------------------------------------------------------
type Profil = {
  username: string; name: string; handle: string; avatar: unknown
  premium: boolean; ultra: boolean; sv_off: boolean
  sokak_hak: number; video_hak: number; sokak_hediye: false
  free_tactical: boolean; admin: boolean
}

async function profilleri(env: Env, uids: string[]): Promise<Map<string, Profil>> {
  const out = new Map<string, Profil>()
  if (uids.length === 0) return out
  type Satir = {
    uid: string; name: string | null; handle: string | null; avatar_json: string | null
    premium: number | null; ultra: number | null; admin: number | null
    sokak_hak: number | null; video_hak: number | null
    free_tactical_used: number | null; attest_key: string | null
  }
  const ph = uids.map((_, i) => `?${i + 1}`).join(', ')
  const rows = ((await env.DB.prepare(
    `SELECT uid, name, handle, avatar_json, premium, ultra, admin, sokak_hak, video_hak,
            free_tactical_used, attest_key
       FROM users WHERE uid IN (${ph})`).bind(...uids).all<Satir>()).results ?? [])
  const satirlar = new Map(rows.map((r) => [r.uid, r]))
  // bedava-taktik kill-switch (config; yoksa varsayılan AÇIK — main.py:1406 db.get(..., True))
  let ftAcik = true
  const cfg = await env.DB.prepare("SELECT value_json FROM config WHERE key = 'free_tactical_enabled'")
    .first<{ value_json: string }>()
  if (cfg) { try { ftAcik = !!JSON.parse(cfg.value_json) } catch { ftAcik = true } }
  // sv-kapali dosya bayrağı → lib/ortak svKapali (tek KV anahtarı 'sv_off'; bütünleştirme 08-30)
  const svOff = await svKapali(env)
  // free_tactical cihaz-dedup (free_tactical_devices tablosu)
  const cihazSeti = new Set<string>()
  const anahtarlar = rows.map((r) => r.attest_key).filter((k): k is string => !!k)
  if (anahtarlar.length) {
    const ph2 = anahtarlar.map((_, i) => `?${i + 1}`).join(', ')
    const dr = ((await env.DB.prepare(
      `SELECT attest_key FROM free_tactical_devices WHERE attest_key IN (${ph2})`)
      .bind(...anahtarlar).all<{ attest_key: string }>()).results ?? [])
    for (const d of dr) cihazSeti.add(d.attest_key)
  }
  for (const u of uids) {
    const r = satirlar.get(u)
    let avatar: unknown = null
    if (r?.avatar_json) { try { avatar = JSON.parse(r.avatar_json) } catch { avatar = null } }
    // Python: p.get("avatar") or {"type":"initials"} — boş dict de falsy sayılır
    if (!avatar || (typeof avatar === 'object' && Object.keys(avatar as object).length === 0))
      avatar = { type: 'initials' }
    out.set(u, {
      username: u,
      name: r?.name || u,
      handle: r?.handle || '',
      avatar,
      premium: !!r?.premium,
      ultra: !!(r?.ultra || r?.admin),               // _profile_of'ta admin ultra SAYILIR (1395)
      sv_off: svOff,
      sokak_hak: Math.trunc(Number(r?.sokak_hak ?? 0)) || 0,
      video_hak: Math.trunc(Number(r?.video_hak ?? 0)) || 0,
      sokak_hediye: false,                            // kalıcı kural (main.py:1405)
      free_tactical: !!(ftAcik && !(r?.ultra || r?.admin) && !r?.free_tactical_used
        && (!r?.attest_key || !cihazSeti.has(r.attest_key))),
      admin: !!r?.admin,
    })
  }
  return out
}

// CANLI TAKİP UÇLARI
// ============================================================================

// POST /api/live/beacon (main.py:3276-3293) — Ultra/arkadaş şartı YOK, herkes kendi beacon'ını yazar
g.post('/api/live/beacon', authUser, async (c) => {
  const b = await govdeAl(c)
  const user = c.get('user')
  const bcn: Record<string, unknown> = { ts: simdi() }
  for (const alan of ['lat', 'lon'] as const) {
    const v = pySayi(b[alan])
    if (v !== null) bcn[alan] = v                     // parse edilemezse alan yazılmaz (hata dönmez)
  }
  const bv = pySayi(b.batt)
  if (bv !== null) {
    const bi = Math.trunc(bv)
    if (bi >= 0 && bi <= 100) bcn.batt = bi           // aralık dışı sessizce atılır
  }
  bcn.charging = !!b.charging
  await c.env.KV.put(`beacon:${user}`, JSON.stringify(bcn))   // TTL YOK: "son bilinen durum" kalıcı
  return c.json({ ok: true })
})

// POST /api/live/hr-request (main.py:3301-3323) — Ultra şartı YOK, arkadaşlık yeter
g.post('/api/live/hr-request', authUser, async (c) => {
  const b = await govdeAl(c)
  const user = c.get('user')
  const target = b.user ? String(b.user) : ''
  await arkadasSart(c.env.DB, user, target, 'sadece arkadaşını izleyebilirsin')
  const paylasir = await jsonGet<number>(c.env.DB, target, 'prefs_json', 'hr_share')
  if (paylasir !== null && !paylasir) {
    // hedef nabız paylaşımını kapattı — 200 döner, 'age' ANAHTARI YOK (main.py:3310)
    return c.json({ ok: false, reason: 'off', hr: null })
  }
  const now = simdi()
  await c.env.KV.put(`hr_want:${target}`, String(now + 25), { expirationTtl: 60 })
  const woke = Number(await c.env.KV.get(`hr_woke:${target}`)) || 0
  if (woke < now - 15) {                              // uyandırma kısması: 15 sn'de en çok 1 sessiz push
    await c.env.KV.put(`hr_woke:${target}`, String(now), { expirationTtl: 60 })
    await sessizPush(c.env, `hr_${target}_${now}`, target, 'hrpeek')
  }
  const hl = await c.env.KV.get<HrLive>(`hr_live:${target}`, 'json')
  const taze = !!(hl && hl.hr && now - (hl.ts || 0) < 12)
  return c.json({
    ok: true,
    hr: taze ? Math.trunc(hl!.hr!) : null,
    age: taze ? now - Math.trunc(hl!.ts ?? now) : null,
  })
})

// POST /api/live/hr-report (main.py:3326-3341) — ölçülen tarafın saati/telefonu çağırır
g.post('/api/live/hr-report', authUser, async (c) => {
  const b = await govdeAl(c)
  const user = c.get('user')
  const now = simdi()
  const hv = Math.trunc(pySayi(b.hr) ?? 0)            // parse hatası → 0 → kaydedilmez ama 200 döner
  if (hv > 25 && hv < 250)
    await c.env.KV.put(`hr_live:${user}`, JSON.stringify({ hr: hv, ts: now }), { expirationTtl: 60 })
  const wantUntil = Number(await c.env.KV.get(`hr_want:${user}`)) || 0
  return c.json({ ok: true, want: now < wantUntil })
})

// POST /api/live/hr-share (main.py:3344-3351) — kalıcı gizlilik tercihi → D1 prefs_json (tek deyim)
g.post('/api/live/hr-share', authUser, async (c) => {
  const b = await govdeAl(c)
  const user = c.get('user')
  const acik = 'on' in b ? !!b.on : true              // bool(body.get("on", True))
  const now = simdi()
  // setdefault eşleniği: satır yoksa oluştur, varsa tek-deyim json_set (SEMA-NOTLARI sözleşmesi)
  await c.env.DB.prepare(
    `INSERT INTO users (uid, prefs_json, created_at, updated_at)
     VALUES (?1, json_object('hr_share', json(?2)), ?3, ?3)
     ON CONFLICT(uid) DO UPDATE SET
       prefs_json = json_set(COALESCE(prefs_json, '{}'), '$.hr_share', json(?2)),
       updated_at = ?3`)
    .bind(user, JSON.stringify(acik), now).run()
  return c.json({ ok: true, hr_share: acik })
})

// GET /api/live/hr-poll (main.py:3354-3360) — 18.09'dan beri GERÇEKTEN ERİŞİLEBİLİR.
// Eskiden üstteki `/api/live/:username` kaydı bunu gölgeliyordu (üretim bug'ı bilinçli kopyalanmıştı);
// o kayıt Ultra'ya bağlı olduğu için kaldırılınca gölge de kalktı. Davranış sözleşmedeki gibi: {want, share}.
g.get('/api/live/hr-poll', authUser, async (c) => {
  const user = c.get('user')
  const now = simdi()
  const wantUntil = Number(await c.env.KV.get(`hr_want:${user}`)) || 0
  const paylasir = await jsonGet<number>(c.env.DB, user, 'prefs_json', 'hr_share')
  return c.json({ want: now < wantUntil, share: paylasir === null ? true : !!paylasir })
})

// POST /api/live/wave (main.py:3623-3640) — Ultra şartı YOK; rate-limit YOK (gölge modda birebir)
const _WV: Record<string, string> = {
  en: '{n} is watching your ride and waved 👋', tr: '{n} sürüşünü izliyor ve el salladı 👋',
  es: '{n} está viendo tu ruta y te saludó 👋', fr: '{n} suit ta ride et te fait coucou 👋',
  de: '{n} schaut deiner Fahrt zu und winkt 👋', it: '{n} sta guardando il tuo giro e ti saluta 👋',
  pt: '{n} está vendo seu rolê e acenou 👋', ru: '{n} следит за твоей поездкой и машет 👋',
  ja: '{n}さんがライドを見て手を振っています👋', zh: '{n} 正在看你骑行，向你挥手 👋',
  ko: '{n}님이 라이딩을 지켜보며 손을 흔들어요 👋', ar: '{n} يشاهد رحلتك ويلوّح لك 👋',
  hi: '{n} आपकी राइड देख रहे हैं और हाथ हिलाया 👋',
}

g.post('/api/live/wave', authUser, async (c) => {
  const b = await govdeAl(c)
  const user = c.get('user')
  const target = b.user ? String(b.user) : ''
  const db = c.env.DB
  await arkadasSart(db, user, target, 'sadece arkadaşına')
  // sadece name/handle/lang gerekir — _profile_of'un kalan alanları push metnine girmez
  const ben = await db.prepare('SELECT name, handle FROM users WHERE uid = ?1').bind(user)
    .first<{ name: string | null; handle: string | null }>()
  const hedef = await db.prepare('SELECT lang FROM users WHERE uid = ?1').bind(target)
    .first<{ lang: string | null }>()
  const ad = (ben?.name || user) || '@' + (ben?.handle || 'rider')   // _profile_of.name = p.name or u
  const lng = hedef?.lang || 'en'                     // push metni HEDEFİN dilinde
  const metin = (_WV[lng] || _WV.en).split('{n}').join(ad)
  await pushKuyruk(c.env, target, 'Move Log 👋', metin, 'profile')
  return c.json({ ok: true })
})

export default g
