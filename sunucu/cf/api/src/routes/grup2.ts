// grup2 — api/live + api/clubs (16 uç) — main.py birebir portu (GÖLGE MOD).
// Sözleşme: cf/contracts/grup2.json; davranış kaynağı: /opt/movelog/backend/main.py
//   canlı takip: 3141-3360 (start/get/beacon/hr-*), wave 3623, live_club 3643
//   kulüpler:    3758-3891 (_club_code/_club_out + 8 uç), _profile_of 1389-1407, _pushq 2986
//
// Kapsanan uçlar:
//   POST   /api/live/start        POST /api/clubs
//   GET    /api/live/hr-poll      GET  /api/clubs
//   POST   /api/live/beacon       GET  /api/clubs/{cid}
//   POST   /api/live/hr-request   POST /api/clubs/join
//   POST   /api/live/hr-report    POST /api/clubs/leave
//   POST   /api/live/hr-share     POST /api/clubs/kick
//   POST   /api/live/wave         POST /api/clubs/rename
//   GET    /api/live/club/{cid}
//   GET    /api/live/{username}   (hr-poll'dan ÖNCE kayıtlı — üretim sırası birebir, aşağıya bak)
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
// ⚠️ ÜRETİM BUG'I BİLİNÇLİ KOPYALANDI — Barış kararıyla düzeltilebilir (diff #2, 2026-08-30):
//   FastAPI'de GET /api/live/{username} (main.py:3168) rotası GET /api/live/hr-poll'dan (3354)
//   ÖNCE kayıtlı — Starlette ilk eşleşmeyi aldığı için canlıda hr-poll isteği live_get("hr-poll")
//   olarak işler: Ultra değilse 402 "Ultra gerekli", Ultra ise 403 "sadece arkadaşını izleyebilirsin"
//   (üretim ölçümü 2026-08-30: apple_golge_diff→402, u69be3f7e960e→403, appreview→403).
//   BİREBİR kuralı gereği burada da AYNI kayıt sırası uygulandı: /api/live/:username hr-poll'dan
//   ÖNCE kaydedilir (Hono da ilk kayıtlı eşleşmeyi çalıştırır — yerel testle kanıtlandı), böylece
//   hr-poll handler'ı üretimdeki gibi ÖLÜ ROTA kalır. DÜZELTME: hr-poll kaydını :username'in
//   önüne almak yeter (Nabız Peek ancak o zaman bu uçtan çalışır; main.py'de de aynısı gerekir).

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

/** _is_ultra (main.py:3124-3126): SADECE users.ultra — admin SAYILMAZ (sözleşme tuzağı). */
async function ultraSart(db: D1Database, user: string): Promise<void> {
  const r = await db.prepare('SELECT ultra FROM users WHERE uid = ?1').bind(user)
    .first<{ ultra: number | null }>()
  if (!r?.ultra) hata(402, 'Ultra gerekli')
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

// ---------------------------------------------------------------------------
// Kulüp yardımcıları (_club_code / _club_out — main.py:3764-3780)
// ---------------------------------------------------------------------------
const CLUB_MAX_PER_USER = 10
const CLUB_MAX_MEMBERS = 30
const KOD_ALFABE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'   // I,O,0,1 yok; 32 karakter

function kodUret(): string {
  const b = new Uint8Array(6)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => KOD_ALFABE[x & 31]).join('')
}

type KulupSatir = {
  cid: string; name: string | null; owner_uid: string | null
  join_code: string | null; created_at: number | null
}

/** Üye uid'leri KATILIM SIRASIYLA (JSON dizi sırası = joined sırası; devir mantığı buna dayanır). */
async function uyeListesi(db: D1Database, cid: string): Promise<string[]> {
  const r = await db.prepare('SELECT uid FROM club_members WHERE cid = ?1 ORDER BY created_at, rowid')
    .bind(cid).all<{ uid: string }>()
  return (r.results ?? []).map((x) => x.uid)
}

/** _club_out (main.py:3774-3780): member=false → code/members YOK. */
async function kulupCikti(env: Env, k: KulupSatir, uyeler: string[], uye: boolean): Promise<Record<string, unknown>> {
  const o: Record<string, unknown> = {
    id: k.cid, name: k.name ?? '', owner: k.owner_uid ?? '',
    member_count: uyeler.length, created: k.created_at ?? 0,
  }
  if (uye) {
    o.code = k.join_code ?? ''
    const pm = await profilleri(env, uyeler)
    o.members = uyeler.map((u) => pm.get(u))
  }
  return o
}

// ============================================================================
// CANLI TAKİP UÇLARI
// ============================================================================

// POST /api/live/start (main.py:3141-3165)
g.post('/api/live/start', authUser, async (c) => {
  const b = await govdeAl(c)
  const user = c.get('user')
  const target = b.user ? String(b.user) : ''
  const db = c.env.DB
  await ultraSart(db, user)
  await arkadasSart(db, user, target, 'sadece arkadaşını izleyebilirsin')
  const hedef = await db.prepare('SELECT tracker_id FROM users WHERE uid = ?1').bind(target)
    .first<{ tracker_id: string | null }>()
  let fresh = false
  if (hedef?.tracker_id) {
    const son = await db.prepare('SELECT MAX(ts) AS t FROM positions WHERE device = ?1')
      .bind(hedef.tracker_id).first<{ t: number | null }>()
    if (son?.t != null) fresh = simdi() - son.t < 120
  }
  if (!fresh) {
    // sessiz canlı-uyandırma: pushq/live_<target>_<ts>.json eşleniği ('user' anahtarı HEDEFİ taşır)
    await sessizPush(c.env, `live_${target}_${simdi()}`, target, 'live')
  }
  return c.json({ ok: true, fresh })
})

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

// GET /api/live/{username} (main.py:3168-3271) — KAYIT SIRASI ÜRETİM BİREBİR: hr-poll'dan ÖNCE.
// üretim bug'ı bilinçli kopyalandı — Barış kararıyla düzeltilebilir (bkz. dosya başı ⚠️ notu).
// Bu kayıt /api/live/hr-poll'u gölgeler: hr-poll istekleri liveGetUsername("hr-poll") olarak
// işler → 402 "Ultra gerekli" / 403 "sadece arkadaşını izleyebilirsin" (üretimle aynı).
g.get('/api/live/:username', authUser, liveGetUsername)

// GET /api/live/hr-poll (main.py:3354-3360) — üretimdeki gibi ÖLÜ ROTA (üstteki :username kaydı
// gölgeliyor; üretim bug'ı bilinçli kopyalandı — Barış kararıyla düzeltilebilir). Handler, rota
// düzeltilirse çalışacak DOĞRU davranışı (sözleşme: {want, share}) korumak için silinmedi.
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

// GET /api/live/club/{cid} (main.py:3643-3669) — konvoy görünümü; beacon fallback YOK
g.get('/api/live/club/:cid', authUser, async (c) => {
  const user = c.get('user')
  const cid = c.req.param('cid')
  const db = c.env.DB
  await ultraSart(db, user)
  const k = await db.prepare('SELECT cid, name FROM clubs WHERE cid = ?1').bind(cid)
    .first<{ cid: string; name: string | null }>()
  if (!k) hata(404, 'kulüp yok')
  type Uye = { uid: string; name: string | null; handle: string | null; tracker_id: string | null }
  const uyeler = ((await db.prepare(
    `SELECT m.uid, u.name, u.handle, u.tracker_id
       FROM club_members m LEFT JOIN users u ON u.uid = m.uid
      WHERE m.cid = ?1 ORDER BY m.created_at, m.rowid`).bind(cid).all<Uye>()).results ?? [])
  if (!uyeler.some((m) => m.uid === user)) hata(404, 'kulüp yok')   // IDOR: üye olmayana varlık sızmaz
  type Poz = { device: string; ts: number; lat: number; lon: number; spd: number | null; course: number | null }
  const pozlar = new Map<string, Poz>()
  const cihazlar = uyeler.map((m) => m.tracker_id).filter((t): t is string => !!t)
  if (cihazlar.length) {
    const ph = cihazlar.map((_, i) => `?${i + 1}`).join(', ')
    const rows = ((await db.prepare(
      `SELECT device, ts, lat, lon, spd, course FROM positions
        WHERE device IN (${ph})
          AND ts = (SELECT MAX(ts) FROM positions p2 WHERE p2.device = positions.device)`)
      .bind(...cihazlar).all<Poz>()).results ?? [])
    for (const p of rows) pozlar.set(p.device, p)
  }
  const now = simdi()
  const riders: Record<string, unknown>[] = []
  for (const m of uyeler) {
    const q = m.tracker_id ? pozlar.get(m.tracker_id) : undefined
    if (!q) continue                                  // konumu olmayan üye listeden atlanır
    riders.push({
      user: m.uid, name: m.name || m.handle || m.uid,
      lat: q.lat, lon: q.lon, spd: yuvarla1(q.spd || 0),
      age: Math.trunc(now - q.ts), course: Math.round(q.course || 0),
    })
  }
  return c.json({ riders, club: k.name ?? '' })
})

// GET /api/live/{username} gövdesi (main.py:3168-3271) — kayıt yukarıda, hr-poll'dan ÖNCE
// (üretim rota-sırası birebir; function declaration hoisted olduğu için erken kayıt güvenli).
async function liveGetUsername(c: Context<AppEnv, '/api/live/:username'>) {
  const user = c.get('user')
  const username = c.req.param('username')
  const db = c.env.DB
  await ultraSart(db, user)
  await arkadasSart(db, user, username, 'sadece arkadaşını izleyebilirsin')
  const prof = await getUser(db, username)
  const devid = prof?.tracker_id
  if (!devid) hata(404, 'cihaz yok')
  const now = simdi()
  type Poz = {
    device: string; ts: number; lat: number; lon: number; spd: number | null; alt: number | null
    hr: number | null; batt: number | null; course: number | null; acc: number | null; charging: number | null
  }
  const son = await db.prepare('SELECT * FROM positions WHERE device = ?1 ORDER BY ts DESC LIMIT 1')
    .bind(devid).first<Poz>()
  const bcn = await beaconOku(c.env, username, prof?.state_json)
  const hl = await c.env.KV.get<HrLive>(`hr_live:${username}`, 'json')
  const t0 = gunBasi(now)
  if (!son) {
    // Traccar konumu yok — app-açılış beacon'ı varsa "son bilinen" yanıtı (main.py:3187-3199)
    if (bcn && bcn.lat != null) {
      // main.py:3196 `_bcn["lon"]`: lat var ama lon ANAHTARI yoksa Python KeyError → 500 (birebir;
      // alanı sessizce düşürmek yanıt alan-kümesini bozar)
      if (bcn.lon === undefined) throw new Error("KeyError: 'lon' (main.py:3196 birebir)")
      const bage = Math.trunc(now - (bcn.ts || 0))
      const tkm = await gunlukKm(db, username, t0)
      return c.json({
        lat: bcn.lat, lon: bcn.lon, spd: 0.0, hr: canliNabiz(hl, now, null), alt: 0,
        age: bage, today_km: yuvarla1(tkm),
        batt: bcn.batt ?? null, charging: !!bcn.charging,
        course: 0, acc: 0, trail: [], ride_min: 0,
        avg_kmh: 0.0, max_kmh: 0.0, temp: null, wcode: null,
        name: prof?.name || prof?.handle || username,
      })
    }
    hata(404, 'konum yok')
  }
  let age = Math.trunc(now - son.ts)
  let hr: number | null = null
  if (son.hr != null) {
    const hv = Math.trunc(son.hr)
    if (hv > 25 && hv < 250) hr = hv                  // 25<hr<250 filtresi (main.py:3204-3211)
  }
  const tkm = await gunlukKm(db, username, t0)
  // son 15 dk iz + bugünün hız istatistikleri (main.py:3216-3242; hata olursa sıfır değerlerle sürer)
  let trail: number[][] = []
  let rideMin = 0
  let mxKmh = 0
  let spds: number[] = []
  try {
    const [r15, rGun] = await db.batch([
      db.prepare('SELECT lat, lon FROM positions WHERE device = ?1 AND ts >= ?2 AND ts <= ?3 ORDER BY ts')
        .bind(devid, now - 900, now),
      db.prepare('SELECT ts, spd FROM positions WHERE device = ?1 AND ts >= ?2 AND ts <= ?3 ORDER BY ts')
        .bind(devid, t0, now),
    ])
    const iz = (r15.results ?? []) as { lat: number; lon: number }[]
    trail = iz.map((q) => [yuvarla5(q.lat), yuvarla5(q.lon)]).slice(-120)
    const gunNoktalari = (rGun.results ?? []) as { ts: number; spd: number | null }[]
    spds = gunNoktalari.map((q) => q.spd || 0)        // D1'de spd ZATEN km/h
    for (const s of spds) if (s > mxKmh) mxKmh = s
    // bu sürüşün dakikası: sondan geriye, 240 sn'den büyük boşlukta kes; >5 km/h başlangıcı
    let lastT: number | null = null
    let startT: number | null = null
    for (let i = gunNoktalari.length - 1; i >= 0; i--) {
      const qt = gunNoktalari[i].ts
      if (lastT !== null && lastT - qt > 240) break
      if ((gunNoktalari[i].spd || 0) > 5) startT = qt
      lastT = qt
    }
    if (startT) rideMin = Math.trunc((now - startT) / 60)
  } catch { /* main.py'deki try/except eşleniği */ }
  const hareketli = spds.filter((x) => x > 5)
  const avgKmh = hareketli.length ? yuvarla1(hareketli.reduce((a, x) => a + x, 0) / hareketli.length) : 0.0
  const [wt, wc] = await havaDurumu(c.env, son.lat, son.lon)
  let batt: number | null = null
  if (son.batt != null) {
    const bi = Math.trunc(son.batt)
    if (bi >= 0 && bi <= 100) batt = bi
  }
  // BEACON ÜSTÜNLÜĞÜ (main.py:3253-3259): beacon son fix'ten yeniyse konum/batarya/yaş beacon'dan
  let lat = son.lat, lon = son.lon
  let spd = yuvarla1(son.spd || 0)
  let crs = Math.round(son.course || 0)
  let chg = !!son.charging
  if (bcn && bcn.ts && bcn.ts > now - age && bcn.lat != null) {
    // main.py:3256 `_bcn["lon"]`: lat var ama lon ANAHTARI yoksa Python KeyError → 500 (birebir;
    // `bcn.lon!` undefined kalsaydı JSON'da 'lon' anahtarı sessizce DÜŞERDİ — alan kümesi bozulur)
    if (bcn.lon === undefined) throw new Error("KeyError: 'lon' (main.py:3256 birebir)")
    age = Math.trunc(now - bcn.ts)
    lat = bcn.lat; lon = bcn.lon; spd = 0.0; crs = 0
    if (bcn.batt != null) batt = bcn.batt
    chg = !!bcn.charging
  }
  hr = canliNabiz(hl, now, hr)                        // taze nabız peek Traccar nabzının önüne geçer
  return c.json({
    lat, lon, spd,
    hr, alt: Math.round(son.alt || 0),
    age, today_km: yuvarla1(tkm),
    batt, charging: chg,
    course: crs,
    acc: Math.round(son.acc || 0),
    trail, ride_min: rideMin,
    avg_kmh: avgKmh, max_kmh: yuvarla1(mxKmh),
    temp: wt, wcode: wc,
    name: prof?.name || prof?.handle || username,
  })
}

// ============================================================================
// KULÜP UÇLARI
// ============================================================================

// GET /api/clubs (main.py:3783-3789) — üye görünümü DEĞİL: code/members yok; yeniden eskiye
g.get('/api/clubs', authUser, async (c) => {
  const user = c.get('user')
  const rows = ((await c.env.DB.prepare(
    `SELECT c.cid, c.name, c.owner_uid, c.created_at,
            (SELECT COUNT(*) FROM club_members cm WHERE cm.cid = c.cid) AS mc
       FROM clubs c JOIN club_members m ON m.cid = c.cid
      WHERE m.uid = ?1
      ORDER BY c.created_at DESC, c.rowid`).bind(user)
    .all<{ cid: string; name: string | null; owner_uid: string | null; created_at: number | null; mc: number }>())
    .results ?? [])
  return c.json({
    clubs: rows.map((r) => ({
      id: r.cid, name: r.name ?? '', owner: r.owner_uid ?? '',
      member_count: r.mc, created: r.created_at ?? 0,
    })),
  })
})

// POST /api/clubs (main.py:3792-3805)
g.post('/api/clubs', authUser, async (c) => {
  const b = await govdeAl(c)
  const user = c.get('user')
  const name = pyStr(b.name).trim().slice(0, 40)     // str(body.get("name","")) — null → 'None' (birebir)
  if (name.length < 3) hata(400, 'grup adı en az 3 karakter')
  const db = c.env.DB
  // kota ÜYE OLUNAN grup sayısıdır, sahiplik değil (sözleşme notu)
  const sayi = await db.prepare('SELECT COUNT(*) AS n FROM club_members WHERE uid = ?1').bind(user)
    .first<{ n: number }>()
  if ((sayi?.n ?? 0) >= CLUB_MAX_PER_USER) hata(400, 'grup sınırına ulaştın')
  const now = simdi()
  const cid = `c${now}${hexUret(3)}`
  let code = ''
  for (let i = 0; i < 50; i++) {
    const aday = kodUret()
    const varMi = await db.prepare('SELECT 1 AS x FROM clubs WHERE join_code = ?1').bind(aday).first()
    if (!varMi) { code = aday; break }
  }
  if (!code) hata(500, 'kod üretilemedi')
  await db.batch([
    db.prepare('INSERT INTO clubs (cid, name, owner_uid, join_code, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)')
      .bind(cid, name, user, code, now),
    db.prepare('INSERT INTO club_members (cid, uid, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)')
      .bind(cid, user, now),
  ])
  return c.json(await kulupCikti(c.env, { cid, name, owner_uid: user, join_code: code, created_at: now }, [user], true))
})

// POST /api/clubs/join (main.py:3827-3848) — İDEMPOTENT; Ultra/arkadaşlık ŞARTSIZ; 10-grup kotası YOK
const _CLUB_JOIN_B: Record<string, string> = {
  en: '{u} joined your group {g} 🏍️', tr: '{u}, {g} grubuna katıldı 🏍️',
  ar: 'انضم {u} إلى مجموعتك {g} 🏍️', es: '{u} se unió a tu grupo {g} 🏍️',
  fr: '{u} a rejoint ton groupe {g} 🏍️', ru: '{u} присоединился к твоей группе {g} 🏍️',
  de: '{u} ist deiner Gruppe {g} beigetreten 🏍️', it: '{u} si è unito al tuo gruppo {g} 🏍️',
  pt: '{u} entrou no seu grupo {g} 🏍️', ja: '{u}さんがグループ{g}に参加しました🏍️',
  zh: '{u} 加入了你的车队 {g} 🏍️', ko: '{u}님이 {g} 그룹에 참여했어요 🏍️',
  hi: '{u} आपके ग्रुप {g} में शामिल हुए 🏍️',
}

g.post('/api/clubs/join', authUser, async (c) => {
  const b = await govdeAl(c)
  const user = c.get('user')
  const code = pyStr(b.code).trim().toUpperCase()    // str(body.get("code","")) birebir
  if (code.length !== 6) hata(400, 'geçersiz kod')
  const db = c.env.DB
  const k = await db.prepare('SELECT cid, name, owner_uid, join_code, created_at FROM clubs WHERE join_code = ?1')
    .bind(code).first<KulupSatir>()
  if (!k) hata(404, 'kod bulunamadı')
  const uyeler = await uyeListesi(db, k.cid)
  if (uyeler.includes(user))                          // zaten üye: aynı görünüm, push ATILMAZ
    return c.json(await kulupCikti(c.env, k, uyeler, true))
  if (uyeler.length >= CLUB_MAX_MEMBERS) hata(400, 'grup dolu')
  const now = simdi()
  await db.prepare('INSERT INTO club_members (cid, uid, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)')
    .bind(k.cid, user, now).run()
  const yeniUyeler = [...uyeler, user]
  const cikti = await kulupCikti(c.env, k, yeniUyeler, true)
  // kurucuya KENDİ dilinde push (main.py:3842-3846)
  const ben = (cikti.members as Profil[]).find((p) => p.username === user)
  const ow = k.owner_uid ?? ''
  const owner = await db.prepare('SELECT lang FROM users WHERE uid = ?1').bind(ow)
    .first<{ lang: string | null }>()
  const lng = owner?.lang || 'en'
  const metin = (_CLUB_JOIN_B[lng] || _CLUB_JOIN_B.en)
    .split('{u}').join(ben?.name || '@' + (ben?.handle || 'rider'))
    .split('{g}').join(k.name ?? '')
  await pushKuyruk(c.env, ow, 'Move Log', metin)
  return c.json(cikti)
})

// POST /api/clubs/leave (main.py:3851-3864)
g.post('/api/clubs/leave', authUser, async (c) => {
  const b = await govdeAl(c)
  const user = c.get('user')
  const cid = pyStr(b.id)                            // str(body.get("id","")) birebir
  const db = c.env.DB
  const k = await db.prepare('SELECT cid, owner_uid FROM clubs WHERE cid = ?1').bind(cid)
    .first<{ cid: string; owner_uid: string | null }>()
  const uyeler = k ? await uyeListesi(db, cid) : []
  if (!k || !uyeler.includes(user)) hata(404, 'grup bulunamadı')
  // Python tek atomik _save yapar — üye silme + grup silme/devir birlikte batch'te (D1 batch atomik)
  const sil = db.prepare('DELETE FROM club_members WHERE cid = ?1 AND uid = ?2').bind(cid, user)
  const kalan = uyeler.filter((u) => u !== user)
  if (kalan.length === 0) {
    await db.batch([sil, db.prepare('DELETE FROM clubs WHERE cid = ?1').bind(cid)])   // son üye çıktı → grup silinir
  } else if (k.owner_uid === user) {
    // kuruculuk EN ESKİ üyeye devrolur (katılım sırası — uyeListesi created_at,rowid sıralı)
    await db.batch([sil, db.prepare('UPDATE clubs SET owner_uid = ?1, updated_at = ?2 WHERE cid = ?3')
      .bind(kalan[0], simdi(), cid)])
  } else {
    await sil.run()
  }
  return c.json({ ok: true })
})

// POST /api/clubs/kick (main.py:3867-3877) — kulüp YOKSA da 403 (404 değil); no-op'ta da {ok:true}
g.post('/api/clubs/kick', authUser, async (c) => {
  const b = await govdeAl(c)
  const user = c.get('user')
  const cid = pyStr(b.id)                            // str(body.get("id","")) birebir
  const target = pyStr(b.user)                       // str(body.get("user","")) birebir
  const db = c.env.DB
  const k = await db.prepare('SELECT owner_uid FROM clubs WHERE cid = ?1').bind(cid)
    .first<{ owner_uid: string | null }>()
  if (!k || k.owner_uid !== user) hata(403, 'sadece kurucu çıkarabilir')
  if (target !== user)                                // kurucu kendini kick edemez; hedef üye değilse no-op
    await db.prepare('DELETE FROM club_members WHERE cid = ?1 AND uid = ?2').bind(cid, target).run()
  return c.json({ ok: true })
})

// POST /api/clubs/rename (main.py:3880-3891) — kontrol SIRASI: önce owner (403), SONRA ad (400)
g.post('/api/clubs/rename', authUser, async (c) => {
  const b = await govdeAl(c)
  const user = c.get('user')
  const cid = pyStr(b.id)                            // str(body.get("id","")) birebir
  const name = pyStr(b.name).trim().slice(0, 40)     // null → 'None' (4 karakter, GEÇERLİ ad — birebir)
  const db = c.env.DB
  const k = await db.prepare('SELECT cid, name, owner_uid, join_code, created_at FROM clubs WHERE cid = ?1')
    .bind(cid).first<KulupSatir>()
  if (!k || k.owner_uid !== user) hata(403, 'sadece kurucu yeniden adlandırır')
  if (name.length < 3) hata(400, 'grup adı en az 3 karakter')
  await db.prepare('UPDATE clubs SET name = ?1, updated_at = ?2 WHERE cid = ?3')
    .bind(name, simdi(), cid).run()
  const uyeler = await uyeListesi(db, cid)
  return c.json(await kulupCikti(c.env, { ...k, name }, uyeler, true))
})

// GET /api/clubs/{cid} (main.py:3808-3814) — üye olmayana 403 değil 404 (varlık da gizlenir)
g.get('/api/clubs/:cid', authUser, async (c) => {
  const user = c.get('user')
  const cid = c.req.param('cid')
  const k = await c.env.DB.prepare('SELECT cid, name, owner_uid, join_code, created_at FROM clubs WHERE cid = ?1')
    .bind(cid).first<KulupSatir>()
  if (!k) hata(404, 'grup bulunamadı')
  const uyeler = await uyeListesi(c.env.DB, cid)
  if (!uyeler.includes(user)) hata(404, 'grup bulunamadı')
  return c.json(await kulupCikti(c.env, k, uyeler, true))
})

export default g
