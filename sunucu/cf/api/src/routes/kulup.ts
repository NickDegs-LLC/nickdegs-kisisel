// kulup — /api/clubs (7 uç). 05.11.2026 GERİ GETİRİLDİ (Barış: "kulüp de yapalım, ücretsiz oluyorsa").
// Kaynak: 0918f0e^ grup2.ts kulüp bölümü BİREBİR; tek fark profilleri() sadeleştirildi (premium/ultra/
// sokak alanları ücretsiz modda anlamsız). Kulüp üyeliği cron grupsurus'ta "tanıdık" sayılır:
// arkadaş VEYA aynı kulüp → ortak sürüş videosu (telefonda).
import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv, Env } from '../lib/env'
import { authUser } from '../lib/auth'
import { simdi } from '../lib/db'
import { hata, Hata } from '../lib/hata'
import { pushq } from '../lib/ortak'

const g = new Hono<AppEnv>()

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

/** secrets.token_hex(n) eşleniği: n bayt → 2n hex karakter. */
function hexUret(n: number): string {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}


type Profil = { username: string; name: string; handle: string; avatar: unknown }

async function profilleri(env: Env, uids: string[]): Promise<Map<string, Profil>> {
  const out = new Map<string, Profil>()
  if (uids.length === 0) return out
  const ph = uids.map((_, i) => `?${i + 1}`).join(', ')
  const rows = ((await env.DB.prepare(`SELECT uid, name, handle, avatar_json FROM users WHERE uid IN (${ph})`)
    .bind(...uids).all<{ uid: string; name: string | null; handle: string | null; avatar_json: string | null }>()).results ?? [])
  const m = new Map(rows.map((r) => [r.uid, r]))
  for (const u of uids) {
    const r = m.get(u)
    let avatar: unknown = null
    if (r?.avatar_json) { try { avatar = JSON.parse(r.avatar_json) } catch { avatar = null } }
    if (!avatar || (typeof avatar === 'object' && Object.keys(avatar as object).length === 0)) avatar = { type: 'initials' }
    out.set(u, { username: u, name: r?.name || u, handle: r?.handle || '', avatar })
  }
  return out
}

async function pushKuyruk(env: Env, user: string, title: string, body: string): Promise<void> {
  await pushq(env, user, title, body)
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
