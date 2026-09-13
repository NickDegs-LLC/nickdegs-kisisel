// grup5 — api/admin + api/summary + api/voicecall + api/chat (16 uç) — TAMAM (2026-08-30).
// Sözleşme: cf/contracts/grup5.json (davranış birebir; kaynak main.py satırları yorumlarda).
// Uçlar TAM yol ile eklenir (mount kökü '/').
//
// Kapsanan uçlar (16/16 portlandı, 501 YOK):
//   POST   /api/admin/announce          (main.py:1894)  → D1 config['announcement']  ⚠️ bkz not-1
//   POST   /api/admin/broadcast         (main.py:1911)  → KV push:bekleyen:bc_<ts>
//   POST   /api/admin/costs             (main.py:1928)  → D1 gpu_costs SELECT
//   POST   /api/admin/gencodes          (main.py:1953)  → D1 gift_codes
//   GET    /api/summary/settings        (main.py:2809)  → D1 users kolonları + prefs_json
//   PUT    /api/summary/settings        (main.py:2814)  → TEK deyim json_set + kolonlar
//   POST   /api/summary/now             (main.py:2845)  → Queue RENDER_Q {type:'summary'}
//   POST   /api/summary/range           (main.py:2857)  → Queue RENDER_Q {type:'range'}
//   POST   /api/voicecall/invite        (main.py:3498)  → state_json.vc_invite + KV push
//   POST   /api/voicecall/respond       (main.py:3515)  → vc_invite tüket + vc_go yaz
//   GET    /api/voicecall/status        (main.py:3536)  → salt okuma, 90sn bayatlama
//   GET    /api/voicecall/token         (main.py:3549)  → LiveKit HS256 JWT (WebCrypto)
//   GET    /api/chat/list               (main.py:4044)  → dm_messages/dm_reads/friends
//   GET    /api/chat/with/:other        (main.py:4068)
//   POST   /api/chat/send               (main.py:4077)
//   GET    /api/chat/poll               (main.py:4097)
//
// NOT-1 (sözleşme sapması, bilinçli): grup5.json cf_mapping announce için "KV: announcement" der,
//   ama şema kararı daha yeni ve daha bağlayıcı — 0001_init.sql `config` tablosu 'announcement'
//   anahtarını D1'e koydu (SEMA-NOTLARI: "KV yerine D1: gölge-mod diff'i ve import tek depodan").
//   Okuyucu uç GET /api/announcement (başka grup) de api.json'da "KV veya D1 tek satır" der —
//   import config tablosuna yazacağı için D1 seçildi; iki uç aynı depoyu kullanmalı.
// NOT-2: push kuyruğu (pushq/broadcast) global kural 3 gereği ŞİMDİLİK KV "push:bekleyen:*"
//   kaydı — Faz 3'te gerçek APNs/FCM. bc_<ts> aynı-saniye ÜZERİNE-yazma davranışı KV put ile
//   birebir korunur (main.py:1924 tuzağı).
// NOT-3: presence (seen/_touch) sözleşmedeki cf_mapping gereği KV `seen:<uid>` (TTL'li) —
//   chat uçlarının her istekte D1'e yazması engellendi; okuma KV ?? users.last_seen_at (max).
// NOT-4: LIVEKIT_KEY/SECRET/URL lib/env.ts Env tipinde YOK — bu dosyada yerel tip genişletmesi
//   yapıldı (kural 5: lib düzenlenmedi). Lib'e eklenmesi + wrangler secret push gerekiyor.
// NOT-5 (DENETİM 2026-08-30, 2. tur): 10 sapma düzeltildi — pyStr artık KULLANILIYOR
//   (announce/broadcast title-body-url, chat_send to/text: null→'None' Python str() yolu),
//   pyTruthy ile bool()/or eşlenikleri ({}/[] FALSY: active, enabled, premium, accept, media,
//   avatar), chat sorguları ORDER BY rowid (Python append/dict sırası: msgs[-1], convos ve
//   poll dizilimi), poll çift-bazlı bitişik gruplama, costs tie-break rowid.

import { Hono } from 'hono'
import type { Env, AppEnv } from '../lib/env'
import { authUser, secretOk, b64uEncode } from '../lib/auth'
import { getUser, jsonGet, jsonSet, jsonRemove, simdi, type UserRow } from '../lib/db'
import { Hata, hata } from '../lib/hata'
import { pushq, svKapali } from '../lib/ortak'

const g = new Hono<AppEnv>()

// LiveKit sırları henüz lib Env'de tanımlı değil (NOT-4)
type LiveKitEnv = Env & { LIVEKIT_KEY?: string; LIVEKIT_SECRET?: string; LIVEKIT_URL?: string }

const enc = new TextEncoder()

// ═══════════════════════ ortak yardımcılar (yalnız grup5) ═══════════════════════

/**
 * FastAPI Body(...) / Body(default={}) eşleniği.
 * zorunlu=true : gövde yok → 422 "Field required"; bozuk JSON → 422 json_invalid.
 * zorunlu=false: gövde yok → {}; bozuk JSON yine 422 (FastAPI davranışı).
 * (422 detail gövdesi FastAPI'nin liste biçiminin sadeleştirilmiş eşleniğidir.)
 */
async function govde(c: { req: { text(): Promise<string> } }, zorunlu = true): Promise<Record<string, unknown>> {
  let txt = ''
  try { txt = await c.req.text() } catch { txt = '' }
  if (!txt) {
    if (!zorunlu) return {}
    throw new Hata(422, [{ type: 'missing', loc: ['body'], msg: 'Field required', input: null }])
  }
  let v: unknown
  try { v = JSON.parse(txt) } catch {
    throw new Hata(422, [{ type: 'json_invalid', loc: ['body', 0], msg: 'JSON decode error', input: {}, ctx: { error: 'Expecting value' } }])
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new Hata(422, [{ type: 'dict_type', loc: ['body'], msg: 'Input should be a valid dictionary', input: v }])
  }
  return v as Record<string, unknown>
}

/** Python int() eşleniği — çevrilemeyen değer THROW (yakalanmazsa 500 text/plain, main.py ile aynı sonuç). */
function pyInt(v: unknown): number {
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('int() cevrilemedi'); return Math.trunc(v) }
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string' && /^\s*[+-]?\d+\s*$/.test(v)) return parseInt(v.trim(), 10)
  throw new Error('int() cevrilemedi: ' + typeof v)
}

/** Python float() eşleniği — geçersiz string/null THROW → 500 (sözleşmedeki ValueError/TypeError yolu). */
function pyFloat(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string' && /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/.test(v)) return Number(v.trim())
  throw new Error('float() cevrilemedi: ' + typeof v)
}

/**
 * Python str() eşleniği (JSON değerleri için): null→'None', true→'True', false→'False'.
 * KRİTİK: main.py `str(body.get("to",""))` yolunda to:null → "None" olur ve 400 yerine 403'e
 * düşer — String(v ?? '') bu davranışı bozuyordu. Dizi/nesne JSON.stringify ile yazılır:
 * Python repr'ine birebir değil ama AYNI sonuca gider (hiçbir uid/handle'a çözülmez);
 * String(['x'])='x' tuzağı (tek elemanlı dizinin YANLIŞLIKLA resolve olması) böyle kapanır.
 */
function pyStr(v: unknown): string {
  if (v === null || v === undefined) return 'None'
  if (v === true) return 'True'
  if (v === false) return 'False'
  if (typeof v === 'string') return v
  if (typeof v === 'object') { try { return JSON.stringify(v) ?? String(v) } catch { return String(v) } }
  return String(v)
}

/** Python bool()/truthiness eşleniği — JS'ten farkı: [] ve {} Python'da FALSY. */
function pyTruthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === '') return false
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v as object).length > 0
  return true
}

/** Python round(x, 2) yaklaşık eşleniği (yarım-çift; float temsili çoğu farkı zaten yutar). */
function round2(n: number): number {
  const m = n * 100
  const kalan = m - Math.floor(m)
  if (kalan === 0.5) { const f = Math.floor(m); return (f % 2 === 0 ? f : f + 1) / 100 }
  return Math.round(m) / 100
}

/** main.py _norm_handle: str(s or '').strip().lstrip('@').lower() */
function normHandle(s: unknown): string {
  return String(s || '').trim().replace(/^@+/, '').toLowerCase()
}

/**
 * main.py _resolve_user eşleniği: internal id VEYA @handle → kanonik uid (yoksa null).
 * (APP_USERS sözlüğü Worker'da yok — bkz dosya sonundaki lib notları; profilli kullanıcılar için birebir.)
 */
async function resolveUser(db: D1Database, s: unknown): Promise<string | null> {
  const h = normHandle(s)
  if (!h) return null
  const dogrudan = await db.prepare('SELECT uid FROM users WHERE uid = ?1').bind(h).first<{ uid: string }>()
  if (dogrudan) return h
  const hRow = await db.prepare('SELECT uid FROM users WHERE handle = ?1 COLLATE NOCASE LIMIT 1')
    .bind(h).first<{ uid: string }>()
  return hRow?.uid ?? null
}

/** friends yönlü satır kontrolü: target in friends[user] (main.py:3504 vb.) */
async function arkadasMi(db: D1Database, uid: string, hedef: string): Promise<boolean> {
  const r = await db.prepare('SELECT 1 AS x FROM friends WHERE uid = ?1 AND friend_uid = ?2')
    .bind(uid, hedef).first()
  return r !== null
}

/** Python setdefault(profiles, uid, {}) eşleniği — satır yoksa iskelet aç (json_set 0-satır kalmasın). */
async function kullaniciGarantile(db: D1Database, uid: string): Promise<void> {
  await db.prepare('INSERT INTO users (uid, created_at, updated_at) VALUES (?1, ?2, ?2) ON CONFLICT(uid) DO NOTHING')
    .bind(uid, simdi()).run()
}

/** 6 bayt hex (Python secrets.token_hex(6) eşleniği). */
function hexRnd(bayt: number): string {
  const b = crypto.getRandomValues(new Uint8Array(bayt))
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

// ---------- push kuyruğu — lib/ortak pushq'ya devredildi (bütünleştirme 08-30) ----------
async function pushqKv(env: Env, user: string, title: string, body: string, route?: string): Promise<void> {
  await pushq(env, user, title, body, route)
}

// ---------- presence: seen → KV (sözleşme cf_mapping; NOT-3) ----------
async function seenDokun(env: Env, uid: string): Promise<void> {
  try { await env.KV.put(`seen:${uid}`, String(simdi()), { expirationTtl: 86400 }) } catch { /* best-effort */ }
}
async function seenOku(env: Env, uid: string): Promise<number> {
  try { const v = await env.KV.get(`seen:${uid}`); return v ? (parseInt(v, 10) || 0) : 0 } catch { return 0 }
}
/** main.py _online (4040-4041): son görülme < 70 sn. KV ?? users.last_seen_at (büyük olan). */
function cevrimici(kvTs: number, row: UserRow | null | undefined, nowTs: number): boolean {
  return nowTs - Math.max(kvTs, row?.last_seen_at ?? 0) < 70
}

// ---------- _profile_of (main.py:1389-1407) ----------
type ProfilCtx = { svOff: boolean; ftEnabled: boolean; ftKullanilmis: Set<string> }

async function profilCtxYukle(env: Env): Promise<Omit<ProfilCtx, 'ftKullanilmis'>> {
  // sv_off: /opt/movelog/data/sv-kapali bayrak dosyası → lib/ortak svKapali (tek KV anahtarı 'sv_off')
  const svOff = await svKapali(env)
  // free_tactical_enabled kill-switch: D1 config tablosu (varsayılan true — main.py:1406)
  let ftEnabled = true
  try {
    const r = await env.DB.prepare("SELECT value_json FROM config WHERE key = 'free_tactical_enabled'")
      .first<{ value_json: string }>()
    if (r) ftEnabled = !!JSON.parse(r.value_json)
  } catch { ftEnabled = true }
  return { svOff, ftEnabled }
}

async function ftCihazlar(db: D1Database, anahtarlar: string[]): Promise<Set<string>> {
  const s = new Set<string>()
  if (!anahtarlar.length) return s
  const ph = anahtarlar.map(() => '?').join(',')
  const r = await db.prepare(`SELECT attest_key FROM free_tactical_devices WHERE attest_key IN (${ph})`)
    .bind(...anahtarlar).all<{ attest_key: string }>()
  for (const x of r.results) s.add(x.attest_key)
  return s
}

function profilOf(uid: string, row: UserRow | null | undefined, ctx: ProfilCtx): Record<string, unknown> {
  let avatar: unknown = null
  try { avatar = row?.avatar_json ? JSON.parse(row.avatar_json) : null } catch { avatar = null }
  return {
    username: uid,
    name: row?.name || uid,
    handle: row?.handle || '',
    avatar: pyTruthy(avatar) ? avatar : { type: 'initials' },   // Python `or`: {} de FALSY → varsayılan
    premium: !!row?.premium,
    ultra: !!(row?.ultra || row?.admin),
    sv_off: ctx.svOff,
    sokak_hak: Math.trunc(Number(row?.sokak_hak || 0)),
    video_hak: Math.trunc(Number(row?.video_hak || 0)),
    sokak_hediye: false,                                   // main.py:1405 — her zaman False
    free_tactical: !!(ctx.ftEnabled && !(row?.ultra || row?.admin) && !row?.free_tactical_used
      && (!row?.attest_key || !ctx.ftKullanilmis.has(row.attest_key))),
    admin: !!row?.admin,
  }
}

/**
 * 🔴 FİKS 05.09 — GEREKSİZ VERİ SIZINTISI. `profilOf` TAM profili döküyor: `video_hak`,
 * `sokak_hak`, `free_tactical`, `sv_off`, `admin`. Sohbet listesinde ve DM başlığında bunlar
 * KARŞI TARAFA gidiyordu — muhatabın kaç video hakkı kaldığı ya da admin olup olmadığı
 * kimseyi ilgilendirmez. Gösterim için gereken alanlar burada kırpılır (main.py mirası).
 */
function profilKirp(p: Record<string, unknown>): Record<string, unknown> {
  return {
    username: p.username, name: p.name, handle: p.handle,
    avatar: p.avatar, premium: p.premium, ultra: p.ultra,
  }
}

// ---------- dm satırı → mesaj nesnesi (alan KÜMESİ main.py msg dict'i ile aynı) ----------
type DmRow = {
  id: string; user_a: string; user_b: string; frm: string
  msg_type: string; text: string | null; media: string | null; ts: number
}
function mesajNesnesi(r: DmRow): Record<string, unknown> {
  const m: Record<string, unknown> = { id: r.id, frm: r.frm, text: r.text ?? '', ts: r.ts, type: r.msg_type }
  if (r.media) m.media = r.media                           // Python: yalnız truthy media yazılır (main.py:4090-4091)
  return m
}

// ---------- voicecall ortak ----------
/** main.py _vc_room (3479-3481): 'vc_' + sha1('|'.join(sorted([a,b])))[:12] */
async function vcRoom(a: string, b: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-1', enc.encode([a, b].sort().join('|'))))
  return 'vc_' + [...d].map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 12)
}

const VC_INV: Record<string, string> = {
  tr: 'seni canlı telsize davet ediyor 📻', en: 'is inviting you to live radio 📻',
  de: 'lädt dich zum Live-Funk ein 📻', fr: "t'invite à la radio en direct 📻",
  es: 'te invita a la radio en vivo 📻', it: 'ti invita alla radio dal vivo 📻',
  pt: 'está te convidando para o rádio ao vivo 📻', ru: 'приглашает вас в живой эфир 📻',
  ja: 'ライブ無線に招待しています 📻', zh: '邀请你加入实时对讲 📻',
  ko: '라이브 무전에 초대했어요 📻', ar: 'يدعوك إلى اللاسلكي المباشر 📻',
}
const VC_OK: Record<string, string> = {
  tr: 'daveti kabul etti — bağlanıyor 📻', en: 'accepted — connecting 📻',
  de: 'hat angenommen — verbinde 📻', fr: 'a accepté — connexion 📻',
  es: 'aceptó — conectando 📻', it: 'ha accettato — connessione 📻',
  pt: 'aceitou — conectando 📻', ru: 'принял — подключение 📻',
  ja: '承諾しました — 接続中 📻', zh: '已接受 — 连接中 📻',
  ko: '수락했어요 — 연결 중 📻', ar: 'قبل الدعوة — جارٍ الاتصال 📻',
}

/** LiveKit HS256 JWT (PyJWT eşleniği, ~20 satır — sözleşme cf_mapping). */
async function livekitJwt(secret: string, claims: Record<string, unknown>): Promise<string> {
  const header = b64uEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'HS256' })))
  const payload = b64uEncode(enc.encode(JSON.stringify(claims)))
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = b64uEncode(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${payload}`))))
  return `${header}.${payload}.${sig}`
}

// ---------- günlük özet ayar nesnesi (main.py _summary_settings 2795-2806) ----------
function ozetAyarlar(row: UserRow | null): Record<string, unknown> {
  let prefs: Record<string, unknown> = {}
  try { prefs = row?.prefs_json ? JSON.parse(row.prefs_json) : {} } catch { prefs = {} }
  const al = (k: string, varsayilan: unknown): unknown => (k in prefs ? prefs[k] : varsayilan)
  return {
    enabled: row?.summary_enabled === null || row?.summary_enabled === undefined ? true : !!row.summary_enabled,
    hour: Math.trunc(Number(row?.summary_hour ?? 21)),
    video: {
      mode: al('summary_vid_mode', al('video_mode', 'flyover')),   // fallback zinciri main.py:2800
      speed: al('summary_vid_speed', 'medium'),
      aspect: al('summary_vid_aspect', '16:9'),
      cam: al('summary_vid_cam', 'orta'),
      music: al('summary_vid_music', ''),
      line: al('video_line', '#00E5FF'),                           // ORTAK video_line alanı
    },
  }
}

// ═══════════════════════ ADMIN uçları (Bearer YOK — GIFT_ADMIN_SECRET) ═══════════════════════

// POST /api/admin/announce (main.py:1894-1907) — duyuru bannerı → D1 config['announcement'] (NOT-1)
g.post('/api/admin/announce', async (c) => {
  const body = await govde(c)
  if (!secretOk(c.env.GIFT_ADMIN_SECRET, body.secret)) return hata(403, 'yetkisiz')
  // pyStr: title:null → 'None' (Python str(None) birebir); pyTruthy: active:{} → False (bool({}))
  const deger = {
    title: pyStr('title' in body ? body.title : '').slice(0, 80),
    body: pyStr('body' in body ? body.body : '').slice(0, 500),
    url: pyStr('url' in body ? body.url : '').slice(0, 300),
    active: 'active' in body ? pyTruthy(body.active) : true,
    ts: simdi(),
  }
  await c.env.DB.prepare(
    `INSERT INTO config (key, value_json, created_at, updated_at) VALUES ('announcement', ?1, ?2, ?2)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`)
    .bind(JSON.stringify(deger), simdi()).run()
  return c.json({ ok: true })
})

// POST /api/admin/broadcast (main.py:1911-1925) — tüm kullanıcılara push kuyruğu.
// SÖZLEŞME TUZAĞI bilinçli aynen taşındı: lokalize titles/bodies kuyruğa YAZILMAZ (yalnız title/body/ts);
// bc_<ts> anahtarı aynı saniyede ikinci broadcast'i EZER (dosya davranışı birebir).
g.post('/api/admin/broadcast', async (c) => {
  const body = await govde(c)
  if (!secretOk(c.env.GIFT_ADMIN_SECRET, body.secret)) return hata(403, 'yetkisiz')
  // sent = apns token'ı olan profil sayısı (main.py:1918; FCM sayılmaz — sayaç kozmetiği)
  const n = await c.env.DB.prepare(
    "SELECT COUNT(DISTINCT uid) AS n FROM push_tokens WHERE platform = 'apns'").first<{ n: number }>()
  const ts = simdi()
  const req = {
    title: pyStr('title' in body ? body.title : '').slice(0, 80),      // title:null → 'None' (Python str())
    body: pyStr('body' in body ? body.body : '').slice(0, 300), ts,
  }
  await c.env.KV.put(`push:bekleyen:bc_${ts}`, JSON.stringify(req), { expirationTtl: 7 * 86400 })
  return c.json({ ok: true, sent: n?.n ?? 0 })
})

// POST /api/admin/costs (main.py:1928-1950) — aylık GPU maliyet raporu (D1 gpu_costs)
g.post('/api/admin/costs', async (c) => {
  const body = await govde(c)
  if (!secretOk(c.env.GIFT_ADMIN_SECRET, body.secret)) return hata(403, 'yetkisiz')
  const rate = pyFloat('usd_per_sec' in body ? body.usd_per_sec : 0.0003)   // geçersiz → 500 (Python float() gibi)
  const month = (body.month as string) || new Date().toISOString().slice(0, 7)   // UTC YYYY-MM (main.py:1935)
  const r = await c.env.DB.prepare(
    `SELECT g.uid, g.videos, g.secs, g.g3d_secs, u.name, u.premium, u.ultra
     FROM gpu_costs g LEFT JOIN users u ON u.uid = g.uid
     WHERE g.month = ?1 ORDER BY g.rowid`)   // ekleme sırası = Python dict sırası (eşit secs tie-break'i)
    .bind(month).all<{ uid: string; videos: number; secs: number; g3d_secs: number; name: string | null; premium: number | null; ultra: number | null }>()
  const users = r.results.map((m) => ({
    user: m.uid, name: m.name || m.uid,
    premium: !!m.premium, ultra: !!m.ultra,
    videos: m.videos, gpu_secs: m.secs, g3d_secs: m.g3d_secs ?? 0,
    est_usd: round2(m.secs * rate),
  }))
  users.sort((a, b) => b.gpu_secs - a.gpu_secs)            // main.py:1947 (stabil azalan)
  return c.json({
    month, usd_per_sec: rate, users,
    total_secs: users.reduce((t, x) => t + x.gpu_secs, 0),
    total_usd: round2(users.reduce((t, x) => t + x.est_usd, 0)),
  })
})

// POST /api/admin/gencodes (main.py:1953-1970) — hediye kodu üretimi (D1 gift_codes)
g.post('/api/admin/gencodes', async (c) => {
  const body = await govde(c)
  if (!secretOk(c.env.GIFT_ADMIN_SECRET, body.secret)) return hata(403, 'yetkisiz')
  const n = Math.max(1, Math.min(pyInt('count' in body ? body.count : 5), 100))   // 1..100 kıskacı
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'         // I,O,0,1 yok — main.py:1961; DEĞİŞMEZ
  const ts = simdi()
  const out: string[] = []
  const yeniler = new Set<string>()
  const eklenecek: D1PreparedStatement[] = []
  while (out.length < n) {
    // 32 harfli alfabe: bayt % 32 modulo yanlılığı üretmez (256 % 32 == 0)
    const b = crypto.getRandomValues(new Uint8Array(10))
    let raw = ''
    for (let i = 0; i < 10; i++) raw += alpha[b[i] % 32]
    if (yeniler.has(raw)) continue
    const var_ = await c.env.DB.prepare('SELECT 1 AS x FROM gift_codes WHERE code = ?1').bind(raw).first()
    if (var_ !== null) continue                            // çakışan kod → yeniden dene (main.py:1965)
    yeniler.add(raw)
    eklenecek.push(c.env.DB.prepare(
      'INSERT INTO gift_codes (code, used_by, used_at, created_at, updated_at) VALUES (?1, NULL, NULL, ?2, ?2)')
      .bind(raw, ts))
    out.push(raw.slice(0, 5) + '-' + raw.slice(5))         // ABCDE-FGHIJ (depo TİRESİZ, gösterim TİRELİ)
  }
  if (eklenecek.length) await c.env.DB.batch(eklenecek)
  return c.json({ codes: out })
})

// ═══════════════════════ GÜNLÜK ÖZET (Bearer JWT) ═══════════════════════

// GET /api/summary/settings (main.py:2809-2811)
g.get('/api/summary/settings', authUser, async (c) => {
  const row = await getUser(c.env.DB, c.get('user'))
  return c.json(ozetAyarlar(row))
})

// PUT /api/summary/settings (main.py:2814-2842)
// TUZAK birebir: geçersiz değerler HATA üretmez, SESSİZCE atlanır; yanıt güncel (eski) değeri döner.
// Yazım TEK UPDATE deyimi: kolonlar + prefs_json json_set(çoklu çift) — SEMA-NOTLARI sözleşmesi.
g.put('/api/summary/settings', authUser, async (c) => {
  const body = await govde(c)
  const user = c.get('user')
  const db = c.env.DB

  const kolonlar: string[] = []
  const args: unknown[] = []
  if ('enabled' in body) { kolonlar.push('summary_enabled = ?'); args.push(pyTruthy(body.enabled) ? 1 : 0) }   // bool(): {} → False
  if ('hour' in body) {
    try {
      const h = pyInt(body.hour)
      if (h >= 0 && h <= 23) { kolonlar.push('summary_hour = ?'); args.push(h) }
    } catch { /* aralık dışı / parse edilemeyen sessizce yok sayılır (main.py:2825-2826) */ }
  }
  const ciftler: Array<[string, unknown]> = []             // prefs_json alan → değer
  const v = body.video
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const vd = v as Record<string, unknown>
    if ((['flat', 'flyover', '3d', 'tactical'] as unknown[]).includes(vd.mode)) ciftler.push(['summary_vid_mode', vd.mode])
    if ((['fast', 'medium', 'slow', 'auto'] as unknown[]).includes(vd.speed)) ciftler.push(['summary_vid_speed', vd.speed])
    if ((['16:9', '9:16'] as unknown[]).includes(vd.aspect)) ciftler.push(['summary_vid_aspect', vd.aspect])
    if ((['yakin', 'orta', 'uzak'] as unknown[]).includes(vd.cam)) ciftler.push(['summary_vid_cam', vd.cam])
    if (typeof vd.music === 'string') ciftler.push(['summary_vid_music', vd.music.slice(0, 40)])
    // video_line ORTAK alan — rota videosu çizgi rengini de değiştirir (main.py:2839-2840)
    if (typeof vd.line === 'string' && vd.line.startsWith('#')) ciftler.push(['video_line', vd.line.slice(0, 9)])
  }

  await kullaniciGarantile(db, user)                       // Python setdefault eşleniği
  if (kolonlar.length || ciftler.length) {
    let set = kolonlar.join(', ')
    if (ciftler.length) {
      // alan adları yukarıdaki KOD SABİTLERİ — SQL'e güvenle gömülür
      const jsonIfade = "prefs_json = json_set(COALESCE(prefs_json, '{}')"
        + ciftler.map(([alan]) => `, '$.${alan}', json(?)`).join('') + ')'
      set = set ? `${set}, ${jsonIfade}` : jsonIfade
      for (const [, deger] of ciftler) args.push(JSON.stringify(deger))
    }
    args.push(simdi(), user)
    await db.prepare(`UPDATE users SET ${set}, updated_at = ? WHERE uid = ?`).bind(...args).run()
  }
  const row = await getUser(db, user)
  return c.json(ozetAyarlar(row))
})

// POST /api/summary/now (main.py:2845-2854) — "şimdi özet üret" (uygulamadaki ÜRET düğmesi)
// 🔴 FİKS 04.09: burası RENDER_Q'ya `type:'summary'` mesajı atıyordu ama kuyruğun TEK tüketicisi
// `movelog-dispatch` `type` alanına HİÇ BAKMIYOR (dispatch/src/index.ts:210) → mesajı video render
// işi sanıp ride_id="_0" ile RunPod'a gönderiyor, RunPod 200 diyor, mesaj ack'leniyor ve iş
// SESSİZCE BUHARLAŞIYOR. Sonuç: "ürete basınca üretmiyor" + her basışta boşuna GPU parası.
// Gerçek tüketici zaten var: cron/gorevler/activity-detect.ts:306 KV'de `summaryreq:<uid>_*`
// arıyor (o anahtarı da kimse yazmıyordu). Artık doğru kapıya yazıyoruz.
// TTL 2 saat: cron 30 sn'de bir bakar; takılırsa istek sonsuza kadar kalmasın.
g.post('/api/summary/now', authUser, async (c) => {
  const body = await govde(c, false)                       // Body(default={}) — gövde tamamen opsiyonel
  const user = c.get('user')
  const ts = simdi()
  await c.env.KV.put(`summaryreq:${user}_${ts}`,
    JSON.stringify({ user, ts, premium: pyTruthy(body.premium), detail: true }),
    { expirationTtl: 2 * 3600 })
  return c.json({ ok: true, queued: `${user}_${ts}.json` })
})

// POST /api/activities/summarize — ANDROID istemcisinin çağırdığı ad (data/Store.kt).
// 🔴 FİKS 04.09: bu uç worker'da HİÇ YOKTU → Android'de "üret" 404 alıp sessizce hiçbir şey
// yapmıyordu (iOS `/api/summary/now` çağırdığı için orada yalnız kuyruk hatası vardı).
// Davranış /api/summary/now ile BİREBİR aynı; iki istemci de aynı yola çıksın.
g.post('/api/activities/summarize', authUser, async (c) => {
  const body = await govde(c, false)
  const user = c.get('user')
  const ts = simdi()
  await c.env.KV.put(`summaryreq:${user}_${ts}`,
    JSON.stringify({ user, ts, premium: pyTruthy(body.premium), detail: true }),
    { expirationTtl: 2 * 3600 })
  return c.json({ ok: true, queued: `${user}_${ts}.json` })
})

// POST /api/summary/range (main.py:2857-2872) — dosya kuyruğu rangereq/ → Queue RENDER_Q
g.post('/api/summary/range', authUser, async (c) => {
  const body = await govde(c)
  const user = c.get('user')
  const frm = pyFloat('from' in body ? body.from : 0)              // geçersiz → 500 (Python float())
  const to = pyFloat('to' in body ? body.to : Date.now() / 1000)   // varsayılan time.time() (kesirli)
  if (to <= frm) return hata(400, 'geçersiz aralık')
  const row = await getUser(c.env.DB, user)
  const devid = row?.tracker_id
  if (!devid) return hata(400, 'cihaz yok')
  const ts = simdi()
  await c.env.RENDER_Q.send({ type: 'range', user, device: String(devid), from: frm, to, ts })
  return c.json({ ok: true, queued: true })                // now'ın aksine dosya adı DÖNMEZ (sözleşme)
})

// ═══════════════════════ ÇİFT CANLI TELSİZ (voicecall) ═══════════════════════

// POST /api/voicecall/invite (main.py:3498-3512)
g.post('/api/voicecall/invite', authUser, async (c) => {
  const body = await govde(c)
  const user = c.get('user')
  const db = c.env.DB
  const target = await resolveUser(db, pyTruthy(body.user) ? pyStr(body.user) : '')   // str(x or '') birebir
  if (!target || target === user) return hata(404, 'kullanıcı yok')
  if (!(await arkadasMi(db, user, target))) return hata(403, 'sadece arkadaşına')   // IDOR koruması
  const me = await getUser(db, user)
  const nm = (me?.name || user) || 'Rider'
  await kullaniciGarantile(db, target)
  // önceki davet varsa ÜZERİNE yazılır (sözleşme) — TEK deyim json_set
  await jsonSet(db, target, 'state_json', 'vc_invite', { from: user, name: nm, ts: simdi() })
  const tRow = await getUser(db, target)
  const lng = tRow?.lang || 'en'
  await pushqKv(c.env, target, nm, VC_INV[lng] ?? VC_INV.en, `vcall:${user}:${nm}`)
  return c.json({ ok: true, room: await vcRoom(user, target) })
})

// POST /api/voicecall/respond (main.py:3515-3533) — red de kabul de daveti TÜKETİR
g.post('/api/voicecall/respond', authUser, async (c) => {
  const body = await govde(c)
  const user = c.get('user')
  const db = c.env.DB
  const frm = await resolveUser(db, pyTruthy(body.user) ? pyStr(body.user) : '')   // str(x or '') birebir
  const accept = pyTruthy(body.accept)                                             // bool(): {} → False
  const inv = await jsonGet<{ from?: string; name?: string; ts?: number }>(db, user, 'state_json', 'vc_invite')
  if (!frm || (inv?.from ?? null) !== frm) return hata(404, 'davet yok')   // sahte kabul engeli
  await jsonRemove(db, user, 'state_json', 'vc_invite')
  const me = await getUser(db, user)
  const nm = (me?.name || user) || 'Rider'
  if (accept) {
    await kullaniciGarantile(db, frm)
    // davet eden status poll'uyla yakalasın diye işaret (main.py:3528-3529)
    await jsonSet(db, frm, 'state_json', 'vc_go', { peer: user, name: nm, ts: simdi() })
    const fRow = await getUser(db, frm)
    const lng = fRow?.lang || 'en'
    await pushqKv(c.env, frm, nm, VC_OK[lng] ?? VC_OK.en, `vcallok:${user}:${nm}`)
  }
  // reddetme karşı tarafa bildirim GÖNDERMEZ (sessiz)
  return c.json({ ok: true, room: accept ? await vcRoom(user, frm) : null })
})

// GET /api/voicecall/status (main.py:3536-3546) — salt okur; bayat (>90sn) kayıt SİLİNMEZ, gizlenir
g.get('/api/voicecall/status', authUser, async (c) => {
  const row = await c.env.DB.prepare('SELECT state_json FROM users WHERE uid = ?1')
    .bind(c.get('user')).first<{ state_json: string | null }>()
  let st: Record<string, unknown> = {}
  try { st = row?.state_json ? JSON.parse(row.state_json) : {} } catch { st = {} }
  let inv = (st.vc_invite || {}) as { from?: string; name?: string; ts?: number }
  let go = (st.vc_go || {}) as { peer?: string; name?: string; ts?: number }
  const now = simdi()
  if (inv && Object.keys(inv).length && now - (inv.ts || 0) > 90) inv = {}
  if (go && Object.keys(go).length && now - (go.ts || 0) > 90) go = {}
  return c.json({
    invite_from: inv.from ?? null, invite_name: inv.name ?? null,
    go_peer: go.peer ?? null, go_name: go.name ?? null,
  })
})

// GET /api/voicecall/token (main.py:3549-3574) — LiveKit JWT; oda deterministik, token TEK güvenlik sınırı
g.get('/api/voicecall/token', authUser, async (c) => {
  const le = c.env as LiveKitEnv
  // 02.09: LIVEKIT_URL de zorunlu. Eski kod URL yoksa `wss://livekit.nickdegs.com` varsayılanına
  // düşüyordu (main.py:3365 mirası) — o host SİLİNDİ (self-host tasfiyesi), yani sır kaybolursa
  // uygulama ÖLÜ bir adrese bağlanmaya çalışırdı. Artık fail-closed: net "kapalı" cevabı.
  if (!le.LIVEKIT_KEY || !le.LIVEKIT_URL) return hata(503, 'canlı telsiz kapalı')
  const user = c.get('user')
  const db = c.env.DB
  const p = await resolveUser(db, c.req.query('peer') ?? '')
  if (!p || p === user) return hata(404, 'kullanıcı yok')
  if (!(await arkadasMi(db, user, p))) return hata(403, 'sadece arkadaşınla')   // IDOR KRİTİK
  // kabul işaretini tüket — YALNIZ vc_go.peer == p ise (tek atomik deyim; main.py:3560-3562)
  await db.prepare(
    `UPDATE users SET state_json = json_remove(COALESCE(state_json, '{}'), '$.vc_go'), updated_at = ?1
     WHERE uid = ?2 AND json_extract(state_json, '$.vc_go.peer') = ?3`)
    .bind(simdi(), user, p).run()
  const me = await getUser(db, user)
  const room = await vcRoom(user, p)
  const now = simdi()
  const token = await livekitJwt(le.LIVEKIT_SECRET || '', {
    iss: le.LIVEKIT_KEY, sub: user, nbf: now, exp: now + 2 * 3600,
    name: (me?.name || user) || 'Rider',
    video: { room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true },
  })
  const pn = await getUser(db, p)
  return c.json({
    url: le.LIVEKIT_URL,                    // varsayılan YOK (yukarıdaki kapı garanti ediyor)
    token, room,
    peer_name: pn?.name || pn?.handle || p,
  })
})

// ═══════════════════════ SOHBET (chat) ═══════════════════════

// GET /api/chat/list (main.py:4044-4065)
g.get('/api/chat/list', authUser, async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const now = simdi()
  await seenDokun(c.env, user)                             // _touch — presence KV'ye (NOT-3)

  // ORDER BY rowid = Python append sırası: last=msgs[-1] (ts DEĞİL, ekleme sırasının sonu) ve
  // convos Map ilk-görülme sırası = dm dict'in çift-anahtarı oluşturma sırası (eşit-ts tie-break'i birebir)
  const msgler = (await db.prepare(
    `SELECT id, user_a, user_b, frm, msg_type, text, media, ts FROM dm_messages
     WHERE user_a = ?1 OR user_b = ?1 ORDER BY rowid`).bind(user).all<DmRow>()).results
  const readRows = (await db.prepare(
    'SELECT peer_uid, read_at FROM dm_reads WHERE uid = ?1').bind(user)
    .all<{ peer_uid: string; read_at: number }>()).results
  const arkadaslar = (await db.prepare(
    'SELECT friend_uid FROM friends WHERE uid = ?1 ORDER BY rowid').bind(user)
    .all<{ friend_uid: string }>()).results

  const read = new Map(readRows.map((r) => [r.peer_uid, r.read_at]))
  const convos = new Map<string, { last: DmRow | null; unread: number; ts: number }>()
  for (const m of msgler) {
    const other = m.user_a === user ? m.user_b : m.user_a  // self-DM (a==b) → other = user
    const c0 = convos.get(other) ?? { last: null, unread: 0, ts: 0 }
    c0.last = m; c0.ts = m.ts                              // rowid sıralı: son atama = msgs[-1] (append sonu)
    if (m.frm !== user && m.ts > (read.get(other) ?? 0)) c0.unread++
    convos.set(other, c0)
  }
  for (const f of arkadaslar) {                            // mesajı olmayan arkadaşlar da listelenir
    if (!convos.has(f.friend_uid)) convos.set(f.friend_uid, { last: null, unread: 0, ts: 0 })
  }

  const uidler = [...convos.keys()]
  const satirlar = new Map<string, UserRow>()
  if (uidler.length) {
    const ph = uidler.map(() => '?').join(',')
    const r = await db.prepare(`SELECT * FROM users WHERE uid IN (${ph})`).bind(...uidler).all<UserRow>()
    for (const u of r.results) satirlar.set(u.uid, u)
  }
  const temel = await profilCtxYukle(c.env)
  const anahtarlar = [...new Set([...satirlar.values()].map((u) => u.attest_key).filter((k): k is string => !!k))]
  const ctx: ProfilCtx = { ...temel, ftKullanilmis: await ftCihazlar(db, anahtarlar) }
  const seenKv = new Map<string, number>()
  await Promise.all(uidler.map(async (u) => { seenKv.set(u, await seenOku(c.env, u)) }))

  const sirali = [...convos.entries()].sort((x, y) => y[1].ts - x[1].ts)   // ts azalan, stabil
  const out = sirali.map(([other, c0]) => ({
    ...profilKirp(profilOf(other, satirlar.get(other), ctx)),
    last: c0.last ? mesajNesnesi(c0.last) : null,
    unread: c0.unread,
    online: cevrimici(seenKv.get(other) ?? 0, satirlar.get(other), now),
  }))
  return c.json({ conversations: out })
})

// GET /api/chat/with/:other (main.py:4068-4074)
// DİKKAT: other INTERNAL id'dir, handle ÇÖZÜLMEZ (send ile bilinçli asimetri); arkadaşlık kontrolü YOK
// (pair anahtarı user'ı içerdiğinden yabancı konuşma zaten okunamaz); olmayan other → boş messages + iskelet peer.
g.get('/api/chat/with/:other', authUser, async (c) => {
  const user = c.get('user')
  const other = c.req.param('other')
  const db = c.env.DB
  const now = simdi()
  await seenDokun(c.env, user)
  const [a, b] = [user, other].sort()
  const msgler = (await db.prepare(
    `SELECT id, user_a, user_b, frm, msg_type, text, media, ts FROM dm_messages
     WHERE user_a = ?1 AND user_b = ?2 ORDER BY rowid`).bind(a, b).all<DmRow>()).results   // Python append sırası birebir
  // okundu işareti (main.py:4072)
  await db.prepare(
    `INSERT INTO dm_reads (uid, peer_uid, read_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?3, ?3)
     ON CONFLICT(uid, peer_uid) DO UPDATE SET read_at = excluded.read_at, updated_at = excluded.updated_at`)
    .bind(user, other, now).run()
  const row = await getUser(db, other)
  const temel = await profilCtxYukle(c.env)
  const ctx: ProfilCtx = {
    ...temel,
    ftKullanilmis: row?.attest_key ? await ftCihazlar(db, [row.attest_key]) : new Set<string>(),
  }
  return c.json({
    messages: msgler.map(mesajNesnesi),
    peer: { ...profilKirp(profilOf(other, row, ctx)), online: cevrimici(await seenOku(c.env, other), row, now) },
  })
})

// POST /api/chat/send (main.py:4077-4094) — alıcıya push YOK (poll tabanlı; sözleşme: aynen bırak)
g.post('/api/chat/send', authUser, async (c) => {
  const body = await govde(c)
  const user = c.get('user')
  const db = c.env.DB
  // pyStr KRİTİK: to:null → Python str(None)='None' → 400 DEĞİL 403 yolu; text:null → 'None' metni
  const toRaw = pyStr('to' in body ? body.to : '').trim()
  const text = pyStr('text' in body ? body.text : '').trim().slice(0, 4000)
  const mtype = 'type' in body ? body.type : 'text'
  const media = 'media' in body ? body.media : ''
  // pyTruthy: media={} / [] Python'da FALSY → boş mesaj (JS truthiness 500'e saptırıyordu)
  if (!toRaw || (!text && !pyTruthy(media))) return hata(400, 'boş mesaj')
  await seenDokun(c.env, user)
  // TUZAK birebir: resolve başarısızsa RAW string kalır → friend kontrolüne o haliyle girer (main.py:4086)
  const other = (await resolveUser(db, toRaw)) || toRaw
  if (other !== user && !(await arkadasMi(db, user, other))) {
    return hata(403, 'sadece arkadasina mesaj gonderebilirsin')   // kendine mesaj (not defteri) SERBEST
  }
  const msg: Record<string, unknown> = { id: hexRnd(6), frm: user, text, ts: simdi(), type: mtype }
  if (pyTruthy(media)) {
    // Python media[:2_000_000] (main.py:4081,4091 — str()'e ÇEVRİLMEZ): str VE list dilimlenebilir;
    // dict/sayı/bool TypeError → 500. Liste yanıt gövdesinde liste kalır (Python birebir),
    // D1 TEXT kolonuna JSON metni yazılır.
    if (typeof media === 'string') msg.media = media.slice(0, 2_000_000)
    else if (Array.isArray(media)) msg.media = media.slice(0, 2_000_000)
    else throw new Error('media dilimlenemedi (str/list degil)')   // → 500 (Python TypeError yolu)
  }
  const [a, b] = [user, other].sort()
  const mediaDb = msg.media === undefined ? null
    : (typeof msg.media === 'string' ? msg.media : JSON.stringify(msg.media))
  await db.prepare(
    `INSERT INTO dm_messages (id, user_a, user_b, frm, msg_type, text, media, ts, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?8)`)
    .bind(msg.id, a, b, user, typeof mtype === 'string' ? mtype : String(mtype), text,
      mediaDb, msg.ts).run()
  return c.json({ ok: true, message: msg })
})

// GET /api/chat/poll (main.py:4097-4111) — since'ten yeni, BAŞKASINDAN gelen mesajlar
// ts SANİYE çözünürlüklü ve karşılaştırma KESİN (ts > since) — ms'e çevirmek sözleşmeyi bozar, aynen korundu.
g.get('/api/chat/poll', authUser, async (c) => {
  const user = c.get('user')
  const sinceRaw = c.req.query('since')
  let since = 0
  if (sinceRaw !== undefined) {
    if (!/^\s*[+-]?\d+\s*$/.test(sinceRaw)) {
      throw new Hata(422, [{
        type: 'int_parsing', loc: ['query', 'since'],
        msg: 'Input should be a valid integer, unable to parse string as an integer', input: sinceRaw,
      }])
    }
    since = parseInt(sinceRaw.trim(), 10)
  }
  await seenDokun(c.env, user)
  // Python çıktısı sohbet başına BİTİŞİK: dm dict sırasıyla çiftler, çift içinde append sırası.
  // rowid sıralı çek + çifte göre grupla (ilk-görülme sırası) + düzleştir — alfabetik ORDER BY
  // (user_a,user_b) Python'dan farklı diziliyordu. (Kalan mikro fark: Python çift sırası anahtarın
  // İLK MESAJINA göredir, burada filtreye takılan ilk mesaja göre — pratikte aynı.)
  const rows = (await c.env.DB.prepare(
    `SELECT id, user_a, user_b, frm, msg_type, text, media, ts FROM dm_messages
     WHERE (user_a = ?1 OR user_b = ?1) AND ts > ?2 AND frm <> ?1
     ORDER BY rowid`).bind(user, since).all<DmRow>()).results
  const gruplar = new Map<string, DmRow[]>()
  for (const m of rows) {
    const k = `${m.user_a}|${m.user_b}`
    const g0 = gruplar.get(k)
    if (g0) g0.push(m); else gruplar.set(k, [m])
  }
  const yeni: Record<string, unknown>[] = []
  for (const grup of gruplar.values()) {
    for (const m of grup) yeni.push({ ...mesajNesnesi(m), with: m.user_a === user ? m.user_b : m.user_a })
  }
  return c.json({ new: yeni, now: simdi() })
})

export default g
