// grup4 — api/profile + api/music + api/ptt (14 uç) — main.py birebir portu.
// Sözleşme: cf/contracts/grup4.json · Orijinal: /opt/movelog/backend/main.py
//
// Kapsanan uçlar (kayıt sırası = bu dosyadaki sıra):
//   GET    /api/profile                 (main.py:1410 — GET olduğu halde lang YAZAR)
//   PUT    /api/profile                 (main.py:2780)
//   POST   /api/profile/photo           (main.py:2896)
//   GET    /api/profile/photo/:u        (main.py:2913 — AUTH YOK, bilinçli)
//   GET    /api/music                   (main.py:2050)
//   GET    /api/music/library           (main.py:2076)
//   POST   /api/music/library           (main.py:2087)
//   DELETE /api/music/library/:mid      (main.py:2106)
//   GET    /api/music/file              (main.py:2150 — _muzik_coz 2117-2135)
//   POST   /api/ptt/send                (main.py:3396)
//   POST   /api/ptt/send-user           (main.py:3433)
//   POST   /api/ptt/busy                (main.py:3578)
//   GET    /api/ptt/busy/:username      (main.py:3596)
//   GET    /api/ptt/:pid                (main.py:3606)
//
// Eşleme kararları (sözleşme cf_mapping):
//   · avatars/usermusic/stockmusic/ridephotos/ptt/voicemsg dizinleri → R2 aynı önekler.
//   · Müzik kütüphanesi names.json → R2 `usermusic/{user}/names.json` (şemada music_library
//     tablosu YOK — 0001_init 26 tabloda tanımsız; dosya davranışı birebir korunarak R2'de
//     tutuldu. İleride 0003 ile tablo gelirse bu üç uç birlikte taşınır.)
//   · active.m4a = KOPYA (çift depolama) — mevcut davranış aynen (Faz 2 kuralı);
//     silinen parça aktifse aktif KALIR (DELETE active.m4a'ya dokunmaz — main.py:2106-2115).
//   · push (sessiz + görünür) → KV `push:bekleyen:*` kaydı (Faz 3'te gerçek APNs/FCM).
//   · ptt_busy → KV `ptt_busy:{hedef}` (TTL 60 — KV alt sınırı; asıl süre kontrolü
//     kayıttaki `until` alanıyla, birebir 25 sn).
//   · sv-kapali kill-switch dosyası → KV `sv_off` bayrağı (anahtar VARSA kapalı).
//   · free_tactical_enabled → D1 config; free_tactical_devices → D1 tablosu.
//   · ptt/voicemsg eski-klip temizlikleri istek-içinden ÇIKTI → R2 lifecycle (1g/30g).

import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv, Env } from '../lib/env'
import { authUser } from '../lib/auth'
import { Hata, hata, hataYanit } from '../lib/hata'
import { simdi } from '../lib/db'
import { svKapali } from '../lib/ortak'

const g = new Hono<AppEnv>()

// ---------------------------------------------------------------- yardımcılar

/** secrets.token_hex(n) eşleniği — n bayt → 2n hex karakter. */
function tokenHex(nBayt: number): string {
  const b = crypto.getRandomValues(new Uint8Array(nBayt))
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

/** Standart base64 çöz (data-URI gövdesi) — Python base64.b64decode(validate=False) eşleniği:
 *  alfabe DIŞI TÜM karakterler atılır (yalnız boşluk değil); kalan uzunluk 4'e bölünmüyorsa
 *  Python binascii.Error (Incorrect padding) → 500 eşleniği fırlatılır (atob'un 'forgiving'
 *  eksik-padding kabulü Python'la uyuşmaz, o yüzden burada elle kontrol edilir). */
function b64Coz(s: string): Uint8Array {
  const t = s.replace(/[^A-Za-z0-9+/=]/g, '')
  if (t.length % 4 !== 0) throw new Error('b64 padding hatali (binascii.Error esleniği)')
  const bin = atob(t)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Python bool(x) eşleniği (JSON'dan gelen değerler için): JS'ten farkı boş dizi/objenin
 *  de FALSY olması ('' / 0 / false / null zaten ortak). */
function pyTruthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === '') return false
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v)
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v).length > 0
  return true
}

/** int(float(s)) eşleniği — Python float() kabul kümesi: ondalık/bilimsel (+rakam arası '_'),
 *  isteğe bağlı kenar boşlukları. JS Number'ın FAZLADAN kabul ettikleri elenir: 0x/0b/0o
 *  literalleri ve ''/salt-boşluk→0 tuzağı. Kabul dışı / sonsuz → null (Python except → sessiz geç). */
function pyFloatInt(s: string): number | null {
  const t = s.trim()
  if (!/^[+-]?(\d(_?\d)*(\.(\d(_?\d)*)?)?|\.\d(_?\d)*)([eE][+-]?\d(_?\d)*)?$/.test(t)) return null
  const n = Math.trunc(Number(t.replace(/_/g, '')))
  return Number.isFinite(n) ? n : null
}

/** FastAPI Body(...) eşleniği — 422 detail gövdesi FastAPI liste biçiminde (grup5 govde ile aynı):
 *  gövde yok → Field required; bozuk JSON → json_invalid; dict değil → dict_type. */
async function govde(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  let txt = ''
  try { txt = await c.req.text() } catch { txt = '' }
  if (!txt) throw new Hata(422, [{ type: 'missing', loc: ['body'], msg: 'Field required', input: null }])
  let v: unknown
  try { v = JSON.parse(txt) } catch {
    throw new Hata(422, [{ type: 'json_invalid', loc: ['body', 0], msg: 'JSON decode error', input: {}, ctx: { error: 'Expecting value' } }])
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new Hata(422, [{ type: 'dict_type', loc: ['body'], msg: 'Input should be a valid dictionary', input: v }])
  }
  return v as Record<string, unknown>
}

/** body.get('data','') + .startswith eşleniği: alan var ama str DEĞİLSE Python AttributeError
 *  atar → 500 text/plain. Aynı sonuç için burada da fırlatılır (hataHandler 500'e çevirir). */
function dataAlani(body: Record<string, unknown>): string {
  const v = 'data' in body ? body.data : ''
  if (typeof v !== 'string') throw new Error('data str degil (Python AttributeError esleniği)')
  return v
}

/** Python str() eşleniği (avatar value tuhaflığı dahil): None→'None', True→'True', False→'False'. */
function pyStr(v: unknown): string {
  if (v === null) return 'None'
  if (v === true) return 'True'
  if (v === false) return 'False'
  return String(v ?? '')
}

/** main.py _req_lang (2500-2509): Accept-Language → app dillerinden biri (yoksa en).
 *  Dil sırası _SV_MSG anahtar sırasıyla AYNI (Python dict sırası — ilk eşleşen kazanır). */
const DILLER = ['tr', 'en', 'de', 'fr', 'es', 'it', 'ru', 'ar', 'pt', 'ja', 'ko', 'zh']
function reqLang(baslik: string | undefined): string {
  const al = (baslik || '').toLowerCase()
  for (const kod of DILLER) {
    if (al.startsWith(kod) || al.includes(`,${kod}`) || al.includes(` ${kod}`)) return kod
  }
  return 'en'
}

/** main.py _resolve_user (2947-2954): internal id VEYA @handle → kanonik uid (yoksa null).
 *  _norm_handle: trim + baştaki @'ler + lower; handle karşılaştırması case-insensitive (NOCASE). */
async function resolveUser(db: D1Database, s: unknown): Promise<string | null> {
  const h = String(s ?? '').trim().replace(/^@+/, '').toLowerCase()
  if (!h) return null
  const r = await db.prepare(
    `SELECT uid, (uid = ?1) AS direkt FROM users
     WHERE uid = ?1 OR handle = ?1 COLLATE NOCASE
     ORDER BY direkt DESC LIMIT 1`).bind(h).first<{ uid: string }>()
  return r?.uid ?? null
}

type ProfilSatir = {
  name: string | null; handle: string | null; avatar_json: string | null
  premium: number | null; ultra: number | null; admin: number | null
  sokak_hak: number | null; video_hak: number | null
  free_tactical_used: number | null; attest_key: string | null; lang: string | null
}

/** main.py _profile_of (1389-1407) birebir — alan KÜMESİ aynen korunur.
 *  Dönen `satir` GET /api/profile'ın lang-karşılaştırması için de kullanılır. */
async function profilYukle(env: Env, uid: string): Promise<{ satir: ProfilSatir | null; profil: Record<string, unknown> }> {
  const [uRes, cRes] = await env.DB.batch([
    env.DB.prepare(
      `SELECT name, handle, avatar_json, premium, ultra, admin, sokak_hak, video_hak,
              free_tactical_used, attest_key, lang FROM users WHERE uid = ?1`).bind(uid),
    env.DB.prepare(`SELECT value_json FROM config WHERE key = 'free_tactical_enabled'`),
  ])
  const satir = (uRes.results[0] as ProfilSatir | undefined) ?? null
  const cfgSatir = cRes.results[0] as { value_json: string } | undefined

  // kill-switch: db.get('free_tactical_enabled', True) — kayıt yoksa AÇIK (main.py:1406)
  let ftAcik = true
  if (cfgSatir) { try { ftAcik = !!JSON.parse(cfgSatir.value_json) } catch { ftAcik = true } }

  // avatar: p.get('avatar') or {'type':'initials'} — Python'da boş obje de falsy
  let avatar: unknown = null
  if (satir?.avatar_json) { try { avatar = JSON.parse(satir.avatar_json) } catch { avatar = null } }
  if (!avatar || typeof avatar !== 'object' || Object.keys(avatar as object).length === 0) {
    avatar = { type: 'initials' }
  }

  const ultraVeyaAdmin = !!(satir?.ultra || satir?.admin)   // 'ultra' alanı = ultra||admin (main.py:1395)

  // free_tactical: kill-switch + hesap-1 + cihaz-1 (main.py:1406); Python'ın tembel `and`
  // sırası korunur — cihaz sorgusu yalnız öncekiler geçerse atılır.
  let freeTactical = ftAcik && !ultraVeyaAdmin && !satir?.free_tactical_used
  if (freeTactical && satir?.attest_key) {
    const cihaz = await env.DB.prepare('SELECT 1 AS x FROM free_tactical_devices WHERE attest_key = ?1')
      .bind(satir.attest_key).first()
    freeTactical = cihaz === null
  }

  // Street View kill-switch dosyası (main.py:1398) → lib/ortak svKapali (tek KV anahtarı 'sv_off'):
  // anahtar VARSA kapalı, silinince özellik otomatik geri gelir (admin paneli yazar/siler).
  const svOff = await svKapali(env)

  const profil = {
    username: uid,
    name: satir?.name || uid,
    handle: satir?.handle || '',
    avatar,
    premium: !!satir?.premium,
    ultra: ultraVeyaAdmin,
    sv_off: svOff,
    sokak_hak: Math.trunc(Number(satir?.sokak_hak ?? 0)) || 0,
    video_hak: Math.trunc(Number(satir?.video_hak ?? 0)) || 0,
    sokak_hediye: false,   // SABİT false — eski sürüm uyumluluğu, alan KALDIRILAMAZ (main.py:1400-1405)
    free_tactical: freeTactical,
    admin: !!satir?.admin,
  }
  return { satir, profil }
}

/** usermusic/{user}/names.json oku — bozuk/yoksa sessizce {} (main.py:2080-2082). */
async function adlarOku(r2: R2Bucket, user: string): Promise<Record<string, unknown>> {
  try {
    const o = await r2.get(`usermusic/${user}/names.json`)
    if (!o) return {}
    const j = await o.json()
    return (j && typeof j === 'object' && !Array.isArray(j)) ? j as Record<string, unknown> : {}
  } catch { return {} }
}

/** main.py _muzik_coz (2117-2135) birebir — ref → R2 nesnesi (çözülmezse null). */
async function muzikCoz(r2: R2Bucket, user: string, ref: string, session: string): Promise<R2ObjectBody | null> {
  const u = (user || '').replace(/[^A-Za-z0-9_-]/g, '')
  let obj: R2ObjectBody | null = null
  if (ref === '' || ref === 'active') obj = await r2.get(`usermusic/${u}/active.m4a`)
  if (!obj && ref.startsWith('lib:')) {
    obj = await r2.get(`usermusic/${u}/${ref.slice(4).replace(/[^A-Za-z0-9]/g, '')}.m4a`)
  }
  if (!obj && ref === 'upload' && session) {
    const s = pyFloatInt(session)                         // int(float(session)); bozuksa sessiz geç
    if (s !== null) obj = await r2.get(`ridephotos/${u}_${s}/music.m4a`)
  }
  if (!obj && ref.startsWith('stock:')) {
    obj = await r2.get(`stockmusic/${ref.slice(6).replace(/[^A-Za-z0-9]/g, '')}.m4a`)
  }
  return obj
}

/** Sessiz/görünür push kaydı → KV (Faz 3'te gerçek APNs/FCM). Anahtar = eski pushq dosya adı. */
function pushBekleyen(env: Env, dosyaAdi: string, kayit: Record<string, unknown>): Promise<void> {
  // 🔴 FİKS 05.09: TTL YOKTU. Telsiz/sesli mesaj sessiz push'ları teslim edilemezse KV'de sonsuza
  // dek kalıp her dakika yeniden deneniyordu. Sessizler kısa ömürlü (1 saat) — gecikmiş bir telsiz
  // klibi zaten anlamsız; görünürler 7 gün.
  const sessiz = typeof kayit.silent !== 'undefined' && kayit.silent !== null
  return env.KV.put(`push:bekleyen:${dosyaAdi}`, JSON.stringify(kayit),
    { expirationTtl: sessiz ? 3600 : 7 * 86400 })
}

const STOCK_MUSIC = [
  { id: 'chill', name: 'Chill' }, { id: 'epic', name: 'Epic' },
  { id: 'upbeat', name: 'Upbeat' }, { id: 'lofi', name: 'Lo-Fi' },
  { id: 'cinematic', name: 'Cinematic' },
]

// sesli mesaj görünür bildirimi — 12 dil (main.py:3458-3463 birebir)
const VM: Record<string, string> = {
  tr: 'sana sesli mesaj gönderdi 🎙️', en: 'sent you a voice message 🎙️',
  de: 'hat dir eine Sprachnachricht geschickt 🎙️', fr: "t'a envoyé un message vocal 🎙️",
  es: 'te envió un mensaje de voz 🎙️', it: 'ti ha inviato un messaggio vocale 🎙️',
  pt: 'te enviou uma mensagem de voz 🎙️', ru: 'отправил вам голосовое сообщение 🎙️',
  ja: 'ボイスメッセージを送りました 🎙️', zh: '给你发了一条语音消息 🎙️',
  ko: '음성 메시지를 보냈어요 🎙️', ar: 'أرسل لك رسالة صوتية 🎙️',
}

// ---------------------------------------------------------------- /api/profile

// GET /api/profile (main.py:1410-1422) — GET olduğu halde YAZAR: cihaz dili (Accept-Language)
// değiştiyse users.lang güncellenir (bildirim lokalizasyonu buna dayanır). Hata sessiz yutulur.
g.get('/api/profile', authUser, async (c) => {
  const user = c.get('user')
  const { satir, profil } = await profilYukle(c.env, user)
  try {
    const lang = reqLang(c.req.header('accept-language'))
    if (lang && (satir?.lang ?? null) !== lang) {
      await c.env.DB.prepare(
        `INSERT INTO users (uid, lang, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT(uid) DO UPDATE SET lang = excluded.lang, updated_at = excluded.updated_at`)
        .bind(user, lang, simdi()).run()
    }
  } catch { /* main.py:1420-1421 — sessiz */ }
  return c.json(profil)
})

// PUT /api/profile (main.py:2780-2791) — gevşek doğrulama: bilinmeyen alan sessiz yok sayılır;
// avatar geçersiz tipse hiç yazılmaz (hata da dönmez). type:'photo' BURADAN set edilemez.
g.put('/api/profile', authUser, async (c) => {
  const user = c.get('user')
  const body = await govde(c)
  let name: string | null = null
  if ('name' in body && typeof body.name === 'string') name = body.name.slice(0, 40)
  let avatarJson: string | null = null
  if ('avatar' in body && body.avatar !== null && typeof body.avatar === 'object' && !Array.isArray(body.avatar)) {
    const av = body.avatar as Record<string, unknown>
    if (av.type === 'emoji' || av.type === 'initials') {
      avatarJson = JSON.stringify({ type: av.type, value: pyStr(av.value).slice(0, 8) })   // str(av.get('value',''))[:8]
    }
  }
  await c.env.DB.prepare(
    `INSERT INTO users (uid, name, avatar_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)
     ON CONFLICT(uid) DO UPDATE SET
       name = COALESCE(excluded.name, users.name),
       avatar_json = COALESCE(excluded.avatar_json, users.avatar_json),
       updated_at = excluded.updated_at`)
    .bind(user, name, avatarJson, simdi()).run()
  const { profil } = await profilYukle(c.env, user)
  return c.json(profil)
})

// POST /api/profile/photo (main.py:2896-2910) — data:image data-URI, ham ≤3 MB → R2 avatars/{user}.jpg
// (uzantı HEP .jpg, PNG gelse bile; magic-byte doğrulaması yok — mevcut davranış).
g.post('/api/profile/photo', authUser, async (c) => {
  const user = c.get('user')
  const body = await govde(c)
  const data = dataAlani(body)                              // str değilse 500 (Python AttributeError)
  if (!data.startsWith('data:image')) hata(400, 'geçersiz görsel')
  const virgul = data.indexOf(',')
  if (virgul < 0) throw new Error('data URI virgülsüz')   // Python IndexError → 500 eşleniği
  const ham = b64Coz(data.slice(virgul + 1))
  if (ham.byteLength > 3_000_000) hata(413, 'görsel çok büyük')
  await c.env.R2.put(`avatars/${user}.jpg`, ham)
  const ts = simdi()
  const url = `/api/profile/photo/${user}?v=${ts}`
  await c.env.DB.prepare(
    `INSERT INTO users (uid, avatar_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)
     ON CONFLICT(uid) DO UPDATE SET avatar_json = excluded.avatar_json, updated_at = excluded.updated_at`)
    .bind(user, JSON.stringify({ type: 'photo', value: url }), ts).run()
  return c.json({ url })
})

// GET /api/profile/photo/:u (main.py:2913-2918) — AUTH YOK (bilinçli: RunPod motoru + arkadaş
// avatarları token'sız çeker). u basename'lenir (path-traversal koruması aynen).
g.get('/api/profile/photo/:u', async (c) => {
  const base = (c.req.param('u') || '').split('/').pop() || ''   // os.path.basename eşleniği
  const obj = await c.env.R2.get(`avatars/${base}.jpg`)
  if (!obj) return hataYanit(404, 'yok')
  return new Response(obj.body, { headers: { 'content-type': 'image/jpeg' } })
})

// ---------------------------------------------------------------- /api/music

// GET /api/music (main.py:2050-2052) — sabit stok liste, DB okunmaz.
g.get('/api/music', authUser, (c) => c.json({ stock: STOCK_MUSIC }))

// GET /api/music/library (main.py:2076-2085) — names.json'da olup .m4a'sı R2'de MEVCUT olanlar;
// names.json bozuksa sessizce boş kütüphane.
g.get('/api/music/library', authUser, async (c) => {
  const user = c.get('user')
  const adlar = await adlarOku(c.env.R2, user)
  // os.path.exists eşleniği: her mid için head — R2 list'in 1000-nesne kesme riski yok,
  // names.json sırası (Python dict sırası) aynen korunur.
  const girisler = Object.entries(adlar)
  const varMi = await Promise.all(girisler.map(([mid]) => c.env.R2.head(`usermusic/${user}/${mid}.m4a`)))
  const tracks = girisler
    .filter((_, i) => varMi[i] !== null)
    .map(([mid, ad]) => ({ id: mid, name: ad }))
  return c.json({ tracks })
})

// POST /api/music/library (main.py:2087-2104) — data:audio ≤20 MB; {mid}.m4a + active.m4a
// (AYNI bayt kopyası: son yüklenen = global aktif müzik, tüm modlar kullanır) + names.json.
g.post('/api/music/library', authUser, async (c) => {
  const user = c.get('user')
  const body = await govde(c)
  const data = dataAlani(body)                              // str değilse 500 (Python AttributeError)
  // str(body.get('name','') or 'Müzik')[:40] — 'or' Python doğruluğuyla ([]/{}  de falsy)
  const nameHam = 'name' in body ? body.name : ''
  const name = pyStr(pyTruthy(nameHam) ? nameHam : 'Müzik').slice(0, 40)
  if (!data.startsWith('data:audio')) hata(400, 'geçersiz ses')
  const virgul = data.indexOf(',')
  if (virgul < 0) throw new Error('data URI virgülsüz')   // Python IndexError → 500 eşleniği
  const ham = b64Coz(data.slice(virgul + 1))
  if (ham.byteLength > 20_000_000) hata(413, 'ses çok büyük (max 20 MB)')
  const mid = tokenHex(5)
  await c.env.R2.put(`usermusic/${user}/${mid}.m4a`, ham)
  await c.env.R2.put(`usermusic/${user}/active.m4a`, ham)
  const adlar = await adlarOku(c.env.R2, user)
  adlar[mid] = name
  await c.env.R2.put(`usermusic/${user}/names.json`, JSON.stringify(adlar))
  return c.json({ ok: true, id: mid, name })
})

// DELETE /api/music/library/:mid (main.py:2106-2115) — idempotent: dosya yoksa da {ok:true}.
// DİKKAT: active.m4a silinen parçanın kopyası olsa bile DOKUNULMAZ (mevcut davranış).
g.delete('/api/music/library/:mid', authUser, async (c) => {
  const user = c.get('user')
  const mid = c.req.param('mid').replace(/[^A-Za-z0-9]/g, '')
  await c.env.R2.delete(`usermusic/${user}/${mid}.m4a`)   // R2 delete zaten sessiz-idempotent
  try {
    const adlar = await adlarOku(c.env.R2, user)
    if (mid in adlar) {
      delete adlar[mid]
      await c.env.R2.put(`usermusic/${user}/names.json`, JSON.stringify(adlar))
    }
  } catch { /* main.py:2112-2114 — sessiz */ }
  return c.json({ ok: true })
})

// GET /api/music/file (main.py:2150-2157) — 1.61 CİHAZDA ÜRETİM hattı: app müziği indirip
// telefonda miksler. internal/music (grup3) ile AYNI çözüm; fark = kullanıcı token'ı → yalnız
// KENDİ user'ının anahtarları.
g.get('/api/music/file', authUser, async (c) => {
  const user = c.get('user')
  let obj = await muzikCoz(c.env.R2, user, c.req.query('ref') ?? '', c.req.query('session') ?? '')
  // 🔴 FİKS 04.09 — SESSİZ VİDEO. Telefonda üretilen videolar müziği buradan çekiyor; kullanıcının
  // `usermusic/<uid>/active.m4a` dosyası YOKSA uç 404 dönüyordu ve telefon videoyu MÜZİKSİZ
  // mikslıyordu. ÖLÇÜLDÜ: Semra'nın 03.09 flyover videosunda hiç ses akışı yok; log'da 22:19-22:32
  // arası dört kez 404. Bulut yolunda bu sorun yok — orada müzik çözülemezse motora stok müzik
  // seçtiriliyor (grup1.ts:862). İki yol artık eşit: çözülemezse stok müziğe düşülür.
  if (!obj) {
    const STOK = ['cinematic', 'epic', 'chill', 'upbeat', 'lofi']    // R2 stockmusic/ içeriği (5 parça)
    // Kullanıcı başına SABİT seçim: aynı kullanıcı hep aynı parçayı alsın (videolar arasında tutarlı).
    let h = 0
    for (let i = 0; i < user.length; i++) h = (h * 31 + user.charCodeAt(i)) >>> 0
    const ad = STOK[h % STOK.length]
    obj = await c.env.R2.get(`stockmusic/${ad}.m4a`)
    if (obj) console.log(`müzik yok, stok kullanıldı: ${ad} (${user.slice(0, 10)})`)
  }
  if (!obj) hata(404, 'müzik yok')
  return new Response(obj.body, { headers: { 'content-type': 'audio/mp4' } })
})

// ---------------------------------------------------------------- /api/ptt

// POST /api/ptt/send (main.py:3396-3427) — kulüp telsizi. SIRA AYNEN: önce Ultra (⚠️ _is_ultra
// SADECE users.ultra — ADMIN BYPASS YOK, main.py:3124-3126; profildeki ultra||admin formülünü
// KULLANMA), sonra kulüp+üyelik, sonra ham gövde boyutu. 24h temizlik → R2 lifecycle (cf_mapping).
g.post('/api/ptt/send', authUser, async (c) => {
  const user = c.get('user')
  const cid = c.req.query('club') ?? ''
  const db = c.env.DB
  const [meRes, klupRes, uyeRes] = await db.batch([
    db.prepare('SELECT ultra, name FROM users WHERE uid = ?1').bind(user),
    db.prepare('SELECT cid FROM clubs WHERE cid = ?1').bind(cid),
    db.prepare('SELECT uid FROM club_members WHERE cid = ?1').bind(cid),
  ])
  const me = meRes.results[0] as { ultra: number | null; name: string | null } | undefined
  if (!me?.ultra) hata(402, 'Ultra gerekli')
  const uyeler = (uyeRes.results as { uid: string }[]).map((r) => r.uid)
  if (klupRes.results.length === 0 || !uyeler.includes(user)) hata(404, 'kulüp yok')
  const data = await c.req.arrayBuffer()                     // HAM m4a gövde (JSON değil)
  if (data.byteLength < 500 || data.byteLength > 800_000) hata(400, 'geçersiz ses boyutu')
  const ts = simdi()
  const pid = `p${ts}${tokenHex(4)}`
  await c.env.R2.put(`ptt/${pid}.m4a`, data)
  await db.prepare(
    `INSERT OR REPLACE INTO ptt_acl (pid, club_cid, users_json, created_at, updated_at)
     VALUES (?1, ?2, NULL, ?3, ?3)`).bind(pid, cid, ts).run()
  const ad = me.name || user                                 // _profile_of: name or uid
  let n = 0
  for (const m of uyeler) {
    if (m === user) continue
    await pushBekleyen(c.env, `ptt_${m}_${pid}`, { user: m, silent: `ptt:${pid}:${ad || 'Rider'}` })
    n++                                                      // sent = KUYRUĞA yazım sayısı (teslim değil)
  }
  return c.json({ ok: true, id: pid, sent: n })
})

// POST /api/ptt/send-user (main.py:3433-3473) — arkadaşa sesli mesaj. Ultra ŞARTI YOK (bilinçli);
// karşılıklı arkadaşlık şart. Tek istekte: R2 klip + sessiz push + görünür lokalize push +
// DM ses baloncuğu + acl. 30 gün temizliği → R2 lifecycle (cf_mapping).
g.post('/api/ptt/send-user', authUser, async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const target = await resolveUser(db, c.req.query('user') ?? '')
  if (!target || target === user) hata(404, 'kullanıcı bulunamadı')
  const dost = await db.prepare('SELECT 1 AS x FROM friends WHERE uid = ?1 AND friend_uid = ?2')
    .bind(user, target).first()
  if (!dost) hata(403, 'sadece arkadaşına')
  const data = await c.req.arrayBuffer()                     // HAM m4a gövde
  if (data.byteLength < 500 || data.byteLength > 800_000) hata(400, 'geçersiz ses boyutu')
  const ts = simdi()
  const pid = `p${ts}${tokenHex(4)}`
  await c.env.R2.put(`voicemsg/${pid}.m4a`, data)            // KALICI sesli mesaj (30 gün)
  const [meRes, hedefRes] = await db.batch([
    db.prepare('SELECT name FROM users WHERE uid = ?1').bind(user),
    db.prepare('SELECT lang FROM users WHERE uid = ?1').bind(target),
  ])
  const ad = ((meRes.results[0] as { name: string | null } | undefined)?.name || user) || 'Rider'
  const lng = ((hedefRes.results[0] as { lang: string | null } | undefined)?.lang) || 'en'
  // TELSİZ: sessiz push — app diriyse arka planda indirip kulaklıkta çalar
  await pushBekleyen(c.env, `ptt_${target}_${pid}`, { user: target, silent: `ptt:${pid}:${ad}` })
  // GÖRÜNÜR bildirim (_pushq eşleniği — hatası sessiz yutulur, main.py:2996-2997)
  try {
    await pushBekleyen(c.env, `${Date.now()}_${tokenHex(4)}`, {
      user: target, title: ad, body: VM[lng] ?? VM.en, route: `voice:${user}:${pid}:${ad}`,
    })
  } catch { /* push gitmezse istek yine de işler */ }
  // SUNUCU KARARI (main.py:3467-3470): sohbete ses baloncuğu — app kapalıyken bile kalır
  const [a, b] = user <= target ? [user, target] : [target, user]   // user_a <= user_b kanonik sıra
  await db.batch([
    db.prepare(
      `INSERT INTO dm_messages (id, user_a, user_b, frm, msg_type, text, media, ts, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 'voice', '', ?5, ?6, ?7, ?7)`)
      .bind(tokenHex(6), a, b, user, pid, ts, ts),
    db.prepare(
      `INSERT OR REPLACE INTO ptt_acl (pid, club_cid, users_json, created_at, updated_at)
       VALUES (?1, NULL, ?2, ?3, ?3)`).bind(pid, JSON.stringify([user, target]), ts),
  ])
  return c.json({ ok: true, id: pid, sent: 1 })
})

// POST /api/ptt/busy (main.py:3578-3593) — çakışma kilidi. KV `ptt_busy:{hedef}` (cf_mapping);
// süre birebir 25 sn (`until` alanı; KV TTL 60 = alt sınır, yalnız çöp temizliği).
// DİKKAT: arkadaşlık kontrolü YOK (mevcut davranış — Faz 2 notu).
g.post('/api/ptt/busy', authUser, async (c) => {
  const user = c.get('user')
  const body = await govde(c)
  const target = await resolveUser(c.env.DB, String(body.user || ''))
  const on = pyTruthy(body.on)                             // bool(body.get('on')) — []/{}  de falsy
  if (!target || target === user) hata(404, 'kullanıcı yok')
  if (on) {
    const me = await c.env.DB.prepare('SELECT name FROM users WHERE uid = ?1').bind(user)
      .first<{ name: string | null }>()
    const ad = (me?.name || user) || 'Rider'                 // _profile_of: name or uid; 'or Rider' aynen
    await c.env.KV.put(`ptt_busy:${target}`,
      JSON.stringify({ from: user, name: ad, until: simdi() + 25 }), { expirationTtl: 60 })
  } else {
    // SADECE kendi koyduğu kaydı temizler (main.py:3590-3591)
    let mevcut: { from?: string } | null = null
    try { mevcut = await c.env.KV.get<{ from?: string }>(`ptt_busy:${target}`, 'json') } catch { mevcut = null }
    if (mevcut && mevcut.from === user) await c.env.KV.delete(`ptt_busy:${target}`)
  }
  return c.json({ ok: true })
})

// GET /api/ptt/busy/:username (main.py:3596-3603) — YÖN DİKKAT: sorgulanan, BENİM kaydım —
// "{username} şu an BANA konuşuyor mu".
g.get('/api/ptt/busy/:username', authUser, async (c) => {
  const user = c.get('user')
  const f = await resolveUser(c.env.DB, c.req.param('username'))
  let b: { from?: string; name?: string; until?: number } | null = null
  try { b = await c.env.KV.get<{ from?: string; name?: string; until?: number }>(`ptt_busy:${user}`, 'json') } catch { b = null }
  const busy = !!(f && b && b.from === f && (b.until ?? 0) > Date.now() / 1000)
  return c.json({ busy, name: busy ? (b?.name ?? null) : null })
})

// GET /api/ptt/:pid (main.py:3606-3620) — önce ptt/ (24 saat), yoksa voicemsg/ (30 gün).
// Yetkisizlik de 404 döner (403 DEĞİL — klip varlığını sızdırmama tercihi, aynen korunur).
// acl kaydı YOKSA herkese açık (eski klipler — mevcut davranış).
g.get('/api/ptt/:pid', authUser, async (c) => {
  const user = c.get('user')
  const temiz = c.req.param('pid').replace(/[^a-z0-9]/g, '')   // re.sub(r'[^a-z0-9]') — büyük harf de süzülür
  let obj = await c.env.R2.get(`ptt/${temiz}.m4a`)
  if (!obj) obj = await c.env.R2.get(`voicemsg/${temiz}.m4a`)
  if (!obj) hata(404, 'klip yok')
  const acl = await c.env.DB.prepare('SELECT club_cid, users_json FROM ptt_acl WHERE pid = ?1')
    .bind(temiz).first<{ club_cid: string | null; users_json: string | null }>()
  if (acl) {
    if (acl.users_json !== null) {
      let liste: unknown = []
      try { liste = JSON.parse(acl.users_json) } catch { liste = [] }
      if (!Array.isArray(liste) || !liste.includes(user)) hata(404, 'klip yok')
    }
    if (acl.club_cid !== null) {
      const uye = await c.env.DB.prepare('SELECT 1 AS x FROM club_members WHERE cid = ?1 AND uid = ?2')
        .bind(acl.club_cid, user).first()
      if (!uye) hata(404, 'klip yok')
    }
  }
  return new Response(obj.body, { headers: { 'content-type': 'audio/mp4' } })
})

export default g
