// grup5 — api/admin + api/summary (9 uç). 18.09: voicecall + chat uçları KALDIRILDI.
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
    `SELECT g.uid, g.videos, g.secs, g.g3d_secs, u.name, u.premium
     FROM gpu_costs g LEFT JOIN users u ON u.uid = g.uid
     WHERE g.month = ?1 ORDER BY g.rowid`)   // ekleme sırası = Python dict sırası (eşit secs tie-break'i)
    .bind(month).all<{ uid: string; videos: number; secs: number; g3d_secs: number; name: string | null; premium: number | null }>()
  const users = r.results.map((m) => ({
    user: m.uid, name: m.name || m.uid,
    premium: !!m.premium,
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

export default g
