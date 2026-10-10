// grup3 — api/friends + auth + api/internal (16 uç) — main.py birebir portu.
// Uçlar TAM yol ile eklenir (mount kökü '/').
// Ortak lib: ../lib/env (AppEnv), ../lib/auth (authUser, secretOk, makeJwt, b64uDecode), ../lib/db, ../lib/hata
// Sözleşme kayıtları: cf/contracts/api.json + cf/contracts/grup3.json
//
// Kapsanan uçlar:
//   GET    /api/friends                    (main.py:2921)
//   POST   /api/friends/request            (main.py:3931)
//   GET    /api/friends/requests           (main.py:3954)
//   POST   /api/friends/respond            (main.py:3962)
//   POST   /api/friends                    (main.py:3980 — geriye uyumluluk: isteğe çevrilmiş eski uç)
//   DELETE /api/friends/{uname}            (main.py:3994)
//   POST   /auth/login                     (main.py:537)
//   POST   /auth/apple                     (main.py:577)
//   POST   /auth/google                    (main.py:635)
//   POST   /auth/sms/start                 (main.py:734 — koşulsuz 410, ölü kod TAŞINMADI)
//   POST   /auth/sms/verify                (main.py:794)
//   POST   /api/internal/register-ride     (main.py:1049)
//   POST   /api/internal/render-done       (main.py:1107)
//   POST   /api/internal/render-failed     (main.py:1243)
//   GET    /api/internal/music             (main.py:2138)
//
// cf_mapping kararları (sözleşme gereği):
//   pushq/pushreq dosya kuyruğu → KV "push:bekleyen:<dosya-adı-eşleniği>" (Faz 3'te gerçek APNs/FCM)
//     · _pushq değeri: {user,title,body,route?} — anahtar: push:bekleyen:<ms>_<hex8>
//     · pushreq değeri: {user,title,body,ts}   — anahtar: push:bekleyen:<orijinal dosya adı gövdesi>
//   adminq dosya kuyruğu → KV "adminq:bekleyen:<ms>" değer {msg} (yeni üye bildirimi)
//   smsfix.json → KV "smsfix:<telefon>" {fixed,ts} (yazan yok — start 410; okuma mantığı korundu)
//   _rl bellek rate-limiter → KV "rl:smsverify:<telefon>" (kayan pencere; TTL=pencere)
//   admin-numbers.conf → KV "admin-numbers" (JSON dizi; rakam-dışı ayıklanarak karşılaştırılır)
//   Apple/Google JWKS 1 saat bellek cache → KV "jwks:apple" / "jwks:google" (TTL 3600)
//   /opt/movelog/data/sv-kapali dosya bayrağı → KV "sv_off" (anahtar VARSA true)
//   usermusic/ridephotos/stockmusic dosya ağacı → R2 aynı yollarla
//   detected_rides/cloud_videos/pending/failed/gpucost/... → D1 (0001_init.sql)

import { Hono, type Context } from 'hono'
import type { AppEnv, Env } from '../lib/env'
import { authUser, secretOk, makeJwt, b64uDecode } from '../lib/auth'
import { getUser, simdi, type UserRow } from '../lib/db'
import { hata, hataYanit } from '../lib/hata'
import { adminq as adminqLib, pushq as pushqLib, svKapali } from '../lib/ortak'

const g = new Hono<AppEnv>()

// grup3'ün kullandığı, çekirdek Env'de (henüz) tanımlı olmayan sırlar/ayarlar.
// NOT lib'e: env.ts'e eklenmesi önerilen alanlar → USERS, TWILIO_SID, TWILIO_TOKEN,
// TWILIO_VERIFY_SID, REVIEW_PHONE, REVIEW_CODE (hepsi SECRETS.md'de kayıtlı).
type Grup3Env = Env & {
  USERS?: string            // "kullanici:parola,..." (main.py:46)
  TWILIO_SID?: string
  TWILIO_TOKEN?: string
  TWILIO_VERIFY_SID?: string
  REVIEW_PHONE?: string     // App Store inceleme bypass numarası (main.py:60)
  REVIEW_CODE?: string      // inceleme sabit OTP kodu (main.py:61)
}

const enc = new TextEncoder()
const td = new TextDecoder()

// ---------- küçük yardımcılar ----------

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** hmac.compare_digest eşleniği (sabit-zaman string kıyası). */
function sabitEsit(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let acc = 0
  for (let i = 0; i < a.length; i++) acc |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return acc === 0
}

/** FastAPI `body: dict` / `Body(...)` eşleniği — doğrulama handler'dan ÖNCE (sms/start dahil).
 *  Canlı backend'e karşı doğrulandı (2026-08-30, 127.0.0.1:8780):
 *    gövde yok VEYA JSON null → 422 {type:'missing'} · bozuk JSON → 422 {type:'json_invalid'} ·
 *    dict değil (liste/str/sayı) → 422 {type:'dict_type', input:<gövde>}. */
async function govdeAl(c: Context<AppEnv>): Promise<Record<string, any>> {
  let ham = ''
  try { ham = await c.req.text() } catch { ham = '' }
  if (!ham) hata(422, [{ type: 'missing', loc: ['body'], msg: 'Field required', input: null }])
  let v: unknown
  try { v = JSON.parse(ham) } catch {
    hata(422, [{ type: 'json_invalid', loc: ['body', 0], msg: 'JSON decode error', input: {}, ctx: { error: 'Expecting value' } }])
  }
  if (v === null) hata(422, [{ type: 'missing', loc: ['body'], msg: 'Field required', input: null }])
  if (typeof v !== 'object' || Array.isArray(v)) {
    hata(422, [{ type: 'dict_type', loc: ['body'], msg: 'Input should be a valid dictionary', input: v }])
  }
  return v as Record<string, any>
}

/** int(x or 0) eşleniği — bozuk girdide 0 (Python 500 verirdi; güvenli taraf seçildi). */
function int0(v: unknown): number {
  const n = Math.trunc(Number(v))
  return Number.isFinite(n) ? n : 0
}

/** main.py:46 APP_USERS — env.USERS "user:pass,..." listesi. Varsayılan parola PORTLANMADI (fail-closed). */
function appUsers(env: Grup3Env): Record<string, string> {
  const out: Record<string, string> = Object.create(null)
  for (const kv of (env.USERS ?? '').split(',')) {
    const i = kv.indexOf(':')
    if (i >= 0) out[kv.slice(0, i)] = kv.slice(i + 1)
  }
  return out
}

// ---------- push / admin kuyrukları (dosya kuyruğu → KV, Faz 3'te gerçek gönderim) ----------

/** main.py:2986 _pushq — lib/ortak pushq'ya devredildi (bütünleştirme 08-30). */
async function pushq(env: Env, kayit: { user: string; title: string; body: string; route?: string }) {
  await pushqLib(env, kayit.user, kayit.title, kayit.body, kayit.route)
}

/** pushreq/<dosya>.json eşleniği (render-done/failed pushları; dosya adı kimliği korunur). */
async function pushreq(
  env: Env, dosyaAdi: string,
  kayit: { user: string; title: string; body: string; ts: number; route?: string },
) {
  try {
    // 🔴 FİKS 05.09: TTL YOKTU. push-kuyruk yalnız BAŞARIDA siliyor → teslim edilemeyen bir kayıt
    // (ör. token iptal) her dakika sonsuza dek yeniden deneniyor ve KV sınırsız büyüyordu.
    await env.KV.put(`push:bekleyen:${dosyaAdi}`, JSON.stringify(kayit), { expirationTtl: 7 * 86400 })
  } catch { /* sessiz */ }
}

/** main.py:2957 _adminq — lib/ortak adminq'ya devredildi (bütünleştirme 08-30). */
async function adminq(env: Env, msg: string) {
  await adminqLib(env, msg)
}

/** main.py:2967 _uye_bildir — yeni üye bildirimi ('ÜYELİK' kelimesi bilinçli, wa-notify APP_RE filtresi). */
async function uyeBildir(env: Env, username: string, isim: string | null, yontem: string, iletisim: string) {
  try {
    const say = await env.DB.prepare(
      "SELECT COUNT(*) AS toplam, COALESCE(SUM(CASE WHEN premium = 1 THEN 1 ELSE 0 END), 0) AS abone FROM users")
      .first<{ toplam: number; abone: number }>()
    await adminq(env,
      `🎉 Move Log Üyelik\n` +
      `${isim || '(isimsiz)'} — ${yontem} girişi\n` +
      `${iletisim || '—'} · id ${username.slice(0, 16)}\n` +
      `Toplam: ${say?.toplam ?? 0} üye · ${say?.abone ?? 0} abone`)
  } catch { /* sessiz — main.py:2972 try/except */ }
}

// ---------- RS256 (Apple/Google ID token) doğrulama ----------

/** main.py:560 _verify_apple_rs256 eşleniği — WebCrypto RSASSA-PKCS1-v1_5/SHA-256 (jenerik, Google da kullanır). */
export async function rs256Dogrula(token: string, jwk: { n?: string; e?: string }): Promise<boolean> {
  try {
    const [h, p, s] = token.split('.')
    const key = await crypto.subtle.importKey(
      'jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64uDecode(s), enc.encode(`${h}.${p}`))
  } catch {
    return false
  }
}

/** JWKS getir — KV cache TTL 3600 (main.py:551/626'daki 1 saatlik bellek cache eşleniği).
 *  fetch/parse hatası Python'daki gibi yukarı fırlar (→ text/plain 500). */
export async function jwksGetir(env: Env, kvAnahtar: string, url: string): Promise<Array<{ kid?: string; n?: string; e?: string }>> {
  try {
    const cached = (await env.KV.get(kvAnahtar, 'json')) as Array<{ kid?: string; n?: string; e?: string }> | null
    if (Array.isArray(cached) && cached.length) return cached
  } catch { /* cache okunamadı → taze çek */ }
  const r = await fetch(url)
  const keys = (((await r.json()) as { keys?: unknown[] })?.keys ?? []) as Array<{ kid?: string; n?: string; e?: string }>
  if (Array.isArray(keys) && keys.length) {
    try { await env.KV.put(kvAnahtar, JSON.stringify(keys), { expirationTtl: 3600 }) } catch { /* sessiz */ }
  }
  return keys
}

// ---------- telefon / rate limit ----------

/** main.py:674 _norm_phone — + yoksa TR (+90) varsayımı. */
function normPhone(p: unknown): string {
  let s = String(p ?? '').replace(/[^\d+]/g, '')
  if (s.startsWith('+')) return s
  if (s.startsWith('00')) return '+' + s.slice(2)
  if (s.startsWith('0')) s = s.slice(1)
  if (s.length === 10) return '+90' + s
  return s ? '+' + s : ''
}

/** main.py:173 _rate_ok — kayan pencere sayacı, KV'de (rl:<anahtar>). */
async function rateOk(env: Env, anahtar: string, limit: number, pencere: number): Promise<boolean> {
  const kvAnahtar = `rl:${anahtar}`
  const now = Date.now() / 1000
  let arr: number[] = []
  try { arr = ((await env.KV.get(kvAnahtar, 'json')) as number[] | null) ?? [] } catch { arr = [] }
  arr = arr.filter((t) => now - t < pencere)
  if (arr.length >= limit) {
    try { await env.KV.put(kvAnahtar, JSON.stringify(arr), { expirationTtl: pencere }) } catch { /* sessiz */ }
    return false
  }
  arr.push(now)
  try { await env.KV.put(kvAnahtar, JSON.stringify(arr), { expirationTtl: pencere }) } catch { /* sessiz */ }
  return true
}

/** main.py:66-81 admin numara listesi — KV 'admin-numbers' (JSON dizi). */
async function adminTelefonMu(env: Env, phone: string): Promise<boolean> {
  try {
    const arr = (await env.KV.get('admin-numbers', 'json')) as string[] | null
    const set = new Set((arr ?? []).map((x) => String(x).replace(/\D/g, '')).filter(Boolean))
    return set.has(String(phone ?? '').replace(/\D/g, ''))
  } catch {
    return false
  }
}

/** main.py:729 _smsfix_get — KV smsfix:<tel> {fixed, ts}; 1 saat TTL kontrolü korunur. */
async function smsfixGet(env: Env, phone: string): Promise<string | null> {
  try {
    const v = (await env.KV.get(`smsfix:${phone}`, 'json')) as { fixed?: string; ts?: number } | null
    if (v && v.fixed && simdi() - (v.ts ?? 0) < 3600) return v.fixed
  } catch { /* sessiz */ }
  return null
}

// ---------- _profile_of (main.py:1389) ----------

type ProfilBaglam = {
  satirlar: Map<string, UserRow>
  svOff: boolean
}

async function profilBaglam(env: Env, uids: string[]): Promise<ProfilBaglam> {
  const benzersiz = [...new Set(uids)].filter(Boolean)
  const satirlar = new Map<string, UserRow>()
  if (!benzersiz.length) return { satirlar, svOff: false }
  const ph = benzersiz.map((_, i) => `?${i + 1}`).join(',')
  const r = await env.DB.prepare(`SELECT * FROM users WHERE uid IN (${ph})`).bind(...benzersiz).all<UserRow>()
  for (const row of r.results) satirlar.set(row.uid, row)
  // sv-kapali dosya bayrağı → lib/ortak svKapali (tek KV anahtarı 'sv_off'; main.py:1398 eşleniği)
  const svOff = await svKapali(env)
  // 18.09: free_tactical kill-switch + cihaz-dedup KALDIRILDI (Ultra/taktik cikti).
  return { satirlar, svOff }
}

function profilOf(b: ProfilBaglam, u: string) {
  const p = b.satirlar.get(u)
  let avatar: unknown = null
  if (p?.avatar_json) { try { avatar = JSON.parse(p.avatar_json) } catch { /* bozuksa varsayılan */ } }
  return {
    username: u,
    name: p?.name || u,
    handle: p?.handle || '',
    avatar: avatar || { type: 'initials' },
    premium: !!p?.premium,
    sv_off: b.svOff,
    video_hak: int0(p?.video_hak ?? 0),
    // ⚠️ SABİT false — 19.09'da GERİ KONDU. iOS `Profile` struct'ında `ultra` ZORUNLU alan;
    // Swift'in sentezlediği Codable çözücüsü VARSAYILAN DEĞERİ KULLANMAZ, eksik anahtarda
    // fırlatır -> profilin TAMAMI çözülemez (kullanıcı adı + avatar kaybolur, 1.67 dahil).
    ultra: false,
    sokak_hediye: false,                             // TUZAK: HER ZAMAN false (eski sürüm uyumu, main.py:1405)
    admin: !!p?.admin,
  }
}

// ---------- kullanıcı çözümü (main.py:2935-2954) ----------

function normHandle(s: unknown): string {
  return String(s ?? '').trim().replace(/^@+/, '').toLowerCase()
}

async function resolveUser(env: Grup3Env, s: unknown): Promise<string | null> {
  const h = normHandle(s)
  if (!h) return null
  const idRow = await env.DB.prepare('SELECT uid FROM users WHERE uid = ?1').bind(h).first<{ uid: string }>()
  if (idRow) return h
  if (h in appUsers(env)) return h                   // APP_USERS (baris vb.) da geçerli hedef (main.py:2952)
  const hRow = await env.DB.prepare('SELECT uid FROM users WHERE handle = ?1 COLLATE NOCASE').bind(h).first<{ uid: string }>()
  return hRow?.uid ?? null
}

// ---------- arkadaşlık yardımcıları ----------

/** main.py:3922 _make_friends — iki yön + freqs iki yönden temizlik (tek batch). */
async function arkadasYap(env: Env, a: string, b: string) {
  const t = simdi()
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO friends (uid, friend_uid, created_at, updated_at) VALUES (?1,?2,?3,?3)').bind(a, b, t),
    env.DB.prepare('INSERT OR IGNORE INTO friends (uid, friend_uid, created_at, updated_at) VALUES (?1,?2,?3,?3)').bind(b, a, t),
    env.DB.prepare('DELETE FROM friend_requests WHERE (target_uid = ?1 AND requester_uid = ?2) OR (target_uid = ?2 AND requester_uid = ?1)').bind(a, b),
  ])
}

async function arkadasListesi(env: Env, uid: string): Promise<string[]> {
  const r = await env.DB.prepare('SELECT friend_uid FROM friends WHERE uid = ?1 ORDER BY created_at, rowid')
    .bind(uid).all<{ friend_uid: string }>()
  return r.results.map((x) => x.friend_uid)
}

/** me_label (main.py:3937-3938): name (@handle). */
async function benimEtiket(env: Env, user: string): Promise<string> {
  const me = await env.DB.prepare('SELECT name, handle FROM users WHERE uid = ?1').bind(user)
    .first<{ name: string | null; handle: string | null }>()
  return (me?.name || user) + (me?.handle ? ` (@${me.handle})` : '')
}

/** main.py:3931 friend_request gövdesi — POST /api/friends/request ve eski POST /api/friends paylaşır. */
async function arkadasIstegiYurut(env: Grup3Env, user: string, usernameRaw: unknown): Promise<{ ok: true; status: 'friends' | 'requested' }> {
  const target = await resolveUser(env, usernameRaw)
  if (!target || target === user) hata(404, 'kullanıcı bulunamadı')
  const meLabel = await benimEtiket(env, user)
  const zaten = await env.DB.prepare('SELECT 1 AS x FROM friends WHERE uid = ?1 AND friend_uid = ?2').bind(user, target).first()
  if (zaten) return { ok: true, status: 'friends' }
  // o zaten BANA istek atmış -> karşılıklı istek = otomatik kabul (main.py:3941)
  const bana = await env.DB.prepare('SELECT 1 AS x FROM friend_requests WHERE target_uid = ?1 AND requester_uid = ?2').bind(user, target).first()
  if (bana) {
    await arkadasYap(env, user, target)
    await pushq(env, { user: target, title: 'Move Log', body: `${meLabel} arkadaşlık isteğini kabul etti 🤝`, route: 'friends' })
    return { ok: true, status: 'friends' }
  }
  // İDEMPOTENT: istek zaten varsa tekrar yazılmaz, TEKRAR PUSH ATILMAZ (main.py:3947-3950)
  const varMi = await env.DB.prepare('SELECT 1 AS x FROM friend_requests WHERE target_uid = ?1 AND requester_uid = ?2').bind(target, user).first()
  if (!varMi) {
    const t = simdi()
    await env.DB.prepare('INSERT INTO friend_requests (target_uid, requester_uid, created_at, updated_at) VALUES (?1,?2,?3,?3)')
      .bind(target, user, t).run()
    await pushq(env, { user: target, title: 'Move Log', body: `${meLabel} sana arkadaşlık isteği gönderdi 🤝`, route: 'friends' })
  }
  return { ok: true, status: 'requested' }
}

// ---------- lokalize push metinleri (main.py'den birebir) ----------

// main.py:1094 — rota meydan okuması başlıkları (13 dil)
const MT: Record<string, string> = {
  en: 'Route challenge complete 🏁', tr: 'Rota meydan okuması tamam 🏁', es: '¡Reto de ruta completado! 🏁',
  fr: "Défi d'itinéraire relevé 🏁", de: 'Routen-Challenge geschafft 🏁', it: 'Sfida percorso completata 🏁',
  pt: 'Desafio de rota concluído 🏁', ru: 'Маршрут-вызов пройден 🏁', ja: 'ルートチャレンジ達成🏁',
  zh: '路线挑战完成 🏁', ko: '루트 챌린지 완료 🏁', ar: 'اكتمل تحدي المسار 🏁', hi: 'रूट चैलेंज पूरा 🏁',
}

// main.py:1165 — grup sürüş push başlığı (13 dil)
const GT: Record<string, string> = {
  en: '🏍️🏍️ Your group ride video is ready!', tr: '🏍️🏍️ Birlikte sürüş videonuz hazır!',
  ar: '🏍️🏍️ فيديو رحلتكم المشتركة جاهز!', es: '🏍️🏍️ ¡Vuestro vídeo de ruta juntos está listo!',
  fr: '🏍️🏍️ Votre vidéo de ride à deux est prête !', ru: '🏍️🏍️ Видео вашей совместной поездки готово!',
  de: '🏍️🏍️ Euer gemeinsames Ride-Video ist fertig!', it: '🏍️🏍️ Il video del vostro giro insieme è pronto!',
  pt: '🏍️🏍️ O vídeo do rolê de vocês está pronto!', ja: '🏍️🏍️ グループライド動画ができました！',
  zh: '🏍️🏍️ 你们的结伴骑行视频已生成！', ko: '🏍️🏍️ 함께한 라이딩 영상이 준비됐어요!',
  hi: '🏍️🏍️ आपकी ग्रुप राइड का वीडियो तैयार है!',
}

// main.py:1172 — grup sürüş push gövdesi ({f} = arkadaş adları)
const GB: Record<string, string> = {
  en: 'You rode together with {f} — watch your joint video in Routes!',
  tr: "{f} ile birlikte sürdünüz — ortak videonuzu Rotalar'da izleyin!",
  ar: 'قدتم معاً أنت و{f} — شاهدا الفيديو المشترك في المسارات!',
  es: 'Habéis rodado juntos con {f} — ¡ved vuestro vídeo en Rutas!',
  fr: 'Vous avez roulé avec {f} — regardez votre vidéo dans Itinéraires !',
  ru: 'Вы прокатились вместе с {f} — смотрите общее видео в разделе Маршруты!',
  de: 'Du bist mit {f} gefahren — schaut euer Video unter Routen an!',
  it: 'Hai guidato insieme a {f} — guarda il vostro video in Percorsi!',
  pt: 'Você pilotou junto com {f} — veja o vídeo em Rotas!',
  ja: '{f}さんと一緒に走りました — ルートで動画を見よう！',
  zh: '你和{f}一起骑行了 — 快去路线里看你们的视频！',
  ko: '{f}님과 함께 라이딩했어요 — 경로에서 영상을 확인하세요!',
  hi: 'आपने {f} के साथ राइड की — रूट्स में अपना वीडियो देखें!',
}

// ---------------------------------------------------------------------------
// 05.09 — VİDEO HAZIR push'u (cron/src/ic.ts ikizi ile BİREBİR). ÖNCE: sabit Türkçe metin,
// rota kimliği yok, `route` alanı yok → 80 dakikada 3 farklı rota için 4 tıpatıp aynı bildirim;
// ayrıca push_tokens'ın 24 cihazından 16'sı Türkçe değil ama metin sabit Türkçeydi.
const VT: Record<string, string> = {
  en: 'Your video is ready 🎬', tr: 'Videon hazır 🎬', es: 'Tu vídeo está listo 🎬',
  fr: 'Ta vidéo est prête 🎬', de: 'Dein Video ist fertig 🎬', it: 'Il tuo video è pronto 🎬',
  pt: 'Seu vídeo está pronto 🎬', ru: 'Твоё видео готово 🎬', ja: '動画ができました🎬',
  zh: '你的视频已生成 🎬', ko: '영상이 준비됐어요 🎬', ar: 'الفيديو جاهز 🎬', hi: 'आपका वीडियो तैयार है 🎬',
}
const VTO: Record<string, string> = {
  en: 'Your daily recap is ready 🎬', tr: 'Günlük özetin hazır 🎬', es: 'Tu resumen del día está listo 🎬',
  fr: 'Ton résumé du jour est prêt 🎬', de: 'Deine Tagesübersicht ist fertig 🎬', it: 'Il riepilogo di oggi è pronto 🎬',
  pt: 'Seu resumo do dia está pronto 🎬', ru: 'Дневная сводка готова 🎬', ja: '今日のまとめができました🎬',
  zh: '今日回顾已生成 🎬', ko: '오늘의 요약이 준비됐어요 🎬', ar: 'ملخصك اليومي جاهز 🎬', hi: 'आज का रीकैप तैयार है 🎬',
}
const VB: Record<string, string> = {
  en: '{d} — watch it in Routes.', tr: "{d} — Rotalar'da izle.", es: '{d} — míralo en Rutas.',
  fr: '{d} — à voir dans Itinéraires.', de: '{d} — ansehen unter Routen.', it: '{d} — guardalo in Percorsi.',
  pt: '{d} — assista em Rotas.', ru: '{d} — смотри в разделе «Маршруты».', ja: '{d} — ルートで見てね。',
  zh: '{d} — 去“路线”里观看。', ko: '{d} — 경로에서 확인하세요.', ar: '{d} — شاهده في المسارات.',
  hi: '{d} — रूट्स में देखें।',
}
const VBF: Record<string, string> = {
  en: '{d} · made on your phone — watch it in Routes.',
  tr: "{d} · telefonunda üretildi — Rotalar'da izle.",
  es: '{d} · creado en tu teléfono — míralo en Rutas.',
  fr: '{d} · créé sur ton téléphone — à voir dans Itinéraires.',
  de: '{d} · auf deinem Handy erstellt — ansehen unter Routen.',
  it: '{d} · creato sul tuo telefono — guardalo in Percorsi.',
  pt: '{d} · feito no seu telefone — assista em Rotas.',
  ru: '{d} · создано на твоём телефоне — смотри в «Маршрутах».',
  ja: '{d} · スマホで作成 — ルートで見てね。',
  zh: '{d} · 在你的手机上生成 — 去“路线”里观看。',
  ko: '{d} · 휴대폰에서 제작됨 — 경로에서 확인하세요.',
  ar: '{d} · أُنشئ على هاتفك — شاهده في المسارات.',
  hi: '{d} · आपके फ़ोन पर बना — रूट्स में देखें।',
}
/** "05.09 10:41 · 12,4 km" — bildirimin HANGİ rotaya ait olduğunu söyleyen kimlik satırı (TR = UTC+3). */
export function pushKimlik(ts: number, km: number | null): string {
  const d = new Date((ts + 3 * 3600) * 1000)
  const iki = (n: number) => String(n).padStart(2, '0')
  const parca = [`${iki(d.getUTCDate())}.${iki(d.getUTCMonth() + 1)} ${iki(d.getUTCHours())}:${iki(d.getUTCMinutes())}`]
  if (km && km > 0) parca.push(`${km.toFixed(1)} km`)
  return parca.join(' · ')
}
/** Video-hazır push gövdesi — dil + rota kimliği + kaynak (telefon/bulut). */
export function videoPush(
  lang: string | null | undefined, ozet: boolean, ts: number, km: number | null, telefon: boolean,
): { title: string; body: string } {
  const l = lang || 'en'
  const govde = telefon ? VBF : VB
  return {
    title: ozet ? VTO[l] || VTO.en : VT[l] || VT.en,
    body: (govde[l] || govde.en).split('{d}').join(pushKimlik(ts, km)),
  }
}

// main.py:3697 — rozet push başlığı (13 dil)
// 18.09: BT (rozet push başlığı) + BADGE_DEFS KALDIRILDI — rozet özelliği çıktı.
// Tek tüketicileri POST /api/internal/badges ucuydu; o da bu commit'te silindi.

// main.py:1076 _hv — haversine (km)
function haversineKm(a1: number, o1: number, a2: number, o2: number): number {
  const rad = (x: number) => (x * Math.PI) / 180
  const dA = rad(a2 - a1)
  const dO = rad(o2 - o1)
  return 2 * 6371 * Math.asin(Math.sqrt(
    Math.sin(dA / 2) ** 2 + Math.cos(rad(a1)) * Math.cos(rad(a2)) * Math.sin(dO / 2) ** 2))
}

// ============================================================================
// AUTH UÇLARI
// ============================================================================

// POST /auth/login (main.py:537)
g.post('/auth/login', async (c) => {
  const env = c.env as Grup3Env
  const body: any = await govdeAl(c)
  const user = String(body?.user ?? '')
  const pw = String(body?.password ?? '')
  const kullanicilar = appUsers(env)
  if (user in kullanicilar && sabitEsit(kullanicilar[user], pw)) {
    await cihazBagla(env, c, user)
    return c.json({ token: await makeJwt(env, user), user })
  }
  return hataYanit(401, 'kullanıcı adı veya parola hatalı')
})

const APPLE_AUD = 'com.nickdegs.kisisel'   // main.py:547

// POST /auth/apple (main.py:577)
g.post('/auth/apple', async (c) => {
  const env = c.env as Grup3Env
  const body: any = await govdeAl(c)
  const tok = String(body?.identity_token ?? '')
  const name = String(body?.name ?? '')
  const parca = tok.split('.')
  let header: any, payload: any
  try {
    if (parca.length !== 3) throw new Error('parça')
    header = JSON.parse(td.decode(b64uDecode(parca[0])))
    payload = JSON.parse(td.decode(b64uDecode(parca[1])))
  } catch {
    return hataYanit(401, 'geçersiz Apple token')
  }
  const keys = await jwksGetir(env, 'jwks:apple', 'https://appleid.apple.com/auth/keys')
  const jwk = keys.find((kk) => kk?.kid === header?.kid)
  if (!jwk || !(await rs256Dogrula(tok, jwk))) return hataYanit(401, 'Apple imzası doğrulanamadı')
  const audRaw = payload?.aud
  const aud: unknown[] = Array.isArray(audRaw) ? audRaw : [audRaw]   // aud str VEYA list (main.py:589)
  if (payload?.iss !== 'https://appleid.apple.com' || !aud.includes(APPLE_AUD)) {
    return hataYanit(401, 'Apple token sahibi uyuşmuyor')
  }
  if (Number(payload?.exp ?? 0) < Date.now() / 1000) return hataYanit(401, 'Apple token süresi dolmuş')
  const sub = String(payload?.sub ?? '')
  if (!sub) return hataYanit(401, 'Apple kullanıcı kimliği yok')
  const username = 'apple_' + (await sha256Hex(sub)).slice(0, 12)
  const mevcut = await getUser(env.DB, username)
  // ALIAS TUZAĞI (main.py:601-602): bağlanmış hesap -> token KANONİK kimlikle basılır,
  // apple_sub/name YAZILMAZ (erken dönüş).
  if (mevcut?.alias) {
    await cihazBagla(env, c, mevcut.alias)
    return c.json({ token: await makeJwt(env, mevcut.alias), user: mevcut.alias })
  }
  const now = simdi()
  const ad = name ? name.slice(0, 40) : ''
  if (!mevcut) {
    // 10.10 İLK VİDEO HEDİYE: yeni üye 1 video hakkıyla doğar (bkz. migrations/0013). 18.09–10.10
    // arası 42 yeni üye, 48 "video oluştur" denemesi, 48×402, 0 satın alma: ücretsiz kullanıcı kendi
    // rotasından tek video bile göremiyordu. Hak, generate'te düşer (grup1 hakOdendi; bütçeden düşmez).
    await env.DB.prepare('INSERT INTO users (uid, name, apple_sub, video_hak, created_at, updated_at) VALUES (?1,?2,?3,1,?4,?4)')
      .bind(username, ad || null, sub, now).run()
    await uyeBildir(env, username, ad || null, 'Apple', String(payload?.email ?? ''))
  } else {
    // setdefault(apple_sub) + (name boşsa) name (main.py:603-605)
    await env.DB.prepare(
      `UPDATE users SET apple_sub = COALESCE(apple_sub, ?2),
         name = CASE WHEN ?3 != '' AND (name IS NULL OR name = '') THEN ?3 ELSE name END,
         updated_at = ?4 WHERE uid = ?1`)
      .bind(username, sub, ad, now).run()
  }
  await cihazBagla(env, c, username)
  return c.json({ token: await makeJwt(env, username), user: username })
})

// ---------------------------------------------------------------------------
// CIHAZ BAGLAMA (17.09, Baris: "herkes tek cihazdan girecek")
// Hesap tek cihaza baglidir. Istemci X-Device-Id basligi gonderir (iOS identifierForVendor,
// Android ANDROID_ID). Kurallar:
//   baslik YOK      -> hicbir sey yapma (sahadaki eski surumler kirilmasin)
//   bagli cihaz YOK -> sessizce bagla
//   ayni cihaz      -> yalnizca device_seen tazele
//   FARKLI cihaz    -> tv + 1 (eski cihazin tum oturumlari duser) + yeni cihaza bagla
// ⚠️ SIRA: makeJwt tv'yi uretim aninda okur -> bu fonksiyon makeJwt'den ONCE cagrilmalidir,
//    yoksa yeni cihazin token'i eski tv ile basilir ve ilk istekte kendi kendini 401 yapar.
// ---------------------------------------------------------------------------
async function cihazBagla(env: Env, c: Context, uid: string): Promise<void> {
  const cihaz = (c.req.header('X-Device-Id') || '').trim().slice(0, 128)
  if (!cihaz) return
  try {
    await cihazBaglaIc(env, cihaz, uid)
  } catch (e) {
    // FAIL-OPEN (bilincli): cihaz baglama bir GUVENLIK EKI; D1 hatasi, eksik kolon veya
    // migration gecikmesi yuzunden GIRIS UCU asla 500 vermemeli. Hata yutulur, kullanici girer.
    console.log('cihaz baglama atlandi:', String(e).slice(0, 120))
  }
}

async function cihazBaglaIc(env: Env, cihaz: string, uid: string): Promise<void> {
  const now = simdi()
  const row = await env.DB.prepare('SELECT device_id FROM users WHERE uid = ?1')
    .bind(uid).first<{ device_id: string | null }>()
  const bagli = (row?.device_id || '').trim()
  if (!bagli) {
    await env.DB.prepare('UPDATE users SET device_id = ?2, device_seen = ?3, updated_at = ?3 WHERE uid = ?1')
      .bind(uid, cihaz, now).run()
    return
  }
  if (bagli === cihaz) {
    await env.DB.prepare('UPDATE users SET device_seen = ?2 WHERE uid = ?1').bind(uid, now).run()
    return
  }
  // farkli cihaz: once tv artir (eski oturumlar olur), sonra bagla
  await env.DB.prepare('UPDATE users SET tv = tv + 1, device_id = ?2, device_seen = ?3, updated_at = ?3 WHERE uid = ?1')
    .bind(uid, cihaz, now).run()
}

// main.py:619 GOOGLE_AUDS — Android (film-ozet web client) + iOS (move-log-500805)
const GOOGLE_AUDS = [
  '909630333798-lhvvpkejikqveqpbcn9es0e39eumvs79.apps.googleusercontent.com',
  '515832699888-6fr2fpkr1c1aq8th12jov28sav2h3lct.apps.googleusercontent.com',
  // 17.09: Android da move-log-500805 projesine tasiniyor -> o projenin Web client'i
  // (Credential Manager serverClientId). Yeni Android surumu CIKMADAN once eklendi ki
  // surum yayina girdigi an giris calissin. Ustteki iki id BILEREK duruyor: yayindaki
  // 1.66 ve oncesi hala film-ozet web client'i / eski iOS client ile giriyor.
  '515832699888-a021ep8nomkro6t8lpi31jmnttmksi2n.apps.googleusercontent.com',
]

// POST /auth/google (main.py:635)
g.post('/auth/google', async (c) => {
  const env = c.env as Grup3Env
  const body: any = await govdeAl(c)
  const tok = String(body?.id_token ?? '')
  const name = String(body?.name ?? '')
  const parca = tok.split('.')
  let header: any, payload: any
  try {
    if (parca.length !== 3) throw new Error('parça')
    header = JSON.parse(td.decode(b64uDecode(parca[0])))
    payload = JSON.parse(td.decode(b64uDecode(parca[1])))
  } catch {
    return hataYanit(401, 'geçersiz Google token')
  }
  const keys = await jwksGetir(env, 'jwks:google', 'https://www.googleapis.com/oauth2/v3/certs')
  const jwk = keys.find((kk) => kk?.kid === header?.kid)
  if (!jwk || !(await rs256Dogrula(tok, jwk))) return hataYanit(401, 'Google imzası doğrulanamadı')
  if (payload?.iss !== 'accounts.google.com' && payload?.iss !== 'https://accounts.google.com') {
    return hataYanit(401, 'Google issuer uyuşmuyor')
  }
  const audRaw = payload?.aud
  const aud: unknown[] = Array.isArray(audRaw) ? audRaw : [audRaw]
  if (!aud.some((a) => GOOGLE_AUDS.includes(String(a)))) return hataYanit(401, 'Google token sahibi uyuşmuyor')
  if (Number(payload?.exp ?? 0) < Date.now() / 1000) return hataYanit(401, 'Google token süresi dolmuş')
  const sub = String(payload?.sub ?? '')
  if (!sub) return hataYanit(401, 'Google kullanıcı kimliği yok')
  const username = 'google_' + (await sha256Hex(sub)).slice(0, 12)
  const mevcut = await getUser(env.DB, username)
  if (mevcut?.alias) {
    await cihazBagla(env, c, mevcut.alias)
    return c.json({ token: await makeJwt(env, mevcut.alias), user: mevcut.alias })
  }
  const now = simdi()
  const nm = name || String(payload?.name ?? '')     // body.name yoksa payload.name (main.py:664)
  const ad = nm ? nm.slice(0, 40) : ''
  if (!mevcut) {
    // 10.10 İLK VİDEO HEDİYE (Apple dalıyla aynı): yeni üye 1 video hakkıyla doğar.
    await env.DB.prepare('INSERT INTO users (uid, name, google_sub, video_hak, created_at, updated_at) VALUES (?1,?2,?3,1,?4,?4)')
      .bind(username, ad || null, sub, now).run()
    await uyeBildir(env, username, ad || null, 'Google', String(payload?.email ?? ''))
  } else {
    await env.DB.prepare(
      `UPDATE users SET google_sub = COALESCE(google_sub, ?2),
         name = CASE WHEN ?3 != '' AND (name IS NULL OR name = '') THEN ?3 ELSE name END,
         updated_at = ?4 WHERE uid = ?1`)
      .bind(username, sub, ad, now).run()
  }
  await cihazBagla(env, c, username)
  return c.json({ token: await makeJwt(env, username), user: username })
})

// POST /auth/sms/start (main.py:734) — gövde doğrulaması SONRASI koşulsuz 410 (FastAPI `body: dict`
// validasyonu handler'dan önce çalışır: gövdesiz/bozuk istek 410 DEĞİL 422 alır — canlı doğrulandı).
// 410 sonrası ölü kod (Twilio/ip-api/smsfix yazımı) TAŞINMADI.
g.post('/auth/sms/start', async (c) => {
  await govdeAl(c)
  return hataYanit(410,
    'SMS ile giriş kaldırıldı. Lütfen uygulamayı güncelleyip Google/Apple ile gir. / SMS sign-in was removed. Please update the app and sign in with Google/Apple.')
})

// POST /auth/sms/verify (main.py:794) — BİLEREK AÇIK (eski sürümler + App Store inceleme hesabı)
g.post('/auth/sms/verify', async (c) => {
  const env = c.env as Grup3Env
  const body: any = await govdeAl(c)
  let phone = normPhone(body?.phone ?? '')
  // TUZAK-3: smsfix IP-kurtarma — kimlik DÜZELTİLMİŞ numaradan türetilir (main.py:796-800)
  const fx = phone ? await smsfixGet(env, phone) : null
  if (fx) phone = fx
  const code = String(body?.code ?? '').replace(/\D/g, '')
  if (!phone || !code) return hataYanit(400, 'eksik bilgi')
  if (!(await rateOk(env, 'smsverify:' + phone, 8, 900))) {
    return hataYanit(429, 'çok fazla deneme, biraz sonra tekrar dene')
  }
  let approved = false
  if (env.REVIEW_PHONE && phone === normPhone(env.REVIEW_PHONE)) {
    // TUZAK-1: App Store inceleme bypass'ı — Twilio'ya hiç gidilmez (main.py:807-811)
    if (!(env.REVIEW_CODE && code === env.REVIEW_CODE)) return hataYanit(401, 'kod doğrulanamadı')
    approved = true
  } else {
    if (!(env.TWILIO_SID && env.TWILIO_TOKEN && env.TWILIO_VERIFY_SID)) {
      return hataYanit(503, 'SMS servisi yapılandırılmamış')
    }
    try {
      const r = await fetch(`https://verify.twilio.com/v2/Services/${env.TWILIO_VERIFY_SID}/VerificationCheck`, {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + btoa(`${env.TWILIO_SID}:${env.TWILIO_TOKEN}`),
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: phone, Code: code }).toString(),
      })
      approved = r.status < 300 && ((await r.json()) as any)?.status === 'approved'
    } catch {
      approved = false
    }
  }
  if (!approved) return hataYanit(401, 'kod doğrulanamadı')
  const username = 'u' + (await sha256Hex(phone)).slice(0, 12)
  const mevcut = await getUser(env.DB, username)
  const yeniUye = !mevcut
  const adminMi = await adminTelefonMu(env, phone)   // admin numarası → otomatik admin+premium (main.py:831-833)
  const now = simdi()
  if (!mevcut) {
    await env.DB.prepare('INSERT INTO users (uid, phone, admin, premium, created_at, updated_at) VALUES (?1,?2,?3,?3,?4,?4)')
      .bind(username, phone, adminMi ? 1 : 0, now).run()
  } else {
    await env.DB.prepare(
      `UPDATE users SET phone = COALESCE(phone, ?2),
         admin = CASE WHEN ?3 = 1 THEN 1 ELSE admin END,
         premium = CASE WHEN ?3 = 1 THEN 1 ELSE premium END,
         updated_at = ?4 WHERE uid = ?1`)
      .bind(username, phone, adminMi ? 1 : 0, now).run()
  }
  const adminOldu = adminMi || !!mevcut?.admin
  if (yeniUye && !adminOldu) await uyeBildir(env, username, null, 'SMS', phone)
  await cihazBagla(env, c, username)
  return c.json({ token: await makeJwt(env, username), user: username })
})

// ============================================================================
// İÇ (SECRET-KAPILI) UÇLAR
// ============================================================================

// ---------------------------------------------------------------------------
// POST /auth/refresh — 05.09 YENİ.
// NEDEN: token 30 gün (auth.ts:90 `days = 30`), yenileme mekanizması HİÇ YOKTU ve istemci
// herhangi bir 401'de doğrudan `logout()` çağırıyordu → her kullanıcı 30 günde bir sebepsiz
// yere oturumdan atılıyordu (uçtan uca tarama bulgusu).
// GÜVENLİK: süresi DOLMUŞ token kabul edilmez — `authUser` normal doğrulamayı yapar (imza + tv +
// silinmiş hesap). Yani bu uç yalnız hâlâ GEÇERLİ bir tokenı tazeler; istemci uygulamayı ayda bir
// bile açsa oturumu düşmez. Süresi dolmuşsa yine normal giriş gerekir.
// ---------------------------------------------------------------------------
g.post('/auth/refresh', authUser, async (c) => {
  const user = c.get('user')
  const token = await makeJwt(c.env as Grup3Env, user)
  return c.json({ ok: true, token })
})

// POST /api/internal/register-ride (main.py:1049) — çağıran: activity-detect
g.post('/api/internal/register-ride', async (c) => {
  const env = c.env
  const body: any = await govdeAl(c)
  if (!secretOk(env.RENDER_DONE_SECRET, body?.secret)) return hataYanit(403, 'yetkisiz')
  const rid = String(body?.ride_id ?? '')
  if (!rid) return hataYanit(400, 'eksik')
  const now = simdi()
  // PARTIAL-MERGE: gönderilmeyen/None alanlar önceki kaydı KORUR (main.py:1060-1069)
  const prev = await env.DB.prepare('SELECT uid, date, ts, to_ts, ride_type, km, lat, lon FROM rides WHERE rid = ?1')
    .bind(rid).first<{ uid: string | null; date: string | null; ts: number; to_ts: number; ride_type: string | null; km: number | null; lat: number | null; lon: number | null }>()
  const date = body.date || prev?.date || null
  const ts = int0(body.ts || prev?.ts || 0)
  const to = int0(body.to || prev?.to_ts || 0)
  const tip = body.type || prev?.ride_type || ''
  const uid = body.user || prev?.uid || null
  const km = body.km !== null && body.km !== undefined ? Number(body.km) : (prev?.km ?? null)
  const lat = body.lat !== null && body.lat !== undefined ? Number(body.lat) : (prev?.lat ?? null)
  const lon = body.lon !== null && body.lon !== undefined ? Number(body.lon) : (prev?.lon ?? null)
  // Python tam-değiştirme semantiği: dr[rid] = {...} → uploaded/track_key de sıfırlanır
  await env.DB.prepare(
    `INSERT INTO rides (rid, uid, date, ts, to_ts, ride_type, km, lat, lon, uploaded, track_key, created_at, updated_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,0,NULL,?10,?10)
     ON CONFLICT(rid) DO UPDATE SET uid=?2, date=?3, ts=?4, to_ts=?5, ride_type=?6, km=?7, lat=?8, lon=?9,
       uploaded=0, track_key=NULL, updated_at=?10`)
    .bind(rid, uid, date, ts, to, tip, km, lat, lon, now).run()
  // 1.8 PAYLAŞILAN ROTA EŞLEŞTİRİCİ (main.py:1070-1102): km ±%25 + (koordinat varsa) başlangıç ≤2km
  const u: string | null = body.user || null
  const k = Number(body.km || 0) || 0
  const la = body.lat ?? null
  const lo = body.lon ?? null
  if (u && k > 1) {
    const adaylar = await env.DB.prepare(
      `SELECT sr.sid, sr.from_uid, sr.ride_id, sr.km, sr.ts FROM shared_routes sr
       JOIN shared_route_targets t ON t.sid = sr.sid
       WHERE t.uid = ?1 AND t.ridden_at IS NULL`)
      .bind(u).all<{ sid: string; from_uid: string; ride_id: string | null; km: number | null; ts: number }>()
    const bodyTs = int0(body.ts || 0)
    const profCache = new Map<string, { name: string | null; handle: string | null; lang: string | null } | null>()
    const prof = async (x: string) => {
      if (!profCache.has(x)) {
        profCache.set(x, await env.DB.prepare('SELECT name, handle, lang FROM users WHERE uid = ?1').bind(x)
          .first<{ name: string | null; handle: string | null; lang: string | null }>())
      }
      return profCache.get(x) ?? null
    }
    for (const sr of adaylar.results) {              // break YOK — tüm eşleşen paylaşımlar işlenir (main.py aynı)
      if (bodyTs <= int0(sr.ts || 0)) continue
      const skm = Number(sr.km || 0) || 0
      if (skm <= 1 || Math.abs(k - skm) / skm > 0.25) continue
      let src: { lat: number | null; lon: number | null } | null = null
      if (sr.ride_id) {
        src = await env.DB.prepare('SELECT lat, lon FROM rides WHERE rid = ?1').bind(sr.ride_id)
          .first<{ lat: number | null; lon: number | null }>()
      }
      if (la !== null && la !== undefined && src?.lat !== null && src?.lat !== undefined && src) {
        if (haversineKm(Number(la), Number(lo), Number(src.lat), Number(src.lon)) > 2.0) continue
      }
      await env.DB.prepare('UPDATE shared_route_targets SET ridden_at = ?1, updated_at = ?1 WHERE sid = ?2 AND uid = ?3')
        .bind(simdi(), sr.sid, u).run()
      const up = await prof(u)
      const fp = await prof(sr.from_uid)
      const rn = up?.name || up?.handle || 'Rider'
      const fl = fp?.lang || 'en'
      await pushq(env, { user: sr.from_uid, title: MT[fl] || MT.en, body: `${rn}: ${k.toFixed(1)} km ✅` })
      const ul = up?.lang || 'en'
      const fn = fp?.name || '?'
      await pushq(env, { user: u, title: MT[ul] || MT.en, body: `${fn} → ${k.toFixed(1)} km ✅` })
    }
  }
  return c.json({ ok: true })
})

// POST /api/internal/render-done (main.py:1107) — çağıran: RunPod/Cloud Run motoru (public kalmalı)
g.post('/api/internal/render-done', async (c) => {
  const env = c.env
  const body: any = await govdeAl(c)
  if (!secretOk(env.RENDER_DONE_SECRET, body?.secret)) return hataYanit(403, 'yetkisiz')
  const rid = String(body?.ride_id ?? '')
  const key = String(body?.key ?? '')
  if (!rid || !key) return hataYanit(400, 'eksik')
  const now = simdi()
  const gusers: string[] = (Array.isArray(body.users) ? body.users : []).filter((x: unknown) => !!x).map(String)
  const grup = !!body.group && gusers.length >= 2
  const user0: string | null = body.user ?? null
  const cvUid: string | null = grup ? (user0 || gusers[0]) : user0
  const ts = int0(body.ts || 0)
  const to = int0(body.to || 0)
  const size = int0(body.size || 0)
  // dict.get(k, default) eşleniği: varsayılan yalnız ANAHTAR YOKKEN devreye girer
  // (açık JSON null Python'da None kalır — ?? kullanmak onu da varsayılana çevirirdi)
  const mode = 'mode' in body ? body.mode : 'flyover'
  const speed = 'speed' in body ? body.speed : 'medium'
  const aspect = 'aspect' in body ? body.aspect : '16:9'
  const tip = 'type' in body ? body.type : ''
  const usersJson = grup ? JSON.stringify(gusers) : null
  // Python tam-değiştirme: cv sözlüğünde km YOK → mevcut kayıttaki km de silinir (km=NULL)
  const videoYaz = (vrid: string, vuid: string | null) => env.DB.prepare(
    `INSERT INTO videos (rid, uid, r2_key, date, ts, to_ts, ride_type, mode, speed, aspect, size, km, done_at, is_group, users_json, created_at, updated_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,NULL,?12,?13,?14,?15,?15)
     ON CONFLICT(rid) DO UPDATE SET uid=?2, r2_key=?3, date=?4, ts=?5, to_ts=?6, ride_type=?7, mode=?8,
       speed=?9, aspect=?10, size=?11, km=NULL, done_at=?12, is_group=?13, users_json=?14, updated_at=?15`)
    .bind(vrid, vuid, key, body.date ?? null, ts, to, tip, mode, speed, aspect, size, now, grup ? 1 : 0, usersJson, now)
  // 🔴 FİKS 05.09 — ÇİFT BİLDİRİM: upsert idempotent ama push her çağrıda yeniden kuyruğa
  // giriyordu. Aynı rid'i üç bağımsız tetikleyici bitmiş sayabiliyor (motorun render-done'u,
  // pending-reconcile FINALIZE — dakikalık, callback'le yarışıyor — ve yetim süpürmesi).
  const onceden = await env.DB.prepare('SELECT done_at FROM videos WHERE rid = ?1').bind(rid)
    .first<{ done_at: number | null }>()
  const yazimlar = [videoYaz(rid, cvUid)]
  if (grup) {
    // kullanıcı-başına kopya: rid_w2, rid_w3... (main.py:1130-1132)
    for (let i = 1; i < gusers.length; i++) yazimlar.push(videoYaz(`${rid}_w${i + 1}`, gusers[i]))
  }
  await env.DB.batch(yazimlar)
  if (grup) {
    // 'Sadece ortak video' tercihi: ±900sn örtüşen solo videoları gizle (main.py:1133-1144)
    const gfrom = int0(body.ts || 0)
    const gto = int0(body.to || 0)
    if (gfrom && gto) {
      const ph = gusers.map((_, i) => `?${i + 1}`).join(',')
      const n = gusers.length
      const solo = await env.DB.prepare(
        `SELECT v.rid FROM videos v JOIN users u ON u.uid = v.uid
         WHERE v.uid IN (${ph}) AND COALESCE(v.is_group, 0) = 0
           AND v.ts < ?${n + 1} AND v.to_ts > ?${n + 2}
           AND json_extract(u.prefs_json, '$.group_video') = 'group'
           AND v.rid NOT IN (SELECT rid FROM deleted_rides)`)
        .bind(...gusers, gto + 900, gfrom - 900).all<{ rid: string }>()
      if (solo.results.length) {
        await env.DB.batch(solo.results.map((r) =>
          env.DB.prepare('INSERT OR IGNORE INTO deleted_rides (rid, created_at, updated_at) VALUES (?1,?2,?2)').bind(r.rid, now)))
      }
    }
  }
  // MALİYET TELEMETRİSİ (main.py:1145-1154) — u0 = body.user (cv.user DEĞİL, grup fallback'sız)
  const gs = int0(body.gpu_secs || 0)
  if (body.user && gs > 0) {
    const ay = new Date().toISOString().slice(0, 7)                      // UTC YYYY-MM
    const g3d = body.ultra && body.mode === '3d' ? gs : 0                // body.mode ham (default'suz, main.py:1153)
    await env.DB.prepare(
      `INSERT INTO gpu_costs (uid, month, secs, videos, g3d_secs, created_at, updated_at)
       VALUES (?1,?2,?3,1,?4,?5,?5)
       ON CONFLICT(uid, month) DO UPDATE SET secs = secs + ?3, videos = videos + 1, g3d_secs = g3d_secs + ?4, updated_at = ?5`)
      .bind(String(body.user), ay, gs, g3d, now).run()
  }
  // kilit/hata kartı temizliği + yeniden üretimde gizlemeyi kaldır (main.py:1155-1159)
  await env.DB.batch([
    env.DB.prepare('DELETE FROM pending_videos WHERE vid = ?1').bind(rid),
    env.DB.prepare('DELETE FROM failed_videos WHERE vid = ?1').bind(rid),
    env.DB.prepare('DELETE FROM deleted_rides WHERE rid = ?1').bind(rid),
  ])
  // push istekleri (pushreq → KV push:bekleyen)
  const ridSan = rid.split('/').join('_')
  if (grup) {
    const ph = gusers.map((_, i) => `?${i + 1}`).join(',')
    const profs = await env.DB.prepare(`SELECT uid, name, handle, lang FROM users WHERE uid IN (${ph})`)
      .bind(...gusers).all<{ uid: string; name: string | null; handle: string | null; lang: string | null }>()
    const pm = new Map(profs.results.map((r) => [r.uid, r]))
    const nm = (x: string) => ((pm.get(x)?.name || pm.get(x)?.handle || '').trim()) || 'your friend'
    const gts = simdi()
    for (const gu of gusers) {                       // herkese KENDİ dilinde, arkadaş adlarıyla (main.py:1189-1194)
      const digerleri = gusers.filter((x) => x !== gu).map(nm).join(', ')
      const lng = pm.get(gu)?.lang || 'en'
      await pushreq(env, `${ridSan}_${gu}_${gts}`, {
        user: gu, title: GT[lng] || GT.en, body: (GB[lng] || GB.en).split('{f}').join(digerleri), ts: gts,
      })
    }
  } else if (user0 && !onceden?.done_at) {
    const pts = simdi()
    // '_ozet' rid'i ayrı metin (main.py:1200-1205 — moda göre DEĞİL, rid'e göre)
    const pr = await env.DB.prepare('SELECT lang FROM users WHERE uid = ?1').bind(user0)
      .first<{ lang: string | null }>()
    const rk = await env.DB.prepare('SELECT km FROM rides WHERE rid = ?1').bind(rid)
      .first<{ km: number | null }>()
    const v = videoPush(pr?.lang, rid.includes('_ozet'), ts || now, rk?.km ?? null, !!body.telefon)
    const pt = body.ptitle || v.title
    const pb = body.pbody || v.body
    // anahtar ARTIK zamansız → aynı rid ikinci kez kuyruğa yazılamaz; route:'videos' derin-link
    await pushreq(env, ridSan, { user: user0, title: pt, body: pb, ts: pts, route: 'videos' })
  }
  return c.json({ ok: true })
})

// POST /api/internal/render-failed (main.py:1243) — 'sonsuz Hazırlanıyor' hayaleti fix'i
g.post('/api/internal/render-failed', async (c) => {
  const env = c.env
  const body: any = await govdeAl(c)
  if (!secretOk(env.RENDER_DONE_SECRET, body?.secret)) return hataYanit(403, 'yetkisiz')
  const rid = String(body?.ride_id ?? '')
  if (!rid) return hataYanit(400, 'eksik')
  const reason = String(body?.reason ?? '').trim()
  const now = simdi()
  // pencere/tip pending'ten failed'a TAŞINIR — 'yeniden dene' doğru pencereyle çalışır (main.py:1255-1259)
  const pv = await env.DB.prepare('SELECT date, ts, to_ts, ride_type, mode FROM pending_videos WHERE vid = ?1')
    .bind(rid).first<{ date: string | null; ts: number; to_ts: number; ride_type: string | null; mode: string | null }>()
  await env.DB.batch([
    env.DB.prepare('DELETE FROM pending_videos WHERE vid = ?1').bind(rid),
    env.DB.prepare(
      `INSERT INTO failed_videos (vid, uid, reason, failed_at, date, ts, to_ts, ride_type, mode, created_at, updated_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)
       ON CONFLICT(vid) DO UPDATE SET uid=?2, reason=?3, failed_at=?4, date=?5, ts=?6, to_ts=?7, ride_type=?8, mode=?9, updated_at=?10`)
      .bind(rid, body.user ?? null, reason || 'GPS verisi yetersiz', now,
        pv?.date ?? null, pv?.ts ?? null, pv?.to_ts ?? null, pv?.ride_type ?? null, pv?.mode ?? null, now),
  ])
  const u: string | null = body.user ?? null
  if (u) {
    const pts = simdi()
    await pushreq(env, `fail_${rid.split('/').join('_')}_${pts}`, {
      user: u, title: 'Video oluşturulamadı',
      body: reason || 'Bu rota için yeterli GPS verisi yok.', ts: pts,   // push fallback'ı karttan FARKLI (main.py:1266)
    })
  }
  return c.json({ ok: true })
})

// GET /api/internal/music (main.py:2138) — RunPod/Cloud Run müzik çeker; _muzik_coz (main.py:2117) R2'ye portlandı
g.get('/api/internal/music', async (c) => {
  const env = c.env
  const q = c.req.query()
  // user query parametresi ZORUNLU — FastAPI eksikte 422 döner, secret kontrolünden ÖNCE (sözleşme notu)
  if (q.user === undefined) {
    return hataYanit(422, [{ type: 'missing', loc: ['query', 'user'], msg: 'Field required', input: null }])
  }
  if (!secretOk(env.RENDER_DONE_SECRET, q.secret ?? '')) return hataYanit(403, 'no')
  // path traversal koruması (main.py:2119/2125/2133 sanitizasyonları R2 anahtarına aynen)
  const user = String(q.user).replace(/[^A-Za-z0-9_-]/g, '')
  const ref = q.ref ?? ''
  const session = q.session ?? ''
  // öncelik sırası ORTAK _muzik_coz ile aynı: active -> lib -> upload+session -> stock
  let obj: R2ObjectBody | null = null
  if (ref === '' || ref === 'active') obj = await env.R2.get(`usermusic/${user}/active.m4a`)
  if (!obj && ref.startsWith('lib:')) {
    const mid = ref.slice(4).replace(/[^A-Za-z0-9]/g, '')
    obj = await env.R2.get(`usermusic/${user}/${mid}.m4a`)
  }
  if (!obj && ref === 'upload' && session) {
    const s = Math.trunc(Number.parseFloat(session))
    if (Number.isFinite(s)) obj = await env.R2.get(`ridephotos/${user}_${s}/music.m4a`)
  }
  if (!obj && ref.startsWith('stock:')) {
    const ad = ref.slice(6).replace(/[^A-Za-z0-9]/g, '')
    obj = await env.R2.get(`stockmusic/${ad}.m4a`)
  }
  if (!obj) return hataYanit(404, 'müzik yok')
  return new Response(obj.body, { headers: { 'content-type': 'audio/mp4' } })
})

// 18.09: POST /api/internal/badges KALDIRILDI — rozet kazanma özelliği çıktı.
// Tek çağıranı silinen cron görevi gorevler/rozet.ts idi.
// ⚠️ users.badges_json KOLONU DURUYOR (veri kaybı olmasın); artık hiç yazılmıyor.

// ============================================================================
// ARKADAŞLIK UÇLARI
// ============================================================================

// GET /api/friends (main.py:2921)
g.get('/api/friends', authUser, async (c) => {
  const user = c.get('user')
  const fl = await arkadasListesi(c.env, user)
  const b = await profilBaglam(c.env, fl)
  return c.json({ friends: fl.map((f) => profilOf(b, f)) })
})

// POST /api/friends/request (main.py:3931)
g.post('/api/friends/request', authUser, async (c) => {
  const body: any = await govdeAl(c)
  const sonuc = await arkadasIstegiYurut(c.env as Grup3Env, c.get('user'), body?.username)
  return c.json(sonuc)
})

// GET /api/friends/requests (main.py:3954) — zaman damgaları DÖNMEZ, yalnız profiller
g.get('/api/friends/requests', authUser, async (c) => {
  const env = c.env
  const user = c.get('user')
  const inc = await env.DB.prepare('SELECT requester_uid FROM friend_requests WHERE target_uid = ?1 ORDER BY created_at, rowid')
    .bind(user).all<{ requester_uid: string }>()
  const out = await env.DB.prepare('SELECT target_uid FROM friend_requests WHERE requester_uid = ?1 ORDER BY created_at, rowid')
    .bind(user).all<{ target_uid: string }>()
  const gelen = inc.results.map((x) => x.requester_uid)
  const giden = out.results.map((x) => x.target_uid)
  const b = await profilBaglam(env, [...gelen, ...giden])
  return c.json({ incoming: gelen.map((x) => profilOf(b, x)), outgoing: giden.map((x) => profilOf(b, x)) })
})

// POST /api/friends/respond (main.py:3962) — yalnız BANA gelen istek yanıtlanabilir (IDOR)
g.post('/api/friends/respond', authUser, async (c) => {
  const env = c.env as Grup3Env
  const user = c.get('user')
  const body: any = await govdeAl(c)
  const other = await resolveUser(env, body?.username)
  const accept = !!body?.accept
  const istek = other
    ? await env.DB.prepare('SELECT 1 AS x FROM friend_requests WHERE target_uid = ?1 AND requester_uid = ?2').bind(user, other).first()
    : null
  if (!other || !istek) return hataYanit(404, 'istek bulunamadı')
  if (accept) {
    await arkadasYap(env, user, other)
    const meLabel = await benimEtiket(env, user)
    await pushq(env, { user: other, title: 'Move Log', body: `${meLabel} arkadaşlık isteğini kabul etti 🎉`, route: 'friends' })
  } else {
    // sessiz red: iz bırakmaz, karşı tarafa push YOK (main.py:3974-3975)
    await env.DB.prepare('DELETE FROM friend_requests WHERE target_uid = ?1 AND requester_uid = ?2').bind(user, other).run()
  }
  const fl = await arkadasListesi(env, user)
  const b = await profilBaglam(env, fl)
  return c.json({ ok: true, friends: fl.map((f) => profilOf(b, f)) })
})

// POST /api/friends (main.py:3980) — GERİYE UYUMLULUK: eski 'anında ekle' artık İSTEK oluşturur.
// Karşılıklı istek oto-kabule dönse bile yanıt DAİMA requested:true (eski app friends listesinden anlar).
g.post('/api/friends', authUser, async (c) => {
  const env = c.env as Grup3Env
  const user = c.get('user')
  const body: any = await govdeAl(c)
  const target = await resolveUser(env, body?.username)
  if (!target || target === user) return hataYanit(404, 'kullanıcı bulunamadı')
  await arkadasIstegiYurut(env, user, target)
  const fl = await arkadasListesi(env, user)          // istek sonrası TAZE liste (main.py:3989)
  const b = await profilBaglam(env, fl)
  return c.json({ ok: true, requested: true, friends: fl.map((f) => profilOf(b, f)) })
})

// DELETE /api/friends/{uname} (main.py:3994) — İDEMPOTENT (404 yok); yalnız internal id, handle ÇÖZÜLMEZ.
// freqs bilerek TEMİZLENMEZ (main.py davranışı korunur).
g.delete('/api/friends/:uname', authUser, async (c) => {
  const user = c.get('user')
  const uname = c.req.param('uname')
  await c.env.DB.prepare('DELETE FROM friends WHERE (uid = ?1 AND friend_uid = ?2) OR (uid = ?2 AND friend_uid = ?1)')
    .bind(user, uname).run()
  return c.json({ ok: true })
})

export default g
